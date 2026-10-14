"""Filesystem integration tests; Docker/network boundaries are explicit fakes."""
import copy
import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'package'))
import frontend as f
import backend as b
import release as r

META = json.loads((HERE/'package/release.json').read_text())
with zipfile.ZipFile(HERE/'bos289.pyz') as archive:
    FILES = {n: archive.read('payload/'+n) for n in META['after']}
BASE_FILES = {n: ('pinned baseline fixture: '+n+'\n').encode() for n in META['before']}
META['before'] = {n:f.sha(data) for n,data in BASE_FILES.items()}
OPTIONAL = {}
PATCHED = (HERE/'package/push-api.ts').read_bytes()
BASELINE = PATCHED.replace(b"'https://139.100.237.167',", b'')
REAL_COMMAND = f.command


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.parent = Path(self.temp.name)
        self.root = self.parent/'release-test/web'
        self.root.mkdir(parents=True)
        for n in META['before']:
            (self.root/n).write_bytes(BASE_FILES[n])
        (self.root/'unrelated.txt').write_text('retain runtime settings')
        self.edge = dict(Id='edge-id', Name='/bos-release-test-edge', Image='sha256:fixed',
                         Config={'Image':'edge:tag', 'Env':['VK_APP_SECRET=preserve-secret'],
                                 'Entrypoint':['edge-runtime'], 'Cmd':['start','--main-service','/bos-main']},
                         HostConfig={'NetworkMode':'existing'}, Mounts=[], State={'Running':True, 'Pid':123})
        self.web = dict(Id='web-id', Name='/bos-release-test-https',
                        Config={'Image':'caddy:2'}, HostConfig={},
                        Mounts=[dict(Type='bind', Source=str(self.root), Destination='/srv')], State={'Running':True})
        self.roots = {}
        for folder, mount in b.MOUNTS.items():
            path = self.root.parent/folder
            path.mkdir()
            self.roots[folder] = str(path)
            self.edge['Mounts'].append(dict(Type='bind', Source=str(path), Destination=mount))
        (Path(self.roots['sources'])/'push-api').mkdir()
        (Path(self.roots['sources'])/'push-api/index.ts').write_bytes(BASELINE)
        (Path(self.roots['sources'])/'other-api.ts').write_text('unchanged private handler')
        (Path(self.roots['bundles'])/'push-api.eszip').write_bytes(b'old-bundle'*20)
        (Path(self.roots['bundles'])/'other.eszip').write_bytes(b'unchanged compiled handler')
        (Path(self.roots['main'])/'index.ts').write_text('Deno.serve; /bos-bundles/ .eszip')
        f.PARENT = self.parent
        f.STAGE = self.parent/'pr289-web'
        b.STAGE = self.parent/'pr289-api'
        self.before = f.snapshot(self.root)
        self.backend_before = {k: f.snapshot(Path(p)) for k,p in self.roots.items()}
        self.restarts = []
        self.fail_restart = None
        self.fail_http = False
        self.info = dict(container=self.edge['Id'], fingerprint=f.fingerprint(self.edge),
                         image=self.edge['Image'], config=copy.deepcopy(self.edge['Config']),
                         roots=self.roots, before=self.backend_before, environment={})
        self.patches = [patch.object(f,'command',self.command), patch.object(f,'http_get',self.http_get),
                        patch.object(f,'emit',lambda x:None), patch.object(b,'compile_candidate',self.compile),
                        patch.object(b,'probe_candidate',lambda rec:None),
                        patch.object(b,'probe_live',lambda rec,cors=True:None)]
        for p in self.patches: p.start()

    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()

    def command(self, args, timeout=60):
        if args[0] != 'docker': return REAL_COMMAND(args,timeout)
        if args[1:3] == ['ps','-q']: return b'web-id edge-id\n'
        if args[1:3] == ['ps','-aq']: return b''
        if args[1] == 'inspect':
            data = {'web-id':self.web, 'edge-id':self.edge}
            return json.dumps([data[cid] for cid in args[2:]]).encode()
        if args[1] == 'restart':
            cid = args[-1]
            self.restarts.append(cid)
            if cid == self.fail_restart:
                self.fail_restart = None
                raise f.Stop('simulated restart failure')
            return cid.encode()
        if args[1] == 'exec' and args[-2:] == ['cat','/srv/build-version.js']:
            return (self.root/'build-version.js').read_bytes()
        raise AssertionError('unexpected action: '+str(args))

    def http_get(self, origin, name):
        if self.fail_http and name == 'mobile-viewport.js':
            self.fail_http = False
            return b'wrong public content'
        return (self.root/name).read_bytes()

    def compile(self, rec, patched):
        (b.STAGE/'sources/push-api/index.ts').write_bytes(patched)
        (b.STAGE/'bundles/push-api.eszip').write_bytes(b'new-compiled-bundle'*20)

    def prepare(self): return b.prepare(self.info,PATCHED)

    def test_frontend_readonly_preflight(self):
        f.preflight(META,OPTIONAL)
        self.assertFalse(f.STAGE.exists())
        self.assertEqual(f.snapshot(self.root),self.before)

    def test_frontend_atomic_apply_and_rollback(self):
        f.apply(META,FILES,OPTIONAL)
        rec=json.loads((f.STAGE/'journal.json').read_text())
        self.assertEqual(rec['state'],'active')
        self.assertEqual((self.root/'unrelated.txt').read_text(),'retain runtime settings')
        f.restore(META,rec)
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual(self.restarts,['web-id','web-id'])

    def test_frontend_http_failure_rolls_back(self):
        self.fail_http=True
        with self.assertRaises(f.Stop): f.apply(META,FILES,OPTIONAL)
        self.assertEqual(f.snapshot(self.root),self.before)

    def test_frontend_restart_failure_rolls_back(self):
        self.fail_restart='web-id'
        with self.assertRaises(f.Stop): f.apply(META,FILES,OPTIONAL)
        self.assertEqual(f.snapshot(self.root),self.before)

    def test_frontend_drift_stops_before_backup(self):
        (self.root/'web-push-v211.js').write_text('other approved version')
        with self.assertRaises(f.Stop): f.apply(META,FILES,OPTIONAL)
        self.assertFalse(f.STAGE.exists())

    def test_frontend_rollback_refuses_later_changes(self):
        f.apply(META,FILES,OPTIONAL)
        rec=json.loads((f.STAGE/'journal.json').read_text())
        (self.root/'unrelated.txt').write_text('later deployment')
        with self.assertRaises(f.Stop): f.restore(META,rec)
        self.assertEqual((self.root/'unrelated.txt').read_text(),'later deployment')

    def test_prepare_retains_production_files_and_config(self):
        config=copy.deepcopy(self.edge)
        rec=self.prepare()
        self.assertEqual(rec['state'],'prepared')
        self.assertEqual(self.edge,config)
        self.assertEqual(self.restarts,[])
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def test_backend_activation_rollback_preserves_every_other_file_and_mode(self):
        rec=self.prepare()
        b.activate(rec)
        self.assertEqual(rec['state'],'active')
        self.assertEqual((Path(self.roots['sources'])/'push-api/index.ts').read_bytes(),PATCHED)
        b.restore(rec)
        self.assertEqual(rec['state'],'rolled_back')
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)
        self.assertEqual(self.restarts,['edge-id','edge-id'])

    def test_backend_unrelated_drift_blocks_activation(self):
        rec=self.prepare()
        p=Path(self.roots['sources'])/'other-api.ts'
        p.write_text('later hotfix')
        with self.assertRaises(f.Stop): b.activate(rec)
        self.assertEqual(p.read_text(),'later hotfix')
        self.assertEqual(self.restarts,[])

    def test_backend_config_drift_blocks_activation(self):
        rec=self.prepare()
        self.edge['Config']['Env']=['different settings']
        with self.assertRaises(f.Stop): b.activate(rec)
        self.assertEqual(self.restarts,[])

    def test_backend_backup_corruption_blocks_rollback(self):
        rec=self.prepare()
        b.activate(rec)
        (b.STAGE/'backup/index.ts').write_text('corrupt')
        with self.assertRaises(f.Stop): b.restore(rec)
        self.assertEqual(len(self.restarts),1)

    def test_interruption_between_backend_file_replacements_is_recoverable(self):
        rec=self.prepare()
        rec['state']='activating'
        b.save(rec)
        p=Path(self.roots['sources'])/'push-api/index.ts'
        f.write_candidate(p.parent,p.name,PATCHED,p.stat())
        b.restore(rec)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def test_backend_later_target_drift_refuses_rollback(self):
        rec=self.prepare()
        b.activate(rec)
        p=Path(self.roots['sources'])/'push-api/index.ts'
        p.write_text('another deployment')
        with self.assertRaises(f.Stop): b.restore(rec)
        self.assertEqual(p.read_text(),'another deployment')

    def test_compile_failure_never_touches_production(self):
        with patch.object(b,'compile_candidate',side_effect=f.Stop('baseline mismatch')):
            with self.assertRaises(f.Stop): self.prepare()
        self.assertEqual(self.restarts,[])
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def test_combined_frontend_failure_restores_both_components(self):
        rec=self.prepare()
        self.fail_http=True
        with self.assertRaises(f.Stop): r.activate_all(META,FILES,OPTIONAL,rec)
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def test_combined_edge_restart_failure_restores_backend(self):
        rec=self.prepare()
        self.fail_restart='edge-id'
        with self.assertRaises(f.Stop): r.activate_all(META,FILES,OPTIONAL,rec)
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def test_combined_success_and_rollback(self):
        rec=self.prepare()
        r.activate_all(META,FILES,OPTIONAL,rec)
        r.rollback_all(META)
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def test_patch_is_exactly_one_cors_origin(self):
        self.assertEqual(f.sha(BASELINE),b.SOURCE_BEFORE)
        self.assertEqual(f.sha(PATCHED),b.SOURCE_AFTER)
        self.assertEqual(PATCHED.count(b"'https://139.100.237.167',"),1)

    def test_distributed_package_matches_reviewed_source_and_hashes(self):
        with zipfile.ZipFile(HERE/'bos289.pyz') as archive:
            for name in ['frontend.py','backend.py','release.py','__main__.py','push-api.ts','release.json']:
                self.assertEqual(archive.read(name),(HERE/'package'/name).read_bytes())
            real_meta=json.loads(archive.read('release.json'))
            for name,digest in real_meta['after'].items():
                self.assertEqual(f.sha(archive.read('payload/'+name)),digest)
            build=archive.read('payload/build-version.js').decode().split('self.BOS_BUILD=',1)[1].rstrip(';\n')
            self.assertEqual(json.loads(build)['id'],real_meta['after_build'])

    def test_frontend_backup_failure_never_activates_backend(self):
        rec=self.prepare()
        with patch.object(f,'copy_tree',side_effect=f.Stop('disk full')):
            with self.assertRaisesRegex(f.Stop,'was rolled back'):
                r.activate_all(META,FILES,OPTIONAL,rec)
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)
        self.assertEqual(self.restarts,[])

    def test_unjournalled_frontend_stage_does_not_prevent_backend_recovery(self):
        rec=self.prepare()
        b.activate(rec)
        f.STAGE.mkdir()
        (f.STAGE/'unfinished-copy').write_text('partial private backup')
        r.rollback_all(META)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)
        self.assertEqual((f.STAGE/'unfinished-copy').read_text(),'partial private backup')

    def test_rollback_https_failure_still_restores_backend_files(self):
        rec=self.prepare()
        r.activate_all(META,FILES,OPTIONAL,rec)
        with patch.object(f,'public_verify',side_effect=f.Stop('network unavailable')):
            with self.assertRaisesRegex(f.Stop,'verification incomplete'): r.rollback_all(META)
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def test_rollback_and_retry_archives_both_backups(self):
        rec=self.prepare()
        r.activate_all(META,FILES,OPTIONAL,rec)
        r.rollback_all(META)
        api=r.load(b.STAGE); web=r.load(f.STAGE)
        backups={str(p):f.snapshot(p) for p in [b.STAGE,f.STAGE]}
        r.archive_inactive(META,api,web)
        self.assertFalse(b.STAGE.exists()); self.assertFalse(f.STAGE.exists())
        for original,expected in backups.items():
            archived=list(self.parent.glob(Path(original).name+'-history-*'))
            self.assertEqual(len(archived),1)
            self.assertEqual(f.snapshot(archived[0]),expected)
        retry=self.prepare()
        r.activate_all(META,FILES,OPTIONAL,retry)
        self.assertEqual(retry['state'],'active')

    def test_retry_refuses_active_backend(self):
        rec=self.prepare()
        b.activate(rec)
        with self.assertRaisesRegex(f.Stop,'interrupted'): r.archive_inactive(META,rec,None)
        self.assertTrue(b.STAGE.exists())

if __name__ == '__main__': unittest.main(verbosity=2)
