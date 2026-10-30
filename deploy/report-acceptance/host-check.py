#!/usr/bin/env python3
"""Read-only, offline inventory for the existing RU report release.

No database requests, network requests, writes, restarts, or secret output.
Docker inspect is consumed in memory; only allowlisted metadata is printed.
"""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import unquote, urlsplit


class Stop(Exception):
    pass


def emit(key, value):
    print(key + '=' + json.dumps(value, ensure_ascii=True, separators=(',', ':')), flush=True)


def run(args):
    result = subprocess.run(args, capture_output=True, timeout=30, check=True)
    return result.stdout.decode()


def env(container):
    return dict(item.split('=', 1) for item in container.get('Config', {}).get('Env', []) if '=' in item)


def name(container):
    return container['Name'].lstrip('/')


def origin(value):
    if not value:
        return 'UNSET'
    try:
        url = urlsplit(value)
        if url.scheme not in ('http', 'https') or not url.hostname:
            return 'INVALID'
        return {'scheme': url.scheme, 'host': url.hostname, 'port': url.port}
    except ValueError:
        return 'INVALID'


def resolve(source, host, containers):
    matches = []
    for candidate in containers:
        common = set(source['NetworkSettings']['Networks']) & set(candidate['NetworkSettings']['Networks'])
        for network in common:
            details = candidate['NetworkSettings']['Networks'][network]
            aliases = [name(candidate), details.get('IPAddress'), *(details.get('Aliases') or []), *(details.get('DNSNames') or [])]
            if host and host in aliases:
                matches.append(candidate)
                break
    if len(matches) != 1:
        raise Stop('ROUTE_NOT_UNIQUE')
    return matches[0]


def mount(container, target):
    matches = [m for m in container['Mounts'] if m['Destination'] == target and m['Type'] == 'bind']
    if len(matches) != 1:
        raise Stop('BIND_MOUNT_NOT_UNIQUE')
    root = Path(matches[0]['Source'])
    if root.resolve() != root or not root.is_dir():
        raise Stop('UNEXPECTED_MOUNT_PATH')
    return root


def read_file(root, relative):
    path = root / relative
    if not path.exists():
        return None
    if not path.is_file() or path.resolve() != path or path.stat().st_size > 8_000_000:
        raise Stop('UNEXPECTED_SOURCE_FILE')
    return path.read_bytes()


def main():
    emit('CHECK_ONLY', True)
    ids = run(['docker', 'ps', '-q']).split()
    if not ids:
        raise Stop('NO_RUNNING_CONTAINERS')
    containers = json.loads(run(['docker', 'inspect', *ids]))
    edges = [c for c in containers if name(c).startswith('bos-release-') and name(c).endswith('-edge')]
    if len(edges) != 1:
        raise Stop('EDGE_NOT_UNIQUE')
    edge = edges[0]
    values = env(edge)
    emit('EDGE', name(edge))
    for key in ('SUPABASE_URL', 'BOS_PUBLIC_URL', 'BOS_REST_ORIGIN', 'BOS_STORAGE_ORIGIN', 'BOS_AUTH_ORIGIN'):
        emit(key, origin(values.get(key)))
    emit('GAS_CONFIGURED', bool(values.get('BOS_DRIVE_GAS_URL')))
    emit('WORKER_KEY_CONFIGURED', len(values.get('BOS_DRIVE_WORKER_KEY', '')) >= 32)
    roots = {target: mount(edge, target) for target in ('/bos-src', '/bos-bundles', '/bos-main')}
    emit('EDGE_ROOT', str(roots['/bos-src'].parent))
    for slug in ('order-lifecycle-api', 'drive-archive-api', 'report-api', 'report-file-upload', 'hands-report-api', 'push-api'):
        candidates = [slug + '/index.ts', slug + '/supabase/functions/' + slug + '/index.ts']
        matches = [(path, read_file(roots['/bos-src'], path)) for path in candidates]
        matches = [(path, data) for path, data in matches if data is not None]
        if len(matches) > 1:
            raise Stop('SOURCE_ENTRYPOINT_NOT_UNIQUE')
        data = matches[0][1] if matches else None
        emit('SOURCE_' + slug, hashlib.sha256(data).hexdigest() if data is not None else 'MISSING')
    mains = sorted(p for p in roots['/bos-main'].glob('*.ts') if p.is_file())
    emit('GATEWAY_FILES', [p.name for p in mains])
    web_candidates = []
    for container in containers:
        for entry in container.get('Mounts', []):
            if entry.get('Destination') == '/srv' and entry.get('Type') == 'bind':
                root = Path(entry['Source'])
                if root.parent == roots['/bos-src'].parent.parent:
                    web_candidates.append((container, mount(container, '/srv')))
    if len(web_candidates) != 1:
        raise Stop('WEB_NOT_UNIQUE')
    web, root = web_candidates[0]
    emit('WEB', {'container': name(web), 'root': str(root)})
    manifest = read_file(root, 'build-version.js') or b''
    match = re.search(rb'"id"\s*:\s*"([0-9a-f]{20})"', manifest)
    emit('BUILD', match.group(1).decode() if match else 'UNKNOWN')
    emit('FREE_GIB', round(shutil.disk_usage(root).free / (1024 ** 3), 2))
    route = urlsplit(values.get('BOS_REST_ORIGIN', ''))
    if route.scheme not in ('http', 'https') or not route.hostname or route.username or route.password or route.query or route.fragment or route.path not in ('', '/'):
        raise Stop('REST_ROUTE_UNSUPPORTED')
    rest = resolve(edge, route.hostname, containers)
    rest_values = env(rest)
    if (route.port or (443 if route.scheme == 'https' else 80)) != int(rest_values.get('PGRST_SERVER_PORT', '3000')):
        raise Stop('REST_PORT_MISMATCH')
    uri = urlsplit(rest_values.get('PGRST_DB_URI', ''))
    if uri.scheme not in ('postgres', 'postgresql') or not uri.hostname or uri.query or uri.fragment or uri.port not in (None, 5432):
        raise Stop('DATABASE_URI_UNSUPPORTED')
    database = unquote(uri.path.lstrip('/'))
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,63}', database):
        raise Stop('DATABASE_NAME_UNSUPPORTED')
    db = resolve(rest, uri.hostname, containers)
    db_mount = mount(db, '/var/lib/postgresql/data')
    emit('DATABASE', {'rest': name(rest), 'container': name(db), 'database': database, 'data_root': str(db_mount)})
    emit('CHECK_COMPLETE', True)


if __name__ == '__main__':
    try:
        main()
    except Stop as error:
        emit('CHECK_STOPPED', str(error))
        raise SystemExit(1)
    except Exception:
        emit('CHECK_STOPPED', 'COMMAND_OR_LAYOUT_UNAVAILABLE')
        raise SystemExit(1)
