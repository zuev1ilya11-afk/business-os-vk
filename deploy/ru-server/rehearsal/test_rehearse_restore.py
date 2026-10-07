import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import subprocess

import rehearse_restore as rr

class RehearsalTests(unittest.TestCase):
    def image_info(self):
        return {'Id': 'sha256:' + 'a' * 64, 'Os': 'linux', 'Architecture': 'amd64',
                'RepoDigests': [rr.CANDIDATE_IMAGE]}

    def test_candidate_selection_uses_inspected_manifest_without_pull(self):
        info = self.image_info()
        with patch('rehearse_restore.subprocess.run', return_value=
                   subprocess.CompletedProcess([], 0, json.dumps([info]), '')) as run:
            image, provenance = rr.resolve_image(rr.CANDIDATE_IMAGE)
        self.assertEqual(image, info['Id'])
        self.assertEqual(provenance['requested_ref'], rr.CANDIDATE_IMAGE)
        self.assertEqual(provenance['image_id'], image)
        self.assertEqual(run.call_args.args[0], ['docker', 'image', 'inspect', rr.CANDIDATE_IMAGE])
        args = rr.create_args('bos-restore-trial-new', Path('/new'), Path('/backup'), image)
        self.assertIn(image, args)
        self.assertNotIn(rr.IMAGE, args)
        self.assertIn('none', args)

    def test_image_preflight_refuses_other_images_or_unmatched_identity(self):
        with patch('rehearse_restore.subprocess.run') as run:
            with self.assertRaises(ValueError):
                rr.resolve_image('supabase/postgres:latest')
            run.assert_not_called()
        for replacement in ({'RepoDigests': []}, {'Id': 'not-an-image-id'},
                            {'Architecture': 'arm64'}, {'Os': 'windows'}):
            info = dict(self.image_info(), **replacement)
            with self.subTest(replacement=replacement):
                with patch('rehearse_restore.subprocess.run', return_value=
                           subprocess.CompletedProcess([], 0, json.dumps([info]), '')):
                    with self.assertRaises(ValueError):
                        rr.resolve_image(rr.CANDIDATE_IMAGE)

    def test_candidate_success_requires_actual_server_and_extension_versions(self):
        extensions = {'pg_net':'0.20.4', 'pg_cron':'1.6.4', 'supabase_vault':'0.3.1',
                      'pgcrypto':'1.3', 'uuid-ossp':'1.1', 'btree_gist':'1.7',
                      'pg_stat_statements':'1.11', 'plpgsql':'1.0'}
        stats = {'cron_enabled':'off', 'server_version_num':170011, 'extensions':extensions}
        rr.check_restored_versions(stats, rr.CANDIDATE_IMAGE)
        for name in extensions:
            if name == 'plpgsql':
                continue
            for change in ('missing', 'changed'):
                changed = dict(extensions)
                if change == 'missing':
                    del changed[name]
                else:
                    changed[name] = '0.0'
                with self.subTest(name=name, change=change):
                    with self.assertRaises(RuntimeError):
                        rr.check_restored_versions(dict(stats, extensions=changed), rr.CANDIDATE_IMAGE)
        for replacement in ({'server_version_num':170006}, {'cron_enabled':'on'}):
            with self.assertRaises(RuntimeError):
                rr.check_restored_versions(dict(stats, **replacement), rr.CANDIDATE_IMAGE)

    def test_original_image_remains_available_and_cron_must_stay_off(self):
        info = dict(self.image_info(), RepoDigests=[])
        with patch('rehearse_restore.subprocess.run', return_value=
                   subprocess.CompletedProcess([], 0, json.dumps([info]), '')):
            image, _ = rr.resolve_image(rr.IMAGE)
        self.assertEqual(image, info['Id'])
        rr.check_restored_versions({'cron_enabled':'off'}, rr.IMAGE)
        with self.assertRaises(RuntimeError):
            rr.check_restored_versions({'cron_enabled':'on'}, rr.IMAGE)

    def test_bootstrap_works_when_postgres_is_not_superuser(self):
        writes = []
        def sql(query, user='postgres', db='postgres'):
            if query.startswith('SELECT'):
                return subprocess.CompletedProcess([], 0, user + ('|t\n' if user == 'supabase_admin' else '|f\n'))
            if user != 'supabase_admin':
                raise PermissionError('Only roles with SUPERUSER may create SUPERUSER roles')
            writes.append(query)
            return subprocess.CompletedProcess([], 0, 'CREATE ROLE\nCREATE DATABASE\n')
        rr.prepare_database(sql)
        self.assertEqual(len(writes), 1)
        self.assertIn('CREATE ROLE bos_restore_loader LOGIN SUPERUSER', writes[0])
        self.assertIn('CREATE DATABASE bos_restore_check TEMPLATE template0 OWNER postgres', writes[0])

    def test_bootstrap_stops_before_writes_when_admin_is_not_superuser(self):
        writes = []
        def sql(query, user='postgres', db='postgres'):
            if not query.startswith('SELECT'):
                writes.append(query)
            return subprocess.CompletedProcess([], 0, user + '|f\n')
        with self.assertRaises(RuntimeError):
            rr.prepare_database(sql)
        self.assertEqual(writes, [])

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
