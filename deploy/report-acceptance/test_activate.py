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

    def test_activation_accepts_the_files_produced_by_real_locked_preparation(self):
        resume = load('activation_locked_prepare_test',ROOT/'resume-stage.py')
        resume.s = s
        edge = self.root/'candidate/edge'
        entries = {}
        graph = {'npm_roots':{'sdk@1':'sdk@1.0.0'},'npm':{'sdk@1.0.0':{}}}
        bundles = {}
        for slug in s.SLUGS:
            middle = '/supabase/functions/'+slug if slug in ('order-lifecycle-api','report-api') else ''
            entries[slug] = slug+middle+'/index.ts'
            source = edge/'sources'/entries[slug]
            source.parent.mkdir(parents=True)
            source.write_text('old source')
            bundle = edge/'bundles'/(slug+'.eszip')
            bundle.parent.mkdir(exist_ok=True)
            bundle.write_text('old bundle')
            bundles[slug] = graph if slug!='gas-bridge-health' else {'npm':{},'npm_roots':{}}
        (edge/'main').mkdir()
        (edge/'main/index.ts').write_text('old gateway')
        existing_config = edge/'sources/push-api/deno.json'
        existing_config.write_text('{"workspace":[],"imports":{"fixture":"./keep.ts"}}')
        before = s.tree(edge)
        with patch.object(resume,'integrity',return_value=('sdk@1.0.0','sha512-fixture-integrity')),\
             contextlib.redirect_stdout(io.StringIO()):
            resume.install_locks(self.root,entries,bundles)
        for slug,entry in entries.items():
            (edge/'sources'/entry).write_text('new source')
            (edge/'bundles'/(slug+'.eszip')).write_text('new bundle')
        for name in ('index.ts','bos-report-env.ts','bos-report-env.json'):
            (edge/'main'/name).write_text('verified gateway candidate')
        rec = {'entrypoints':entries,'before':{'edge':before},'candidate_edge':s.tree(edge)}
        changes = m.edge_changed_files(rec)
        self.assertIn('sources/order-lifecycle-api/supabase/functions/order-lifecycle-api/bos-report.lock',changes)
        self.assertIn('sources/report-api/supabase/functions/report-api/deno.json',changes)
        self.assertIn('sources/push-api/deno.json',changes)
        self.assertEqual(len([name for name in changes if name.endswith('/bos-report.lock')]),6)
        self.assertEqual(json.loads(existing_config.read_text())['imports'],{'fixture':'./keep.ts'})
        for extra in ('sources/unrelated/deno.json','sources/push-api/unreviewed.ts','main/secret.json'):
            with self.subTest(extra=extra):
                altered = {**rec,'candidate_edge':{**rec['candidate_edge'],extra:'unexpected-digest'}}
                with self.assertRaisesRegex(RuntimeError,'CANDIDATE_HAS_UNEXPECTED_CHANGES'):
                    m.edge_changed_files(altered)

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

    def run_install(self,fail=False,defer_archive=False):
        fixture = self.install_fixture()
        fixture[1].update(gas_signing_verified=not defer_archive,archive_deferred=defer_archive)
        calls = []
        def run(args,*unused,**kwargs):
            calls.append(args)
            return b''
        fake_v = SimpleNamespace(run=run,sql=lambda *args:b't\n')
        states = lambda unit: {'LoadState':'loaded','ActiveState':'inactive' if defer_archive else 'active',
                               'UnitFileState':'disabled' if defer_archive else 'enabled'}
        output = io.StringIO()
        with patch.object(m,'prepare',return_value=fixture),patch.object(m,'check_saved_files'),\
             patch.object(m,'fresh_backup',return_value={'path':'fixture','sha256':'fixture'}),\
             patch.object(m,'v',fake_v),patch.object(s,'command',return_value=b'Result=success\nExecMainStatus=0\n'),\
             patch.object(m,'unit_state',side_effect=states),patch.object(m,'wait_health'),\
             patch.object(m,'smoke',side_effect=RuntimeError('SMOKE_FAILED') if fail else None),\
             contextlib.redirect_stdout(output):
            if fail:
                with self.assertRaisesRegex(RuntimeError,'SMOKE_FAILED'):
                    m.activate(defer_archive=defer_archive)
            else:
                m.activate(defer_archive=defer_archive)
        self.output = output.getvalue()
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

    def test_deferred_install_keeps_verified_files_and_never_starts_archive(self):
        fixture,calls = self.run_install(defer_archive=True)
        work,journal = fixture[:2]
        result = json.loads((work/'activation.json').read_text())
        self.assertEqual(result['phase'],'complete_archive_pending')
        self.assertFalse(result['gas_signing_verified'])
        self.assertEqual(s.tree(Path(journal['live'])/'web'),journal['after']['web'])
        self.assertEqual(s.tree(Path(journal['live'])/'edge'),journal['after']['edge'])
        self.assertIn(['systemctl','disable','--now',m.UNITS[1]],calls)
        self.assertFalse(any(args[:2]==['systemctl','start'] or args[:2]==['systemctl','enable'] for args in calls))
        self.assertIn('GAS_DEPLOYMENT_VERIFIED=false',self.output)
        self.assertIn('ARCHIVE_TIMER_ENABLED=false',self.output)
        self.assertIn('PRODUCTION_UPDATED=true',self.output)

    def test_deferred_install_still_rolls_back_failed_application_checks(self):
        fixture,calls = self.run_install(fail=True,defer_archive=True)
        work,journal = fixture[:2]
        self.assertEqual(json.loads((work/'activation.json').read_text())['phase'],'rolled_back')
        self.assertEqual(s.tree(Path(journal['live'])/'web'),journal['before']['web'])
        self.assertFalse(any('pg_restore' in args for args in calls))

    def test_only_explicit_deferral_avoids_external_gas_preflight(self):
        with patch.object(m,'request',side_effect=OSError('unreachable')),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError,'GAS_CONNECTION_FAILED'):
                m.archive_preflight('fixture-key')
            self.assertFalse(m.archive_preflight('fixture-key',defer_archive=True))

    def test_deferred_smoke_checks_auth_rest_cors_and_build_without_gas(self):
        calls = []
        def api(base,slug,body=None,method='POST',headers=None):
            calls.append((base,slug,method))
            if slug=='gas-bridge-health':
                raise RuntimeError('GAS_UNREACHABLE')
            if body=={'action':'health'}:
                return 200,b'{"ok":true,"service":"order-lifecycle-api"}',{}
            if method=='OPTIONS':
                return 204,b'',{'Access-Control-Allow-Origin':m.PUBLIC}
            return 401,b'{"ok":false}',{}
        def request(url,**kwargs):
            if '/rest/v1/' in url:
                return 200,b'[]',{}
            self.assertIn('/build-version.js?',url)
            return 200,b'fixture-build',{}
        with patch.object(m,'api',side_effect=api),patch.object(m,'request',side_effect=request):
            m.smoke('http://127.0.0.1:19000',{'SUPABASE_SERVICE_ROLE_KEY':'fixture'},
                    {'build-version.js':s.sha(b'fixture-build')},defer_archive=True)
            self.assertEqual(len([c for c in calls if c[2]=='OPTIONS']),1)
            self.assertEqual(len([c for c in calls if c[1]=='report-api']),1)
            with self.assertRaisesRegex(RuntimeError,'GAS_UNREACHABLE'):
                m.smoke('http://127.0.0.1:19000',{'SUPABASE_SERVICE_ROLE_KEY':'fixture'},
                        {'build-version.js':s.sha(b'fixture-build')})

    def test_enable_archive_requires_gas_success_and_preserves_installed_code_on_failure(self):
        fixture,_ = self.run_install(defer_archive=True)
        work,journal = fixture[:2]
        runtime = work/'runtime.json'
        runtime.write_text('{"image":"fixture-image"}')
        journal.update(runtime_journal=str(runtime),runtime_journal_sha256=s.sha(runtime.read_bytes()))
        m.save(work,journal,'complete_archive_pending')
        edge = {'State':{'Running':True},'Image':'fixture-image','NetworkSettings':{
            'Ports':{'9000/tcp':[{'HostIp':'127.0.0.1','HostPort':'19000'}]}}}
        states = {m.UNITS[0]:{'ActiveState':'inactive','UnitFileState':'static'},
                  m.UNITS[1]:{'ActiveState':'inactive','UnitFileState':'disabled'}}
        calls = []
        def run(args,*unused,**kwargs):
            calls.append(args)
            if args[:3]==['systemctl','enable','--now']:
                states[m.UNITS[1]].update(ActiveState='active',UnitFileState='enabled')
            if args[:3]==['systemctl','disable','--now']:
                states[m.UNITS[1]].update(ActiveState='inactive',UnitFileState='disabled')
            return b''
        mounts = {'/bos-src':'sources','/bos-bundles':'bundles','/bos-main':'main'}
        fake_v = SimpleNamespace(run=run,environment=lambda e:{'BOS_SYNC_KEY':'fixture',
                                                              'SUPABASE_SERVICE_ROLE_KEY':'fixture'})
        response = lambda valid:(200,json.dumps({'ok':False,'error':'ACT_REQUIRED' if valid else 'INVALID_ORDER_NUMBER_SIGNATURE'}).encode(),{})
        with patch.object(m,'v',fake_v),patch.object(s,'inspect',return_value=edge),\
             patch.object(s,'mount',side_effect=lambda e,p:Path(journal['live'])/'edge'/mounts[p]),\
             patch.object(m,'unit_state',side_effect=lambda unit:states[unit]),\
             contextlib.redirect_stdout(io.StringIO()):
            with patch.object(m,'request',side_effect=OSError('no route')):
                with self.assertRaisesRegex(RuntimeError,'GAS_CONNECTION_FAILED'):
                    m.enable_archive(work,journal)
            self.assertFalse(any(args[:2]==['systemctl','start'] for args in calls))
            self.assertEqual(json.loads((work/'activation.json').read_text())['phase'],'complete_archive_pending')
            with patch.object(m,'request',side_effect=[response(False),response(True)]),\
                 patch.object(m,'smoke',side_effect=RuntimeError('LIVE_GAS_BRIDGE_FAILED')):
                with self.assertRaisesRegex(RuntimeError,'LIVE_GAS_BRIDGE_FAILED'):
                    m.enable_archive(work,journal)
            self.assertFalse(any(args[:2]==['systemctl','start'] for args in calls))
            with patch.object(m,'request',side_effect=[response(False),response(True)]),\
                 patch.object(m,'smoke'),patch.object(s,'command',return_value=b'Result=failed\nExecMainStatus=1\n'):
                with self.assertRaisesRegex(RuntimeError,'WORKER_FIRST_RUN_FAILED'):
                    m.enable_archive(work,journal)
            self.assertEqual(json.loads((work/'activation.json').read_text())['phase'],'complete_archive_pending')
            self.assertFalse(journal['gas_signing_verified'])
            self.assertEqual(states[m.UNITS[1]]['UnitFileState'],'disabled')
            self.assertEqual(s.tree(Path(journal['live'])/'web'),journal['after']['web'])
            with patch.object(m,'request',side_effect=[response(False),response(True)]),\
                 patch.object(m,'smoke'),patch.object(s,'command',return_value=b'Result=success\nExecMainStatus=0\n'):
                m.enable_archive(work,journal)
            self.assertEqual(json.loads((work/'activation.json').read_text())['phase'],'complete')
            self.assertEqual(states[m.UNITS[1]]['UnitFileState'],'enabled')
            self.assertTrue(journal['gas_signing_verified'])
            self.assertFalse(any(args[0]=='docker' for args in calls))

    def test_repeated_deferred_command_does_not_reapply_migration_or_enable_timer(self):
        fixture,_ = self.run_install(defer_archive=True)
        work,journal = fixture[:2]
        parent = self.root/'report-acceptance-stage-fixture/locked-fixture/runtime-fixture/activate-fixture'
        parent.mkdir(parents=True)
        (parent/'activation.json').write_bytes((work/'activation.json').read_bytes())
        with patch.object(s,'PARENT',self.root),patch.object(m,'load_helpers',return_value=(s,m.v,m.r)),\
             patch.object(m.os,'geteuid',return_value=0),patch.object(m,'archive_inactive'),\
             patch.object(m,'activate',side_effect=AssertionError('must not redeploy')),\
             patch.object(m.sys,'argv',['activate.py','--defer-archive']),contextlib.redirect_stdout(io.StringIO()) as output:
            m.main()
        self.assertIn('ALREADY_ACTIVATED=true',output.getvalue())
        self.assertIn('ARCHIVE_TIMER_ENABLED=false',output.getvalue())

    def test_enable_rejects_modified_installed_files_before_touching_worker(self):
        fixture,_ = self.run_install(defer_archive=True)
        work,journal = fixture[:2]
        (Path(journal['live'])/'edge/index').write_bytes(b'concurrent change')
        with self.assertRaisesRegex(RuntimeError,'ACTIVE_RELEASE_CHANGED'):
            m.enable_archive(work,journal)

    def test_paused_worker_may_have_failed_but_must_not_be_running_or_enabled(self):
        def state(unit):
            return {'ActiveState':'failed' if unit.endswith('.service') else 'inactive',
                    'UnitFileState':'static' if unit.endswith('.service') else 'disabled'}
        with patch.object(m,'unit_state',side_effect=state):
            m.archive_inactive()
        for active,enabled in (('active','disabled'),('inactive','enabled')):
            with patch.object(m,'unit_state',return_value={'ActiveState':active,'UnitFileState':enabled}):
                with self.assertRaises(RuntimeError):
                    m.archive_inactive()

    def test_retry_pause_keeps_separate_logs_after_worker_failure(self):
        verify = load('pause_verify_test',ROOT/'verify-stage.py')
        verify.s = s
        state = {'ActiveState':'inactive','UnitFileState':'disabled'}
        result = subprocess.CompletedProcess([],0,b'',b'')
        with patch.object(m,'v',verify),patch.object(m,'unit_state',return_value=state),\
             patch.object(verify.subprocess,'run',return_value=result):
            m.pause_archive(self.root)
            m.pause_archive(self.root)
        self.assertEqual(len(list(self.root.rglob('*.log'))),4)


if __name__=='__main__':
    unittest.main()
