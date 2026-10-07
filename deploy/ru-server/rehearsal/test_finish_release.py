import unittest
import base64
import json
import time
import errno
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch
import finish_release as f

class FinishTests(unittest.TestCase):
    def test_custom_configuration_uses_populated_persistent_volume(self):
        args=f.database_args('bos-release-test-db','image','/release','private')
        self.assertIn('type=volume,source=bos-release-test-db-config,target=/etc/postgresql-custom',args)
        self.assertFalse(any('type=bind' in a and 'target=/etc/postgresql-custom' in a for a in args))

    def test_full_disk_logging_cannot_block_commands_or_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            runner=f.ReleaseRunner(Path(tmp),'bos-release-test')
            result=subprocess.CompletedProcess(['docker','inspect'],0,b'OK',b'error')
            with patch.object(f.subprocess,'run',return_value=result),patch.object(Path,'open',side_effect=OSError(errno.ENOSPC,'full')):
                self.assertIs(runner.command(['docker','inspect']),result)
            runner.stop_owned=Mock(return_value=True)
            runner.private_service_logs=Mock(side_effect=OSError(errno.ENOSPC,'full'))
            source=Mock(attempted=True)
            with patch.object(Path,'write_text',side_effect=OSError(errno.ENOSPC,'full')):
                self.assertTrue(f.failure_recovery(runner,source,False,'trace'))
            source.thaw.assert_called_once()
            runner.stop_owned.assert_any_call(skip=('bos-release-test-source',))
            source.thaw.reset_mock()
            self.assertFalse(f.failure_recovery(runner,source,True,'trace'))
            source.thaw.assert_not_called()

    def test_working_api_keys_outlive_rehearsal_day(self):
        token=f.release_jwt('secret','service_role')
        payload=json.loads(base64.urlsafe_b64decode(token.split('.')[1]+'=='))
        self.assertEqual(payload['role'],'service_role')
        self.assertGreater(payload['exp']-int(time.time()),365*86400)

    def test_database_is_private_and_cron_off_before_activation(self):
        args=f.database_args('bos-release-test-db','sha256:'+'a'*64,'/private/release','bos-release-test-internal')
        self.assertNotIn('--publish',args)
        self.assertIn('config_file=/bos-postgresql.conf',args)
        self.assertIn('cron.launch_active_jobs=off',f.postgres_config(False))
        self.assertIn("listen_addresses='*'",f.postgres_config(False))
        self.assertIn("pg_net.database_name='bos_restore_check'",f.postgres_config(False))
        self.assertIn('cron.launch_active_jobs=on',f.postgres_config(True))
        self.assertNotIn('5432:5432',args)

    def test_target_roles_have_distinct_private_credential_configuration(self):
        values=f.service_environments('f'*64,'j'*96,'ANON','SERVICE','https://139.100.237.167')
        self.assertIn('authenticator:',values['rest']['PGRST_DB_URI'])
        self.assertIn('supabase_auth_admin:',values['auth']['GOTRUE_DB_DATABASE_URL'])
        self.assertIn('supabase_storage_admin:',values['storage']['DATABASE_URL'])
        self.assertEqual(values['auth']['API_EXTERNAL_URL'],'https://139.100.237.167/auth/v1')
        self.assertEqual(values['storage']['STORAGE_PUBLIC_URL'],'https://139.100.237.167/storage/v1')
        self.assertNotIn('supabase.co',str(values))

if __name__=='__main__':unittest.main()
