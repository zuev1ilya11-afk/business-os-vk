"""Additive order intake schema with full backup and data-preserving rollback."""
import json, os, shutil, subprocess
from pathlib import Path
import frontend as f
import preflight as p
STAGE = f.PARENT / "intake-296-db"


def resource(name):
    import zipfile
    root = Path(__file__).parent
    if root.is_dir():
        return (root/name).read_text()
    with zipfile.ZipFile(root) as archive:
        return archive.read(name).decode()


SCHEMA_SQL = resource('schema.sql').strip().removesuffix(';')
EMPTY = {k: [] for k in ['columns','functions','constraints','indexes','triggers']}


def expected():
    return json.loads(resource('schema-expected.json'))


def inspect_schema(rec):
    meta = query(rec, "SELECT json_build_object('size',pg_database_size(current_database()),'version',current_setting('server_version_num')::int)")
    f.require(170000 <= meta['version'] < 180000, 'Expected PostgreSQL 17')
    schema = query(rec, SCHEMA_SQL)
    f.require(schema == EMPTY or schema == expected(), 'Partial or unknown order intake schema; no automatic overwrite')
    return {**meta, 'schema': 'baseline' if schema == EMPTY else 'target'}


def preflight(rec):
    columns = query(rec, "SELECT json_object_agg(column_name,data_type) FROM information_schema.columns WHERE table_schema='public' AND table_name='orders'")
    required = {'id','source','external_id','work','amount','original_amount'}
    f.require(required <= set(columns), 'Required orders columns missing')
    f.require(all(columns[n]=='text' for n in ['source','external_id','work']), 'Unexpected orders text column types')
    f.require(all(columns[n] in ['numeric','bigint','integer','double precision','real'] for n in ['amount','original_amount']), 'Unexpected orders monetary column types')
    state = inspect_schema(rec)
    f.emit('DATABASE_CHECK_OK schema='+state['schema'])
    return state

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
    rec = {**info, 'main_sha': f.MAIN, 'state': 'preparing', 'schema_before': state['schema']}
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
    # Read/decompress every archived data block without connecting to a DB or
    # restoring anything. --list alone only verifies the table of contents.
    with open(dump, 'rb', buffering=0) as stream:
        command(rec, ['pg_restore', '--file=/dev/null'], stdin=stream, label='backup-data-verify')
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


def schema_guard(value, message):
    literal = json.dumps(value, ensure_ascii=False).replace("'", "''")
    return "DO $guard$ BEGIN IF ("+SCHEMA_SQL+")::jsonb IS DISTINCT FROM '"+literal+"'::jsonb THEN RAISE EXCEPTION '"+message+"'; END IF; END $guard$;"


def migration_transaction(migration):
    import re
    # This source migration already owns a transaction. Replace its exact outer
    # envelope; never nest COMMIT inside the guarded deployment transaction.
    match = re.fullmatch(r'-- Additive: old orders and integration identifiers are left untouched\.\nbegin;\n(.*)\ncommit;\n', migration, re.S)
    f.require(match is not None, 'Unexpected migration transaction envelope')
    return ("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; "
            "SELECT pg_advisory_xact_lock(hashtext('business-os-intake-296')); "
            "LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE;\n"+
            schema_guard(EMPTY,'INTAKE_BASELINE_CHANGED')+'\n'+match[1]+'\n'+
            schema_guard(expected(),'INTAKE_TARGET_MISMATCH')+
            "\nNOTIFY pgrst, 'reload schema'; COMMIT;")


def write_sql(rec, statement, label):
    return command(rec, ['psql','-X','-qAt','-U','postgres','-d',rec['dbname'],'-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse'],
                   input_data=statement.encode(), timeout=180, label=label)


def apply(rec, migration):
    backup_check(rec)
    state = preflight(rec)
    if state['schema']=='baseline':
        rec['state']='applying'; save(rec)
        f.emit('Applying additive order intake migration...')
        write_sql(rec, migration_transaction(migration), 'migration')
    verify(rec)
    rec['state']='applied'; save(rec)
    f.emit('INTAKE_SCHEMA_READY')


def verify(rec):
    f.require(inspect_schema(rec)['schema']=='target', 'Order intake schema was not installed completely')


def retain(rec):
    state=inspect_schema(rec)
    rec['state']='retained' if state['schema']=='target' else 'not_applied'
    save(rec)
    f.emit('DATABASE_RETAINED; all orders and additive fields preserved')
