import io
import json
import unittest
from unittest.mock import patch
import zipfile

import app_cli
import app_flow_check as flow
import build_app_flow_check as build
from test_app_login_diagnostic import Runner, LAUNCH, ORIGIN


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
            self.staff[ident] = {'id': ident, 'role': body['role']}
            assert body['full_name'].startswith('BOS-CHECK-')
            return response({'ok': True, 'user': self.staff[ident]})
        if action == 'bootstrap':
            return response({'ok': True, 'user': {'role': role, 'full_name': 'PRIVATE_OWNER'},
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
            return response({'ok': True, 'url': 'http://127.0.0.1:9000' + path})
        if action == 'finalizeMasterReport':
            assert role == 'master'
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
                        'PRIVATE_CLIENT', 'PRIVATE_OWNER', 'synthetic.signature'):
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
        original = (build.ROOT / 'BOS-Flow-Check-20261116.zip').read_bytes()
        self.assertEqual(build.build(), first)
        self.assertEqual((build.ROOT / 'BOS-Flow-Check-20261116.zip').read_bytes(), original)
        with zipfile.ZipFile(build.ROOT / 'bos-flow-check.pyz') as archive:
            self.assertEqual(archive.read('app_flow_check.py'), (build.ROOT / 'app_flow_check.py').read_bytes())
        with zipfile.ZipFile(io.BytesIO(original)) as archive:
            self.assertEqual(set(archive.namelist()), set(build.FILES))
            for name in build.FILES:
                self.assertEqual(archive.read(name), (build.ROOT / name).read_bytes())
        self.assertIn(first, (build.ROOT / 'check-flow.ps1').read_text())


if __name__ == '__main__':
    unittest.main()
