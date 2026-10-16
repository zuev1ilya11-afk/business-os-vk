#!/usr/bin/env python3
"""Read-only preparation for PR295 on the existing RU Docker host.

No install/apply mode, downloads, DB writes, restarts, RPC calls or customer rows.
Prints version/schema metadata only; credentials are read in memory, never output.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

BASE = Path('/opt/business-os/deploy')
SOURCE_BASE = 'd35007996bb2125d404be1e6ea5e01e204d7e1d6'
SOURCE_TARGET = '3fdae9e6d2240c2d245ad3407438f13dacd7afc3'
EXPECTED = {'modules': {'master-call-workflow-v26.js': {'baseline': '2781fb219be960a03ea9f066a653f94947ad17e653afcf900be88bf81016c095',
                                             'target': 'e780e2867b36f4d11102bc75320eff76ac4dbf7d76aa686f7a8f518834730d6b'},
             'master-order-actions-v179.js': {'baseline': 'ba97c8d1bf47234d0822a785f2b33d8c15a2b7920bf94ff970eefe2aecb8c056',
                                              'target': '7e8bbb4b2b8740fbaf3c1e2cd23de1c209178f818a11775616d0beaacf318640'},
             'contact-status.js': {'baseline': '29bbff2ba81fdc201e8437533f5434944ac4d3d8c80d2a9148aabe71bbc3acab',
                                   'target': 'a94ee748fa833ca701890cc3479b659e3c9e9d6b386603ae7ed607436a42ab16'},
             'order-control.js': {'baseline': 'e0c8d4d9fd826afb643d17a338d04fbd93100e57352d182200e8ec321ae57b06',
                                  'target': '0a8e11b4238a007c3118bf010f20492b2bd217da9b5c6d4ee6cb18e71b193fc5'},
             'order-control-tasks.js': {'baseline': '2c69428665f13df0582a9c1a3ab62cc25950be4f26380f491b032d378bee0f71',
                                        'target': '8c08f21d485ae65e2df90f64168633b7be480d2e6f20f3d709cd26151b4b703e'}},
 'api_body': {'baseline': 'e200899a28b335205b137e704010c6284f53668b1acac0eb7ba7f259f5a3a9f7',
              'target': '502d2c4059faf1cf9e165ce636998aaa51b318dd0ebef26f4ef7264ee773aeb9'},
 'functions': {'bos_push_private.kick': {'baseline': '116b5cf89c270f44ccc2e979b1cb1f9c',
                                         'target': '116b5cf89c270f44ccc2e979b1cb1f9c'},
               'public.bos_push_delivery': {'baseline': 'a0a042181e8ec59a995a2dac753e4e3e',
                                            'target': 'ed7c129abf02e9fc9cae08d408b51e3e'},
               'bos_control_private.current_task': {'baseline': '33b53336d0c58cde2cba145901621034',
                                                    'target': 'd20daca69355127ec1461eee30b02901'},
               'bos_control_private.task_view': {'baseline': '2ecd597b81c5c8f4867767052a962dec',
                                                 'target': 'eb23460cb061dba72ff32c892e828a68'},
               'public.bos_control_action': {'baseline': 'e60d1cc84b87f20230005018bda921e3',
                                             'target': '813979e0ecd4b01490622ba61b2c954c'},
               'bos_control_private.tick': {'baseline': '7dd2e5e6d13ff93e8e48e59226d9bbfa',
                                            'target': '3088d7e7356200b5c62e59ef2e86066a'}}}
TABLES = {
    'public.orders': 'id status master_staff_id master_contact_status master_contact_history master_contact_updated_at master_contact_callback_at scheduled_date time_slot report_uploaded_at master_started_at master_departed_at',
    'public.business_staff': 'id role is_active',
    'public.staff_schedule': 'staff_id work_date is_working work_start work_end',
    'public.bos_push_subscriptions': 'id',
    'public.bos_push_deliveries': 'event_id state',
    'bos_control_private.tasks': 'id order_id issue_code version due_at resolved_at reminder_event',
    'bos_control_private.runtime': 'enabled',
    'bos_push_private.runtime': 'enabled worker_url',
}


class Stop(Exception):
    """Fixed diagnostic messages only; no subprocess stderr or configuration."""


def emit(key, value):
    print(key + '=' + json.dumps(value, ensure_ascii=True, separators=(',', ':')), flush=True)


def run(args, timeout=20):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise Stop('COMMAND_UNAVAILABLE_OR_TIMEOUT') from None
    if result.returncode:
        raise Stop('COMMAND_FAILED_EXIT_' + str(result.returncode))
    return result.stdout


def sha(data):
    return hashlib.sha256(data).hexdigest()


def cname(container):
    return container['Name'].lstrip('/')


def find_db(rest, containers):
    values = dict(x.split('=', 1) for x in rest['Config'].get('Env', []) if '=' in x)
    try:
        uri = urlsplit(values.get('PGRST_DB_URI', ''))
        dbname = unquote(uri.path.lstrip('/'))
        if uri.scheme not in ('postgres', 'postgresql') or not uri.hostname or not re.fullmatch(r'[A-Za-z0-9_]+', dbname):
            raise ValueError()
        host = uri.hostname
    except ValueError:
        raise Stop('REST_DATABASE_FORMAT_UNKNOWN') from None
    found = []
    for item in containers:
        if not cname(item).endswith('-db'):
            continue
        networks = item['NetworkSettings']['Networks']
        for network in set(rest['NetworkSettings']['Networks']) & set(networks):
            info = networks[network]
            aliases = (info.get('Aliases') or []) + (info.get('DNSNames') or [])
            if host in [cname(item), info.get('IPAddress'), *aliases]:
                found.append(item)
                break
    if len(found) != 1:
        raise Stop('REST_DATABASE_TARGET_MISSING_OR_AMBIGUOUS')
    return found[0], dbname


def sql(db, dbname, query):
    if not query.lstrip().upper().startswith('SELECT '):
        raise Stop('SELECT_REQUIRED')
    statement = "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='2s'; " + query + '; COMMIT;'
    raw = run(['docker', 'exec', '-u', 'postgres', db['Id'], 'psql', '-X', '-qAt',
               '-U', 'postgres', '-d', dbname, '-v', 'ON_ERROR_STOP=1', '-c', statement])
    return json.loads(raw.strip())


def mount_root(container, destination):
    matches = [m for m in container.get('Mounts', []) if m.get('Type') == 'bind' and m.get('Destination') == destination]
    if len(matches) != 1:
        raise Stop('EXPECTED_BIND_MISSING')
    root = Path(matches[0]['Source'])
    if root.resolve() != root or not root.is_relative_to(BASE) or not root.is_dir():
        raise Stop('UNREVIEWED_RELEASE_PATH')
    if any(m.get('Destination', '').startswith(destination + '/') for m in container.get('Mounts', [])):
        raise Stop('NESTED_MOUNT_NOT_SUPPORTED')
    return root


def read(root, relative, limit=8_000_000):
    path = root / relative
    if (not re.fullmatch(r'[A-Za-z0-9_./-]+', relative) or Path(relative).is_absolute()
            or '..' in Path(relative).parts or not path.is_relative_to(root)):
        raise Stop('UNSAFE_RELEASE_PATH')
    if path.resolve() != path:
        raise Stop('SYMLINKED_RELEASE_FILE:' + relative)
    if not path.is_file():
        raise Stop('MISSING_RELEASE_FILE:' + relative)
    if path.stat().st_size > limit:
        raise Stop('OVERSIZED_RELEASE_FILE:' + relative)
    return path.read_bytes()


def file_metadata(root, relative):
    """Only called with fixed, public code paths; never follow a symlink."""
    path = root / relative
    safe = path.resolve() == path
    return {'name': relative, 'canonical': safe, 'file': safe and path.is_file(),
            'bytes': path.stat().st_size if safe and path.is_file() else None}


def module(bundle, name):
    marker = b'// Source: ' + name.encode() + b'\n'
    if bundle.count(marker) != 1:
        raise Stop('BUNDLE_MODULE_MISSING_OR_AMBIGUOUS')
    start = bundle.index(marker) + len(marker)
    end = bundle.find(b'\n;\n// Source:', start)
    if end < 0:
        raise Stop('BUNDLE_MODULE_BOUNDARY_UNKNOWN')
    return bundle[start:end].rstrip()


def frontend(edge, containers):
    src = mount_root(edge, '/bos-src')
    if src.name != 'sources' or src.parent.name != 'edge':
        raise Stop('UNREVIEWED_EDGE_LAYOUT')
    web = src.parent.parent / 'web'
    caddies = [c for c in containers if any(m.get('Type') == 'bind' and m.get('Destination') == '/srv'
               and Path(m.get('Source', '')) == web for m in c.get('Mounts', []))]
    if len(caddies) != 1 or mount_root(caddies[0], '/srv') != web:
        raise Stop('WEB_AND_EDGE_RELEASE_DISAGREE')
    raw = read(web, 'build-version.js')
    match = re.fullmatch(rb'// Generated by npm run build\. Do not edit\.\nself\.BOS_BUILD=(\{.*\});\n', raw, re.S)
    if not match:
        raise Stop('BUILD_MANIFEST_FORMAT_UNKNOWN')
    meta = json.loads(match.group(1))
    if not re.fullmatch(r'[a-f0-9]{20}', meta.get('id', '')) or not isinstance(meta.get('assets'), dict):
        raise Stop('BUILD_MANIFEST_INVALID')
    failures = []
    for name, digest in {**meta['assets'], 'index.html': meta.get('shell')}.items():
        if sha(read(web, name)) != digest:
            failures.append(name)
    emit('WEB', {'build': meta['id'], 'integrity': not failures, 'mismatched': failures})
    states = {}
    for name, expected in EXPECTED['modules'].items():
        bundle = meta.get('assetBundles', {}).get(name)
        data = module(read(web, bundle), name) if bundle else read(web, name).rstrip()
        digest = sha(data)
        state = next((state for state, known in expected.items() if digest == known), 'different')
        states[name] = state
        if state == 'different':
            emit('MODULE_DIFFERENT', {'name': name, 'sha256': digest})
    emit('MODULES', states)
    return src


def backend(edge, src):
    bundles = mount_root(edge, '/bos-bundles')
    if bundles != src.parent / 'bundles':
        raise Stop('BUNDLE_AND_SOURCE_RELEASE_DISAGREE')
    for name in ('master-workflow-api/index.ts', 'master-workflow-api.ts',
                 'supabase/functions/master-workflow-api/index.ts'):
        emit('API_SOURCE_FILE', file_metadata(src, name))
    emit('API_BUNDLE_FILE', file_metadata(bundles, 'master-workflow-api.eszip'))
    code = read(src, 'master-workflow-api/index.ts')
    lines = code.split(b'\n', 2)
    body = lines[2] if len(lines) == 3 else b''
    # Do not discard or normalize code: the two known import positions are
    # reported separately and the complete file hash is always included.
    import_match = re.fullmatch(rb'import \{ createClient \} from [\'"]([^\'"\r\n]+)[\'"];', lines[0])
    payroll_match = re.fullmatch(rb'import [\'"]([.A-Za-z0-9_/-]+order-payroll\.js)[\'"];', lines[1]) if len(lines) > 1 else None
    imports_known = bool(import_match and import_match[1] == b'npm:@supabase/supabase-js@2' and payroll_match)
    digest = sha(body)
    state = next((state for state, known in EXPECTED['api_body'].items() if digest == known), 'different')
    bundle_hash = sha(read(bundles, 'master-workflow-api.eszip', limit=32_000_000))
    emit('API', {'state': state, 'imports_known': imports_known,
                 'payroll_import': payroll_match[1].decode() if payroll_match else 'unknown',
                 'source_sha256': sha(code), 'bundle_sha256': bundle_hash})


def database(db, dbname):
    names = ','.join("'" + name + "'" for name in TABLES)
    cols = sql(db, dbname, "SELECT coalesce(json_object_agg(n,cols),'{}'::json) FROM (SELECT table_schema||'.'||table_name n, json_agg(column_name) cols FROM information_schema.columns WHERE table_schema||'.'||table_name IN (" + names + ') GROUP BY table_schema,table_name) x')
    missing = {name: sorted(set(required.split()) - set(cols.get(name, []))) for name, required in TABLES.items()}
    emit('SCHEMA_MISSING', {name: keys for name, keys in missing.items() if keys})
    emit('DB', sql(db, dbname, "SELECT json_build_object('version',current_setting('server_version'),'roles',(SELECT json_agg(rolname ORDER BY rolname) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')),'pg_cron',EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron'),'contact_config',to_regclass('bos_control_private.contact_config') IS NOT NULL)"))
    names = ','.join("'" + name + "'" for name in EXPECTED['functions'])
    funcs = sql(db, dbname, "SELECT coalesce(json_agg(json_build_object('name',n.nspname||'.'||p.proname,'args',oidvectortypes(p.proargtypes),'md5',md5(p.prosrc)) ORDER BY n.nspname,p.proname),'[]'::json) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname IN (" + names + ')')
    states = {}
    for name, expected in EXPECTED['functions'].items():
        rows = [row for row in funcs if row['name'] == name]
        row = rows[0] if len(rows) == 1 else {}
        state = next((state for state, known in expected.items() if row.get('md5') == known), 'different') if rows else 'missing'
        if len(rows) > 1:
            state = 'ambiguous'
        states[name] = state
        if state not in ('baseline', 'target'):
            emit('FUNCTION_DIFFERENT', {'name': name, 'count': len(rows), 'state': state, 'md5': row.get('md5'), 'args': row.get('args')})
    emit('FUNCTIONS', states)
    present = sql(db, dbname, "SELECT to_json(to_regclass('bos_control_private.contact_config') IS NOT NULL)")
    if present:
        emit('CONTACT', sql(db, dbname, "SELECT coalesce(json_agg(json_build_object('enabled',enabled,'reminders_enabled',reminders_enabled,'pilot_size',cardinality(pilot_staff_ids))),'[]'::json) FROM bos_control_private.contact_config"))
    if not missing['bos_push_private.runtime']:
        emit('PUSH', sql(db, dbname, "SELECT coalesce(json_agg(json_build_object('enabled',enabled,'worker_configured',worker_url IS NOT NULL)),'[]'::json) FROM bos_push_private.runtime"))
    if sql(db, dbname, "SELECT to_json(to_regclass('cron.job') IS NOT NULL)"):
        emit('CRON', sql(db, dbname, "SELECT json_build_object('active_control_ticks',count(*) FILTER(WHERE active AND command LIKE '%bos_control_private.tick%')) FROM cron.job"))


def main():
    if len(sys.argv) != 1:
        raise Stop('NO_ARGUMENTS_SUPPORTED_READ_ONLY')
    print('BOS_CONTACT_PREFLIGHT_V2 READ_ONLY', flush=True)
    ids = run(['docker', 'ps', '-q']).split()
    if not ids:
        raise Stop('NO_RUNNING_CONTAINERS')
    containers = json.loads(run(['docker', 'inspect', *ids]))
    edges = [c for c in containers if cname(c).startswith('bos-release-') and cname(c).endswith('-edge')]
    if len(edges) != 1:
        raise Stop('RELEASE_EDGE_MISSING_OR_AMBIGUOUS')
    edge = edges[0]
    prefix = cname(edge)[:-5]
    rests = [c for c in containers if cname(c) == prefix + '-rest']
    if len(rests) != 1:
        raise Stop('RELEASE_REST_MISSING_OR_AMBIGUOUS')
    db, dbname = find_db(rests[0], containers)
    emit('RELEASE', {'name': prefix, 'database_container': cname(db), 'edge_image': edge['Image']})
    # Schema collection is independent of public API file layout.
    database(db, dbname)
    src = frontend(edge, containers)
    backend(edge, src)
    print('BOS_CONTACT_PREFLIGHT_DONE NO_CHANGES_MADE', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Stop as error:
        emit('CHECK_STOPPED', str(error))
        sys.exit(1)
    except Exception as error:
        emit('CHECK_STOPPED', type(error).__name__)
        sys.exit(1)
