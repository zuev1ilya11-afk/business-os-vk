import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import app_cli
import app_login_diagnostic as login
import build_app_login_diagnostic as build


RUN = 'bos-app-123456789abc'
ORIGIN = 'http://127.0.0.1:45678'
LAUNCH = {'run_id': RUN, 'volume': RUN + '-data', 'origin': ORIGIN,
          'source_manifest_sha256': 'a' * 64}
SECRET = 'private.jwt.secret'


class Runner:
    def __init__(self):
        self.last_error = b''
        self.calls = []
        self.records = {}
        for index, role in enumerate(login.ROLES):
            cid = str(index + 1) * 64
            self.records[cid] = {'Id': cid, 'Name': '/' + RUN + '-' + role,
                'Config': {'Labels': {login.LABEL: RUN}, 'Env': [
                    'SUPABASE_URL=http://127.0.0.1:9000', 'SUPABASE_SERVICE_ROLE_KEY=' + SECRET,
                    'VK_APP_SECRET=private-session-secret']},
                'HostConfig': {'NetworkMode': 'none' if role == 'db' else 'container:' + '1' * 64,
                    'ReadonlyRootfs': True}, 'State': {'Running': True, 'OOMKilled': False, 'ExitCode': 0},
                'RestartCount': 0, 'Mounts': ([] if role in ('rest', 'auth') else
                    [{'Type': 'volume', 'Name': RUN + '-data'}])}

    def __call__(self, args, **kwargs):
        self.calls.append(args)
        self.last_error = b''
        if args[:2] == ['volume', 'inspect']:
            return json.dumps([{'Name': RUN + '-data', 'Driver': 'local', 'Labels': {login.LABEL: RUN}}]).encode()
        if args[:2] == ['container', 'ls']:
            return '\n'.join(self.records).encode()
        if args[:2] == ['container', 'inspect']:
            return json.dumps([self.records[args[2]]]).encode()
        if args[:2] == ['container', 'logs']:
            self.last_error = b'ERROR: connection refused for private-client-name private-session-secret\n'
            return b'private.jwt.secret private-account-password private-client-address\n'
        raise AssertionError('Mutating or unexpected Docker operation: ' + str(args[:2]))


class Checks:
    def __init__(self):
        self.logins = []
        self.gateway_failure = False
        self.portal_unavailable = False
        self.login_timeout = False

    def host(self, origin, method, path, body=b''):
        assert origin == ORIGIN
        if self.portal_unavailable:
            raise ConnectionRefusedError('private-host-detail')
        if path == login.GUARD:
            return 200, {}, b'LOCAL_DRILL_EXTERNAL_BLOCKED'
        value = json.loads(body)
        self.logins.append(value)
        if not value['login']:
            return 400, {}, json.dumps({'ok': False, 'error': 'Введите логин и пароль'}).encode()
        if self.login_timeout:
            raise TimeoutError('private-detail')
        return 401, {'X-BOS-Session': 'private-session-secret'}, json.dumps({
            'ok': False, 'error': 'Неверный логин или пароль', 'private': 'private-client-name'}).encode()

    def transport(self, runner, anchor, method, path, headers, body, *, port, timeout):
        assert anchor == '1' * 64
        assert method == 'GET' and not body
        assert headers['apikey'] == SECRET
        if port == 9000 and self.gateway_failure:
            return 503, {}, b'{"message":"private-client-name"}'
        if path == '/':
            return 200, {}, json.dumps({'paths': {'/rpc/bos_verify_staff_credentials': {},
                '/rpc/bos_consume_login_attempt': {}, '/private_table': {}}, 'private': SECRET}).encode()
        assert path.endswith('limit=0')
        return 200, {}, b'[]'


class LoginDiagnosticTests(unittest.TestCase):
    def collect(self, checks=None, runner=None):
        checks, runner = checks or Checks(), runner or Runner()
        result = login.collect(runner, LAUNCH, host=checks.host, transport=checks.transport)
        return result, checks, runner

    def test_exercises_single_invalid_login_and_does_not_claim_real_login(self):
        result, checks, runner = self.collect()
        self.assertEqual(result['finding'], 'INVALID_LOGIN_PATH_OK_REAL_LOGIN_AND_BOOTSTRAP_NOT_TESTED')
        self.assertFalse(result['real_login_verified'])
        self.assertFalse(result['authenticated_bootstrap_tested'])
        self.assertEqual(result['synthetic_login_requests'], 1)
        self.assertEqual(len(checks.logins), 2)
        self.assertRegex(checks.logins[1]['login'], r'^bos_check_[0-9a-f]{32}$')
        self.assertGreaterEqual(len(checks.logins[1]['password']), 32)
        self.assertTrue(result['checks']['rest_rpc_schema']['credential_rpc_visible'])
        allowed = {('volume', 'inspect'), ('container', 'ls'), ('container', 'inspect'), ('container', 'logs')}
        self.assertTrue(all(tuple(args[:2]) in allowed for args in runner.calls))

    def test_no_private_response_header_environment_log_or_payload_leaks(self):
        result, checks, _ = self.collect()
        output = json.dumps(result)
        for value in (SECRET, 'private-session-secret', 'private-client-name', 'private-client-address',
                      'private-account-password', 'private_table', checks.logins[1]['login'], checks.logins[1]['password']):
            self.assertNotIn(value, output)

    def test_gateway_failure_distinguished_from_database_success(self):
        checks = Checks()
        checks.gateway_failure = True
        self.assertEqual(self.collect(checks)[0]['finding'], 'GATEWAY_TO_DATABASE_PATH_FAILED')

    def test_portal_unavailable_does_not_attempt_login(self):
        checks = Checks()
        checks.portal_unavailable = True
        result, _, _ = self.collect(checks)
        self.assertEqual(result['finding'], 'LOCAL_PORTAL_UNAVAILABLE')
        self.assertEqual(result['synthetic_login_requests'], 0)
        self.assertFalse(checks.logins)

    def test_timeout_sanitized_and_not_retried(self):
        checks = Checks()
        checks.login_timeout = True
        result, _, _ = self.collect(checks)
        self.assertEqual(result['checks']['synthetic_login']['error'], 'TIMEOUT')
        self.assertEqual(result['finding'], 'LOGIN_PATH_TIMEOUT')
        self.assertNotIn('private-detail', json.dumps(result))
        self.assertEqual(len(checks.logins), 2)

    def test_stopped_or_oom_service_identified(self):
        runner = Runner()
        runner.records['5' * 64]['State'].update(Running=False, OOMKilled=True)
        self.assertEqual(self.collect(runner=runner)[0]['finding'], 'LOCAL_SERVICE_OUT_OF_MEMORY')

    def test_network_host_ports_foreign_mount_and_label_fail_closed(self):
        for change in ('network', 'port', 'mount', 'label'):
            with self.subTest(change=change):
                runner, checks = Runner(), Checks()
                item = runner.records['5' * 64]
                if change == 'network': item['HostConfig']['NetworkMode'] = 'bridge'
                if change == 'port': item['HostConfig']['PortBindings'] = {'9000/tcp': [{}]}
                if change == 'mount': item['Mounts'][0]['Name'] = 'production-data'
                if change == 'label': item['Config']['Labels'][login.LABEL] = 'foreign'
                with self.assertRaises(app_cli.Stop): self.collect(checks, runner)
                self.assertFalse(checks.logins)

    def test_metadata_rechecked_before_each_container_probe(self):
        runner, checks = Runner(), Checks()
        original = checks.transport
        def changing(*args, **kwargs):
            result = original(*args, **kwargs)
            runner.records['1' * 64]['HostConfig']['NetworkMode'] = 'bridge'
            return result
        with self.assertRaisesRegex(app_cli.Stop, 'LOGIN_ISOLATION_CHANGED'):
            login.collect(runner, LAUNCH, host=checks.host, transport=changing)
        self.assertFalse(checks.logins)

    def test_database_requires_own_volume_even_though_rest_auth_do_not(self):
        runner = Runner()
        runner.records['1' * 64]['Mounts'] = []
        with self.assertRaisesRegex(app_cli.Stop, 'LOGIN_MOUNTS_CHANGED'):
            self.collect(runner=runner)

    def test_latest_ready_report_only(self):
        with tempfile.TemporaryDirectory() as root:
            work = Path(root)
            report = dict(LAUNCH, status='READY_FOR_MANUAL_CHECK',
                network_isolation='NETWORK_NONE_SHARED_LOOPBACK_NO_HOST_PORTS')
            first = work / 'BOS-App-20261115T120000Z-12345678.json'
            first.write_text(json.dumps(report))
            self.assertEqual(login.select_launch(work), LAUNCH)
            (work / 'BOS-App-20261115T130000Z-12345678.json').write_text('{"status":"STOPPED"}')
            with self.assertRaisesRegex(app_cli.Stop, 'LOGIN_APP_NOT_RUNNING'): login.select_launch(work)

    def test_report_external_origin_and_symlink_blocked(self):
        with tempfile.TemporaryDirectory() as root:
            work = Path(root)
            report = dict(LAUNCH, status='READY_FOR_MANUAL_CHECK',
                network_isolation='NETWORK_NONE_SHARED_LOOPBACK_NO_HOST_PORTS', origin='https://production.example')
            path = work / 'BOS-App-20261115T120000Z-12345678.json'
            path.write_text(json.dumps(report))
            with self.assertRaisesRegex(app_cli.Stop, 'LOGIN_ORIGIN_INVALID'): login.select_launch(work)
            target = work / 'other.json'
            path.rename(target)
            try: path.symlink_to(target)
            except OSError: self.skipTest('Symlinks unavailable')
            with self.assertRaisesRegex(app_cli.Stop, 'LOGIN_APP_REPORT_INVALID'): login.select_launch(work)

    def test_host_request_blocks_external_target_and_unapproved_path(self):
        with patch('http.client.HTTPConnection') as connection:
            for origin, path in [('http://production.example:123', login.LOGIN), (ORIGIN, '/private')]:
                with self.assertRaises(app_cli.Stop): login.host_request(origin, 'GET', path)
            connection.assert_not_called()

    def test_report_created_even_when_app_not_started(self):
        with tempfile.TemporaryDirectory() as root, patch.object(login.drill, 'DockerRunner') as runner:
            self.assertEqual(login.main(['--package-dir', root]), 1)
            runner.assert_not_called()
            report = json.loads(next(Path(root).glob('BOS-Login-Diagnostic-*.json')).read_text())
            self.assertEqual(report['reason'], 'LOGIN_APP_REPORT_NOT_FOUND')

    def test_package_reproducible_and_modules_match(self):
        before = {name: (build.ROOT / name).read_bytes() for name in ('bos-login-check.pyz', 'check-login.ps1')}
        first, second = build.build(), build.build()
        self.assertEqual(first, second)
        self.assertEqual(first, hashlib.sha256(before['bos-login-check.pyz']).hexdigest())
        for name, data in before.items(): self.assertEqual((build.ROOT / name).read_bytes(), data)
        with zipfile.ZipFile(build.ROOT / 'bos-login-check.pyz') as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(set(archive.namelist()), set(build.MODULES) | {'__main__.py'})
            for name in build.MODULES: self.assertEqual(archive.read(name), (build.ROOT / name).read_bytes())


if __name__ == '__main__':
    unittest.main()
