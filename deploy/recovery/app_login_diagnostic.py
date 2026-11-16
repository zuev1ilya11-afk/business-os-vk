"""Bounded live checks of one already-running local application clone.

Never creates, stops or removes containers, never reads browser credentials.
One random invalid login exercises the same RPC chain as the login form; it
may add a synthetic rate-limit entry to the disposable clone. Raw responses,
Docker environment and logs stay in memory; only allowlisted facts are saved.
"""
import argparse
from datetime import datetime, timezone
import http.client
import json
from pathlib import Path
import re
import secrets
import time

import app_cli
import app_db_log_sanitize
import app_transport
import drill
import drill_files

MIB = 1024 * 1024
LABEL = 'io.business-os.local-app'
ROLES = ('db', 'rest', 'auth', 'storage', 'edge', 'https')
RUN = re.compile(r'bos-app-[0-9a-f]{12}')
ID = re.compile(r'[0-9a-f]{64}')
REPORT = re.compile(r'BOS-App-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.json')
ORIGIN = re.compile(r'http://127\.0\.0\.1:([0-9]{1,5})')
GUARD = '/__bos_local_guard.js'
LOGIN = '/api/proxy/password-session-api'
EMPTY = b'{"action":"login","login":"","password":""}'
PROBES = {
    'portal_guard': ('GET', GUARD, None),
    'rest_direct': ('GET', '/business_staff?select=id&limit=0', 3000),
    'rest_via_gateway': ('GET', '/rest/v1/business_staff?select=id&limit=0', 9000),
    'rest_rpc_schema': ('GET', '/', 3000),
    'empty_login': ('POST', LOGIN, None),
    'synthetic_login': ('POST', LOGIN, None),
}
ERROR_CODES = frozenset({'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003',
    'PGRST100', 'PGRST116', 'PGRST202', 'PGRST204', 'PGRST301', 'PGRST302',
    'PGRST303', '42501', '42883', '42P01', '42703', '53300', '53400', '57014'})


def require(condition, code):
    if not condition:
        raise app_cli.Stop(code)


def code(error):
    value = getattr(error, 'reason_code', None)
    known = {'DOCKER_COMMAND_TIMEOUT', 'DOCKER_COMMAND_FAILED', 'DOCKER_OUTPUT_LIMIT',
             'APP_DOCKER_COMMAND_TIMEOUT', 'APP_DOCKER_COMMAND_FAILED',
             'APP_HTTP_RESPONSE_INVALID', 'APP_HTTP_BODY_LIMIT'}
    if value in known:
        return value
    if isinstance(error, (TimeoutError,)):
        return 'TIMEOUT'
    if isinstance(error, (ConnectionError, OSError, http.client.HTTPException)):
        return 'CONNECTION_FAILED'
    return 'CHECK_FAILED'


def select_launch(work):
    candidates = sorted((p for p in work.glob('BOS-App-*.json') if REPORT.fullmatch(p.name)),
                        key=lambda p: p.name, reverse=True)
    require(bool(candidates), 'LOGIN_APP_REPORT_NOT_FOUND')
    require(len(candidates) <= 512, 'LOGIN_REPORT_COUNT_LIMIT')
    try:
        raw, _ = drill_files._read(candidates[0], limit=MIB, collect=True)
        value = json.loads(raw, object_pairs_hook=drill_files._unique_pairs)
    except Exception:
        raise app_cli.Stop('LOGIN_APP_REPORT_INVALID') from None
    require(isinstance(value, dict), 'LOGIN_APP_REPORT_INVALID')
    require(value.get('status') == 'READY_FOR_MANUAL_CHECK', 'LOGIN_APP_NOT_RUNNING')
    run, origin = value.get('run_id', ''), value.get('origin', '')
    require(isinstance(run, str) and RUN.fullmatch(run)
            and value.get('volume') == run + '-data'
            and isinstance(value.get('source_manifest_sha256'), str)
            and ID.fullmatch(value['source_manifest_sha256'])
            and value.get('network_isolation') == 'NETWORK_NONE_SHARED_LOOPBACK_NO_HOST_PORTS',
            'LOGIN_APP_REPORT_INVALID')
    require(isinstance(origin, str) and ORIGIN.fullmatch(origin)
            and 1 <= int(ORIGIN.fullmatch(origin)[1]) <= 65535, 'LOGIN_ORIGIN_INVALID')
    return {key: value[key] for key in ('run_id', 'volume', 'origin', 'source_manifest_sha256')}


def one(runner, args):
    try:
        value = json.loads(runner(args, timeout=10, limit=4 * MIB))
    except (ValueError, UnicodeError):
        raise app_cli.Stop('LOGIN_DOCKER_METADATA_INVALID') from None
    require(isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict),
            'LOGIN_DOCKER_METADATA_INVALID')
    return value[0]


def verify_container(item, cid, role, launch, anchor):
    host, config = item.get('HostConfig') or {}, item.get('Config') or {}
    require(item.get('Id') == cid and item.get('Name') == '/' + launch['run_id'] + '-' + role
            and (config.get('Labels') or {}).get(LABEL) == launch['run_id'],
            'LOGIN_CONTAINER_IDENTITY_CHANGED')
    require(host.get('NetworkMode') == ('none' if role == 'db' else 'container:' + anchor)
            and host.get('ReadonlyRootfs') is True and not host.get('Privileged')
            and not host.get('PortBindings') and not host.get('PublishAllPorts')
            and not host.get('Devices') and not host.get('DeviceRequests')
            and not host.get('VolumesFrom') and host.get('PidMode', '') in ('', 'private')
            and host.get('IpcMode', '') in ('', 'private')
            and host.get('UTSMode', '') in ('', 'private'), 'LOGIN_ISOLATION_CHANGED')
    if role == 'db':
        networks = item.get('NetworkSettings', {}).get('Networks') or {}
        require(set(networks) <= {'none'} and all(not n.get('IPAddress')
                and not n.get('GlobalIPv6Address') for n in networks.values()), 'LOGIN_ISOLATION_CHANGED')
    mounts = item.get('Mounts') or []
    # REST and Auth have no app-volume mount: they use the database over the
    # already-verified shared loopback namespace. Other services own mounts.
    require((role in ('rest', 'auth') or any(m.get('Type') == 'volume'
                and m.get('Name') == launch['volume'] for m in mounts))
            and all(m.get('Type') == 'tmpfs' or (m.get('Type') == 'volume'
                    and m.get('Name') == launch['volume']) for m in mounts), 'LOGIN_MOUNTS_CHANGED')
    return item


def discover(runner, launch):
    volume = one(runner, ['volume', 'inspect', launch['volume']])
    require(volume.get('Name') == launch['volume'] and volume.get('Driver') == 'local'
            and not volume.get('Options') and (volume.get('Labels') or {}).get(LABEL) == launch['run_id'],
            'LOGIN_VOLUME_IDENTITY_CHANGED')
    ids = runner(['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter',
                  'label=' + LABEL + '=' + launch['run_id']], timeout=10, limit=4096).decode().split()
    require(ids, 'LOGIN_APP_NOT_RUNNING')
    require(len(ids) <= len(ROLES) and len(set(ids)) == len(ids) and all(ID.fullmatch(v) for v in ids),
            'LOGIN_CONTAINER_SET_INVALID')
    records = {}
    for cid in ids:
        item = one(runner, ['container', 'inspect', cid])
        role = next((r for r in ROLES if item.get('Name') == '/' + launch['run_id'] + '-' + r), None)
        require(role is not None and role not in records, 'LOGIN_CONTAINER_SET_INVALID')
        records[role] = item
    require('db' in records, 'LOGIN_APP_NOT_RUNNING')
    anchor = records['db']['Id']
    for role, item in records.items():
        verify_container(item, item['Id'], role, launch, anchor)
    return records


def environment(item):
    result = {}
    values = item.get('Config', {}).get('Env') or []
    require(isinstance(values, list) and len(values) <= 4096, 'LOGIN_ENV_INVALID')
    for value in values:
        require(isinstance(value, str) and '=' in value, 'LOGIN_ENV_INVALID')
        key, content = value.split('=', 1)
        require(key not in result, 'LOGIN_ENV_INVALID')
        result[key] = content
    return result


def http_summary(status, headers, body):
    """Never expose a URL, header, message, session or returned database row."""
    require(type(status) is int and 100 <= status <= 599 and isinstance(body, bytes),
            'LOGIN_RESPONSE_INVALID')
    result = {'http_status': status, 'response_bytes': len(body)}
    try:
        value = json.loads(body) if len(body) <= 4 * MIB else None
    except (ValueError, UnicodeError, RecursionError):
        value = None
    result['json_kind'] = ('object' if isinstance(value, dict) else 'array'
                           if isinstance(value, list) else 'null' if body.strip() == b'null' else 'other')
    if isinstance(value, dict):
        if type(value.get('ok')) is bool:
            result['ok'] = value['ok']
        error_code = value.get('code')
        if isinstance(error_code, str) and error_code in ERROR_CODES:
            result['error_code'] = error_code
        result['session_returned'] = bool(value.get('session_token')) or any(
            str(key).lower() == 'x-bos-session' and bool(content)
            for key, content in headers.items())
        paths = value.get('paths')
        if isinstance(paths, dict):
            result['credential_rpc_visible'] = '/rpc/bos_verify_staff_credentials' in paths
            result['rate_limit_rpc_visible'] = '/rpc/bos_consume_login_attempt' in paths
        messages = {'Введите логин и пароль': 'EMPTY_CREDENTIALS_REJECTED',
                    'Неверный логин или пароль': 'INVALID_CREDENTIALS_REJECTED',
                    'Слишком много попыток входа. Повторите позже.': 'LOGIN_RATE_LIMITED',
                    'Временная ошибка сервиса. Повторите позже.': 'LOGIN_SERVICE_ERROR'}
        error = value.get('error')
        if isinstance(error, str) and error in messages:
            result['login_result'] = messages[error]
    return result


def host_request(origin, method, path, body=b''):
    require(isinstance(origin, str) and ORIGIN.fullmatch(origin), 'LOGIN_ORIGIN_INVALID')
    require(path in (GUARD, LOGIN), 'LOGIN_PATH_INVALID')
    port = int(ORIGIN.fullmatch(origin)[1])
    require(1 <= port <= 65535, 'LOGIN_ORIGIN_INVALID')
    # HTTPConnection ignores proxy environment and does not follow redirects.
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=25)
    try:
        connection.request(method, path, body=body, headers={'Origin': origin,
            'Content-Type': 'application/json', 'Connection': 'close'})
        response = connection.getresponse()
        data = response.read(65537)
        require(len(data) <= 65536, 'LOGIN_RESPONSE_TOO_LARGE')
        return response.status, dict(response.getheaders()), data
    finally:
        connection.close()


def request_metadata(name, origin):
    """Only fixed probe paths and a validated loopback origin may be recorded."""
    require(name in PROBES and isinstance(origin, str) and ORIGIN.fullmatch(origin),
            'LOGIN_REQUEST_METADATA_INVALID')
    require(1 <= int(ORIGIN.fullmatch(origin)[1]) <= 65535, 'LOGIN_ORIGIN_INVALID')
    method, path, port = PROBES[name]
    return {'method': method, 'url': (origin if port is None else 'http://127.0.0.1:' + str(port)) + path,
            'network_scope': 'HOST_LOOPBACK' if port is None else 'ISOLATED_CONTAINER_LOOPBACK',
            'started_at': datetime.now(timezone.utc).isoformat(timespec='milliseconds')}


def measured(call, *, name, origin):
    metadata = request_metadata(name, origin)
    start = time.monotonic()
    try:
        result = http_summary(*call())
    except Exception as error:
        result = {'error': code(error)}
    result['elapsed_ms'] = round((time.monotonic() - start) * 1000)
    result['exceeded_browser_timeout'] = result['elapsed_ms'] >= 20000
    result['request'] = metadata
    return result


def rejected_login(check, result, status):
    return (check.get('http_status') == status and check.get('ok') is False
            and check.get('login_result') == result and check.get('session_returned') is False)


def first_failed_request(checks):
    """Chronological failure among performed probes, not a claimed browser trace."""
    for name, check in checks.items():
        if name == 'portal_guard':
            passed = check.get('recognized') is True
        elif name == 'empty_login':
            passed = rejected_login(check, 'EMPTY_CREDENTIALS_REJECTED', 400)
        elif name == 'synthetic_login':
            passed = rejected_login(check, 'INVALID_CREDENTIALS_REJECTED', 401)
        else:
            passed = check.get('http_status') == 200
        if not passed:
            return {'probe': name, **{key: check[key] for key in
                ('request', 'http_status', 'error', 'elapsed_ms') if key in check}}
    return None


def diagnosis(report):
    containers, checks = report.get('containers', {}), report.get('checks', {})
    if any(c.get('oom_killed') for c in containers.values()):
        return 'LOCAL_SERVICE_OUT_OF_MEMORY'
    if any(not containers.get(role, {}).get('running') for role in ROLES):
        return 'LOCAL_SERVICE_NOT_RUNNING'
    if checks.get('portal_guard', {}).get('recognized') is not True:
        return 'LOCAL_PORTAL_UNAVAILABLE'
    direct, gateway = checks.get('rest_direct', {}), checks.get('rest_via_gateway', {})
    if direct.get('http_status') == 200 and gateway.get('http_status') != 200:
        return 'GATEWAY_TO_DATABASE_PATH_FAILED'
    if direct.get('http_status') != 200:
        return 'DATABASE_HTTP_PATH_FAILED'
    attempt = checks.get('synthetic_login', {})
    if attempt.get('exceeded_browser_timeout') or attempt.get('error') in ('TIMEOUT', 'APP_DOCKER_COMMAND_TIMEOUT'):
        return 'LOGIN_PATH_TIMEOUT'
    if rejected_login(attempt, 'LOGIN_RATE_LIMITED', 429):
        return 'LOCAL_LOGIN_RATE_LIMITED'
    if rejected_login(attempt, 'INVALID_CREDENTIALS_REJECTED', 401):
        return 'INVALID_LOGIN_PATH_OK_REAL_LOGIN_AND_BOOTSTRAP_NOT_TESTED'
    return 'LOGIN_PATH_FAILED_NEEDS_REVIEW'


def collect(runner, launch, *, host=host_request, transport=app_transport.http_call, progress=lambda x: None):
    records = discover(runner, launch)
    report = {'format': 2, 'diagnostic': 'LIVE_LOGIN_CHECK', 'status': 'COLLECTED',
        'run_id': launch['run_id'], 'source_manifest_sha256': launch['source_manifest_sha256'],
        'origin': launch['origin'], 'containers': {}, 'checks': {}, 'service_logs': {},
        'real_credentials_used': False, 'real_login_verified': False,
        'authenticated_bootstrap_tested': False, 'synthetic_login_requests': 0,
        'account_credentials_changed': False, 'containers_changed': False,
        'production_accessed': False, 'disaster_recovery_ready': False}
    anchor = records['db']['Id']
    for role, item in records.items():
        state = item.get('State') or {}
        report['containers'][role] = {'running': state.get('Running') is True,
            'oom_killed': state.get('OOMKilled') is True,
            'exit_code': state.get('ExitCode') if type(state.get('ExitCode')) is int else None,
            'restart_count': item.get('RestartCount') if type(item.get('RestartCount')) is int else None}
    checks = report['checks']
    progress('LOCAL_PORTAL')
    metadata = request_metadata('portal_guard', launch['origin'])
    started = time.monotonic()
    try:
        status, _, data = host(launch['origin'], 'GET', GUARD)
        checks['portal_guard'] = {'http_status': status,
            'recognized': status == 200 and b'LOCAL_DRILL_EXTERNAL_BLOCKED' in data}
    except Exception as error:
        checks['portal_guard'] = {'recognized': False, 'error': code(error)}
    checks['portal_guard'].update(request=metadata,
        elapsed_ms=round((time.monotonic() - started) * 1000))
    env = environment(records['edge']) if 'edge' in records else {}
    report['local_configuration'] = {'supabase_url_is_local_gateway': env.get('SUPABASE_URL') == 'http://127.0.0.1:9000',
        'service_key_present': bool(env.get('SUPABASE_SERVICE_ROLE_KEY')),
        'session_secret_present': bool(env.get('VK_APP_SECRET'))}
    token = env.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if report['containers']['db']['running'] and re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', token):
        headers = {'Authorization': 'Bearer ' + token, 'apikey': token}
        progress('DATABASE_PATHS')
        for name, port, path in (
                ('rest_direct', 3000, '/business_staff?select=id&limit=0'),
                ('rest_via_gateway', 9000, '/rest/v1/business_staff?select=id&limit=0'),
                ('rest_rpc_schema', 3000, '/')):
            verify_container(one(runner, ['container', 'inspect', anchor]), anchor, 'db', launch, anchor)
            checks[name] = measured(lambda port=port, path=path: transport(runner, anchor,
                'GET', path, headers, b'', port=port, timeout=10), name=name, origin=launch['origin'])
    if checks['portal_guard']['recognized']:
        progress('LOGIN_VALIDATION')
        checks['empty_login'] = measured(lambda: host(launch['origin'], 'POST', LOGIN, EMPTY),
                                         name='empty_login', origin=launch['origin'])
        if rejected_login(checks['empty_login'], 'EMPTY_CREDENTIALS_REJECTED', 400):
            # No real staff login or password is read or entered. Never retry:
            # this may consume one local IP counter and one random pair counter.
            progress('SYNTHETIC_LOGIN')
            payload = json.dumps({'action': 'login', 'login': 'bos_check_' + secrets.token_hex(16),
                                  'password': secrets.token_urlsafe(32)}).encode()
            report['synthetic_login_requests'] = 1
            checks['synthetic_login'] = measured(lambda: host(launch['origin'], 'POST', LOGIN, payload),
                                                 name='synthetic_login', origin=launch['origin'])
    progress('SERVICE_LOGS')
    for role, item in records.items():
        try:
            current = one(runner, ['container', 'inspect', item['Id']])
            verify_container(current, item['Id'], role, launch, anchor)
            report['containers'][role]['running'] = current.get('State', {}).get('Running') is True
            report['containers'][role]['oom_killed'] = current.get('State', {}).get('OOMKilled') is True
            raw = runner(['container', 'logs', '--since', '30m', '--tail', '120', item['Id']],
                         timeout=10, limit=MIB)
            stderr = getattr(runner, 'last_error', b'')
            report['service_logs'][role] = app_db_log_sanitize.summarize(raw + b'\n' + stderr)
        except Exception as error:
            report['service_logs'][role] = {'error': code(error)}
    report['finding'] = diagnosis(report)
    report['first_failed_request'] = first_failed_request(checks)
    report['request_trace_scope'] = 'DIAGNOSTIC_PROBES_ONLY_NOT_BROWSER_HISTORY'
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description='Check one running isolated Business OS copy; no real passwords')
    parser.add_argument('--package-dir', required=True)
    args = parser.parse_args(argv)
    work = Path(args.package_dir)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    name = 'BOS-Login-Diagnostic-' + stamp + '-' + secrets.token_hex(4) + '.json'
    result = {'format': 1, 'diagnostic': 'LIVE_LOGIN_CHECK', 'status': 'STOPPED',
              'real_credentials_used': False, 'disaster_recovery_ready': False}
    try:
        launch = select_launch(work)
        result = collect(drill.DockerRunner(), launch,
            progress=lambda stage: print('LOGIN_CHECK=' + stage, flush=True))
    except Exception as error:
        reason = getattr(error, 'reason_code', None)
        result['reason'] = (reason if isinstance(reason, str)
                            and re.fullmatch(r'LOGIN_[A-Z_]{3,80}|DOCKER_UNAVAILABLE|LOCAL_DOCKER_REQUIRED', reason)
                            else code(error))
    try:
        app_cli.write_report(work / name, result)
        print(json.dumps({'diagnostic': result['status'],
            'finding': result.get('finding', result.get('reason')), 'report': str(work / name)}, ensure_ascii=True), flush=True)
    except OSError:
        print('{"diagnostic":"STOPPED","reason":"LOGIN_REPORT_WRITE_FAILED"}', flush=True)
        return 1
    return 0 if result['status'] == 'COLLECTED' else 1


if __name__ == '__main__':
    raise SystemExit(main())
