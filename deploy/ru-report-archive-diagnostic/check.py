#!/usr/bin/env python3
"""Read-only report archive routing diagnosis on the existing RU Docker host.

No database queries, credentials, report submissions, file downloads, service
restarts or configuration writes. Network checks are unauthenticated health and
empty archive requests (ORDER_ID_REQUIRED before authentication or DB access).
Only fixed diagnostics, SHA-256 hashes, origins and HTTP status are printed.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

ORIGINS = ('https://139.100.237.167', 'https://136.234.17.113', 'https://homemaster.qd.je')
ENV_NAMES = ('SUPABASE_URL', 'BOS_AUTH_ORIGIN', 'BOS_REST_ORIGIN', 'BOS_STORAGE_ORIGIN')
BASE = Path('/opt/business-os')

class Stop(Exception):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def run(args):
    p = subprocess.run(args, capture_output=True, text=True, timeout=20)
    if p.returncode or len(p.stdout) > 8_000_000:
        raise Stop('DOCKER_READ_FAILED')
    return p.stdout

def origin(value):
    try:
        u = urlsplit(value)
        if u.scheme not in ('http', 'https') or not u.hostname:
            return 'INVALID_OR_UNSET'
        if u.username or u.password or u.query or u.fragment or u.path not in ('', '/'):
            return 'NOT_A_BARE_ORIGIN'
        if not re.fullmatch(r'[a-zA-Z0-9.:-]+', u.hostname):
            return 'INVALID_OR_UNSET'
        if u.port is not None and not 1 <= u.port <= 65535:
            return 'INVALID_OR_UNSET'
        return u.scheme + '://' + u.netloc
    except ValueError:
        return 'INVALID_OR_UNSET'

def emit(label, value):
    print(label + '=' + json.dumps(value, ensure_ascii=True, separators=(',', ':')), flush=True)

def read(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(BASE) or path.stat().st_size > 4_000_000:
        raise Stop('SOURCE_PATH_UNAVAILABLE')
    return path.read_bytes()

def source_summary(data):
    s = data.decode('utf-8')
    markers = [x for x in ('BOS_FUNCTIONS_ORIGIN', 'BOS_INTERNAL_ORIGIN', 'BOS_STORAGE_ORIGIN', 'BOS_REST_ORIGIN', '127.0.0.1') if x in s]
    return {'sha256': hashlib.sha256(data).hexdigest(),
            'archive_via_base': '${base}/functions/v1/drive-archive-api' in s,
            'base_from_supabase': bool(re.search(r"const\s+base\s*=\s*Deno\.env\.get\(['\"]SUPABASE_URL['\"]\)", s)),
            'fetch_override': bool(re.search(r'(?:globalThis|window)\.fetch\s*=', s)),
            'internal_markers': markers}

def probe(item):
    label, address, service = item
    if address not in ORIGINS or service not in ('lifecycle', 'archive'):
        raise Stop('PROBE_NOT_ALLOWED')
    path = '/functions/v1/' + ('order-lifecycle-api' if service == 'lifecycle' else 'drive-archive-api')
    body = b'{"action":"health"}' if service == 'lifecycle' else b'{}'
    req = Request(address + path, data=body, headers={'Content-Type': 'application/json'}, method='POST')
    started = time.monotonic()
    try:
        try:
            response = build_opener(NoRedirect()).open(req, timeout=8)
        except HTTPError as e:
            response = e
        with response:
            code = response.code
            # Do not print response bodies, redirect locations, URLs or exception messages.
            payload = response.read(8193)
        valid = False
        if len(payload) <= 8192:
            try:
                d = json.loads(payload)
                valid = (code == 200 and d.get('ok') is True) if service == 'lifecycle' else (code == 400 and d.get('error') == 'ORDER_ID_REQUIRED')
            except (ValueError, AttributeError):
                pass
        result = {'http': code, 'expected_response': valid}
    except Exception as e:
        result = {'error_type': type(e).__name__}
    result['seconds'] = round(time.monotonic() - started, 1)
    return label + '_' + service, result

def main():
    print('BOS_ARCHIVE_DIAGNOSTIC_BEGIN', flush=True)
    ids = run(['docker', 'ps', '-q']).split()
    if not ids:
        raise Stop('NO_CONTAINERS')
    containers = json.loads(run(['docker', 'inspect', *ids]))
    edges = [c for c in containers if re.fullmatch(r'/bos-release-[a-zA-Z0-9-]+-edge', c.get('Name', ''))]
    if len(edges) != 1:
        raise Stop('EDGE_NOT_UNIQUE')
    edge = edges[0]
    emit('EDGE', edge['Name'].lstrip('/'))
    # Read only known non-secret origins; never print the container environment.
    values = dict(x.split('=', 1) for x in edge.get('Config', {}).get('Env', []) if '=' in x and x.split('=', 1)[0] in ENV_NAMES)
    emit('ORIGINS', {k: origin(values.get(k, '')) for k in ENV_NAMES})
    mounts = {m['Destination']: Path(m['Source']) for m in edge.get('Mounts', []) if m.get('Type') == 'bind'}
    if '/bos-src' not in mounts:
        raise Stop('SOURCE_MOUNT_MISSING')
    for service in ('order-lifecycle-api', 'drive-archive-api'):
        emit(service, source_summary(read(mounts['/bos-src'] / service / 'index.ts')))
    main_root = mounts.get('/bos-main')
    if main_root:
        for p in sorted(main_root.glob('*.ts'))[:6]:
            emit('ROUTER_' + p.name, source_summary(read(p)))
    journal = BASE / 'deploy/ru-report-files-20261028-v1/journal.json'
    if journal.exists():
        j = json.loads(read(journal))
        status = j.get('status')
        emit('PHOTO_PATCH', status if status in ('prepared', 'installing', 'deployed', 'rolled_back') else 'UNKNOWN')
    else:
        emit('PHOTO_PATCH', 'NO_JOURNAL')
    # These probes run from the Docker host, not inside the edge worker.
    tasks = [(label, address, service) for label, address in zip(('HOST_OLD_IP', 'HOST_NEW_IP', 'HOST_DOMAIN'), ORIGINS) for service in ('lifecycle', 'archive')]
    with ThreadPoolExecutor(max_workers=6) as pool:
        for label, result in pool.map(probe, tasks):
            emit(label, result)

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        emit('STOP', str(e) if isinstance(e, Stop) else type(e).__name__)
    finally:
        print('BOS_ARCHIVE_DIAGNOSTIC_END', flush=True)
