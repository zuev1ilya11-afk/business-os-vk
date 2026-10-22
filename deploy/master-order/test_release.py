"""Real filesystem/atomic exchange tests; Docker and HTTPS are explicit fakes."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE/'package'))
import frontend as f
import release as r

REAL_COMMAND = f.command
REAL_META = json.loads((HERE/'package/release.json').read_text())
with zipfile.ZipFile(HERE/'bos300.pyz') as z:
    FILES = {n: z.read('payload/'+n) for n in REAL_META['after']}
    OPTIONAL = {n: z.read('optional/'+n) for n in REAL_META['optional']}

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.parent = Path(self.temp.name)
        self.root = self.parent/'release-test/web'
        self.root.mkdir(parents=True)
        self.meta = copy.deepcopy(REAL_META)
        for name in self.meta['before']:
            path = self.root/name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('synthetic baseline: '+name)
            self.meta['before'][name] = f.sha(path.read_bytes())
        self.optional = dict(OPTIONAL)
        for name in self.optional:
            (self.root/name).write_text('synthetic optional: '+name)
            self.meta['optional'][name]['before'] = f.sha((self.root/name).read_bytes())
        (self.root/'unrelated.txt').write_text('RU settings preserved')
        (self.root/'unrelated.txt').chmod(0o640)
        self.web = dict(Id='web-id', Name='/bos-release-test-https', Config={'Image': 'caddy:2'},
                        HostConfig={}, Mounts=[dict(Type='bind', Source=str(self.root), Destination='/srv')],
                        State={'Running': True})
        self.restarts = []
        self.fail_restart = False
        self.fail_http = False
        self.patches = [patch.object(f, 'PARENT', self.parent), patch.object(f, 'STAGE', self.parent/'master-order-300-web'),
                        patch.object(f, 'command', self.command), patch.object(f, 'http_get', self.http),
                        patch.object(f, 'emit', lambda message: None)]
        for p in self.patches:
            p.start()
        self.before = f.snapshot(self.root)

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def command(self, args, timeout=60):
        if args[0] != 'docker':
            return REAL_COMMAND(args, timeout)
        if args[1:3] == ['ps', '-q']:
            return b'web-id\n'
        if args[1] == 'inspect':
            self.assertEqual(args[2:], ['web-id'])
            return json.dumps([self.web]).encode()
        if args[1] == 'exec' and args[2:] == ['web-id', 'cat', '/srv/build-version.js']:
            return (self.root/'build-version.js').read_bytes()
        if args[1] == 'restart':
            self.assertEqual(args[-1], 'web-id')
            self.restarts.append('web-id')
            if self.fail_restart:
                self.fail_restart = False
                raise f.Stop('simulated restart failure')
            return b'web-id'
        raise AssertionError('Unexpected Docker operation: '+str(args))

    def http(self, origin, name):
        self.assertEqual(origin, 'https://139.100.237.167')
        if self.fail_http and name == 'approved-master-ui.css':
            self.fail_http = False
            return b'wrong response'
        return (self.root/name).read_bytes()

    def apply(self):
        r.execute('apply', self.meta, FILES, self.optional)

    def test_check_is_read_only(self):
        r.execute('check', self.meta, FILES, self.optional)
        self.assertFalse(f.STAGE.exists())
        self.assertEqual(self.restarts, [])
        self.assertEqual(f.snapshot(self.root), self.before)

    def test_success_and_rollback_preserve_every_other_file_and_mode(self):
        config = copy.deepcopy(self.web)
        self.apply()
        rec = r.load()
        self.assertEqual(rec['state'], 'active')
        self.assertEqual(self.web, config)
        self.assertEqual((self.root/'unrelated.txt').stat().st_mode & 0o777, 0o640)
        for name, data in {**FILES, **self.optional}.items():
            self.assertEqual((self.root/name).read_bytes(), data)
        r.execute('rollback', self.meta, FILES, self.optional)
        self.assertEqual(f.snapshot(self.root), self.before)
        self.assertEqual(self.restarts, ['web-id', 'web-id'])

    def test_repeated_apply_only_verifies(self):
        self.apply()
        after = f.snapshot(f.STAGE)
        self.apply()
        self.assertEqual(self.restarts, ['web-id'])
        self.assertEqual(f.snapshot(f.STAGE), after)

    def test_public_verification_failure_restores_original(self):
        self.fail_http = True
        with self.assertRaisesRegex(f.Stop, 'rolled back'):
            self.apply()
        self.assertEqual(f.snapshot(self.root), self.before)
        self.assertEqual(r.load()['state'], 'rolled_back')

    def test_restart_failure_restores_original(self):
        self.fail_restart = True
        with self.assertRaisesRegex(f.Stop, 'rolled back'):
            self.apply()
        self.assertEqual(f.snapshot(self.root), self.before)

    def test_changed_baseline_stops_before_backup(self):
        (self.root/'approved-master-ui.css').write_text('later hotfix')
        with self.assertRaises(f.Stop):
            self.apply()
        self.assertFalse(f.STAGE.exists())
        self.assertEqual(self.restarts, [])

    def test_changed_optional_module_stops_before_backup(self):
        (self.root/'master-help-entry.js').write_text('later help editor')
        with self.assertRaises(f.Stop):
            self.apply()
        self.assertFalse(f.STAGE.exists())

    def test_missing_optional_sources_stay_missing(self):
        for name in self.optional:
            (self.root/name).unlink()
        self.apply()
        for name in self.optional:
            self.assertFalse((self.root/name).exists())

    def test_rollback_refuses_later_unrelated_deployment(self):
        self.apply()
        (self.root/'unrelated.txt').write_text('new release')
        with self.assertRaisesRegex(f.Stop, 'later changes'):
            r.execute('rollback', self.meta, FILES, self.optional)
        self.assertEqual(self.restarts, ['web-id'])

    def test_interrupted_swap_is_recoverable(self):
        rec = f.prepare(self.meta, FILES, self.optional)
        rec['state'] = 'activating'
        f.save(rec)
        f.exchange(self.root, f.STAGE/'swap')
        with self.assertRaisesRegex(f.Stop, 'Interrupted'):
            self.apply()
        r.execute('rollback', self.meta, FILES, self.optional)
        self.assertEqual(f.snapshot(self.root), self.before)

    def test_partial_preparation_keeps_files_and_can_retry(self):
        f.STAGE.mkdir(mode=0o700)
        (f.STAGE/'partial').write_text('retain evidence')
        self.apply()
        archived = list(self.parent.glob('master-order-300-web-history-*'))
        self.assertEqual(len(archived), 1)
        self.assertEqual((archived[0]/'partial').read_text(), 'retain evidence')

    def test_backup_failure_does_not_activate(self):
        with patch.object(f, 'copy_tree', side_effect=f.Stop('disk full')):
            with self.assertRaisesRegex(f.Stop, 'disk full'):
                self.apply()
        self.assertEqual(f.snapshot(self.root), self.before)
        self.assertEqual(self.restarts, [])

    def test_corrupt_backup_blocks_rollback(self):
        self.apply()
        (f.STAGE/'backup/index.html').write_text('corrupt')
        with self.assertRaisesRegex(f.Stop, 'Backup changed'):
            r.execute('rollback', self.meta, FILES, self.optional)

    def test_retry_archives_complete_backup(self):
        self.apply()
        r.execute('rollback', self.meta, FILES, self.optional)
        previous = f.snapshot(f.STAGE)
        self.apply()
        archived = list(self.parent.glob('master-order-300-web-history-*'))
        self.assertEqual(len(archived), 1)
        self.assertEqual(f.snapshot(archived[0]), previous)

    def test_container_drift_refuses_rollback(self):
        self.apply()
        self.web['Config']['Image'] = 'new configuration'
        with self.assertRaisesRegex(f.Stop, 'configuration changed'):
            r.execute('rollback', self.meta, FILES, self.optional)

    def test_package_matches_sources_and_hashes(self):
        with zipfile.ZipFile(HERE/'bos300.pyz') as z:
            for name in ['frontend.py', 'release.py', '__main__.py', 'release.json']:
                self.assertEqual(z.read(name), (HERE/'package'/name).read_bytes())
            self.assertFalse(any('backend' in n or n.endswith('.sql') for n in z.namelist()))
            meta = json.loads(z.read('release.json'))
            manifest = json.loads(z.read('payload/build-version.js').split(b'self.BOS_BUILD=')[1][:-2])
            self.assertEqual(manifest['id'], meta['after_build'])
            for name, digest in meta['after'].items():
                data = z.read('payload/'+name)
                self.assertEqual(f.sha(data), digest)
                if name in manifest['assets']:
                    self.assertEqual(f.sha(data), manifest['assets'][name])
            self.assertEqual(f.sha(z.read('payload/index.html')), manifest['shell'])
            self.assertIn(meta['after_build'].encode(), z.read('payload/sw.js'))

if __name__ == '__main__':
    unittest.main(verbosity=2)
