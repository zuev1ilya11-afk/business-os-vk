"""Restore a captured database only into a fresh, networkless Docker container.

The caller verifies the bundle and owns the new labeled volume.  No production
container settings, startup scripts, SQL configuration files or credentials are
reused.  Database credentials in the genuine globals dump stay inside Docker.
"""
import json
import re
import secrets
import time


LABEL = 'io.business-os.restore-drill'
PATH = '/usr/lib/postgresql/17/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
ROUTING = ('PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGSERVICE',
           'PGSERVICEFILE', 'PGOPTIONS', 'PGPASSWORD', 'PGPASSFILE', 'PGSYSCONFDIR')


class DrillDBError(Exception):
    def __init__(self, reason_code):
        self.reason_code = reason_code
        super().__init__(reason_code)


def require(condition, reason):
    if not condition:
        raise DrillDBError(reason)


def call(runner, args, reason, *, timeout=30, limit=16 * 1024 * 1024):
    try:
        return runner(args, timeout=timeout, limit=limit)
    except Exception:
        raise DrillDBError(reason) from None


def document(runner, args, reason):
    try:
        result = json.loads(call(runner, args, reason))
    except (ValueError, TypeError):
        raise DrillDBError(reason) from None
    return result


def one(runner, args, reason):
    result = document(runner, args, reason)
    require(isinstance(result, list) and len(result) == 1
            and isinstance(result[0], dict), reason)
    return result[0]


HASH_CHECK_SCRIPT = r'''command -v sha256sum >/dev/null 2>&1 || exit 45
check_hash() {
    hash_line=$(sha256sum < "$2") || exit 47
    case "$hash_line" in
        *'  -') hash_value=${hash_line%'  -'} ;;
        *) exit 46 ;;
    esac
    test "${#hash_value}" -eq 64 || exit 46
    case "$hash_value" in *[!0-9a-f]*) exit 46 ;; esac
    test "$hash_value" = "$1" || exit 43
}
'''


INIT_SCRIPT = r'''set -eu
''' + HASH_CHECK_SCRIPT + r'''
umask 077
test -z "$(ls -A /bos)"
available_kb=$(df -Pk /bos | awk 'NR==2 {print $4}')
case "$available_kb" in ''|*[!0-9]*) exit 41 ;; esac
test "$available_kb" -ge "$1" || exit 42
test -f /bundle/database.dump
test -f /bundle/globals.sql
test -f /bundle/files.tar
test ! -L /bundle/database.dump
test ! -L /bundle/globals.sql
test ! -L /bundle/files.tar
mkdir /bos/input
cp /bundle/database.dump /bos/input/database.dump
cp /bundle/globals.sql /bos/input/globals.sql
cp /bundle/files.tar /bos/input/files.tar
check_hash "$2" /bos/input/database.dump
check_hash "$3" /bos/input/globals.sql
check_hash "$4" /bos/input/files.tar
removed=$(dd if=/bos/input/globals.sql bs=1 skip="$5" count="$(($6 - $5))" 2>/dev/null)
test "$removed" = "CREATE ROLE $7;" || test "$removed" = "CREATE ROLE \"$7\";" || exit 44
head -c "$5" /bos/input/globals.sql > /bos/input/globals-restore.sql
tail -c "+$(($6 + 1))" /bos/input/globals.sql >> /bos/input/globals-restore.sql
chmod 700 /bos /bos/input
chmod 600 /bos/input/database.dump /bos/input/globals.sql /bos/input/globals-restore.sql /bos/input/files.tar
chown postgres:postgres /bos /bos/input /bos/input/database.dump /bos/input/globals.sql /bos/input/globals-restore.sql /bos/input/files.tar
'''

START_SCRIPT = r'''set -eu
umask 077
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE PGSYSCONFDIR PGDATA
test ! -e /bos/data
initdb --version | grep -Eq '^initdb \(PostgreSQL\) 17\.'
initdb -D /bos/data --username "$1" --auth-local=trust --auth-host=reject --no-locale --encoding=UTF8 --no-instructions >/dev/null
exec postgres -D /bos/data -c listen_addresses= -c port=5432 -c unix_socket_directories=/tmp -c unix_socket_permissions=0700 -c shared_preload_libraries= -c session_preload_libraries= -c local_preload_libraries= -c max_connections=20 -c shared_buffers=64MB -c max_worker_processes=0 -c max_parallel_workers=0 -c max_logical_replication_workers=0 -c max_wal_senders=0 -c autovacuum=off -c logging_collector=off -c log_min_messages=panic -c log_min_error_statement=panic -c log_statement=none -c log_connections=off -c log_disconnections=off
'''

VALIDATE_SQL = """BEGIN READ ONLY;
SELECT json_build_object(
 'version',current_setting('server_version_num')::int,
 'database',current_database(),
 'socket_only',inet_server_addr() IS NULL AND current_setting('listen_addresses')='',
 'readonly',current_setting('transaction_read_only')='on',
 'workers_disabled',current_setting('max_worker_processes')='0'
   AND current_setting('shared_preload_libraries')='',
 'extensions',(SELECT coalesce(json_agg(json_build_array(extname,extversion)), '[]'::json) FROM pg_extension),
 'guard_function',to_regprocedure('public.guard_order_completion()') IS NOT NULL,
 'guard_trigger',EXISTS(SELECT 1 FROM pg_trigger
    WHERE tgrelid=to_regclass('public.orders')
      AND tgfoid=to_regprocedure('public.guard_order_completion()')
      AND tgname='trg_guard_order_completion' AND tgenabled IN ('O','A')
      AND NOT tgisinternal),
 'orders',(SELECT count(*) FROM public.orders),
 'staff',(SELECT count(*) FROM public.business_staff),
 'storage_objects',(SELECT count(*) FROM storage.objects));
ROLLBACK;"""


def _tmpfs(image):
    volumes = image.get('Config', {}).get('Volumes') or {}
    require(isinstance(volumes, dict), 'DRILL_IMAGE_VOLUMES_INVALID')
    targets = {'/tmp'}
    for target in volumes:
        require(isinstance(target, str) and re.fullmatch(r'/[A-Za-z0-9_./-]+', target)
                and target != '/' and '..' not in target.split('/')
                and not target.endswith('/') and '//' not in target,
                'DRILL_IMAGE_VOLUMES_INVALID')
        require(not any(target == p or target.startswith(p + '/')
                        or p.startswith(target + '/') for p in ('/bos', '/bundle')),
                'DRILL_IMAGE_VOLUMES_INVALID')
        targets.add(target)
    # Parent and child tmpfs mounts are unnecessary and ambiguous.
    targets = {p for p in targets if not any(p != q and p.startswith(q + '/') for q in targets)}
    require('/tmp' in targets, 'DRILL_IMAGE_VOLUMES_INVALID')
    return sorted(targets)


def _base_args(name, run_id, volume, image, *, helper=False, bundle_mount=None):
    args = ['create', '--name', name, '--label', LABEL + '=' + run_id,
            '--network', 'none', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--restart', 'no',
            '--no-healthcheck', '--log-driver', 'none', '--pids-limit', '256',
            '--memory', '1g', '--memory-swap', '1g', '--cpus', '2',
            '--shm-size', '128m', '--user', '0:0' if helper else 'postgres',
            '--env', 'PATH=' + PATH, '--entrypoint', '/bin/sh',
            '--mount', 'type=volume,source=' + volume + ',target=/bos,volume-nocopy']
    if helper:
        args += ['--cap-add', 'CHOWN', '--cap-add', 'DAC_READ_SEARCH', '--mount',
                 'type=bind,source=' + bundle_mount + ',target=/bundle,readonly']
    for target in _tmpfs(image):
        options = 'rw,noexec,nosuid,nodev,size=64m,mode=1777' if target == '/tmp' else 'rw,noexec,nosuid,nodev,size=16m'
        args += ['--tmpfs', target + ':' + options]
    return args


def _capabilities(value):
    """Docker versions return capability names with or without the CAP_ prefix."""
    require(value is None or isinstance(value, list), 'DRILL_ISOLATION_UNCONFIRMED')
    normalized = set()
    for capability in value or []:
        require(isinstance(capability, str) and re.fullmatch(r'[A-Za-z_]+', capability),
                'DRILL_ISOLATION_UNCONFIRMED')
        capability = capability.upper()
        normalized.add(capability[4:] if capability.startswith('CAP_') else capability)
    return normalized


def _no_new_privileges(value):
    # Exact enabling forms only.  Do not accept "false" or extra options such
    # as seccomp=unconfined merely because one enabling entry is also present.
    return (isinstance(value, list) and len(value) == 1
            and value[0] in ('no-new-privileges', 'no-new-privileges:true',
                             'no-new-privileges=true'))


def _inspect(runner, cid, run_id, volume, tmpfs, *, helper=False, running=None):
    obj = one(runner, ['inspect', cid], 'DRILL_ISOLATION_UNCONFIRMED')
    hc, config = obj.get('HostConfig', {}), obj.get('Config', {})
    require(obj.get('Id') == cid and config.get('Labels', {}).get(LABEL) == run_id,
            'DRILL_RESOURCE_IDENTITY_CHANGED')
    require(hc.get('NetworkMode') == 'none' and not hc.get('Privileged')
            and hc.get('ReadonlyRootfs') is True and not hc.get('PortBindings')
            and not hc.get('PublishAllPorts')
            and hc.get('PidMode', '') in ('', 'private')
            and hc.get('IpcMode', '') in ('', 'private')
            and hc.get('UTSMode', '') in ('', 'private')
            and not hc.get('Devices') and not hc.get('DeviceRequests')
            and not hc.get('DeviceCgroupRules')
            and hc.get('Memory') == 1024 ** 3 and hc.get('MemorySwap') == 1024 ** 3
            and hc.get('NanoCpus') == 2_000_000_000 and hc.get('PidsLimit') == 256
            and hc.get('ShmSize') == 128 * 1024 * 1024
            and _capabilities(hc.get('CapDrop')) == {'ALL'}
            and _capabilities(hc.get('CapAdd')) == ({'CHOWN', 'DAC_READ_SEARCH'} if helper else set())
            and _no_new_privileges(hc.get('SecurityOpt'))
            and hc.get('RestartPolicy', {}).get('Name') in ('', 'no')
            and hc.get('LogConfig', {}).get('Type') == 'none'
            and config.get('Healthcheck', {}).get('Test') == ['NONE']
            and config.get('User') == ('0:0' if helper else 'postgres')
            and config.get('Entrypoint') == ['/bin/sh'], 'DRILL_ISOLATION_UNCONFIRMED')
    networks = obj.get('NetworkSettings', {}).get('Networks') or {}
    require(set(networks) <= {'none'} and all(not n.get('IPAddress') for n in networks.values()),
            'DRILL_ISOLATION_UNCONFIRMED')
    mounts = obj.get('Mounts')
    require(isinstance(mounts, list), 'DRILL_ISOLATION_UNCONFIRMED')
    seen = set()
    for mount in mounts:
        target = mount.get('Destination')
        require(target not in seen, 'DRILL_ISOLATION_UNCONFIRMED')
        seen.add(target)
        if target == '/bos':
            require(mount.get('Type') == 'volume' and mount.get('Name') == volume
                    and mount.get('RW') is True, 'DRILL_ISOLATION_UNCONFIRMED')
        elif helper and target == '/bundle':
            require(mount.get('Type') == 'bind' and mount.get('RW') is False,
                    'DRILL_ISOLATION_UNCONFIRMED')
        else:
            require(target in tmpfs and mount.get('Type') == 'tmpfs', 'DRILL_ISOLATION_UNCONFIRMED')
    require('/bos' in seen and (not helper or '/bundle' in seen), 'DRILL_ISOLATION_UNCONFIRMED')
    require(set(hc.get('Tmpfs') or {}) == set(tmpfs), 'DRILL_ISOLATION_UNCONFIRMED')
    if running is not None:
        require(obj.get('State', {}).get('Running') is running, 'DRILL_CONTAINER_STATE_INVALID')
    return obj


def _create(runner, args):
    raw = call(runner, args, 'DRILL_CONTAINER_CREATE_FAILED', limit=4096)
    try:
        cid = raw.decode('ascii').strip()
    except (AttributeError, UnicodeError):
        raise DrillDBError('DRILL_CONTAINER_CREATE_FAILED') from None
    require(re.fullmatch(r'[0-9a-f]{64}', cid), 'DRILL_CONTAINER_CREATE_FAILED')
    return cid


def _client(cid, bootstrap, program, database, options, *, readonly=False):
    args = ['exec', '--user', 'postgres', cid, 'env']
    for variable in ROUTING:
        args += ['-u', variable]
    settings = '-c session_preload_libraries= -c local_preload_libraries= -c statement_timeout=600000'
    if readonly:
        settings += ' -c default_transaction_read_only=on'
    args += ['PGCONNECT_TIMEOUT=5', 'PGOPTIONS=' + settings, program,
             '-h', '/tmp', '-p', '5432', '-U', bootstrap, '-w', '-d', database, *options]
    return args


def _cleanup(runner, cid, run_id):
    # Even failure cleanup must never stop a resource whose identity changed.
    obj = one(runner, ['inspect', cid], 'DRILL_CLEANUP_UNCONFIRMED')
    require(obj.get('Id') == cid and obj.get('Config', {}).get('Labels', {}).get(LABEL) == run_id,
            'DRILL_CLEANUP_UNCONFIRMED')
    if obj.get('State', {}).get('Running'):
        call(runner, ['stop', '--time', '15', cid], 'DRILL_CLEANUP_UNCONFIRMED', timeout=30, limit=4096)
        obj = one(runner, ['inspect', cid], 'DRILL_CLEANUP_UNCONFIRMED')
    require(obj.get('State', {}).get('Running') is False, 'DRILL_CLEANUP_UNCONFIRMED')
    call(runner, ['rm', '-v', cid], 'DRILL_CLEANUP_UNCONFIRMED', limit=4096)


def restore_database(runner, image_id, run_id, volume, bundle_mount, private, *, required_bytes=None,
                     expected_payloads=None, bootstrap_role=None, bootstrap_create_span=None):
    """Return safe aggregate results; preserve the fresh named volume for checks."""
    require(isinstance(image_id, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', image_id), 'DRILL_IMAGE_ID_INVALID')
    require(isinstance(run_id, str) and re.fullmatch(r'bos-drill-[0-9a-f]{12}', run_id)
            and volume == run_id + '-data', 'DRILL_RESOURCE_NAME_INVALID')
    require(isinstance(bundle_mount, str) and bundle_mount and not any(c in bundle_mount for c in ',\n\r\x00'),
            'DRILL_BUNDLE_MOUNT_INVALID')
    metadata = private.get('database', {}) if isinstance(private, dict) else {}
    db = metadata.get('database')
    require(db == 'bos_restore_check' and isinstance(metadata.get('version'), int)
            and 170000 <= metadata['version'] < 180000, 'DRILL_DATABASE_METADATA_INVALID')
    if required_bytes is None:
        size = metadata.get('bytes')
        require(type(size) is int and size > 0, 'DRILL_DATABASE_METADATA_INVALID')
        required_bytes = size * 3 + 512 * 1024 * 1024
    require(type(required_bytes) is int and 0 < required_bytes < 2 ** 60, 'DRILL_SPACE_ESTIMATE_INVALID')
    copied = ('database.dump', 'globals.sql', 'files.tar')
    require(isinstance(expected_payloads, dict), 'DRILL_PAYLOAD_METADATA_INVALID')
    hashes = []
    for name in copied:
        record = expected_payloads.get(name)
        require(isinstance(record, dict) and isinstance(record.get('sha256'), str)
                and re.fullmatch(r'[0-9a-f]{64}', record['sha256'])
                and type(record.get('bytes')) is int and record['bytes'] >= 0,
                'DRILL_PAYLOAD_METADATA_INVALID')
        hashes.append(record['sha256'])
    require(isinstance(bootstrap_role, str) and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', bootstrap_role)
            and not bootstrap_role.startswith('pg_'), 'DRILL_BOOTSTRAP_METADATA_REQUIRED')
    require(isinstance(bootstrap_create_span, (list, tuple)) and len(bootstrap_create_span) == 2
            and all(type(offset) is int for offset in bootstrap_create_span)
            and 0 <= bootstrap_create_span[0] < bootstrap_create_span[1] <= expected_payloads['globals.sql']['bytes'],
            'DRILL_BOOTSTRAP_METADATA_REQUIRED')
    expected_extensions = metadata.get('extensions')
    require(isinstance(expected_extensions, list) and all(isinstance(x, list) and len(x) == 2
            and all(isinstance(v, str) for v in x) for x in expected_extensions),
            'DRILL_DATABASE_METADATA_INVALID')
    image = one(runner, ['image', 'inspect', image_id], 'DRILL_IMAGE_INSPECT_FAILED')
    require(image.get('Os') == 'linux', 'DRILL_IMAGE_PLATFORM_INVALID')
    targets = _tmpfs(image)
    vol = one(runner, ['volume', 'inspect', volume], 'DRILL_VOLUME_UNCONFIRMED')
    require(vol.get('Name') == volume and vol.get('Driver') == 'local'
            and not vol.get('Options') and vol.get('Labels', {}).get(LABEL) == run_id,
            'DRILL_VOLUME_UNCONFIRMED')
    administrator = 'drill_admin_' + secrets.token_hex(12)
    owned, result = [], None
    try:
        helper_args = _base_args(run_id + '-init', run_id, volume, image,
                                 helper=True, bundle_mount=bundle_mount)
        helper = _create(runner, [*helper_args, image_id, '-ceu', INIT_SCRIPT,
                                  'bos-drill-init', str((required_bytes + 1023) // 1024), *hashes,
                                  str(bootstrap_create_span[0]), str(bootstrap_create_span[1]), bootstrap_role])
        owned.append(helper)
        _inspect(runner, helper, run_id, volume, targets, helper=True, running=False)
        call(runner, ['start', helper], 'DRILL_VOLUME_INIT_FAILED', limit=4096)
        wait = call(runner, ['wait', helper], 'DRILL_VOLUME_INIT_FAILED', timeout=90, limit=4096)
        require(wait.strip() != b'42', 'DRILL_INSUFFICIENT_SPACE')
        require(wait.strip() != b'43', 'DRILL_COPY_HASH_MISMATCH')
        require(wait.strip() != b'44', 'DRILL_BOOTSTRAP_METADATA_MISMATCH')
        require(wait.strip() != b'45', 'DRILL_HASH_TOOL_UNAVAILABLE')
        require(wait.strip() != b'46', 'DRILL_HASH_OUTPUT_INVALID')
        require(wait.strip() != b'47', 'DRILL_HASH_READ_FAILED')
        require(wait.strip() == b'0', 'DRILL_VOLUME_INIT_FAILED')
        _inspect(runner, helper, run_id, volume, targets, helper=True, running=False)
        _cleanup(runner, helper, run_id)
        owned.remove(helper)
        args = _base_args(run_id + '-db', run_id, volume, image)
        cid = _create(runner, [*args, image_id, '-ceu', START_SCRIPT, 'bos-drill', bootstrap_role])
        owned.append(cid)
        _inspect(runner, cid, run_id, volume, targets, running=False)
        call(runner, ['start', cid], 'DRILL_DATABASE_START_FAILED', limit=4096)
        deadline = time.monotonic() + 60
        while True:
            try:
                call(runner, _client(cid, bootstrap_role, 'psql', 'postgres',
                     ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 1;']),
                     'DRILL_DATABASE_NOT_READY', timeout=8, limit=4096)
                break
            except DrillDBError:
                _inspect(runner, cid, run_id, volume, targets, running=True)
                require(time.monotonic() < deadline, 'DRILL_DATABASE_START_TIMEOUT')
                time.sleep(0.25)
        _inspect(runner, cid, run_id, volume, targets, running=True)
        # Globals may demote the original bootstrap role or remove LOGIN.  A
        # new isolated administrator therefore performs the unchanged ALTERs
        # and original GRANTED BY statements after initdb preserves its OID10.
        create_admin = 'CREATE ROLE "' + administrator + '" WITH LOGIN SUPERUSER;'
        call(runner, _client(cid, bootstrap_role, 'psql', 'postgres',
             ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', create_admin]),
             'DRILL_TEMPORARY_ADMIN_CREATE_FAILED')
        call(runner, _client(cid, administrator, 'psql', 'postgres',
             ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '/bos/input/globals-restore.sql']),
             'DRILL_GLOBALS_RESTORE_FAILED', timeout=630)
        call(runner, _client(cid, administrator, 'pg_restore', 'postgres',
             ['--exit-on-error', '--create', '/bos/input/database.dump']),
             'DRILL_DATABASE_RESTORE_FAILED', timeout=630)
        raw = call(runner, _client(cid, administrator, 'psql', db,
                   ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', VALIDATE_SQL], readonly=True),
                   'DRILL_DATABASE_VALIDATION_FAILED', timeout=60)
        try:
            checked = json.loads(raw)
        except (TypeError, ValueError):
            raise DrillDBError('DRILL_DATABASE_VALIDATION_FAILED') from None
        require(isinstance(checked, dict) and checked.get('database') == db
                and checked.get('version') == metadata['version']
                and checked.get('socket_only') is True and checked.get('readonly') is True
                and checked.get('workers_disabled') is True, 'DRILL_DATABASE_VALIDATION_FAILED')
        try:
            require(sorted(checked.get('extensions', [])) == sorted(expected_extensions),
                    'DRILL_EXTENSION_MISMATCH')
        except TypeError:
            raise DrillDBError('DRILL_EXTENSION_MISMATCH') from None
        require(checked.get('guard_function') is True and checked.get('guard_trigger') is True,
                'DRILL_REPORT_GUARD_MISSING')
        counts = {key: checked.get(key) for key in ('orders', 'staff', 'storage_objects')}
        require(all(type(v) is int and v >= 0 for v in counts.values()), 'DRILL_DATABASE_VALIDATION_FAILED')
        _inspect(runner, cid, run_id, volume, targets, running=True)
        result = {'database': 'RESTORED', 'globals': 'RESTORED',
                  'archived_owners_and_acls': 'APPLIED_WITHOUT_RESTORE_ERRORS',
                  'extensions': 'MATCH', 'report_guard': 'PRESENT_AND_ENABLED',
                  'outbound_network': 'DISABLED', 'background_workers': 'DISABLED',
                  'bootstrap_identity': 'INFERRED_FROM_UNIQUE_DUMP_GRANTOR',
                  'temporary_admin': 'ISOLATED_RESTORE_ONLY',
                  'counts': counts, 'source_version': metadata['version']}
    finally:
        failed = False
        for cid in reversed(owned):
            try:
                _cleanup(runner, cid, run_id)
            except DrillDBError:
                failed = True
        if failed:
            raise DrillDBError('DRILL_CLEANUP_UNCONFIRMED') from None
    result['cleanup'] = 'CONTAINERS_REMOVED_VOLUME_RETAINED'
    return result
