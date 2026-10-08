import unittest
import os
import stat
import tempfile
import json
from pathlib import Path
from unittest.mock import patch, Mock
import release_source as r

class SourceTests(unittest.TestCase):
    def state(self):
        return {'readonly':None,'cron':[{'id':i,'active':i!=2} for i in range(1,5)],
                'runtime':{'bos_push_private':True,'bos_hands_private':True,'bos_avito_private':False}}

    def test_freeze_uses_cron_api_and_disables_every_saved_runtime(self):
        source=r.Source(None,'client',Path('/unused'))
        source.state=self.state()
        statements=[]
        def sql(value):
            statements.append(value)
            if 'UPDATE cron.job' in value:raise PermissionError('permission denied for table job')
            return b'0'
        source.sql=sql
        source.assert_frozen=Mock()
        with patch.object(r,'durable_json'):
            source.freeze()
        for job in source.state['cron']:
            self.assertIn(f"SELECT cron.alter_job(job_id:={job['id']},active:=false);",statements[0])
        for schema in source.state['runtime']:
            self.assertIn(f'UPDATE {schema}.runtime SET enabled=false;',statements[0])

    def test_thaw_confirms_already_original_state_without_retrying_failed_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=r.Source(None,'client',Path(tmp));source.state=self.state()
            def sql(value):
                if value!=r.STATE_SQL:raise AssertionError('Unnecessary mutation on unchanged source')
                return json.dumps(source.state).encode()
            source.sql=Mock(side_effect=sql)
            source.thaw()
            self.assertEqual(json.loads((Path(tmp)/'source-thawed.json').read_text()),{'restored':True})

    def test_recovery_file_data_and_directory_are_synced_with_private_mode(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'resume-source.sh'
            modes=[]
            sync=os.fsync
            def record(fd):
                modes.append(os.fstat(fd).st_mode)
                sync(fd)
            with patch.object(r.os,'fsync',side_effect=record):
                r.durable_text(path,'#!/bin/sh\n',mode=0o700)
            self.assertEqual(path.read_text(),'#!/bin/sh\n')
            self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o700)
            self.assertTrue(stat.S_ISREG(modes[0]))
            self.assertTrue(stat.S_ISDIR(modes[1]))

    def test_freeze_thaw_restores_exact_flags_and_unset_readonly(self):
        state={'readonly':None,'cron':[{'id':1,'active':True},{'id':2,'active':False},{'id':3,'active':True},{'id':4,'active':True}],
               'runtime':{'bos_push_private':True,'bos_hands_private':True,'bos_avito_private':False}}
        r.validate_state(state)
        thaw=r.thaw_sql(state)
        self.assertIn('RESET default_transaction_read_only',thaw)
        self.assertNotIn('UPDATE cron.job',thaw)
        self.assertIn('cron.alter_job(job_id:=2,active:=false)',thaw)
        self.assertIn('cron.alter_job(job_id:=1,active:=true)',thaw)
        self.assertIn('bos_avito_private.runtime SET enabled=false',thaw)
        self.assertLess(thaw.index('SET default_transaction_read_only=off'),thaw.index('BEGIN;'))
        state['cron'].append({'id':5,'active':True})
        with self.assertRaises(ValueError):r.validate_state(state)

    def test_activation_boundary_never_automatically_reopens_source(self):
        calls=[]
        self.assertTrue(r.recover_before_activation(True,False,lambda:calls.append('thaw')))
        self.assertEqual(calls,['thaw'])
        self.assertFalse(r.recover_before_activation(True,True,lambda:calls.append('unsafe')))
        self.assertEqual(calls,['thaw'])
        def fail():raise OSError('offline')
        self.assertFalse(r.recover_before_activation(True,False,fail))

if __name__=='__main__':unittest.main()
