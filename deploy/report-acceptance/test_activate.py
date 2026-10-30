"""Offline release/rollback regression tests. No Docker, systemd, or network."""
import base64
import contextlib
import hashlib
import hmac
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.request import Request

ROOT = Path(__file__).resolve().parent


def load(name,path):
    spec = importlib.util.spec_from_file_location(name,path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


s = load('activation_stage_base',ROOT/'stage.py')
m = load('activation_test',ROOT/'activate.py')
m.s = s


class ActivationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_runtime_helper_is_exact_successfully_probed_version(self):
        self.assertEqual(s.sha((ROOT/'runtime-stage.py').read_bytes()),m.RUNTIME_SHA)

    def test_scope_rejects_deleted_and_unrelated_changed_files(self):
        self.assertEqual(m.changed_files({'a':'1','keep':'2'},{'a':'3','keep':'2','new':'4'},{'a','new'}),['a','new'])
        for after in ({'a':'3'},{'a':'3','keep':'changed'}):
            with self.assertRaises(RuntimeError):
                m.changed_files({'a':'1','keep':'2'},after,{'a'})

    def test_partial_install_can_restore_files_and_permissions(self):
        work = self.root/'work'
        old = self.root/'live/old.ts'
        added = self.root/'live/new/config.json'
        old.parent.mkdir()
        old.write_bytes(b'previous')
        old.chmod(0o640)
        records = [m.capture_file(work,old,b'new'),m.capture_file(work,added,b'private',0o600)]
        m.atomic_file(old,b'new',0o644,os.getuid(),os.getgid())
        m.atomic_file(added,b'private',0o600,os.getuid(),os.getgid())
        m.restore_files(records)
        self.assertEqual(old.read_bytes(),b'previous')
        self.assertEqual(old.stat().st_mode&0o777,0o640)
        self.assertFalse(added.exists())

    def test_rollback_validates_every_file_before_restoring_any(self):
        work = self.root/'work'
        first,second = self.root/'first',self.root/'second'
        first.write_bytes(b'old-first')
        second.write_bytes(b'old-second')
        records = [m.capture_file(work,first,b'new-first'),m.capture_file(work,second,b'new-second')]
        first.write_bytes(b'new-first')
        second.write_bytes(b'concurrent-user-edit')
        with self.assertRaisesRegex(RuntimeError,'CONCURRENT_FILE_CHANGE'):
            m.restore_files(records)
        self.assertEqual(first.read_bytes(),b'new-first')
        self.assertEqual(second.read_bytes(),b'concurrent-user-edit')

    def test_atomic_install_rejects_symlink_destination(self):
        target = self.root/'target'
        target.write_text('user-file')
        alias = self.root/'alias'
        alias.symlink_to(target)
        with self.assertRaises(RuntimeError):
            m.atomic_file(alias,b'new',0o600)
        self.assertEqual(target.read_text(),'user-file')

    def test_gas_checks_signatures_without_attachment_data(self):
        key = 'fixture-sync-key'
        for valid in (False,True):
            fields = m.gas_fields(key,valid)
            self.assertFalse({'act_data','measurement_data','photos_json'} & fields.keys())
            secret = hashlib.sha256(key.encode()).hexdigest().encode()
            def sign(parts):
                return base64.urlsafe_b64encode(hmac.new(secret,'|'.join(parts).encode(),hashlib.sha256).digest()).rstrip(b'=').decode()
            base = [fields[n] for n in ('archive_ts','order_id','upload_token')]
            self.assertEqual(fields['archive_sign'],sign(base))
            self.assertEqual(fields['order_no_sign']==sign(base+[fields['order_no']]),valid)

    def test_gas_verification_distinguishes_old_code_from_published_v4(self):
        good = [(200,json.dumps({'ok':False,'error':e}).encode(),{})
                for e in ('INVALID_ORDER_NUMBER_SIGNATURE','ACT_REQUIRED')]
        with patch.object(m,'request',side_effect=good),contextlib.redirect_stdout(io.StringIO()):
            m.verify_gas('fixture-sync-key')
        with patch.object(m,'request',return_value=good[1]),contextlib.redirect_stdout(io.StringIO()),self.assertRaises(RuntimeError):
            m.verify_gas('fixture-sync-key')

    def test_google_redirect_never_sends_probe_to_unrelated_host(self):
        redirect = m.GoogleOutputRedirect()
        for url in ('https://attacker.example/x','http://script.googleusercontent.com/x',
                    'https://script.googleusercontent.com.attacker.example/x'):
            with self.assertRaises(RuntimeError):
                redirect.redirect_request(Request(m.GAS),None,302,'',{},url)
        result = redirect.redirect_request(Request(m.GAS,data=b'fixture'),None,302,'',{},
                                           'https://script.googleusercontent.com/macros/echo?fixture=1')
        self.assertEqual(result.get_method(),'GET')
        self.assertIsNone(result.data)

    def test_saved_storage_route_preserves_object_and_drops_old_signed_token(self):
        config = {'public':m.PUBLIC,'internal':'http://127.0.0.1:9000','legacy':'https://139.100.237.167'}
        order = {'id':1,'token':'a@b'}
        url = 'https://139.100.237.167/storage/v1/object/sign/business-os-vk-files/orders/1/a_b/act%20name.pdf?token=private'
        self.assertEqual(m.storage_route(url,order,config),'/storage/v1/object/authenticated/business-os-vk-files/orders/1/a_b/act%20name.pdf')
        for bad in (url.replace('139.100.237.167','evil.example'),url.replace('/a_b/','/other/'),
                    url.replace('act%20name.pdf','../x'),url+'#fragment',url.replace('?token=private','')):
            with self.assertRaises(RuntimeError):
                m.storage_route(bad,order,config)

    def test_unknown_systemd_unit_is_not_treated_as_command_failure(self):
        result = subprocess.CompletedProcess([],1,b'LoadState=not-found\nActiveState=inactive\n',b'')
        with patch.object(m.subprocess,'run',return_value=result):
            self.assertEqual(m.unit_state('fixture.timer')['LoadState'],'not-found')

    def test_migration_is_a_bounded_single_transaction(self):
        with patch.object(m,'v',SimpleNamespace(run=lambda *args,**kwargs:args)):
            result = m.sql_write('db','business', 'ALTER TABLE x ADD COLUMN y text;',self.root,'ddl')
        sql = result[3]
        self.assertTrue(sql.startswith(b'BEGIN;'))
        self.assertTrue(sql.endswith(b'COMMIT;'))
        self.assertIn(b"lock_timeout='10s'",sql)
        self.assertIn('ON_ERROR_STOP=1',result[0])

    def install_fixture(self):
        live,work,payload = self.root/'live',self.root/'work',self.root/'payload'
        for folder in ('edge','web'):
            (live/folder).mkdir(parents=True)
            (live/folder/'index').write_bytes(b'old-'+folder.encode())
        work.mkdir()
        (payload/m.MIGRATION).parent.mkdir(parents=True)
        (payload/m.MIGRATION).write_text('SELECT 1;')
        before = {folder:s.tree(live/folder) for folder in ('edge','web')}
        contents = [b'new-edge',b'new-web']
        files = [m.capture_file(work,live/folder/'index',data) for folder,data in zip(('edge','web'),contents)]
        after = {folder:{'index':s.sha(data)} for folder,data in zip(('edge','web'),contents)}
        journal = {'live':str(live),'edge_id':'fixture-edge','database_id':'fixture-db','database':'fixture-db',
                   'loopback':'http://127.0.0.1:19000','before':before,'after':after,'files':files,
                   'timer_before':{'UnitFileState':'disabled'},'build':'fixture-build'}
        return work,journal,contents,{'candidate_web':after['web']},{},payload,{}

    def run_install(self,fail=False):
        fixture = self.install_fixture()
        calls = []
        def run(args,*unused,**kwargs):
            calls.append(args)
            return b''
        fake_v = SimpleNamespace(run=run,sql=lambda *args:b't\n')
        states = lambda unit: {'LoadState':'loaded','ActiveState':'active','UnitFileState':'enabled'}
        with patch.object(m,'prepare',return_value=fixture),patch.object(m,'check_saved_files'),\
             patch.object(m,'fresh_backup',return_value={'path':'fixture','sha256':'fixture'}),\
             patch.object(m,'v',fake_v),patch.object(s,'command',return_value=b'Result=success\nExecMainStatus=0\n'),\
             patch.object(m,'unit_state',side_effect=states),patch.object(m,'wait_health'),\
             patch.object(m,'smoke',side_effect=RuntimeError('SMOKE_FAILED') if fail else None),\
             contextlib.redirect_stdout(io.StringIO()):
            if fail:
                with self.assertRaisesRegex(RuntimeError,'SMOKE_FAILED'):
                    m.activate()
            else:
                m.activate()
        return fixture,calls

    def test_failed_live_check_restores_code_but_never_restores_database(self):
        fixture,calls = self.run_install(fail=True)
        work,journal = fixture[:2]
        self.assertEqual(json.loads((work/'activation.json').read_text())['phase'],'rolled_back')
        self.assertEqual(s.tree(Path(journal['live'])/'edge'),journal['before']['edge'])
        self.assertEqual(s.tree(Path(journal['live'])/'web'),journal['before']['web'])
        self.assertFalse(any('pg_restore' in args for args in calls))
        self.assertFalse(any(args[:3]==['systemctl','enable','--now'] for args in calls))

    def test_worker_and_timer_start_only_after_file_install_and_live_checks(self):
        fixture,calls = self.run_install()
        work,journal = fixture[:2]
        self.assertEqual(json.loads((work/'activation.json').read_text())['phase'],'complete')
        self.assertEqual(s.tree(Path(journal['live'])/'edge'),journal['after']['edge'])
        first = calls.index(['systemctl','start',m.UNITS[0]])
        enabled = calls.index(['systemctl','enable','--now',m.UNITS[1]])
        self.assertLess(calls.index(['docker','start','fixture-edge']),first)
        self.assertLess(first,enabled)


if __name__=='__main__':
    unittest.main()
