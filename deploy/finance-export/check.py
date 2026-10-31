#!/usr/bin/env python3
"""Read-only host compatibility check for the finance XLSX release.

Run on the existing RU Docker host. Never edits production files, starts/stops
containers, reads business rows, or prints environment values/source text.
The only database statement reads information_schema in a read-only transaction.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit

BASELINE = {'revision': '54f9b0b32e675b3305cde9aa36221dd6841f88b7^', 'web': {'finance-page.js': '626ecd6b284bebd2fee10e20bba75cf922deb34b715e65e505ea014078e0a96e', 'finance-data.js': '311d1c3ce790b7db927ca5adbfaa09ecaeff763104e46e8cdfb7de951aa38595', 'finance-expenses.js': 'ee2baac406d9a015e9bf3a8776067742db2ba4ec235b1e1a2d207c0a5177e585', 'order-payroll.js': '9c8a04f7ad9a9681fa7cdb7c0743ade27c2e12595945477e13235b3e491bf363', 'salary-periods.js': 'b81b679ea8176299b8d26823fc1353eda2ca311a08b714aea21cfd87616a077e', 'order-work-items.js': 'c6dc6bd5da0835aa9aaa56e60a592419ad26b48cf1b82b155e751fa8c46ecec7', 'service-catalog.js': 'da27504e0d095a55685d693e11133b1dac3c91fe60e1c5bc100d36b061fd9126', 'report-deduction.js': '22efa34e2dcdb5b642fb862ffd49a8895a04e8b3165c77704d6eb08fa898d6bf', 'pwa-register.js': 'dce6f99491ef5e67934829f3d6005f0a2abb42eb50a0ab06b7b67012a5004014', 'network-direct-v86.js': 'e6a937d250e3d4a85b5210bdc8f06bfea6a109aff560139dcd98e22b8357cf19', 'approved-operations-ui.css': 'd192ac0ccfe62f8af7bda3f89982aa7f57d294fe6640457eb7b869d288d51b1e'}, 'api': '5e7b8d38da647ff0618490a34fc121e9c8fc2863754282f290517921c513e7a3'}
EXPECTED_COLUMNS = {'orders': ['id', 'order_number', 'external_id', 'external_source', 'source', 'created_at', 'received_date', 'master_agreed_at', 'scheduled_date', 'completed_at', 'report_reviewed_at', 'status', 'client', 'phone', 'address', 'city', 'master_staff_id', 'master_id', 'master_name', 'amount', 'original_amount', 'extra_work_amount', 'extra_work_description', 'uncompleted_work_amount', 'uncompleted_work_description', 'uncompleted_work_items', 'master_payout', 'comment', 'report_upload_token', 'report_review_status', 'report_uploaded_at', 'manual_completion_history', 'work', 'work_items'], 'business_staff': ['id', 'external_id', 'full_name', 'role', 'is_active', 'city'], 'finance_expenses': ['id', 'expense_date', 'category', 'comment', 'amount', 'order_id', 'employee_id', 'city', 'created_by_name', 'created_at', 'updated_at'], 'order_claims': ['id', 'order_id', 'master_staff_id', 'opened_at']}
ORIGINS = ('https://obsropbslfwtanyspjbi.supabase.co',
           'https://139.100.237.167', 'https://homemaster.qd.je')


class Stop(Exception):
    pass


def emit(key, value):
    print(key + '=' + json.dumps(value, ensure_ascii=True, separators=(',', ':')), flush=True)


def command(args):
    return subprocess.run(args, check=True, capture_output=True, timeout=30).stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalized(data):
    for origin in ORIGINS:
        data = data.replace(origin.encode(), b'@BOS_ORIGIN@')
    return data.rstrip()


def source_hash(data):
    return digest(normalized(data))


def read(root, relative, optional=False):
    path = root / relative
    if optional and not path.exists():
        return None
    if (not path.is_file() or path.is_symlink() or path.resolve() != path
            or not path.is_relative_to(root) or path.stat().st_size > 4_000_000):
        raise Stop('SOURCE_PATH_UNSAFE_OR_MISSING')
    return path.read_bytes()


def name(container):
    return container['Name'].lstrip('/')


def variables(container):
    return dict(item.split('=', 1) for item in container.get('Config', {}).get('Env', []) if '=' in item)


def mount(container, target):
    entries = [m for m in container['Mounts'] if m['Destination'] == target and m['Type'] == 'bind']
    if len(entries) != 1:
        raise Stop('MOUNT_NOT_UNIQUE')
    path = Path(entries[0]['Source'])
    if path.resolve() != path or not path.is_dir():
        raise Stop('UNSAFE_MOUNT')
    if any(m['Destination'].startswith(target + '/') for m in container['Mounts']):
        raise Stop('NESTED_MOUNT')
    return path


def resolve(source, hostname, containers):
    matches = []
    for candidate in containers:
        networks = set(source['NetworkSettings']['Networks']) & set(candidate['NetworkSettings']['Networks'])
        for network in networks:
            info = candidate['NetworkSettings']['Networks'][network]
            aliases = [name(candidate), info.get('IPAddress'), *(info.get('Aliases') or []), *(info.get('DNSNames') or [])]
            if hostname and hostname in aliases:
                matches.append(candidate)
                break
    if len(matches) != 1:
        raise Stop('DATABASE_ROUTE_NOT_UNIQUE')
    return matches[0]


def schema(edge, containers):
    route = urlsplit(variables(edge).get('BOS_REST_ORIGIN', ''))
    if (route.scheme not in ('http', 'https') or not route.hostname or route.username
            or route.password or route.query or route.fragment or route.path not in ('', '/')):
        raise Stop('REST_ROUTE_UNSUPPORTED')
    rest = resolve(edge, route.hostname, containers)
    env = variables(rest)
    if (route.port or (443 if route.scheme == 'https' else 80)) != int(env.get('PGRST_SERVER_PORT', '3000')):
        raise Stop('REST_PORT_MISMATCH')
    uri = urlsplit(env.get('PGRST_DB_URI', ''))
    if (uri.scheme not in ('postgres', 'postgresql') or not uri.hostname or uri.query
            or uri.fragment or uri.port not in (None, 5432)):
        raise Stop('DATABASE_URI_UNSUPPORTED')
    database = unquote(uri.path.lstrip('/'))
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,63}', database):
        raise Stop('DATABASE_NAME_UNSUPPORTED')
    db = resolve(rest, uri.hostname, containers)
    # Constant metadata-only SQL. Do not interpolate identifiers or URI contents.
    sql = """BEGIN READ ONLY; SET LOCAL statement_timeout='3s';
SELECT coalesce(json_agg(json_build_array(table_name,column_name)), '[]'::json)
FROM information_schema.columns WHERE table_schema='public'
AND table_name IN ('orders','business_staff','finance_expenses','order_claims');
ROLLBACK;"""
    raw = command(['docker', 'exec', db['Id'], 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                   '-U', 'postgres', '-d', database, '-c', sql])
    actual = {(table, column) for table, column in json.loads(raw)}
    return sorted(table + '.' + column for table, columns in EXPECTED_COLUMNS.items()
                  for column in columns if (table, column) not in actual)


def module(bundle, filename):
    marker = b'// Source: ' + filename.encode() + b'\n'
    if bundle.count(marker) != 1:
        raise Stop('BUNDLE_MODULE_NOT_UNIQUE')
    start = bundle.index(marker) + len(marker)
    end = bundle.find(b'\n;\n// Source:', start)
    if end < 0:
        raise Stop('BUNDLE_MODULE_BOUNDARY_UNKNOWN')
    return bundle[start:end].rstrip()


def runtime_source(root, filename, bundles):
    marker = b'// Source: ' + filename.encode() + b'\n'
    matches = [module(data, filename) for data in bundles if marker in data]
    if len(matches) > 1:
        raise Stop('RUNTIME_MODULE_AMBIGUOUS')
    # The active bundle is authoritative when stale standalone sources remain.
    return matches[0] if matches else read(root, filename, optional=True)


def inspect_host(containers):
    edges = [c for c in containers if name(c) == 'bos-release-to2wblxf-edge']
    webs = [c for c in containers if name(c) == 'bos-release-to2wblxf-https']
    if len(edges) != 1 or len(webs) != 1:
        raise Stop('PRODUCTION_CONTAINER_NOT_UNIQUE')
    edge, web = edges[0], webs[0]
    root = mount(web, '/srv')
    roots = {part: mount(edge, '/bos-' + target) for part, target in
             [('sources', 'src'), ('bundles', 'bundles'), ('main', 'main')]}
    if any(path != root.parent / 'edge' / part for part, path in roots.items()):
        raise Stop('WEB_EDGE_RELEASE_MISMATCH')
    raw = read(root, 'build-version.js')
    match = re.fullmatch(rb'// Generated by npm run build\. Do not edit\.\nself\.BOS_BUILD=(\{.*\});\n', raw, re.S)
    if not match:
        raise Stop('MANIFEST_FORMAT_UNKNOWN')
    meta = json.loads(match[1])
    emit('BUILD', meta['id'])
    emit('NETWORK', {'web': web['HostConfig']['NetworkMode'], 'edge': edge['HostConfig']['NetworkMode']})
    emit('EDGE_IMAGE', edge['Image'])
    bad = []
    for filename, expected in meta['assets'].items():
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', filename):
            raise Stop('MANIFEST_PATH_UNSAFE')
        data = read(root, filename, optional=True)
        if data is None or digest(data) != expected:
            bad.append(filename)
    if digest(read(root, 'index.html')) != meta['shell']:
        bad.append('index.html')
    emit('MANIFEST_MISMATCH', bad)
    bundled_names = sorted(set(['startup-shell.bundle.js'] + [n for n in meta['assets'] if n.endswith('.bundle.js')]))
    bundles = [read(root, filename) for filename in bundled_names]
    mismatches = {}
    for filename, expected in BASELINE['web'].items():
        data = runtime_source(root, filename, bundles)
        if data is None or source_hash(data) != expected:
            mismatches[filename] = source_hash(data) if data is not None else 'MISSING'
    emit('FINANCE_WEB_DIFFERENCES', mismatches)
    choices = ['mini-app-api/index.ts', 'mini-app-api/supabase/functions/mini-app-api/index.ts']
    entries = [(p, read(roots['sources'], p, optional=True)) for p in choices]
    entries = [(p, data) for p, data in entries if data is not None]
    if len(entries) != 1:
        raise Stop('MINI_API_SOURCE_NOT_UNIQUE')
    entry, source = entries[0]
    emit('API_ENTRY', entry)
    emit('API_BASELINE_MATCH', source_hash(source) == BASELINE['api'])
    emit('API_SOURCE_SHA256', digest(source))
    emit('API_BUNDLE_SHA256', digest(read(roots['bundles'], 'mini-app-api.eszip')))
    anchors = [b'import "../../../finance-expenses.js";', b"Deno.serve(async r=>{",
               b"const a=String(b.action||'health');", b"const role=String(me.role||'');"]
    emit('API_PATCH_ANCHORS', [source.count(anchor) for anchor in anchors])
    missing = schema(edge, containers)
    emit('MISSING_COLUMNS', missing)
    emit('CHECK_COMPLETE', True)
    emit('PRODUCTION_CHANGED', False)


def main():
    emit('FINANCE_CHECK_ONLY', True)
    ids = command(['docker', 'ps', '-q']).decode().split()
    if not ids:
        raise Stop('NO_CONTAINERS')
    inspect_host(json.loads(command(['docker', 'inspect', *ids])))


if __name__ == '__main__':
    try:
        main()
    except Stop as error:
        emit('CHECK_STOPPED', str(error))
        raise SystemExit(1)
    except Exception:
        emit('CHECK_STOPPED', 'COMMAND_OR_LAYOUT_UNAVAILABLE')
        raise SystemExit(1)
