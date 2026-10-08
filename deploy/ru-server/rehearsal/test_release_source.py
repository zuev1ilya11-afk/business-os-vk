import unittest
import os
import stat
import tempfile
import json
import re
import subprocess
from pathlib import Path
from unittest.mock import patch, Mock
import release_source as r

class PooledRunner:
    def __init__(self,state,mode,expected_mode,stuck=False):
        self.state=state;self.mode=mode;self.expected_mode=expected_mode;self.stuck=stuck
        self.pid=1234;self.retired=[];self.queries=[]

    def command(self,args,input,timeout,required=True):
        query=input.decode();self.queries.append(query)
        if 'pg_terminate_backend' in query:
            self.assert_retirement(query,required)
            self.retired.append(self.pid);self.pid+=1
            if not self.stuck:self.mode=self.expected_mode
            return subprocess.CompletedProcess(args,2,b'',b'connection lost after terminating own pooled backend')
        result=dict(self.state)
        if "current_setting('default_transaction_read_only')" in query:
            result.update(session_readonly=self.mode,backend_pid=self.pid)
        return subprocess.CompletedProcess(args,0,json.dumps(result).encode(),b'')

    def assert_retirement(self,query,required):
        assert not required
        assert f'a.pid={self.pid}' in query
        assert 'a.usename=current_user' in query
        assert 'a.datname=current_database()' in query

class SourceTests(unittest.TestCase):
    def state(self):
        return {'readonly':None,'cron':[{'id':i,'active':i!=2} for i in range(1,5)],
                'runtime':{'bos_push_private':True,'bos_hands_private':True,'bos_avito_private':False}}

    def frozen(self):
        state=self.state();state['readonly']='on'
        for job in state['cron']:job['active']=False
        state['runtime']={s:False for s in state['runtime']}
        return state

    def test_stale_pooled_backend_is_retired_and_fresh_mode_verified(self):
        runner=PooledRunner(self.frozen(),'off','on')
        source=r.Source(runner,'client',Path('/unused'));source.state=self.state()
        source.assert_frozen()
        self.assertEqual(runner.retired,[1234])
        self.assertFalse(any('SET default_transaction_read_only' in sql for sql in runner.queries))

    def test_real_pause_loss_is_never_repaired_as_a_session_cache_problem(self):
        for field in ('readonly','cron','runtime'):
            state=self.frozen()
            if field=='readonly':state[field]=None
            elif field=='cron':state[field][0]['active']=True
            else:state[field]['bos_hands_private']=True
            runner=PooledRunner(state,'off','on')
            source=r.Source(runner,'client',Path('/unused'));source.state=self.state()
            with self.subTest(field=field),self.assertRaises(RuntimeError):source.assert_frozen()
            self.assertEqual(runner.retired,[])

    def test_stuck_pool_stops_with_actual_safe_state_details(self):
        runner=PooledRunner(self.frozen(),'off','on',stuck=True)
        source=r.Source(runner,'client',Path('/unused'));source.state=self.state()
        with self.assertRaisesRegex(RuntimeError,'session_readonly.*off'):source.assert_frozen()
        self.assertLessEqual(len(runner.retired),3)

    def test_recovery_also_retires_stale_readonly_backend(self):
        with tempfile.TemporaryDirectory() as tmp:
            runner=PooledRunner(self.state(),'on','off')
            source=r.Source(runner,'client',Path(tmp));source.state=self.state()
            source.thaw()
            self.assertEqual(runner.retired,[1234])
            self.assertTrue((Path(tmp)/'source-thawed.json').exists())

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
                if not value.startswith('SELECT jsonb_build_object('):raise AssertionError('Unnecessary mutation on unchanged source')
                state=dict(source.state)
                if "current_setting('default_transaction_read_only')" in value:
                    state.update(session_readonly='off',backend_pid=1234)
                return json.dumps(state).encode()
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
