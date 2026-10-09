#!/usr/bin/env python3
"""Prepare, back up and isolate-test a Hands sync bundle; never activate it.

Runs on the RU Docker host as root. No DB mutations, source replacement,
production restart, imports, notifications or provider configuration changes.
The temporary API has no external network and uses dummy database environment
values. The private source copy retains its existing webhook credential.
"""
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = pathlib.Path('/opt/business-os/deploy')
PIN = '9f08cabfc7b4b95891ba7d7e0648f9ff1e334c37'
RAW = 'https://raw.githubusercontent.com/zuev1ilya11-afk/business-os-vk/' + PIN + '/'
ASSETS = {
    'scripts/ru-check.py': 'da6c58723ed3945dae2d959a7bdee2e41ff8eccf82fd466474734c03afd5bdb2',
    'tests/fixtures/hands-v11-sync.ts': 'f85861ccb8285767a7f69d687573a981f56c23947de5435c20b2e6b381c18d5e',
    'supabase/functions/_shared/hands-sync.ts': 'dad95961de706bb3d460b3f8f90c549b4d019a5748395c6b918da10833592770',
}
IMPORT = b'import { syncHandsPages } from "./hands-sync.ts";\n'
REPLACEMENT = b"async function syncOrders(db:any,b:any){const map=await staffMap(db);return await syncHandsPages(b,'ACTIVE',q=>hands(`/orders/?${q}`),o=>importOrder(db,o,map))}"
RESOURCE_LIMITS = ['--memory', '512m', '--memory-swap', '512m', '--cpus', '1',
                   '--pids-limit', '256', '--user', '0:0']


class Stop(Exception):
    pass


def sha(content):
    return hashlib.sha256(content).hexdigest()


def patch_source(source, expected):
    marker = b'async function syncOrders('
    start = source.find(marker)
    if start < 0 or source.count(marker) != 1 or b'hands-sync.ts' in source:
        raise Stop('unknown, duplicate or already patched sync')
    if source[start:start + len(expected)] != expected:
        raise Stop('private sync differs from reviewed v11 fixture')
    after = source[start + len(expected):]
    if after and not after.startswith(b'\n'):
        raise Stop('unknown sync boundary')
    return IMPORT + source[:start] + REPLACEMENT + after


def tree_size(root):
    size = 0
    for path in root.rglob('*'):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise Stop('unexpected link or special file in deployment tree')
        if path.is_file():
            size += path.stat().st_size
    return size


def check_gateway(source):
    if '/bos-bundles/' not in source or '.eszip' not in source or 'Deno.serve' not in source:
        raise Stop('gateway bundle routing differs from expected layout')
    if re.search(r'\b(setInterval|Deno\.Command|Deno\.run)\s*\(', source):
        raise Stop('gateway has background/process code requiring review')


def gateway_env_names(source):
    return set(re.findall(r'Deno\.env\.get\(\s*[\'"]([A-Z][A-Z0-9_]{0,79})[\'"]\s*\)', source))


def candidate_environment(gateway_text, origins):
    # Reuse only credential-free origins already matched to release services.
    # Real DB/auth/VK credentials are not copied; Docker network remains none.
    values = {
        'SUPABASE_URL': 'http://127.0.0.1:1',
        'SUPABASE_ANON_KEY': 'candidate-no-database-access',
        'SUPABASE_SERVICE_ROLE_KEY': 'candidate-no-database-access',
        'JWT_SECRET': 'candidate-only-signing-key-with-no-production-validity',
        'VK_APP_SECRET': 'candidate-only-vk-key-with-no-production-validity',
    }
    for name in ('BOS_AUTH_ORIGIN', 'BOS_REST_ORIGIN', 'BOS_STORAGE_ORIGIN'):
        value = origins.get(name, '')
        try:
            url = urllib.parse.urlsplit(value)
            if (not value or any(c.isspace() for c in value) or url.scheme not in ('http', 'https')
                    or not url.hostname or url.username is not None or url.password is not None
                    or url.path not in ('', '/') or url.query or url.fragment
                    or (url.port is not None and not 1 <= url.port <= 65535)):
                raise ValueError()
        except (TypeError, ValueError):
            raise Stop('service origin must be a credential-free base URL: ' + name) from None
        values[name] = value
    missing = gateway_env_names(gateway_text) - values.keys()
    if missing:
        raise Stop('unreviewed gateway environment names: ' + ','.join(sorted(missing)))
    return values


def route_matches(edge, target, origin):
    try:
        parsed = urllib.parse.urlsplit(origin)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname:
            return False
        networks = target['NetworkSettings']['Networks']
        for network in set(edge['NetworkSettings']['Networks']) & set(networks):
            details = networks[network]
            names = [target['Name'].lstrip('/'), details.get('IPAddress'),
                     *(details.get('Aliases') or []), *(details.get('DNSNames') or [])]
            if parsed.hostname in names:
                return True
    except (KeyError, TypeError, ValueError):
        pass
    return False


def production_preflight(diag, edge, containers, gateway_text):
    """Compare current routing metadata, without issuing service/DB requests."""
    prefix = diag.name(edge)[:-len('-edge')]
    env = diag.env(edge)
    checks = {'gateway_env_missing_or_empty': sorted(name for name in gateway_env_names(gateway_text)
                                                   if not env.get(name)),
              'route_hosts_match_release': {}, 'database_container_matches_release': None}
    for service in ('auth', 'rest', 'storage'):
        matches = [item for item in containers if diag.name(item) == prefix + '-' + service]
        checks['route_hosts_match_release'][service] = (len(matches) == 1 and
            route_matches(edge, matches[0], env.get('BOS_' + service.upper() + '_ORIGIN', '')))
        if service == 'rest' and len(matches) == 1:
            try:
                db, _ = diag.find_db(matches[0], containers)
                checks['database_container_matches_release'] = diag.name(db) == prefix + '-db'
            except diag.CheckError:
                pass
    return checks


def require_memory(meminfo):
    available = re.search(r'^MemAvailable:\s+(\d+)\s+kB$', meminfo, re.MULTILINE)
    if not available or int(available[1]) < 1024 * 1024:
        raise Stop('at least 1 GiB available RAM is required for bounded staging')


def command(args, stage, label, timeout=30, input_data=None):
    try:
        result = subprocess.run(args, input=input_data, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise Stop(label + ': unavailable or timed out') from None
    # Source lines in compiler errors may contain credentials: keep all logs private.
    (stage / (label + '.log')).write_bytes(result.stdout + b'\n' + result.stderr)
    if result.returncode:
        raise Stop(label + ': failed; details retained privately on server')
    return result.stdout


def download(relative):
    try:
        with urllib.request.urlopen(RAW + relative, timeout=30) as response:
            content = response.read(2000000)
    except Exception:
        raise Stop('cannot download pinned public patch assets') from None
    if sha(content) != ASSETS[relative]:
        raise Stop('public patch asset checksum mismatch')
    return content


def mount_path(edge, target):
    mounts = [x for x in edge['Mounts'] if x['Destination'] == target and x['Type'] == 'bind']
    if len(mounts) != 1:
        raise Stop('expected bind mount missing: ' + target)
    raw = pathlib.Path(mounts[0]['Source'])
    actual = raw.resolve()
    if raw.is_symlink() or not actual.is_relative_to(BASE) or not actual.is_dir():
        raise Stop('unexpected deployment mount location')
    return actual


def token_from(source):
    matches = re.findall(rb"\bWEBHOOK_TOKEN\s*=\s*(['\"])([^'\"\r\n]{16,512})\1", source)
    if len(matches) != 1:
        raise Stop('webhook credential declaration differs; review required')
    return matches[0][1].decode('ascii')


PROBE = r'''
import json,sys,urllib.request,urllib.error,urllib.parse
data=json.load(sys.stdin)
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
results=[]
for path in data['paths']:
    url=data['origin']+path+'?'+urllib.parse.urlencode({'token':data['token']})
    request=urllib.request.Request(url,data=b'{}',method='POST',headers={'Content-Type':'application/json'})
    try:
        response=opener.open(request,timeout=4)
    except urllib.error.HTTPError as e: response=e
    except Exception:
        results.append({'path':path,'ok':False}); continue
    try:
        body=json.loads(response.read(8192))
        good=response.code==400 and body.get('error')=='MISSING_DELIVERY'
    except Exception: good=False
    finally: response.close()
    results.append({'path':path,'ok':good})
print(json.dumps(results))
'''


def probe(paths, token, stage, label, *, pid):
    if not isinstance(pid, int) or pid <= 0:
        raise Stop('isolated container PID required for probe')
    args = ['nsenter', '-t', str(pid), '-n', sys.executable, '-c', PROBE]
    # The credential travels only through stdin, never process arguments or output.
    data = json.dumps({'origin': 'http://127.0.0.1:9000', 'paths': paths, 'token': token}).encode()
    return json.loads(command(args, stage, label, input_data=data, timeout=20))


def report_candidate_failure(cid, stage, gateway_text):
    """Keep a runtime log tail private; print only fixed signals and env names."""
    try:
        info = json.loads(command(['docker', 'inspect', cid], stage, 'candidate-failed-metadata'))[0]
        command(['docker', 'logs', '--tail', '120', cid], stage, 'candidate-runtime')
        log = (stage / 'candidate-runtime.log').read_text(errors='replace').lower()
        patterns = {
            'dependency_network': r'network is unreachable|failed to lookup address|dns error|error sending request|connection refused|failed to fetch|import .*failed',
            'missing_environment': r'environment variable|missing.*(?:secret|key|env)|required.*(?:secret|key|env)|(?:secret|key|env).*required',
            'permission_denied': r'permission denied|operation not permitted',
            'file_missing': r'no such file|module not found|cannot find module',
            'invalid_bundle': r'invalid eszip|invalid.*bundle|failed to deserialize|unsupported.*eszip',
            'syntax_or_type_error': r'syntaxerror|typeerror|referenceerror',
            'memory_limit': r'out of memory|memory limit|cannot allocate memory',
            'invalid_cli_option': r'unexpected argument|unrecognized option|invalid.*argument',
        }
        env = {item.partition('=')[0] for item in info.get('Config', {}).get('Env', [])}
        needed = gateway_env_names(gateway_text)
        state = info['State']
        report = {'running': bool(state.get('Running')), 'exit_code': int(state.get('ExitCode', -1)),
                  'oom_killed': bool(state.get('OOMKilled')),
                  'log_signals': [name for name, pattern in patterns.items() if re.search(pattern, log)],
                  'gateway_env_not_set': sorted(needed - env)}
        print('CANDIDATE_DIAGNOSTIC=' + json.dumps(report), flush=True)
    except Exception:
        # Diagnostics must not replace the original failure or bypass cleanup.
        print('CANDIDATE_DIAGNOSTIC_UNAVAILABLE', flush=True)


def redact_runtime_log(log, source, metadata):
    log = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', log)
    log = ''.join(c for c in log if c in '\n\t' or ord(c) >= 32)
    values = set()
    for item in metadata:
        for entry in item.get('Config', {}).get('Env', []) or []:
            value = entry.partition('=')[2]
            if value:
                values.add(value)
    assignments = r'\b[\w$]*(?:token|secret|password|api_key|service_key)[\w$]*\s*(?::\s*[^=;\n]+)?=\s*([\'\"])(.*?)\1'
    values.update(match[1] for match in re.findall(assignments, source, re.IGNORECASE) if match[1])
    # Also hide opaque string literals, including credentials with other names.
    for _, value in re.findall(r'([\'\"])([^\'\"\r\n]{16,})\1', source):
        if not re.search(r'\s', value):
            values.add(value)
    representations = set()
    for value in values:
        representations.update((value, urllib.parse.quote(value, safe=''), urllib.parse.quote_plus(value),
                                json.dumps(value)[1:-1], json.dumps(value, ensure_ascii=False)[1:-1]))
    if representations:
        # Replace simultaneously, so short values cannot expand existing masks.
        pattern = '|'.join(re.escape(value) for value in sorted(representations, key=len, reverse=True))
        log = re.sub(pattern, '[REDACTED]', log)
    log = re.sub(r'[A-Za-z0-9_+/.=-]{32,}', '[OPAQUE_VALUE]', log)
    return log


def diagnose_last_failure():
    """Read a saved candidate log only; no Docker runs, network or writes."""
    if os.geteuid() != 0 or not BASE.is_dir():
        raise Stop('run diagnosis as root on the RU Docker host')
    stages = [p for p in BASE.glob('hands-stage-*') if p.is_dir() and not p.is_symlink()
              and (p / 'candidate-runtime.log').is_file()]
    if not stages:
        raise Stop('no saved candidate runtime log found')
    stage = max(stages, key=lambda p: (p / 'candidate-runtime.log').stat().st_mtime)
    diagnose_stage(stage)


def diagnose_stage(stage):
    def read(path):
        if path.is_symlink() or not path.resolve().is_relative_to(stage.resolve()) or path.stat().st_size > 8 * 1024 * 1024:
            raise Stop('unexpected diagnostic file')
        return path.read_text(errors='replace')
    metadata = []
    for name in ('container-metadata.log', 'candidate-failed-metadata.log'):
        metadata.extend(json.loads(read(stage / name)))
    paths = [stage / 'sources/hands-api/index.ts', *sorted((stage / 'main').rglob('*.ts'))]
    source = '\n'.join(read(path) for path in paths)
    safe = redact_runtime_log(read(stage / 'candidate-runtime.log'), source, metadata)
    print('DIAGNOSIS_READ_ONLY=' + str(stage), flush=True)
    print(safe[-6000:] or '[empty runtime log]', flush=True)
    print('DIAGNOSIS_DONE; saved log read only', flush=True)


def main():
    if len(sys.argv) != 1 or os.geteuid() != 0 or not BASE.is_dir():
        raise Stop('run without arguments as root on the RU Docker host')
    if not shutil.which('nsenter'):
        raise Stop('nsenter is needed for isolated verification; nothing installed')
    require_memory(pathlib.Path('/proc/meminfo').read_text())
    os.umask(0o077)
    stage = pathlib.Path(tempfile.mkdtemp(prefix='hands-stage-', dir=BASE))
    print('STAGE=' + str(stage), flush=True)
    diag_file = stage / 'ru-check.py'
    diag_file.write_bytes(download('scripts/ru-check.py'))
    spec = importlib.util.spec_from_file_location('ru_diag', diag_file)
    diag = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(diag)
    ids = command(['docker', 'ps', '-q'], stage, 'container-list').decode().split()
    if not ids:
        raise Stop('no running containers')
    all_containers = json.loads(command(['docker', 'inspect', *ids], stage, 'container-metadata'))
    edges = [x for x in all_containers if diag.name(x).startswith('bos-release-') and diag.name(x).endswith('-edge')]
    if len(edges) != 1:
        raise Stop('expected one active release edge')
    edge = edges[0]
    src = mount_path(edge, '/bos-src')
    bundles = mount_path(edge, '/bos-bundles')
    gateway = mount_path(edge, '/bos-main')
    if len({src.parent, bundles.parent, gateway.parent}) != 1:
        raise Stop('release mounts disagree')
    source_file, bundle_file = src / 'hands-api/index.ts', bundles / 'hands-api.eszip'
    if not source_file.is_file() or not bundle_file.is_file():
        raise Stop('expected hands-api/index.ts or hands-api.eszip not found')
    total = sum(tree_size(p) for p in (src, bundles, gateway))
    if total > 512 * 1024 * 1024 or shutil.disk_usage(stage).free < total * 3 + 256 * 1024 * 1024:
        raise Stop('deployment too large or free space insufficient')
    gateway_text = '\n'.join(p.read_text() for p in gateway.rglob('*.ts'))
    check_gateway(gateway_text)
    preflight = production_preflight(diag, edge, all_containers, gateway_text)
    print('PRODUCTION_PREFLIGHT=' + json.dumps(preflight), flush=True)
    if not all(preflight['route_hosts_match_release'].values()):
        raise Stop('service origins must match the active release network before candidate launch')
    candidate_env = candidate_environment(gateway_text, diag.env(edge))
    original_source, original_bundle = source_file.read_bytes(), bundle_file.read_bytes()
    expected = download('tests/fixtures/hands-v11-sync.ts').rstrip(b'\n')
    patched = patch_source(original_source, expected)
    token = token_from(original_source)
    backup = stage / 'backup'
    backup.mkdir()
    (backup / 'index.ts').write_bytes(original_source)
    (backup / 'hands-api.eszip').write_bytes(original_bundle)
    for folder, original in (('sources', src), ('bundles', bundles), ('main', gateway)):
        shutil.copytree(original, stage / folder)
    staged_index = stage / 'sources/hands-api/index.ts'
    staged_helper = staged_index.with_name('hands-sync.ts')
    if staged_helper.exists():
        raise Stop('helper already exists; refusing to overwrite')
    staged_index.write_bytes(patched)
    staged_helper.write_bytes(download('supabase/functions/_shared/hands-sync.ts'))
    output = stage / 'output'
    output.mkdir()
    nonce = uuid.uuid4().hex
    label = 'bos.hands.stage=' + nonce
    image = edge['Image']  # Exact local image, never a mutable tag or pull.
    print('BACKUP_OK; building separate bundle', flush=True)
    candidate_name = None
    try:
        build = ['docker', 'run', '--rm', '--pull=never', '--name', 'bos-hands-build-' + nonce,
                 '--label', label, *RESOURCE_LIMITS, '--entrypoint', 'edge-runtime',
                 '--mount', 'type=bind,src=' + str(stage / 'sources') + ',dst=/bos-src,readonly',
                 '--mount', 'type=bind,src=' + str(output) + ',dst=/bos-output', image,
                 'bundle', '--entrypoint', '/bos-src/hands-api/index.ts',
                 '--output', '/bos-output/hands-api.eszip', '--quiet', '--timeout', '90']
        command(build, stage, 'build', timeout=120)
        built = output / 'hands-api.eszip'
        if not built.is_file() or built.stat().st_size < 64:
            raise Stop('bundle output missing or empty')
        shutil.copyfile(built, stage / 'bundles/hands-api.eszip')
        print('BUNDLE_OK; checking isolated API', flush=True)
        require_memory(pathlib.Path('/proc/meminfo').read_text())
        # Retain exited candidates until their private logs have been collected.
        candidate_name = 'bos-hands-candidate-' + nonce
        candidate = ['docker', 'run', '-d', '--pull=never', '--network', 'none',
                     '--name', candidate_name, '--label', label, *RESOURCE_LIMITS]
        for name, value in candidate_env.items():
            candidate += ['-e', name + '=' + value]
        for folder, destination in (('sources', '/bos-src'), ('bundles', '/bos-bundles'), ('main', '/bos-main')):
            candidate += ['--mount', 'type=bind,src=' + str(stage / folder) + ',dst=' + destination + ',readonly']
        if edge['Config'].get('Entrypoint'):
            entry = edge['Config']['Entrypoint']
            if len(entry) != 1:
                raise Stop('compound entrypoint needs review')
            candidate += ['--entrypoint', entry[0]]
        candidate += [image, *(edge['Config'].get('Cmd') or [])]
        cid = command(candidate, stage, 'candidate-start').decode().strip()
        result = []
        for attempt in range(6):
            info = json.loads(command(['docker', 'inspect', cid], stage, 'candidate-metadata'))[0]
            pid = info['State']['Pid']
            if not info['State']['Running'] or pid <= 0:
                raise Stop('isolated API exited before validation')
            result = probe(['/hands-api', '/functions/v1/hands-api'],
                           token, stage, 'candidate-probe-' + str(attempt), pid=pid)
            if any(item['ok'] for item in result):
                break
            time.sleep(1)
        if not any(item['ok'] for item in result):
            raise Stop('isolated webhook validation failed')
        if source_file.read_bytes() != original_source or bundle_file.read_bytes() != original_bundle:
            raise Stop('production files changed during preparation')
        manifest = {'prepared': True, 'activated': False, 'edge_id': edge['Id'],
                    'source': str(source_file), 'bundle': str(bundle_file), 'image': image,
                    'source_before': sha(original_source), 'bundle_before': sha(original_bundle),
                    'source_after': sha(patched), 'bundle_after': sha(built.read_bytes()),
                    'helper_after': sha(staged_helper.read_bytes()), 'patch_commit': PIN,
                    'production_preflight': preflight,
                    'live_webhook_validation': False, 'isolated_webhook_validation': True}
        (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        print('WEBHOOK_TOKEN_SHA256=' + sha(token.encode()), flush=True)
        print('BOS_HANDS_PREPARED=' + str(stage), flush=True)
        print('No production files replaced or production DB operations issued; not activated.', flush=True)
    except Exception:
        if candidate_name:
            report_candidate_failure(candidate_name, stage, gateway_text)
            try:
                diagnose_stage(stage)
            except Exception:
                print('SANITIZED_RUNTIME_LOG_UNAVAILABLE', flush=True)
        raise
    finally:
        # Remove only containers marked with this unpredictable per-run label.
        try:
            own = command(['docker', 'ps', '-aq', '--filter', 'label=' + label], stage, 'cleanup-list').decode().split()
            if own:
                command(['docker', 'rm', '-f', *own], stage, 'cleanup')
        except Stop:
            print('TEMPORARY_CONTAINER_CLEANUP_REQUIRED', flush=True)


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--diagnose']:
            diagnose_last_failure()
        else:
            main()
    except Stop as error:
        print('PREPARE_STOPPED: ' + str(error), flush=True)
        sys.exit(1)
    except Exception as error:
        print('PREPARE_STOPPED: ' + type(error).__name__ + '; production not activated', flush=True)
        sys.exit(1)
