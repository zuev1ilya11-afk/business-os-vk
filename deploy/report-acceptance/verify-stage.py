#!/usr/bin/env python3
"""Check the prepared release and restore/migrate its backup in an isolated DB.

Production is only inspected/read. No live SQL writes, restarts, or activation.
The disposable database has no network, host ports, or production data mounts.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import time
from urllib.parse import unquote, urlsplit
import uuid

STAGE_SHA = '7e41a15b6f5209b17e3df0c73846585bf45fd4c4e69fd05ff7f8f440a3e06425'
s = None


def load_stage():
    path = Path('/tmp/bos-stage.py')
    if path.resolve() != path or hashlib.sha256(path.read_bytes()).hexdigest() != STAGE_SHA:
        raise RuntimeError('HELPER_CHANGED')
    spec = importlib.util.spec_from_file_location('bos_verified_stage', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(args, work, label, data=None, timeout=45):
    try:
        result = subprocess.run(args, input=data, capture_output=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        raise s.Stop(label + '_UNAVAILABLE') from None
    s.write(work / 'logs' / (label + '.log'), result.stdout + b'\n' + result.stderr)
    if result.returncode:
        # Only fixed SQLSTATE codes are exposed; messages can contain row data.
        codes = sorted(set(re.findall(rb'ERROR:\s+([0-9A-Z]{5}):', result.stderr)))
        if codes:
            s.emit('SQLSTATE', [x.decode() for x in codes])
        known = set(re.findall(r"raise exception '([A-Z_]+)'", CONTRACT))
        known.update(('REPORT_REQUIRED_BEFORE_COMPLETION', 'MEASUREMENT_REPORT_REQUIRED'))
        matched = sorted(code for code in known if code.encode() in result.stderr)
        if matched:
            s.emit('DB_CONTRACT_FAILURE', matched)
        raise s.Stop(label + '_FAILED')
    return result.stdout


def environment(container):
    return dict(x.split('=', 1) for x in container['Config'].get('Env', []) if '=' in x)


def resolve(source, hostname, containers):
    matches = []
    for item in containers:
        for network in set(source['NetworkSettings']['Networks']) & set(item['NetworkSettings']['Networks']):
            details = item['NetworkSettings']['Networks'][network]
            names = [item['Name'].lstrip('/'), details.get('IPAddress'),
                     *(details.get('Aliases') or []), *(details.get('DNSNames') or [])]
            if hostname in names:
                matches.append(item)
                break
    s.require(len(matches) == 1, 'DATABASE_ROUTE_NOT_UNIQUE')
    return matches[0]


def database_route(edge, containers, live):
    url = urlsplit(environment(edge).get('BOS_REST_ORIGIN', ''))
    s.require(url.scheme == 'http' and url.hostname and not url.username and not url.password,
              'REST_ROUTE_UNSUPPORTED')
    rest = resolve(edge, url.hostname, containers)
    uri = urlsplit(environment(rest).get('PGRST_DB_URI', ''))
    s.require(uri.scheme in ('postgres', 'postgresql') and uri.hostname and uri.port in (None, 5432),
              'DATABASE_ROUTE_UNSUPPORTED')
    name = unquote(uri.path.lstrip('/'))
    s.require(re.fullmatch(r'[A-Za-z0-9_-]{1,63}', name) is not None, 'DATABASE_NAME_UNSUPPORTED')
    db = resolve(rest, uri.hostname, containers)
    s.require(s.mount(db, '/var/lib/postgresql/data') == live / 'data', 'DATABASE_DATA_MOUNT_CHANGED')
    return db, name


def sql(container, database, statement, work, label, *, isolated=False):
    args = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres',
            '-d', database, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
    if isolated:
        args += ['-h', '/tmp']
    else:
        # All production SQL must run in a read-only transaction.
        statement = "BEGIN READ ONLY; SET LOCAL statement_timeout='15s';\n" + statement + '\nCOMMIT;'
    return run(args, work, label, statement.encode(), timeout=60)


def assert_isolated(container, work):
    info = s.inspect(container)
    s.require(info['State']['Running'] and info['State']['Pid'] > 0, 'PROBE_DATABASE_NOT_RUNNING')
    s.require(set(info['NetworkSettings']['Networks']) <= {'none'}, 'PROBE_DATABASE_HAS_NETWORK')
    s.require(not info['HostConfig'].get('PortBindings'), 'PROBE_DATABASE_HAS_HOST_PORTS')
    interfaces = run(['nsenter', '-t', str(info['State']['Pid']), '-n', sys.executable, '-c',
                      'import socket,json;print(json.dumps([n for _,n in socket.if_nameindex()]))'],
                     work, 'probe-interfaces')
    s.require(json.loads(interfaces) == ['lo'], 'PROBE_DATABASE_NOT_ISOLATED')


def db_arguments(image, name, backup, binaries, extensions):
    s.require(re.fullmatch(r'sha256:[0-9a-f]{64}', image) is not None, 'DATABASE_IMAGE_NOT_PINNED')
    s.require(len(binaries) == 2 and all(re.fullmatch(r'/[A-Za-z0-9_./-]+', x) for x in binaries),
              'POSTGRES_BINARIES_UNKNOWN')
    postgres, initdb = binaries
    preload = ','.join(x for x in ('pg_cron', 'pg_net', 'pg_stat_statements') if x in extensions)
    commands = (shlex.quote(initdb) + ' -D /tmp/bos-db -U postgres --auth-local=trust --auth-host=reject'
                ' >/tmp/bos-init.log 2>&1; exec ' + shlex.quote(postgres) +
                " -D /tmp/bos-db -c listen_addresses='' -c unix_socket_directories=/tmp"
                ' -c max_connections=20 -c shared_buffers=32MB -c max_worker_processes=8'
                ' -c wal_level=logical -c shared_preload_libraries=' + shlex.quote(preload) +
                ' -c cron.database_name=postgres -c cron.launch_active_jobs=off')
    return ['docker', 'run', '-d', '--pull=never', '--network=none', '--name', name,
            '--label', 'bos.report-db-probe=' + name, '--memory=1g', '--memory-swap=1g',
            '--cpus=1', '--pids-limit=128', '--user=postgres', '--entrypoint=/bin/sh',
            '--tmpfs', '/tmp:rw,nosuid,nodev,size=768m,mode=1777',
            '--mount', 'type=bind,src=' + str(backup) + ',dst=/bos-backup.dump,readonly',
            image, '-ceu', commands]


def origins_from_reports(data):
    origins = set()
    # Data remains on the user's host. Only bare origins are retained/emitted.
    for match in re.finditer(r'https?://[^\s\x00-\x20\x7f\x22\x27<>`\\]+', data):
        try:
            u = urlsplit(match.group())
            if (u.hostname and not u.username and not u.password and
                    u.path.startswith('/storage/v1/') and (u.port is None or 1 <= u.port <= 65535)):
                origins.add(u.scheme + '://' + u.netloc)
        except ValueError:
            pass
    return sorted(origins)


CONTRACT = r'''
BEGIN;
SET LOCAL statement_timeout='20s';
DO $$
declare n bigint; o bigint; j jsonb; again jsonb; accepted text;
begin
 if (select format_type(atttypid,atttypmod) from pg_attribute
     where attrelid='public.business_staff'::regclass and attname='id') <> 'uuid'
 then raise exception 'STAFF_ID_TYPE_DIFFERS'; end if;
 if has_function_privilege('anon','public.bos_drive_claim()','execute')
 or has_function_privilege('authenticated','public.bos_drive_claim()','execute')
 or not has_function_privilege('service_role','public.bos_drive_claim()','execute')
 then raise exception 'QUEUE_PERMISSIONS_FAILED'; end if;
 select id into o from public.orders order by id limit 1;
 if o is null then raise exception 'NO_ORDER_FOR_ISOLATED_PROBE'; end if;
 -- Arrange only on the disposable restored database; test with triggers enabled.
 perform set_config('session_replication_role','replica',true);
 update public.orders set status='В работе',report_review_status='pending',
 report_upload_token='bos-isolated-probe',report_uploaded_at=now(),report_type='work',
 report_act_url='https://invalid.example/act',report_photo_urls='["https://invalid.example/photo"]',
 drive_archive_status='pending',drive_archive_url=null,drive_archive_folder_id=null where id=o;
 perform set_config('session_replication_role','origin',true);
 delete from bos_drive_private.jobs;
 update public.orders set status='Выполнена',report_review_status='approved',
 report_reviewer_staff_id=(select id from public.business_staff limit 1) where id=o;
 select count(*) into n from bos_drive_private.jobs where order_id=o;
 if n <> 1 then raise exception 'APPROVAL_NOT_QUEUED'; end if;
 update public.orders set report_review_status='approved' where id=o;
 if (select count(*) from bos_drive_private.jobs) <> 1 then raise exception 'DUPLICATE_JOB'; end if;
 j := public.bos_drive_claim();
 if j is null or j->>'state' <> 'processing' then raise exception 'CLAIM_FAILED'; end if;
 if not public.bos_drive_finish(o,j->>'report_token',(j->>'report_uploaded_at')::timestamptz,
     (j->>'lease')::uuid,null,'ISOLATED_TEST') then raise exception 'FAILURE_SAVE_FAILED'; end if;
 select report_review_status into accepted from public.orders where id=o;
 if accepted <> 'approved' then raise exception 'APPROVAL_LOST'; end if;
 if public.bos_drive_claim() is not null then raise exception 'BACKOFF_FAILED'; end if;
 update bos_drive_private.jobs set next_attempt_at=now()-interval '1 second';
 again := public.bos_drive_claim();
 if again is null or again->>'lease'=j->>'lease' then raise exception 'RETRY_LEASE_FAILED'; end if;
 if public.bos_drive_finish(o,j->>'report_token',(j->>'report_uploaded_at')::timestamptz,
     (j->>'lease')::uuid,'{"drive_folder_url":"https://drive.google.com/drive/folders/isolated-test"}',null)
 then raise exception 'STALE_LEASE_ACCEPTED'; end if;
 if not public.bos_drive_finish(o,again->>'report_token',(again->>'report_uploaded_at')::timestamptz,
     (again->>'lease')::uuid,'{"drive_folder_url":"https://drive.google.com/drive/folders/isolated-test"}',null)
 then raise exception 'SUCCESS_SAVE_FAILED'; end if;
 if (select drive_archive_status from public.orders where id=o) <> 'archived'
 or (select report_review_status from public.orders where id=o) <> 'approved'
 then raise exception 'FINAL_REPORT_STATE_FAILED'; end if;
end $$;
ROLLBACK;
SELECT 'DB_CONTRACT_OK';
'''


def database_probe(db, name, backup, migration, work):
    settings = json.loads(sql(db['Id'], name, "SELECT json_build_object('roles',"
        "(select json_agg(rolname) from pg_roles where rolname !~ '^pg_' and rolname <> 'postgres'),"
        "'extensions',(select json_agg(extname) from pg_extension));", work, 'live-db-metadata'))
    binaries = run(['docker', 'exec', db['Id'], '/bin/sh', '-c', 'command -v postgres; command -v initdb'],
                   work, 'postgres-binaries').decode().splitlines()
    container = 'bos301-db-probe-' + uuid.uuid4().hex
    args = db_arguments(db['Image'], container, backup, binaries, settings['extensions'])
    created = False
    try:
        run(args, work, 'db-probe-start')
        created = True
        for attempt in range(40):
            result = subprocess.run(['docker', 'exec', container, 'pg_isready', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres'],
                                    capture_output=True, timeout=5)
            if result.returncode == 0:
                break
            s.require(s.inspect(container)['State']['Running'], 'DB_PROBE_STARTUP_FAILED')
            time.sleep(0.5)
        else:
            raise s.Stop('DB_PROBE_STARTUP_TIMEOUT')
        assert_isolated(container, work)
        role_sql = '\n'.join('CREATE ROLE "' + role.replace('"', '""') + '" NOLOGIN;'
                             for role in settings['roles'] or [])
        sql(container, 'postgres', role_sql, work, 'probe-roles', isolated=True)
        s.emit('DB_RESTORE_STARTED', True)
        # The backup is root:root 0600. Only this restore client needs root to
        # read its read-only bind; the database server itself stays postgres.
        run(['docker', 'exec', '--user=0:0', container, 'pg_restore', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres',
             '--no-owner', '--no-acl', '--exit-on-error', '/bos-backup.dump'], work, 'backup-restore', timeout=180)
        s.emit('DB_BACKUP_RESTORED', True)
        for attempt in range(2):
            sql(container, 'postgres', 'BEGIN;\n' + migration.decode() + '\nCOMMIT;', work,
                'probe-migration-' + str(attempt), isolated=True)
        s.emit('DB_MIGRATION_REPLAY_OK', True)
        result = sql(container, 'postgres', CONTRACT, work, 'probe-contract', isolated=True)
        s.require(result.strip() == b'DB_CONTRACT_OK', 'DB_CONTRACT_OUTPUT')
        s.emit('DB_APPROVAL_RETRY_OK', True)
        report_data = sql(container, 'postgres', "SELECT json_agg(json_build_array(report_act_url,"
                          "report_measurement_url,report_photo_urls)) FROM public.orders;", work,
                          'report-origin-inventory', isolated=True).decode()
        origins = origins_from_reports(report_data.replace('\\"', '"'))
        s.emit('STORED_REPORT_ORIGINS', origins)
        return {'backup_restored': True, 'migration_twice': True, 'approval_retry': True,
                'stored_report_origins': origins, 'database_image': db['Image']}
    finally:
        if created:
            # Logs remain private, even on startup failure; remove only our container.
            log = subprocess.run(['docker', 'logs', container], capture_output=True, timeout=10)
            s.write(work / 'logs/db-container.log', log.stdout + b'\n' + log.stderr)
            run(['docker', 'rm', '-fv', container], work, 'db-probe-remove')


def gateway_shape(source):
    """Mask literals/comments before printing the worker environment expression."""
    # Includes templates as opaque literals, so interpolation never leaks values.
    token = re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\[\s\S]|[^"\\])*"|'
                       r"'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`")
    allowed = {'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
               'BOS_PUBLIC_URL', 'BOS_LEGACY_STORAGE_ORIGINS', 'BOS_DRIVE_WORKER_KEY',
               'BOS_DRIVE_GAS_URL', 'BOS_SYNC_KEY', 'JWT_SECRET', 'VK_APP_SECRET',
               'BOS_AUTH_ORIGIN', 'BOS_REST_ORIGIN', 'BOS_STORAGE_ORIGIN'}
    def hide(match):
        value = match.group()
        if value.startswith(('//', '/*')):
            return '\n' * value.count('\n')
        return value if value[1:-1] in allowed else '"<redacted>"'
    masked = token.sub(hide, source)
    lines = masked.splitlines()
    selected = set()
    for i, line in enumerate(lines):
        if re.search(r'\benvVars\b|Deno\.readTextFile|SUPABASE_URL|BOS_SYNC_KEY', line):
            selected.update(range(max(0, i-4), min(len(lines), i+6)))
    return '\n'.join(lines[i] for i in sorted(selected))[:5000]


def main():
    global s
    os.umask(0o077)
    sys.dont_write_bytecode = True
    s = load_stage()
    s.require(os.geteuid() == 0, 'ROOT_REQUIRED')
    with (s.PARENT / '.report-acceptance-stage.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        journals = list(s.PARENT.glob('report-acceptance-stage-*/locked-*/journal.json'))
        s.require(bool(journals), 'PREPARED_CANDIDATE_MISSING')
        journal = max(journals, key=lambda p: p.stat().st_mtime_ns)
        rec = json.loads(s.read(journal))
        stage, live = journal.parent, Path(rec['live'])
        s.require(rec['app_revision'] == s.APP and rec['status'] == 'compiled_not_activated', 'CANDIDATE_STATUS')
        for folder in ('edge', 'web'):
            s.require(s.tree(live / folder) == rec['before'][folder], 'LIVE_RELEASE_CHANGED')
            s.require(s.tree(stage / 'candidate' / folder) == rec['candidate_' + folder], 'CANDIDATE_CHANGED')
        work = Path(tempfile.mkdtemp(prefix='verify-', dir=stage))
        s.emit('VERIFY_DIR', str(work))
        ids = s.command(['docker', 'ps', '-q']).decode().split()
        containers = json.loads(s.command(['docker', 'inspect', *ids]))
        edge = next((c for c in containers if c['Id'] == rec['edge_id']), None)
        s.require(edge is not None and edge['Image'] == rec['image'], 'EDGE_CHANGED')
        db, database = database_route(edge, containers, live)
        s.emit('DATABASE_TARGET_VERIFIED', True)
        gateway = s.read(stage / 'candidate/edge/main/index.ts').decode()
        shape = gateway_shape(gateway)
        s.emit('GATEWAY_ENV_SHAPE', shape)
        # Bare loopback origins help verify the gateway's internal URL. No
        # paths, query strings, keys, or arbitrary upstream hosts are printed.
        loopback = set()
        for value in re.findall(r'''["'](https?://[^"'\s]+)["']''', gateway):
            try:
                u = urlsplit(value)
                if u.hostname in ('127.0.0.1', 'localhost', '::1') and not u.username and not u.password:
                    if u.port is None or 1 <= u.port <= 65535:
                        loopback.add(u.scheme + '://' + u.netloc)
            except ValueError:
                pass
        s.emit('GATEWAY_LOOPBACK_ORIGINS', sorted(loopback))
        backup = Path(rec['backup']) / 'db.dump'
        s.require(backup.resolve() == backup and backup.is_file() and backup.stat().st_size < 1_000_000_000,
                  'BACKUP_PATH_UNSAFE')
        with backup.open('rb') as stream:
            digest = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
            backup_sha = digest.hexdigest()
        migration_path = 'supabase/migrations/20261030090000_report_archive_queue.sql'
        migration = s.read(stage / 'payload/after' / migration_path)
        s.require(s.sha(migration) == s.ASSETS[migration_path]['after'], 'MIGRATION_CHANGED')
        result = database_probe(db, database, backup, migration, work)
        for folder in ('edge', 'web'):
            s.require(s.tree(live / folder) == rec['before'][folder], 'CONCURRENT_LIVE_CHANGE')
        s.write(work / 'verification.json', json.dumps({'candidate': str(stage), 'journal_sha256':s.sha(s.read(journal)),
                'database': result, 'backup_sha256':backup_sha,
                'gateway_sha256': s.sha(gateway.encode()), 'status':'database_verified_not_activated'}, indent=2).encode())
        s.emit('DB_VERIFICATION_READY', True)
        s.emit('PRODUCTION_UPDATED', False)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('VERIFY_STOPPED=INTERRUPTED', flush=True)
        raise SystemExit(130)
    except Exception as error:
        label = str(error) if s is not None and isinstance(error, s.Stop) else 'COMMAND_OR_LAYOUT_UNAVAILABLE'
        print('VERIFY_STOPPED=' + label, flush=True)
        raise SystemExit(1)
