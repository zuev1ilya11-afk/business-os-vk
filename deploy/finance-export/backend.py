"""Rebuild exact dependency versions, then exercise the real gateway offline."""
import base64
import concurrent.futures
import hashlib
import hmac
import json
from pathlib import Path
import re
import shutil
import sys
import time
import uuid
import eszip
import frozen
from common import require, read, atomic, run, inspect, emit, Stop

ENTRY = 'mini-app-api/supabase/functions/mini-app-api/index.ts'
MODEL_FILES = ('order-payroll.js', 'order-work-items.js', 'finance-expenses.js', 'salary-periods.js',
               'service-catalog.js', 'report-deduction.js', 'finance-data.js', 'finance-export-data.js')
NEW_HELPERS = ('supabase/functions/_shared/finance-export.ts', 'supabase/functions/_shared/finance-xlsx.js')
API = 'supabase/functions/mini-app-api/index.ts'


def register(work, name):
    path = work / 'containers.json'
    names = json.loads(read(path)) if path.exists() else []
    require(name not in names, 'STAGING_CONTAINER_DUPLICATE')
    atomic(path, json.dumps([*names, name]).encode())


def cleanup(work):
    path = work / 'containers.json'
    if not path.exists(): return
    names = json.loads(read(path))
    require(isinstance(names, list) and all(isinstance(n, str) and re.fullmatch(r'bos-finance-(?:build|test)-[a-f0-9]{32}', n) for n in names),
            'STAGING_CONTAINER_RECORD_INVALID')
    found = run(['docker', 'ps', '-a', '--filter', 'label=bos.finance.stage=' + str(work), '--format', '{{.Names}}']).decode().splitlines()
    require(set(found) <= set(names), 'STAGING_CONTAINER_UNRECORDED')
    for name in found:
        info = inspect(name)
        require((info['Config'].get('Labels') or {}).get('bos.finance.stage') == str(work), 'STAGING_CONTAINER_LABEL_CHANGED')
        run(['docker', 'rm', '-fv', name], work, 'orphan-remove')


def isolate(container, work):
    info = inspect(container)
    require(info['State']['Running'] and info['State']['Pid'] > 0, 'TEST_CONTAINER_NOT_RUNNING')
    require(set(info['NetworkSettings']['Networks']) <= {'none'}, 'TEST_CONTAINER_HAS_NETWORK')
    interfaces = run(['nsenter', '-t', str(info['State']['Pid']), '-n', sys.executable, '-c',
                      'import socket,json;print(json.dumps([n for _,n in socket.if_nameindex()]))'], work, 'interfaces')
    require(json.loads(interfaces) == ['lo'], 'TEST_INTERFACES_NOT_ISOLATED')
    return info['State']['Pid']


def compile_api(work, image, patched):
    source = work / 'compiler/mini-app-api'
    shutil.copytree(work / 'backup-source', source)
    entry = source / API
    original = read(work / 'backup-bundle.eszip')
    graph = eszip.parse(original)
    require(graph['checksum_kind'] in (0, 1), 'UNSUPPORTED_BUNDLE_CHECKSUM')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        integrities = dict(pool.map(frozen.integrity, sorted(graph['npm'])))
    config_path = entry.parent / 'deno.json'
    require(not config_path.with_suffix('.jsonc').exists(), 'JSONC_BUILD_CONFIG_UNSUPPORTED')
    config = json.loads(read(config_path)) if config_path.exists() else {'workspace': []}
    config['lock'] = {'path': './bos-finance.lock', 'frozen': True}
    atomic(config_path, json.dumps(config).encode())
    atomic(entry.parent / 'bos-finance.lock', json.dumps(frozen.lockfile(graph, integrities)).encode())
    output = work / 'output'; output.mkdir(mode=0o700)
    name = 'bos-finance-build-' + uuid.uuid4().hex
    args = ['docker', 'run', '-d', '--pull=never', '--network=bridge', '--name', name,
            '--label', 'bos.finance.stage=' + str(work),
            '--memory=768m', '--memory-swap=768m', '--cpus=1', '--pids-limit=256', '--user=0:0', '--entrypoint=/bin/sh',
            '--mount', 'type=bind,src=' + str(source) + ',dst=/bos-src/mini-app-api,readonly',
            '--mount', 'type=bind,src=' + str(output) + ',dst=/bos-output', image, '-c', 'while :; do sleep 1; done']
    started = False
    try:
        register(work, name)
        run(args, work, 'builder-start'); started = True
        command = ['docker', 'exec', name, 'edge-runtime', 'bundle', '--entrypoint', '/bos-src/' + ENTRY,
                   '--output', '/bos-output/mini-app-api.eszip', '--quiet', '--timeout', '120']
        emit('BUILD_EXACT_BASELINE')
        run(command, work, 'build-baseline', timeout=150)
        require(frozen.equal_baseline(original, read(output / 'mini-app-api.eszip')), 'BASELINE_REBUILD_DIFFERS')
        run(['docker', 'network', 'disconnect', 'bridge', name], work, 'builder-disconnect')
        isolate(name, work)
        for relative, data in patched.items():
            target = source / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            atomic(target, data)
        (output / 'mini-app-api.eszip').unlink()
        emit('BUILD_FINANCE_OFFLINE')
        run(command, work, 'build-candidate', timeout=150)
        candidate = read(output / 'mini-app-api.eszip')
        compiled = eszip.parse(candidate)
        require(compiled['npm'] == graph['npm'] and compiled['npm_roots'] == graph['npm_roots'], 'DEPENDENCY_VERSION_DRIFT')
        before, redirects, logical = frozen.executable_modules(graph, ENTRY)
        after, next_redirects, next_logical = frozen.executable_modules(compiled, ENTRY)
        require(logical == next_logical and redirects == next_redirects, 'MODULE_ROUTING_DRIFT')
        additions = {'/bos-src/mini-app-api/' + p for p in (*MODEL_FILES, *NEW_HELPERS, API)}
        require(not (set(before) - set(after)) and (set(after) - set(before)) <= additions, 'UNEXPECTED_NEW_MODULE')
        for key, value in before.items():
            if key != logical: require(after[key] == value, 'EXISTING_DEPENDENCY_CHANGED')
        return candidate
    finally:
        if started: run(['docker', 'rm', '-fv', name], work, 'builder-remove')


def jwt(role, secret):
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=').decode()
    text = encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode({'role': role, 'iss': 'supabase', 'exp': int(time.time()) + 3600})
    return text + '.' + base64.urlsafe_b64encode(hmac.new(secret.encode(), text.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()


def test_runtime(work, edge, main, package):
    target = work / 'probe-main'; shutil.copytree(main, target)
    gateway = read(target / 'index.ts').decode()
    lists = re.findall(r'\bconst\s+keys\s*=\s*(\[[^\]]*\])\s*;', gateway)
    require(len(lists) == 1, 'GATEWAY_KEYS_UNSUPPORTED')
    keys = []
    for token in lists[0][1:-1].split(','):
        match = re.fullmatch(r'''\s*['"]([A-Z][A-Z0-9_]*)['"]\s*''', token)
        require(match is not None, 'GATEWAY_KEY_LITERAL_REQUIRED'); keys.append(match[1])
    require({'SUPABASE_URL', 'VK_APP_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'} <= set(keys), 'GATEWAY_REQUIRED_KEYS')
    env = {key: 'isolated-finance-value' for key in keys}
    env.update({'JWT_SECRET': 'isolated-finance-jwt-secret', 'VK_APP_SECRET': 'isolated-finance-vk-secret',
                'SUPABASE_URL': 'http://127.0.0.1:9000'})
    env['SUPABASE_ANON_KEY'] = jwt('anon', env['JWT_SECRET'])
    env['SUPABASE_SERVICE_ROLE_KEY'] = jwt('service_role', env['JWT_SECRET'])
    for key, suffix in [('BOS_REST_ORIGIN', 'rest'), ('BOS_AUTH_ORIGIN', 'auth'), ('BOS_STORAGE_ORIGIN', 'storage')]:
        env[key] = 'http://bos-finance-probe-' + suffix + ':19001'
    # No real archived-report credentials enter the disposable runtime.
    for config in target.rglob('*.json'):
        require(config == target / 'bos-report-env.json', 'UNKNOWN_GATEWAY_PRIVATE_CONFIG')
        atomic(config, json.dumps({'version': 1, 'internal': 'http://127.0.0.1:9000',
            'public': 'https://homemaster.qd.je', 'legacy': '', 'workerKey': 'isolated-worker-key-not-production',
            'gas': 'http://127.0.0.1:19001/gas'}).encode())
    name = 'bos-finance-test-' + uuid.uuid4().hex
    entry = edge['Config'].get('Entrypoint') or []
    require(len(entry) <= 1 and isinstance(edge['Config'].get('Cmd'), list), 'RUNTIME_COMMAND_UNSUPPORTED')
    args = ['docker', 'run', '-d', '--pull=never', '--network=none', '--name', name,
            '--label', 'bos.finance.stage=' + str(work),
            '--memory=768m', '--memory-swap=768m', '--cpus=1', '--pids-limit=256', '--user=0:0']
    for suffix in ('rest', 'auth', 'storage'): args += ['--add-host', 'bos-finance-probe-' + suffix + ':127.0.0.1']
    for key, value in env.items(): args += ['-e', key + '=' + value]
    for source, dest in [(work / 'compiler', '/bos-src'), (work / 'output', '/bos-bundles'), (target, '/bos-main')]:
        args += ['--mount', 'type=bind,src=' + str(source) + ',dst=' + dest + ',readonly']
    if entry: args += ['--entrypoint', entry[0]]
    args += [edge['Image'], *edge['Config']['Cmd']]
    atomic(work / 'probe.py', package['probe.py']); atomic(work / 'fixture.json', package['fixture.json'])
    started = False
    try:
        register(work, name)
        run(args, work, 'runtime-start'); started = True
        pid = isolate(name, work)
        result = json.loads(run(['nsenter', '-t', str(pid), '-n', sys.executable, str(work / 'probe.py'), str(work / 'fixture.json')],
             work, 'fixture-probe', timeout=180, data=json.dumps({'vk_secret': env['VK_APP_SECRET']}).encode()))
        require(result == {'xlsx': True, 'totals': True, 'roles': True, 'sessions': True, 'filters': True, 'empty': True, 'writes': False}, 'FIXTURE_PROBE_INCOMPLETE')
        emit('ISOLATED_XLSX_TESTS', result)
    finally:
        if started:
            try: run(['docker', 'logs', name], work, 'runtime-output')
            finally: run(['docker', 'rm', '-fv', name], work, 'runtime-remove')
