import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import app_cli


class OperatorFiles(unittest.TestCase):
    def test_selects_matching_manifest_not_first_existing_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / 'tools'
            package.mkdir()
            first = package / 'BOS-Backup'
            first.mkdir()
            (first / 'manifest.json').write_bytes(b'other capture')
            wanted = root / 'BOS-Backup'
            wanted.mkdir()
            raw = b'exact reported capture'
            (wanted / 'manifest.json').write_bytes(raw)
            report = {'source_manifest_sha256': hashlib.sha256(raw).hexdigest()}
            self.assertEqual(app_cli.select_bundle(None, report, package), wanted)
            with self.assertRaisesRegex(app_cli.Stop, 'APP_MATCHING_BACKUP_NOT_FOUND'):
                app_cli.select_bundle(str(first), report, package)

    def test_report_read_rejects_incomplete_and_large_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'restore.json'
            for content in ('{}', '[]', 'x' * 65537,
                            '{"status":"STOPPED","source_manifest_sha256":"' + 'a' * 64 + '"}'):
                path.write_text(content)
                with self.assertRaisesRegex(app_cli.Stop, 'APP_RESTORE_REPORT_INVALID'):
                    app_cli.read_report(path)
            good = {'status': 'DRILL_COMPLETED', 'source_manifest_sha256': 'a' * 64}
            path.write_text(json.dumps(good), encoding='utf-8-sig')
            self.assertEqual(app_cli.read_report(path), good)

    def test_report_creation_never_overwrites_original(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'report.json'
            app_cli.write_report(path, {'first': True})
            with self.assertRaises(FileExistsError):
                app_cli.write_report(path, {'second': True})
            self.assertEqual(json.loads(path.read_text()), {'first': True})

    def test_unknown_exception_is_never_rendered(self):
        self.assertEqual(app_cli.safe_code(RuntimeError('private customer password')),
                         'APP_LAUNCH_FAILED')
        for value in ('PRIVATE=secret', 'https://private', 'PRIVATE\nsecret', 'x' * 200):
            self.assertEqual(app_cli.safe_code(app_cli.Stop(value)), 'APP_LAUNCH_FAILED')
        self.assertEqual(app_cli.safe_code(app_cli.Stop('APP_BASELINE_CHANGED')), 'APP_BASELINE_CHANGED')


if __name__ == '__main__':
    unittest.main()
