import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import subprocess

import rehearse_restore as rr

class RehearsalTests(unittest.TestCase):
    def test_cleanup_timeout_never_reports_verified_stop(self):
        with patch('rehearse_restore.subprocess.run', side_effect=subprocess.TimeoutExpired('docker', 40)):
            self.assertFalse(rr.stop_trial('a' * 64))

    def test_still_running_after_stop_never_reports_verified_stop(self):
        with patch('rehearse_restore.subprocess.run', side_effect=[
            subprocess.CompletedProcess([], 0, '', ''),
            subprocess.CompletedProcess([], 0, 'true\n', ''),
        ]):
            self.assertFalse(rr.stop_trial('a' * 64))
    def test_duplicate_builtin_roles_become_conditional_without_losing_attributes(self):
        raw = 'CREATE ROLE postgres;\nALTER ROLE postgres NOSUPERUSER;\nGRANT anon TO postgres;\n'
        actual = rr.adapt_roles(raw, 'bos_restore_loader')
        self.assertIn("WHERE rolname = 'postgres'", actual)
        self.assertIn('THEN CREATE ROLE postgres;', actual)
        self.assertIn('ALTER ROLE postgres NOSUPERUSER;', actual)
        self.assertIn('GRANT anon TO postgres;', actual)

    def test_loader_collision_refuses_role_file(self):
        with self.assertRaises(ValueError):
            rr.adapt_roles('CREATE ROLE bos_restore_loader;\n', 'bos_restore_loader')

    def test_unrecognized_role_syntax_stops_instead_of_bypassing_conversion(self):
        with self.assertRaises(ValueError):
            rr.adapt_roles('CREATE ROLE "a-b";\n', 'bos_restore_loader')

    def test_checksum_mismatch_is_rejected_without_changing_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            for name in ('source.dump', 'roles.sql', 'contents.txt'):
                (p/name).write_bytes(b'original')
            checksum = hashlib.sha256(b'original').hexdigest()
            (p/'SHA256SUMS').write_text(''.join(f'{checksum}  {name}\n' for name in ('source.dump','roles.sql','contents.txt')))
            rr.validate_backup(p)
            (p/'source.dump').write_bytes(b'changed')
            with self.assertRaises(ValueError):
                rr.validate_backup(p)
            self.assertEqual((p/'source.dump').read_bytes(), b'changed')

    def test_rehearsal_cannot_publish_ports_or_mount_backup_writable(self):
        args = rr.create_args('bos-restore-test', Path('/stage'), Path('/backup-source'), 'image-id')
        self.assertEqual(args[args.index('--network')+1], 'none')
        self.assertNotIn('--publish', args)
        self.assertNotIn('-p', args)
        self.assertIn('type=bind,source=/backup-source,target=/backup,readonly', args)
        self.assertIn('cron.launch_active_jobs=off', args)
        self.assertIn('cron.database_name=bos_restore_check', args)
        self.assertEqual(args[args.index('--restart')+1], 'no')
        self.assertIn('type=volume,source=bos-restore-test-config,target=/etc/postgresql-custom',args)

if __name__ == '__main__':
    unittest.main()
