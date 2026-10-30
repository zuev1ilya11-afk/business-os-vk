import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


class RehearsalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'bos-staging-rehearsal'
        spec = importlib.util.spec_from_file_location('rehearse', HERE / 'rehearse.py')
        self.r = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.r)

    def test_check_is_read_only(self):
        self.r.check_target(self.root)
        self.assertFalse(self.root.exists())

    def test_existing_target_is_never_overwritten(self):
        self.root.mkdir()
        with self.assertRaises(self.r.Stop):
            self.r.check_target(self.root)

    def test_target_must_be_new_private_scratch_location(self):
        for path in [Path('/opt/bos-staging-new'), Path('/tmp/production'), Path('bos-staging-relative')]:
            with self.subTest(path=path), self.assertRaises(self.r.Stop):
                self.r.check_target(path)

    def test_symlink_parent_is_rejected(self):
        link = Path(self.tmp.name) / 'link'
        link.symlink_to(Path(self.tmp.name), target_is_directory=True)
        with self.assertRaises(self.r.Stop):
            self.r.check_target(link / 'bos-staging-new')

    def test_real_release_core_restores_bytes_but_retains_new_data(self):
        result = self.r.rehearse(self.root)
        self.assertTrue(result['successful_release_and_manual_rollback'])
        self.assertTrue(result['failed_release_and_automatic_rollback'])
        self.assertTrue(result['separate_frontend_restore_hashes_match'])
        self.assertEqual((self.root / 'synthetic-business-change.txt').read_text(), 'created-after-backup')
        self.assertEqual(result['scope'], 'local-frontend-rehearsal-only')
        self.assertFalse(result['server_staging_ready'])
        self.assertEqual(json.loads((self.root / 'failed-release' / 'journal.json').read_text())['status'], 'rolled_back')


if __name__ == '__main__':
    unittest.main()
