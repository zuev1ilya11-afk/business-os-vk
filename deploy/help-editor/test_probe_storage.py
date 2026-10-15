"""Verify the test database bind against the data path observed on the RU host.
Docker launch is intercepted; this does not claim a running PostgreSQL test.
"""
import importlib.util
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'bos293.pyz'))
import backend as b
spec=importlib.util.spec_from_file_location('probe_under_test',HERE/'package/probe_runtime.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)


class CaptureStart(Exception):pass


class StorageTest(unittest.TestCase):
    def test_fresh_private_bind_covers_the_directory_postgres_actually_uses(self):
        with tempfile.TemporaryDirectory() as temporary:
            stage=Path(temporary)
            rec={'nonce':'a'*32,'database':{'db_image':'sha256:existing-ru-image'},
                 'environment':{key:'http://existing-service:3000' for key in
                     ('BOS_AUTH_ORIGIN','BOS_REST_ORIGIN','BOS_STORAGE_ORIGIN')}}
            launches=[]
            def capture(args,label):
                launches.append(args)
                raise CaptureStart()
            with patch.object(b,'STAGE',stage),patch.object(p,'invoke',capture),patch.object(b,'cleanup') as cleanup:
                with self.assertRaises(CaptureStart):p.probe_candidate(rec)
            cleanup.assert_called_once_with(rec)
            args=launches[0]
            env=dict(line.split('=',1) for line in Path(args[args.index('--env-file')+1]).read_text().splitlines())
            # The on-host 15 October log identifies this server data_directory.
            used_by_server='/var/lib/postgresql/data'
            self.assertEqual(env['PGDATA'],used_by_server)
            mount=dict(item.split('=',1) for item in args[args.index('--mount')+1].split(','))
            self.assertEqual(mount['dst'],used_by_server)
            self.assertEqual(mount['src'],str(stage/'probe-pg'))
            self.assertEqual(stat.S_IMODE(Path(mount['src']).stat().st_mode),0o700)
            self.assertEqual(list(Path(mount['src']).iterdir()),[])
            self.assertEqual(args[args.index('--network')+1],'none')
            self.assertNotIn('--publish',args);self.assertNotIn('-p',args)
            self.assertEqual(args[-1],rec['database']['db_image'])
            self.assertEqual(env['POSTGRES_USER'],'supabase_admin')
            self.assertEqual(env['POSTGRES_DB'],'postgres')

    def test_bootstrap_uses_tcp_before_creating_only_the_disposable_database(self):
        self.assertTrue(callable(getattr(p,'prepare_pg',None)),'Explicit post-bootstrap test database creation required')
        queries=[]
        def command(args,label,**kwargs):
            queries.append((args,kwargs['input_data'].decode()))
            return b'{"ok":true}' if len(queries)==1 else b''
        with patch.object(b,'private_command',command):p.prepare_pg('new-isolated-test-container')
        self.assertEqual(len(queries),2)
        for args,sql in queries:
            self.assertEqual(args[:6],['docker','exec','-i','-e','PGHOST=127.0.0.1','new-isolated-test-container'])
            self.assertEqual(args[-1],'postgres')
        self.assertIn('BEGIN READ ONLY;',queries[0][1])
        self.assertEqual(queries[1][1],'CREATE DATABASE help_preview;')


if __name__=='__main__':unittest.main()
