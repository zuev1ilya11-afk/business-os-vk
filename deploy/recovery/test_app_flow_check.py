import io
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import app_cli
import app_flow_check as flow
import build_app_flow_check as build
from test_app_login_diagnostic import Runner as LoginRunner, LAUNCH, ORIGIN

PUBLIC = 'https://homemaster.qd.je'


class Runner(LoginRunner):
    def __init__(self):
        super().__init__()
        self.gateway = {'version': 1, 'internal': 'http://127.0.0.1:9000', 'public': PUBLIC,
                        'legacy': '', 'gas': 'http://127.0.0.1:18080/__bos_blocked/gas',
                        'workerKey': 'private-worker-secret-not-exported'}

    def __call__(self, args, **kwargs):
        if args == ['exec', '5'*64, 'cat', '/bos-main/bos-report-env.json']:
            self.calls.append(args)
            return json.dumps(self.gateway).encode()
        return super().__call__(args, **kwargs)


def evidence():
    return {'marker': 'BOS-CHECK-0123456789abcdef', 'checks': [], 'states': {},
            'synthetic_staff': {}, 'status': 'STOPPED'}


class Server:
    def __init__(self):
        self.calls, self.staff, self.orders, self.files = [], {}, [], {}
        self.reject_at = None
        self.revoke = False
        self.revision = 0

    def __call__(self, origin, method, path, headers, raw):
        assert origin == ORIGIN
        assert headers['Origin'] == origin
        body = json.loads(raw) if raw else {}
        self.calls.append((path, body))
        if self.reject_at is not None and body.get('action') == self.reject_at:
            return 500, {}, b'{"ok":false,"error":"PRIVATE_SECRET_AND_CLIENT_NAME"}'
        def response(value, status=200):
            return status, {}, json.dumps(value).encode()
        role = headers.get('X-BOS-Session', 'none').removeprefix('secret-')
        if path == flow.safety.GUARD:
            return 200, {}, b'LOCAL_DRILL_EXTERNAL_BLOCKED'
        if path == '/build-version.js':
            return 200, {}, b'window.BOS_BUILD="test";'
        if path == flow.API + 'password-session-api':
            assert body == {'action': 'login', 'login': 'private-owner', 'password': 'private-password'}
            return response({'ok': True, 'session_token': 'secret-owner', 'user': {'role': 'owner'}})
        if path == '/__bos_local_roles':
            assert role == 'owner'
            if body['action'] == 'authorize':
                return response({'ok': True, 'grant': 'secret-grant'})
            assert headers['X-BOS-Role-Control'] == 'secret-grant'
            if body['action'] == 'revoke':
                self.revoke = True
                return response({'ok': True})
            target = self.staff[body['staff_id']]['role']
            return response({'ok': True, 'session_token': 'secret-' + target, 'current': {'role': target}})
        if path.startswith('/storage/'):
            return 200, {}, self.files[path]
        action = body.get('action')
        if path == flow.API + 'drive-archive-api':
            return response({'ok': False, 'code': 'LOCAL_DRILL_EXTERNAL_DISABLED'}, 501)
        if action == 'addEmployee':
            assert role == 'owner'
            ident = str(len(self.staff) + 100)
            self.staff[ident] = {'id': ident, 'role': body['role'], 'full_name': body['full_name'], 'is_active': True}
            assert body['full_name'].startswith('BOS-CHECK-')
            return response({'ok': True, 'user': self.staff[ident]})
        if action == 'bootstrap':
            return response({'ok': True, 'user': {'role': role, 'full_name': 'PRIVATE_OWNER'},
                             'users': list(self.staff.values()),
                             'orders': self.orders + [{'id': '50', 'client': 'PRIVATE_CLIENT'}]})
        if action == 'createOrder':
            assert role == 'dispatcher'
            if not self.orders:
                self.orders.append({**body, 'id': '777', 'status': 'В работе', 'master_payout': 552.5})
            return response({'ok': True, 'order': self.orders[0]})
        if action == 'updateOrder':
            assert role == 'manager'
            self.orders[0]['master_staff_id'] = body['master_id']
            return response({'ok': True, 'order': self.orders[0]})
        if action in ('recordContactAttempt', 'recordContactResult', 'setAgreementSchedule', 'setStage'):
            assert role == 'master'
            if action == 'setStage':
                self.orders[0]['master_workflow_stage'] = body['stage']
            return response({'ok': True, 'order': self.orders[0]})
        if action == 'uploadReportFile':
            assert role == 'master'
            path = '/storage/v1/object/sign/business-os-vk-files/orders/777/' + body['upload_token'] + '/' + body['file_kind'] + '.png?token=synthetic.signature'
            self.files[path] = flow.base64.b64decode(body['file_data'])
            return response({'ok': True, 'url': PUBLIC + path})
        if action == 'finalizeMasterReport':
            assert role == 'master'
            assert body['act_url'].startswith(PUBLIC + '/storage/')
            assert all(u.startswith(PUBLIC + '/storage/') for u in body['photo_urls'])
            if self.orders[0].get('report_upload_token') != body['upload_token']:
                self.revision += 1
                self.orders[0].update(report_upload_token=body['upload_token'], report_uploaded_at=str(self.revision),
                    report_review_status='pending', extra_work_amount=100)
            return response({'ok': True, 'order': self.orders[0]})
        if action == 'reviewReport':
            assert body['decision'] == 'rejected'  # Never fake external archive or approval.
            if role == 'master':
                return response({'ok': False}, 403)
            assert role == 'manager'
            self.orders[0]['report_review_status'] = 'rejected'
            return response({'ok': True, 'order': self.orders[0]})
        if action in ('previewFinanceExport', 'downloadFinanceExport'):
            if role in ('master', 'dispatcher'):
                return response({'ok': False}, 403)
            assert role in ('owner', 'manager')
            if body['filters'].get('format') == 'master':
                assert body['filters'] == {'format': 'master', 'master': '102'}
                if action == 'previewFinanceExport':
                    return response({'ok': True, 'count': 0, 'empty': True, 'revision': 'empty'})
                return response({'ok': False, 'code': 'EMPTY_EXPORT'}, 422)
            assert body['filters'] == {'format': 'full', 'master': '102', 'selected': '102'}
            if action == 'previewFinanceExport':
                return response({'ok': True, 'count': 1, 'expenseCount': 0, 'total': {'completed': 0, 'pay': 0}, 'revision': 'synthetic'})
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, 'w') as archive:
                archive.writestr('xl/workbook.xml', '<workbook/>')
                archive.writestr('[Content_Types].xml', '<Types/>')
            return 200, {}, buf.getvalue()
        raise AssertionError('Unexpected native API operation')


class FlowTests(unittest.TestCase):
    def checker(self, runner=None, server=None):
        return flow.Checker(runner or Runner(), LAUNCH, evidence(), server or Server(), progress=lambda _: None)

    def interrupted(self):
        server = Server()
        def old_checker_mismatch(*args):
            result = server(*args)
            if json.loads(args[4] or b'{}').get('action') == 'uploadReportFile':
                return 200, {}, b'{"ok":true,"url":"https://not-the-configured-origin.invalid/"}'
            return result
        checker = self.checker(server=old_checker_mismatch)
        with self.assertRaisesRegex(app_cli.Stop, 'FLOW_STORAGE_URL_INVALID'):
            checker.run('private-owner', 'private-password')
        checker.close()
        prior = dict(checker.report, diagnostic='LIVE_SYNTHETIC_FLOW',
                     run_id=LAUNCH['run_id'], source_manifest_sha256=LAUNCH['source_manifest_sha256'],
                     reason='FLOW_STORAGE_URL_INVALID', failed_step='UPLOAD_ACT_1')
        server.calls.clear()
        return server, prior

    def test_resume_reuses_live_staff_and_started_order(self):
        server, prior = self.interrupted()
        checker = self.checker(server=server)
        checker.run('private-owner', 'private-password', resume=prior)
        checker.close()
        actions = [body.get('action') for _, body in server.calls]
        for mutation in ('addEmployee', 'createOrder', 'updateOrder', 'setStage',
                         'recordContactAttempt', 'recordContactResult', 'setAgreementSchedule'):
            self.assertNotIn(mutation, actions)
        self.assertTrue(checker.report['reused_existing_records'])
        self.assertEqual(checker.report['synthetic_order_id'], '777')
        self.assertEqual(len(server.staff), 3)
        self.assertEqual(len(server.orders), 1)
        self.assertEqual(checker.report['status'], 'PARTIAL_EXTERNAL_ARCHIVE_DISABLED')

    def test_resume_rejects_changed_staff_before_any_upload(self):
        server, prior = self.interrupted()
        server.staff['102']['full_name'] = 'Someone else'
        checker = self.checker(server=server)
        with self.assertRaisesRegex(app_cli.Stop, 'FLOW_RESUME_STAFF_CHANGED'):
            checker.run('private-owner', 'private-password', resume=prior)
        self.assertFalse(any(body.get('action') == 'uploadReportFile' for _, body in server.calls))

    def test_resume_rejects_changed_order_before_any_upload(self):
        for key, value in (('client', 'REAL_CLIENT'), ('status', 'Выполнена'),
                           ('amount', 900), ('report_review_status', 'pending')):
            with self.subTest(key=key):
                server, prior = self.interrupted()
                server.orders[0][key] = value
                checker = self.checker(server=server)
                with self.assertRaisesRegex(app_cli.Stop, 'FLOW_RESUME_STATE_CHANGED'):
                    checker.run('private-owner', 'private-password', resume=prior)
                self.assertFalse(any(body.get('action') == 'uploadReportFile' for _, body in server.calls))

    def test_resume_rejects_changed_build_before_login(self):
        server, prior = self.interrupted()
        prior['captured_build_file_sha256'] = 'a'*64
        with self.assertRaisesRegex(app_cli.Stop, 'FLOW_RESUME_BUILD_CHANGED'):
            self.checker(server=server).run('private-owner', 'private-password', resume=prior)
        self.assertFalse(any(body.get('action') == 'login' for _, body in server.calls))

    def test_resume_file_is_bound_to_same_clone_and_latest_run(self):
        _, prior = self.interrupted()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'BOS-Flow-Check-20261116T094752Z-20de65df.json'
            path.write_text(json.dumps(prior))
            selected, name = flow.resume_input(root, LAUNCH)
            self.assertEqual(name, path.name)
            self.assertEqual(selected['synthetic_order_id'], '777')
            changed = dict(prior, run_id='bos-app-' + 'f'*12)
            path.write_text(json.dumps(changed))
            with self.assertRaisesRegex(app_cli.Stop, 'FLOW_RESUME_CLONE_MISMATCH'):
                flow.resume_input(root, LAUNCH)
            path.write_text(json.dumps(prior))
            (root / 'BOS-Flow-Check-20261116T100000Z-12345678.json').write_text(
                json.dumps(dict(prior, status='PARTIAL_EXTERNAL_ARCHIVE_DISABLED')))
            with self.assertRaisesRegex(app_cli.Stop, 'FLOW_RESUME_POINT_UNSUPPORTED'):
                flow.resume_input(root, LAUNCH)

    def test_gateway_external_configuration_stops_before_login(self):
        runner, server = Runner(), Server()
        runner.gateway['gas'] = 'https://outside.invalid/'
        with self.assertRaisesRegex(app_cli.Stop, 'FLOW_GATEWAY_CONFIG_NOT_ISOLATED'):
            self.checker(runner, server).run('private-owner', 'private-password')
        self.assertFalse(any(body.get('action') == 'login' for _, body in server.calls))

    def test_storage_contract_keeps_capability_but_transport_is_only_local(self):
        token = 'flow_0123456789abcdef_1'
        path = '/storage/v1/object/sign/business-os-vk-files/orders/777/' + token + '/act.png?token=synthetic.signature'
        self.assertEqual(flow.storage_path(PUBLIC + path, {PUBLIC}, '777', token), path)
        for bad in ('https://homemaster.qd.je.evil.invalid' + path,
                    'https://user:password@homemaster.qd.je' + path,
                    PUBLIC + path + '#fragment', PUBLIC + path.replace('/777/', '/778/'),
                    PUBLIC + path.replace('/act.png', '/%2e%2e%2fsecret'),
                    PUBLIC + path.replace('/act.png', '/nested/act.png')):
            with self.subTest(url=bad), self.assertRaises(app_cli.Stop):
                flow.storage_path(bad, {PUBLIC}, '777', token)
        with patch.object(flow.http.client, 'HTTPConnection') as connection:
            response = connection.return_value.getresponse.return_value
            response.status, response.getheaders.return_value, response.read.return_value = 200, [], b'png'
            self.assertEqual(flow.local_request(ORIGIN, 'GET', path, {}, b'')[2], b'png')
            connection.assert_called_once_with('127.0.0.1', 45678, timeout=55)
            self.assertEqual(connection.return_value.request.call_args.args[:2], ('GET', path))

    def test_native_sequence_and_scope(self):
        server = Server()
        checker = self.checker(server=server)
        checker.run('private-owner', 'private-password')
        checker.close()
        self.assertEqual(checker.report['status'], 'PARTIAL_EXTERNAL_ARCHIVE_DISABLED')
        self.assertEqual(len(server.orders), 1)
        self.assertEqual(len(server.staff), 3)
        self.assertEqual(server.revision, 2)
        self.assertEqual(len(server.files), 4)
        self.assertTrue(server.revoke)
        self.assertEqual(checker.tokens, {})
        encoded = json.dumps(checker.report)
        for private in ('private-owner', 'private-password', 'secret-owner', 'secret-grant',
                        'PRIVATE_CLIENT', 'PRIVATE_OWNER', 'synthetic.signature', 'private-worker-secret-not-exported'):
            self.assertNotIn(private, encoded)
        self.assertEqual(checker.report['states']['pending_2']['master_payout'], 552.5)
        self.assertTrue(checker.report['xlsx']['downloaded'])

    def test_each_request_rechecks_all_container_mounts(self):
        runner, server = Runner(), Server()
        checker = self.checker(runner, server)
        checker.request('BEFORE', flow.safety.GUARD, binary=True)
        runner.records['5' * 64]['Mounts'].append({'Type': 'volume', 'Name': 'production'})
        with self.assertRaisesRegex(app_cli.Stop, 'LOGIN_MOUNTS_CHANGED'):
            checker.api('MUST_NOT_WRITE', 'mini-app-api', 'createOrder', client='test')
        self.assertEqual(len(server.calls), 1)

    def test_external_docker_network_stops_before_credentials(self):
        runner = Runner()
        runner.records['1' * 64]['HostConfig']['NetworkMode'] = 'bridge'
        checker = self.checker(runner)
        with self.assertRaisesRegex(app_cli.Stop, 'LOGIN_ISOLATION_CHANGED'):
            checker.run('private-owner', 'private-password')
        self.assertEqual(checker.host.calls, [])

    def test_production_gateway_stops_before_credentials(self):
        runner = Runner()
        runner.records['5' * 64]['Config']['Env'][0] = 'SUPABASE_URL=https://homemaster.qd.je'
        checker = self.checker(runner)
        with self.assertRaisesRegex(app_cli.Stop, 'FLOW_GATEWAY_NOT_LOCAL'):
            checker.run('private-owner', 'private-password')
        self.assertEqual(checker.host.calls, [])

    def test_partial_service_set_rejected(self):
        runner = Runner()
        del runner.records['6' * 64]
        with self.assertRaisesRegex(app_cli.Stop, 'FLOW_SERVICES_NOT_RUNNING'):
            self.checker(runner).isolated()

    def test_first_native_error_stops_without_retry_or_raw_error(self):
        server = Server()
        server.reject_at = 'recordContactResult'
        checker = self.checker(server=server)
        with self.assertRaisesRegex(app_cli.Stop, 'FLOW_CONTACT_RESULT_HTTP_500'):
            checker.run('private-owner', 'private-password')
        checker.close()
        self.assertEqual(len(server.files), 0)
        self.assertTrue(server.revoke)
        self.assertNotIn('PRIVATE_SECRET', json.dumps(checker.report))
        self.assertEqual(sum(body.get('action') == 'recordContactResult' for _, body in server.calls), 1)

    def test_non_owner_cannot_create_synthetic_records(self):
        server = Server()
        def host(*args):
            result = server(*args)
            if args[2].endswith('password-session-api'):
                return 200, {}, b'{"ok":true,"user":{"role":"master"},"session_token":"s"}'
            return result
        checker = self.checker(server=host)
        with self.assertRaisesRegex(app_cli.Stop, 'FLOW_OWNER_REQUIRED'):
            checker.run('private-owner', 'private-password')
        self.assertEqual(server.staff, {})

    def test_attachment_external_url_rejected_without_fetch(self):
        server = Server()
        def host(*args):
            result = server(*args)
            if json.loads(args[4] or b'{}').get('action') == 'uploadReportFile':
                return 200, {}, b'{"ok":true,"url":"https://example.com/private"}'
            return result
        checker = self.checker(server=host)
        with self.assertRaisesRegex(app_cli.Stop, 'FLOW_STORAGE_URL_INVALID'):
            checker.run('private-owner', 'private-password')

    def test_pending_reversion_is_not_success(self):
        server = Server()
        def host(*args):
            result = server(*args)
            if json.loads(args[4] or b'{}').get('action') == 'bootstrap' and server.revision:
                value = json.loads(result[2])
                value['orders'][0]['report_review_status'] = None
                return 200, {}, json.dumps(value).encode()
            return result
        with self.assertRaisesRegex(app_cli.Stop, 'FLOW_REPORT_NOT_PENDING_AFTER_RELOAD'):
            self.checker(server=host).run('private-owner', 'private-password')

    def test_no_external_path_or_origin_can_reach_http(self):
        for origin, path in ((ORIGIN, 'https://example.com/'), ('https://example.com', flow.safety.GUARD),
                             (ORIGIN, '/api/proxy/push-api'), (ORIGIN, '/storage/../../private')):
            with self.subTest(path=path), patch.object(flow.http.client, 'HTTPConnection') as connection:
                with self.assertRaises(app_cli.Stop):
                    flow.local_request(origin, 'GET', path, {}, b'')
                connection.assert_not_called()

    def test_artifact_is_valid_png(self):
        data = flow.image_bytes()
        self.assertTrue(data.startswith(b'\x89PNG\r\n\x1a\n'))
        self.assertIn(b'IHDR', data)
        self.assertTrue(data.endswith(b'IEND\xaeB`\x82'))

    def test_package_is_reproducible_and_contains_current_sources(self):
        first = build.build()
        original = (build.ROOT / build.DELIVERY).read_bytes()
        self.assertEqual(build.build(), first)
        self.assertEqual((build.ROOT / build.DELIVERY).read_bytes(), original)
        with zipfile.ZipFile(build.ROOT / 'bos-flow-check.pyz') as archive:
            self.assertEqual(archive.read('app_flow_check.py'), (build.ROOT / 'app_flow_check.py').read_bytes())
        with zipfile.ZipFile(io.BytesIO(original)) as archive:
            self.assertEqual(set(archive.namelist()), set(build.FILES))
            for name in build.FILES:
                self.assertEqual(archive.read(name), (build.ROOT / name).read_bytes())
        self.assertIn(first, (build.ROOT / 'check-flow.ps1').read_text())
        self.assertIn("'--resume-latest'", (build.ROOT / 'check-flow.ps1').read_text())


if __name__ == '__main__':
    unittest.main()
