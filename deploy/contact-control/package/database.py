"""Pinned additive migration; verified full backup; rollback retains user data."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import frontend as f
import preflight as p

STAGE = f.PARENT / 'contact-295-db'
SIGNATURES = {
    'bos_push_private.kick': '()',
    'public.bos_push_delivery': '(uuid,uuid)',
    'bos_control_private.current_task': '(bos_control_private.tasks)',
    'bos_control_private.task_view': '(bos_control_private.tasks)',
    'public.bos_control_action': '(uuid,text,jsonb)',
    'bos_control_private.tick': '()',
}


def discover(edge_id):
    ids = f.command(['docker', 'ps', '-q']).decode().split()
    containers = json.loads(f.command(['docker', 'inspect', *ids]))
    edges = [c for c in containers if c['Id'] == edge_id]
    f.require(len(edges) == 1, 'Active edge disappeared during database discovery')
    prefix = p.cname(edges[0])[:-5]
    rests = [c for c in containers if p.cname(c) == prefix + '-rest']
    f.require(len(rests) == 1, 'Active release REST container missing')
    db, name = p.find_db(rests[0], containers)
    return {'container': db['Id'], 'fingerprint': f.fingerprint(db), 'dbname': name,
            'rest': rests[0]['Id'], 'rest_fingerprint': f.fingerprint(rests[0])}


def check_containers(rec):
    for key, fingerprint in [('container', 'fingerprint'), ('rest', 'rest_fingerprint')]:
        current = f.inspect(rec[key])
        f.require(current['State']['Running'] and f.fingerprint(current) == rec[fingerprint],
                  'Database/REST container changed since preparation')


def query(rec, statement):
    check_containers(rec)
    return p.sql({'Id': rec['container']}, rec['dbname'], statement)


def inspect_schema(rec):
    functions = []
    for name, args in SIGNATURES.items():
        functions.append("'" + name + "',(SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('" + name + args + "'))")
    result = query(rec, "SELECT json_build_object('functions',json_build_object(" + ','.join(functions) + "),"
                   "'config',to_regclass('bos_control_private.contact_config') IS NOT NULL,"
                   "'size',pg_database_size(current_database()),'version',current_setting('server_version_num')::int)")
    f.require(170000 <= result['version'] < 180000, 'This release requires the observed PostgreSQL 17')
    known = 'target' if result['config'] else 'baseline'
    for name, digest in result['functions'].items():
        f.require(digest == p.EXPECTED['functions'][name][known], 'Database function changed: ' + name)
    if result['config']:
        flags = query(rec, "SELECT coalesce(json_agg(json_build_object('enabled',enabled,'reminders_enabled',reminders_enabled)),'[]'::json) FROM bos_control_private.contact_config WHERE singleton")
        f.require(len(flags) == 1, 'Contact configuration singleton missing')
        result['flags'] = flags[0]
        f.require(query(rec, "SELECT to_json(md5(prosrc)) FROM pg_proc WHERE oid=to_regprocedure('public.bos_contact_action(uuid,text,jsonb)')")=="688bea794e7644ea5fe46af5c33cb51a", 'Contact RPC differs from reviewed migration')
    return result


def preflight(rec):
    # Reject partial/foreign migrations before backups, compilations or DDL.
    for name, required in p.TABLES.items():
        schema, table = name.split('.')
        cols = query(rec, "SELECT coalesce(json_agg(column_name),'[]'::json) FROM information_schema.columns WHERE table_schema='" + schema + "' AND table_name='" + table + "'")
        f.require(set(required.split()) <= set(cols), 'Required database columns missing: ' + name)
    roles = query(rec, "SELECT coalesce(json_agg(rolname),'[]'::json) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')")
    f.require(set(roles) == {'anon', 'authenticated', 'service_role'}, 'Required database roles missing')
    state = inspect_schema(rec)
    if state['config']:
        f.require(not any(state['flags'].values()), 'Contact pilot already enabled; first-install package will not overwrite its settings')
    f.emit('DATABASE_CHECK_OK; schema=' + ('contact-installed-off' if state['config'] else 'baseline'))
    return state


def sync_dir():
    fd = os.open(STAGE, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save(rec):
    path = STAGE / 'journal.tmp'
    with open(path, 'w') as stream:
        os.chmod(path, 0o600)
        json.dump(rec, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(path, STAGE / 'journal.json')
    sync_dir()


def command(rec, program, *, input_data=None, stdin=None, stdout=subprocess.PIPE, timeout=300, label='database'):
    check_containers(rec)
    log = STAGE / (label + '.log')
    with open(log, 'wb') as errors:
        os.chmod(log, 0o600)
        try:
            result = subprocess.run(['docker', 'exec', '-i', '-u', 'postgres', rec['container'], *program],
                                    input=input_data, stdin=stdin, stdout=stdout, stderr=errors, timeout=timeout)
        except (OSError, subprocess.SubprocessError):
            raise f.Stop('Database operation unavailable/timed out; private log: ' + str(log)) from None
    f.require(result.returncode == 0, 'Database operation failed; private log: ' + str(log))
    return result.stdout


def prepare(info):
    state = preflight(info)
    f.require(not STAGE.exists(), 'Database stage already exists')
    f.require(shutil.disk_usage(f.PARENT).free >= state['size'] * 2 + 512 * 1024 * 1024,
              'Not enough free space for database backup')
    STAGE.mkdir(mode=0o700)
    rec = {**info, 'main_sha': f.MAIN, 'state': 'preparing', 'schema_before': 'target' if state['config'] else 'baseline'}
    save(rec)
    f.emit('Saving a private full PostgreSQL backup...')
    dump = STAGE / 'database.dump'
    fd = os.open(dump, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        command(rec, ['pg_dump', '-U', 'postgres', '-d', rec['dbname'], '--format=custom'], stdout=stream, label='backup')
        stream.flush()
        os.fsync(stream.fileno())
    # subprocess passes the file descriptor, not Python's buffered position.
    # Keep header inspection and the child's stdin at the same byte offset.
    with open(dump, 'rb', buffering=0) as stream:
        f.require(stream.read(5) == b'PGDMP', 'PostgreSQL backup is incomplete')
        stream.seek(0)
        listing = command(rec, ['pg_restore', '--list'], stdin=stream, label='backup-verify')
    f.require(b'public orders' in listing and b'bos_control_private' in listing, 'Backup lacks required application objects')
    rec['backup_sha256'] = file_sha(dump)
    rec['state'] = 'prepared'
    save(rec)
    f.emit('DATABASE_BACKUP_VERIFIED=' + str(dump))
    return rec


def file_sha(path):
    import hashlib
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def backup_check(rec):
    dump = STAGE / 'database.dump'
    f.require(dump.is_file() and not dump.is_symlink() and file_sha(dump) == rec.get('backup_sha256'),
              'Database backup changed or is incomplete')


def baseline_guard():
    checks = []
    for name, args in SIGNATURES.items():
        checks.append("IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('" + name + args + "')) IS DISTINCT FROM '" + p.EXPECTED['functions'][name]['baseline'] + "' THEN RAISE EXCEPTION 'CONTACT_BASELINE_CHANGED'; END IF;")
    return "DO $$ BEGIN IF to_regclass('bos_control_private.contact_config') IS NOT NULL THEN RAISE EXCEPTION 'CONTACT_ALREADY_INSTALLED'; END IF; " + ' '.join(checks) + ' END $$;'


def migration_transaction(migration):
    return ("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; "
            "SELECT pg_advisory_xact_lock(hashtext('business-os-contact-295'));\n" + baseline_guard() + '\n' + migration +
            "\nDO $$ BEGIN IF (SELECT count(*) FROM bos_control_private.contact_config WHERE singleton AND NOT enabled AND NOT reminders_enabled AND cardinality(pilot_staff_ids)=0)<>1 THEN RAISE EXCEPTION 'CONTACT_FLAGS_NOT_OFF'; END IF; END $$;\n"
            "NOTIFY pgrst, 'reload schema'; COMMIT;")


def write_sql(rec, statement, label):
    return command(rec, ['psql', '-X', '-qAt', '-U', 'postgres', '-d', rec['dbname'], '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse'],
                   input_data=statement.encode(), timeout=180, label=label)


def apply(rec, migration):
    backup_check(rec)
    state = preflight(rec)
    if not state['config']:
        rec['state'] = 'applying'
        save(rec)
        f.emit('Applying additive contact migration with both flags OFF...')
        write_sql(rec, migration_transaction(migration), 'migration')
    verify_off(rec)
    rec['state'] = 'applied'
    save(rec)
    f.emit('CONTACT_SCHEMA_READY; enabled=false reminders_enabled=false')


def verify_off(rec):
    state = inspect_schema(rec)
    f.require(state['config'] and not any(state['flags'].values()), 'Installed contact configuration is not OFF')


def retain_off(rec):
    state = inspect_schema(rec)
    if state['config'] and any(state['flags'].values()):
        write_sql(rec, "BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'; UPDATE bos_control_private.contact_config SET enabled=false,reminders_enabled=false WHERE singleton; COMMIT;", 'disable')
    if state['config']:
        verify_off(rec)
    rec['state'] = 'retained_off' if state['config'] else 'not_applied'
    save(rec)
    f.emit('DATABASE_RETAINED; no tables, contact history or customer data removed')
