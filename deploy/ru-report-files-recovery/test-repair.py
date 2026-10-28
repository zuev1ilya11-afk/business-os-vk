"""Integration tests against a read-only copy of the pinned production web root.

Set BOS_TEST_WEB to that copy. No production writes or network calls are made.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from urllib.parse import urlsplit

spec = importlib.util.spec_from_file_location('repair', Path(__file__).with_name('repair.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

class RepairTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.parent = Path(self.temp.name)
        self.root = self.parent / 'web'
        shutil.copytree(os.environ['BOS_TEST_WEB'], self.root)
        self.stage = self.parent / 'backup'
        self.old, self.new, self.build = r.prepare(self.root)

    def assertOriginal(self):
        for name, data in self.old.items():
            self.assertEqual((self.root / name).read_bytes(), data)

    def test_manifest_shell_worker_and_all_assets_consistent(self):
        self.assertNotEqual(self.build, r.BEFORE_BUILD)
        meta = r.manifest(self.new['build-version.js'])
        self.assertEqual(meta['id'], self.build)
        self.assertEqual(meta['shell'], r.digest(self.new['index.html']))
        self.assertIn(("const BUILD_ID='" + self.build + "';").encode(), self.new['sw.js'])
        self.assertNotIn(r.BEFORE_BUILD.encode(), self.new['index.html'])
        for name, expected in meta['assets'].items():
            self.assertEqual(r.digest(self.new.get(name, (self.root / name).read_bytes())), expected, name)
        self.assertEqual(set(self.new), set(r.RUNTIME))
        self.assertOriginal()

    def test_module_patch_does_not_change_other_modules(self):
        def modules(data):
            parts = data.split(b'\n;\n// Source: ')
            return {part.split(b'\n', 1)[0]: part for part in parts}
        old, new = modules(self.old['startup-shell.bundle.js']), modules(self.new['startup-shell.bundle.js'])
        self.assertEqual(set(old), set(new))
        self.assertEqual([name for name in old if old[name] != new[name]], [b'master-report-patch.js', b'report-review-patch.js'])

    def test_reject_different_bundle_or_asset_without_writes(self):
        with self.assertRaises(r.Stop):r.patch_bundle(self.old['startup-shell.bundle.js'] + b'changed')
        (self.root / 'startup-shell.bundle.js').write_bytes(b'changed')
        with self.assertRaises(r.Stop):r.prepare(self.root)
        self.assertFalse(self.stage.exists())

    def test_reject_changed_build(self):
        p = self.root / 'build-version.js'
        p.write_bytes(p.read_bytes().replace(r.BEFORE_BUILD.encode(), b'0'*20))
        with self.assertRaises(r.Stop):r.prepare(self.root)

    def test_reject_symlink(self):
        p = self.root / 'sw.js'; p.unlink(); p.symlink_to(Path(os.environ['BOS_TEST_WEB']) / 'sw.js')
        with self.assertRaises(r.Stop):r.prepare(self.root)

    def test_install_exact_verification_then_rollback(self):
        def verify(files):
            r.verify_public(files, self.build, lambda url:(self.root / (urlsplit(url).path.lstrip('/') or 'index.html')).read_bytes())
        record = r.install(self.root, self.stage, self.old, self.new, r.RELEASE, verify)
        self.assertEqual(record['status'], 'deployed')
        self.assertEqual(self.stage.stat().st_mode & 0o777, 0o700)
        for name, data in self.new.items():self.assertEqual((self.root / name).read_bytes(), data)
        r.rollback(self.root, self.stage, record)
        self.assertOriginal()
        self.assertEqual(json.loads((self.stage/'journal.json').read_text())['status'], 'rolled_back')

    def test_failed_public_check_automatically_rolls_back(self):
        def fail(files):raise r.Stop('simulated HTTPS mismatch')
        with self.assertRaisesRegex(r.Stop, 'simulated'):
            r.install(self.root, self.stage, self.old, self.new, r.RELEASE, fail)
        self.assertOriginal()

    def test_rollback_refuses_concurrent_edit(self):
        record = r.install(self.root, self.stage, self.old, self.new, r.RELEASE, lambda _:None)
        (self.root / 'index.html').write_bytes(b'another deployment')
        with self.assertRaisesRegex(r.Stop, 'changed outside'):r.rollback(self.root, self.stage, record)
        self.assertEqual((self.root / 'index.html').read_bytes(), b'another deployment')
        self.assertEqual((self.root / 'startup-shell.bundle.js').read_bytes(), self.new['startup-shell.bundle.js'])

    def test_public_byte_mismatch_rejected(self):
        with self.assertRaises(r.Stop):r.verify_public(self.new, self.build, lambda _:b'wrong')

if __name__ == '__main__':unittest.main()
