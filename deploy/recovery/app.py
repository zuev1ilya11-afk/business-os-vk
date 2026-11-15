"""Launch a captured application on a clone of a verified local restore volume.

No production endpoint or host bind mount is used.  Runtime credentials and
captured private configuration remain in memory or in the new labelled volume.
"""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import secrets
import tarfile
import threading
import time
from urllib.parse import unquote, urlsplit
import uuid

import app_browser
import app_plan
import app_storage
import app_transport
import drill
import drill_db
import drill_files
import drill_profile

LABEL = 'io.business-os.local-app'
ID = re.compile(r'[0-9a-f]{64}')
RUN = re.compile(r'bos-app-[0-9a-f]{12}')
SOURCE_RUN = re.compile(r'bos-drill-[0-9a-f]{12}')
SUBPATH = re.compile(r'[A-Za-z0-9_./-]+')
MIB = 1024 * 1024


class Stop(Exception):
    def __init__(self, reason_code):
        self.reason_code = reason_code
        super().__init__(reason_code)


def require(condition, code):
    if not condition:
        raise Stop(code)


def one(runner, args):
    try:
        result = json.loads(runner(args))
    except (ValueError, TypeError):
        raise Stop('APP_DOCKER_METADATA_INVALID') from None
    require(isinstance(result, list) and len(result) == 1 and isinstance(result[0], dict),
            'APP_DOCKER_METADATA_INVALID')
    return result[0]


def validate_report(context, report):
    require(isinstance(report, dict) and report.get('format') == 1
            and report.get('status') == 'DRILL_COMPLETED', 'APP_SUCCESSFUL_RESTORE_REPORT_REQUIRED')
    run_id = report.get('run_id')
    require(isinstance(run_id, str) and SOURCE_RUN.fullmatch(run_id)
            and report.get('volume') == run_id + '-data', 'APP_BASELINE_IDENTITY_INVALID')
    manifest_hash = hashlib.sha256((context['bundle'] / 'manifest.json').read_bytes()).hexdigest()
    require(report.get('source_manifest_sha256') == manifest_hash, 'APP_REPORT_BUNDLE_MISMATCH')
    restored, files = report.get('restore'), report.get('files')
    require(isinstance(restored, dict) and restored.get('database') == 'RESTORED'
            and restored.get('globals') == 'RESTORED' and restored.get('extensions') == 'MATCH'
            and restored.get('source_version') == context['private']['database']['version']
            and restored.get('report_guard') == 'PRESENT_AND_ENABLED', 'APP_BASELINE_RESTORE_INCOMPLETE')
    require(isinstance(files, dict) and files.get('integrity') == 'VERIFIED'
            and files.get('files') == context['file_count'] and files.get('bytes') == context['file_bytes'],
            'APP_BASELINE_FILES_INCOMPLETE')
    counts = restored.get('counts')
    require(isinstance(counts, dict) and set(counts) == {'orders', 'staff', 'storage_objects'}
            and all(type(value) is int and value >= 0 for value in counts.values()),
            'APP_BASELINE_COUNTS_INVALID')
    return report['volume']


def baseline_available(runner, report, *, own_helper=None):
    name = report['volume']
    obj = one(runner, ['volume', 'inspect', name])
    require(obj.get('Name') == name and obj.get('Driver') == 'local' and not obj.get('Options')
            and (obj.get('Labels') or {}).get(drill.LABEL) == report['run_id'],
            'APP_BASELINE_VOLUME_UNCONFIRMED')
    refs = runner(['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter', 'volume=' + name]).decode().split()
    require(not (set(refs) - ({own_helper} if own_helper else set())), 'APP_BASELINE_VOLUME_IN_USE')
    return obj


def ensure_images(runner, context):
    ids = [item['Id'] for item in context['private']['images']]
    try:
        actual = json.loads(runner(['image', 'inspect', *ids]))
    except Exception:
        drill.load_images(runner, context)
        actual = json.loads(runner(['image', 'inspect', *ids]))
    require(isinstance(actual, list), 'APP_IMAGES_UNCONFIRMED')
    by_id = {item.get('Id'): item for item in actual}
    require(set(by_id) == set(ids), 'APP_IMAGE_ID_CHANGED')
    for expected in context['private']['images']:
        require(all(by_id[expected['Id']].get(key) == expected.get(key)
                    for key in ('Os', 'Architecture', 'Variant', 'RootFS', 'Config')),
                'APP_IMAGE_METADATA_CHANGED')
    return by_id


def create_volume(runner, run_id):
    name = run_id + '-data'
    require(RUN.fullmatch(run_id) is not None, 'APP_RESOURCE_ID_INVALID')
    require(name not in runner(['volume', 'ls', '--quiet']).decode().split(), 'APP_VOLUME_ALREADY_EXISTS')
    result = runner(['volume', 'create', '--driver', 'local', '--label', LABEL + '=' + run_id, name]).decode().strip()
    require(result == name, 'APP_VOLUME_CREATE_FAILED')
    inspect_volume(runner, run_id, name)
    return name


def inspect_volume(runner, run_id, name):
    obj = one(runner, ['volume', 'inspect', name])
    require(obj.get('Name') == name and obj.get('Driver') == 'local' and not obj.get('Options')
            and (obj.get('Labels') or {}).get(LABEL) == run_id, 'APP_VOLUME_IDENTITY_CHANGED')


def mount_arg(volume, target, subpath=None, readonly=False):
    require(re.fullmatch(r'bos-(?:app|drill)-[0-9a-f]{12}-data', volume) is not None,
            'APP_MOUNT_INVALID')
    require(target.startswith('/') and SUBPATH.fullmatch(target) and '..' not in target.split('/'),
            'APP_MOUNT_INVALID')
    result = 'type=volume,source=' + volume + ',target=' + target + ',volume-nocopy'
    if subpath is not None:
        require(isinstance(subpath, str) and SUBPATH.fullmatch(subpath) and not subpath.startswith('/')
                and '..' not in subpath.split('/') and str(PurePosixPath(subpath)) == subpath,
                'APP_MOUNT_INVALID')
        result += ',volume-subpath=' + subpath
    return result + (',readonly' if readonly else '')


def tmpfs_targets(image, mounts):
    values = image.get('Config', {}).get('Volumes') or {}
    require(isinstance(values, dict), 'APP_IMAGE_VOLUMES_INVALID')
    targets = {'/tmp', '/run'}
    for target in values:
        require(isinstance(target, str) and target.startswith('/') and SUBPATH.fullmatch(target)
                and '..' not in target.split('/') and target != '/', 'APP_IMAGE_VOLUMES_INVALID')
        if target not in mounts:
            require(not any(target.startswith(m + '/') or m.startswith(target + '/') for m in mounts),
                    'APP_IMAGE_VOLUME_OVERLAP')
            targets.add(target)
    return {p for p in targets if not any(p != q and p.startswith(q + '/') for q in targets)}


def base_args(run_id, role, image, env, mounts, network, *, user='0:0', helper=False):
    memory = {'db': 512, 'edge': 768, 'storage': 512, 'rest': 256, 'auth': 256, 'https': 128}.get(role, 256) * MIB
    args = ['container', 'create', '--name', run_id + '-' + role, '--label', LABEL + '=' + run_id,
            '--network', network, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--restart', 'no', '--no-healthcheck', '--user', user, '--pids-limit', '256',
            '--memory', str(memory), '--memory-swap', str(memory), '--cpus', '2',
            '--log-driver', 'local', '--log-opt', 'max-size=1m', '--log-opt', 'max-file=1']
    if helper:
        for cap in ('CHOWN', 'DAC_OVERRIDE', 'DAC_READ_SEARCH', 'FOWNER'):
            args += ['--cap-add', cap]
    for key, value in env.items():
        require(app_plan.ENV_KEY.fullmatch(key) and isinstance(value, str) and '\x00' not in value,
                'APP_ENV_INVALID')
        args += ['--env', key + '=' + value]
    for entry in mounts.values():
        args += ['--mount', entry['argument']]
    temporary = tmpfs_targets(image, mounts)
    for target in sorted(temporary):
        args += ['--tmpfs', target + ':rw,nosuid,nodev,size=64m,mode=1777']
    return args, temporary


def verify_container(session, cid, spec, *, running=None):
    item = one(session.runner, ['container', 'inspect', cid])
    host, config = item.get('HostConfig') or {}, item.get('Config') or {}
    require(item.get('Id') == cid and (config.get('Labels') or {}).get(LABEL) == session.run_id
            and item.get('Image') == spec['image'], 'APP_CONTAINER_IDENTITY_CHANGED')
    require(host.get('NetworkMode') == spec['network'] and host.get('ReadonlyRootfs') is True
            and not host.get('Privileged') and not host.get('PortBindings') and not host.get('PublishAllPorts')
            and not host.get('Devices') and not host.get('DeviceRequests') and not host.get('DeviceCgroupRules')
            and not host.get('VolumesFrom') and host.get('PidMode', '') in ('', 'private')
            and host.get('IpcMode', '') in ('', 'private') and host.get('UTSMode', '') in ('', 'private')
            and host.get('RestartPolicy', {}).get('Name') in ('', 'no')
            and drill_db._capabilities(host.get('CapDrop')) == {'ALL'}
            and drill_db._capabilities(host.get('CapAdd')) == spec['caps']
            and drill_db._no_new_privileges(host.get('SecurityOpt'))
            and host.get('Memory') == spec['memory'] and host.get('MemorySwap') == spec['memory']
            and host.get('NanoCpus') == 2_000_000_000 and host.get('PidsLimit') == 256
            and config.get('User') == spec['user'] and config.get('Entrypoint') == [spec['entrypoint']]
            and (config.get('Cmd') or []) == spec['cmd'] and config.get('Healthcheck', {}).get('Test') == ['NONE'],
            'APP_CONTAINER_ISOLATION_CHANGED')
    require(set(host.get('Tmpfs') or {}) == spec['tmpfs'], 'APP_CONTAINER_MOUNTS_CHANGED')
    seen = set()
    for mounted in item.get('Mounts') or []:
        target = mounted.get('Destination')
        require(target not in seen, 'APP_CONTAINER_MOUNTS_CHANGED')
        seen.add(target)
        if target in spec['tmpfs']:
            require(mounted.get('Type') == 'tmpfs', 'APP_CONTAINER_MOUNTS_CHANGED')
            continue
        expected = spec['mounts'].get(target)
        require(expected is not None and mounted.get('Type') == 'volume'
                and mounted.get('Name') == expected['volume'] and mounted.get('RW') == (not expected['readonly']),
                'APP_CONTAINER_MOUNTS_CHANGED')
    require(set(spec['mounts']) <= seen, 'APP_CONTAINER_MOUNTS_CHANGED')
    # Docker reports subpaths in HostConfig even where inspect Mounts omits them.
    configured = host.get('Mounts') or []
    require(len(configured) == len(spec['mounts']), 'APP_CONTAINER_MOUNTS_CHANGED')
    for mounted in configured:
        expected = spec['mounts'].get(mounted.get('Target'))
        require(expected is not None and mounted.get('Type') == 'volume'
                and mounted.get('Source') == expected['volume']
                and bool(mounted.get('ReadOnly')) == expected['readonly']
                and (mounted.get('VolumeOptions') or {}).get('Subpath', '') == expected.get('subpath', ''),
                'APP_CONTAINER_MOUNTS_CHANGED')
    if spec['network'] == 'none':
        networks = item.get('NetworkSettings', {}).get('Networks') or {}
        require(set(networks) <= {'none'} and all(not n.get('IPAddress') and not n.get('GlobalIPv6Address')
                for n in networks.values()), 'APP_CONTAINER_NETWORK_CHANGED')
    if running is not None:
        require(item.get('State', {}).get('Running') is running, 'APP_CONTAINER_NOT_RUNNING')
    return item


def mount_record(volume, target, *, subpath=None, readonly=False):
    return {'volume': volume, 'readonly': readonly, 'subpath': subpath or '',
            'argument': mount_arg(volume, target, subpath, readonly)}


def create_container(session, role, image, env, mounts, network, entrypoint, cmd, *, user='0:0', helper=False):
    args, tmpfs = base_args(session.run_id, role, image, env, mounts, network, user=user, helper=helper)
    if role == 'db':
        for hostname, address in app_plan.ALIASES.items():
            args += ['--add-host', hostname + ':' + address]
    args += ['--entrypoint', entrypoint, image['Id'], *cmd]
    cid = session.runner(args, limit=4096).decode().strip()
    require(ID.fullmatch(cid) is not None, 'APP_CONTAINER_CREATE_FAILED')
    spec = {'image': image['Id'], 'network': network, 'mounts': mounts, 'tmpfs': tmpfs,
            'user': user, 'entrypoint': entrypoint, 'cmd': cmd,
            'memory': int(args[args.index('--memory') + 1]),
            'caps': {'CHOWN', 'DAC_OVERRIDE', 'DAC_READ_SEARCH', 'FOWNER'} if helper else set()}
    session._owned[cid] = spec
    verify_container(session, cid, spec, running=False)
    session.runner(['container', 'start', cid], limit=4096)
    verify_container(session, cid, spec, running=True)
    return cid


def clean_env(image):
    env = {key: '' for key in app_plan.environment(image.get('Config') or {})}
    env.update(PATH=drill_db.PATH, LANG='C.UTF-8', LC_ALL='C.UTF-8', TZ='UTC')
    return env


def tar_bytes(files):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        for name, data in sorted(files.items()):
            require(isinstance(data, bytes) and len(data) <= 8 * MIB and not name.startswith('/')
                    and '..' not in name.split('/') and str(PurePosixPath(name)) == name,
                    'APP_GENERATED_FILE_INVALID')
            item = tarfile.TarInfo(name)
            item.mode, item.size = 0o600, len(data)
            archive.addfile(item, io.BytesIO(data))
    return stream.getvalue()


def sql(session, statement, *, database=None, readonly=False, limit=32 * MIB):
    args = drill_db._client(session.containers['db'], session._admin, 'psql', database or session._database,
                           ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], readonly=readonly, profile=session._profile)
    # Docker exec must retain stdin; _client deliberately has no -i for argv SQL.
    args.insert(1, '-i')
    return app_transport.input_call(session.runner, args, statement.encode(), timeout=90, limit=limit)


def postgres_files(profile):
    settings = {
        'listen_addresses': '127.0.0.1', 'port': '5432', 'unix_socket_directories': '/tmp',
        'unix_socket_permissions': '0700', 'max_connections': '50', 'shared_buffers': '64MB',
        'logging_collector': 'off', 'log_min_messages': 'error', 'log_min_error_statement': 'panic',
        'log_statement': 'none', 'log_connections': 'off', 'log_disconnections': 'off',
        'ssl': 'off', 'archive_mode': 'off', 'archive_command': '', 'restore_command': '',
        'external_pid_file': '', 'password_encryption': 'scram-sha-256',
        'search_path': 'public,extensions',
    }
    for value in profile.startup_settings:
        key, content = value.split('=', 1)
        settings[key] = content
    # No source postgresql.conf/auto.conf/startup hook is consulted.
    config = ''.join(key + " = '" + value.replace("'", "''") + "'\n" for key, value in settings.items())
    return {'data/postgresql.conf': config.encode(), 'data/postgresql.auto.conf': b'# Local application clone only.\n',
            'data/pg_hba.conf': b'local all all trust\nhost all all 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n',
            'data/pg_ident.conf': b'# Local application clone only.\n'}


CLONE_SCRIPT = r'''set -eu
umask 077
test -d /source/data
test -d /source/files
test -f /source/files-ready
test ! -e /source/data/postmaster.pid
test -z "$(ls -A /bos)"
test -z "$(find /source/data /source/files ! -type f ! -type d -print -quit)"
cp -a /source/data /bos/data
cp -a /source/files /bos/files
chmod 711 /bos
chown -R 0:0 /bos/files
chmod -R u+rwX,go-rwx /bos/files
mkdir -m 700 /bos/app /bos/app/caddy /bos/app/diagnostics
cp -a "/bos/files/$1" /bos/app/gateway
'''


def clone_baseline(session, context, report, image):
    source = report['volume']
    mounts = {'/source': mount_record(source, '/source', readonly=True),
              '/bos': mount_record(session.volume, '/bos')}
    helper = create_container(session, 'init', image, clean_env(image), mounts, 'none', '/bin/sh',
                              ['-ceu', 'exec sleep 1800'], helper=True)
    baseline_available(session.runner, report, own_helper=helper)
    space = session.runner(['exec', helper, '/bin/sh', '-ceu',
        "df -Pk /bos | awk 'NR==2 {print $4}'; du -sk /source/data /source/files | awk '{print $1}'"], limit=4096).decode().split()
    require(len(space) == 3 and all(re.fullmatch(r'[0-9]+', x) for x in space), 'APP_SPACE_CHECK_FAILED')
    require(int(space[0]) >= int(space[1]) + int(space[2]) + 256 * 1024, 'APP_INSUFFICIENT_DOCKER_SPACE')
    session.runner(['exec', helper, '/bin/sh', '-ceu', CLONE_SCRIPT, 'bos-app-clone',
                    session._plan['gateway_archive_prefix']], timeout=900, limit=4096)
    session.runner.verify_stream(['exec', helper, 'tar', '-cf', '-', '-C', '/bos/files', '.'], context['inventory'])
    baseline_available(session.runner, report, own_helper=helper)
    files = {'app/' + name: value for name, value in session._plan['generated_files'].items()}
    files.update(postgres_files(session._profile))
    app_transport.input_call(session.runner, ['exec', '-i', helper, 'tar', '-xf', '-', '-C', '/bos'], tar_bytes(files))
    session.runner(['exec', helper, 'chown', 'postgres:postgres', '/bos/data/postgresql.conf',
                    '/bos/data/postgresql.auto.conf', '/bos/data/pg_hba.conf', '/bos/data/pg_ident.conf'], limit=4096)
    # Single-user mode is confined to the unstarted clone; it creates one new local administrator.
    session._admin = 'app_admin_' + secrets.token_hex(12)
    statements = ['CREATE ROLE "' + session._admin + '" WITH LOGIN SUPERUSER;', 'DELETE FROM pg_db_role_setting;']
    for user, password in session._plan['db_roles'].items():
        require(app_plan.IDENT.fullmatch(user) and re.fullmatch(r'[A-Za-z0-9_-]+', password), 'APP_ROLE_INVALID')
        statements.append('ALTER ROLE "' + user + '" WITH LOGIN PASSWORD \'' + password + '\';')
    statement = '\n'.join(statements) + '\n'
    app_transport.input_call(session.runner, ['exec', '-i', '--user', 'postgres', helper, '/bin/sh', '-ceu',
        'exec env -i PATH="$1" postgres --single -D /bos/data -c config_file=/bos/data/postgresql.conf postgres 2>/bos/data/app-bootstrap.stderr.log',
        'bos-app-bootstrap', drill_db.PATH], statement.encode(), timeout=120, limit=2 * MIB)
    verify_container(session, helper, session._owned[helper], running=True)
    session._remove(helper)
    baseline_available(session.runner, report)


def wait_database(session, expected):
    deadline = time.monotonic() + 60
    while True:
        try:
            if sql(session, 'SELECT 1;\n', database='postgres', readonly=True, limit=4096).strip() == b'1':
                break
        except Exception:
            pass
        verify_container(session, session.containers['db'], session._owned[session.containers['db']], running=True)
        require(time.monotonic() < deadline, 'APP_DATABASE_START_TIMEOUT')
        time.sleep(0.25)
    checked = json.loads(sql(session, drill_db.VALIDATE_SQL, readonly=True))
    require(checked.get('database') == session._database and checked.get('version') == expected['restore']['source_version']
            and checked.get('workers_disabled') is True and checked.get('preloads') == ','.join(session._profile.preloads)
            and sorted(tuple(value) for value in checked.get('extensions', [])) == sorted(session._profile.extensions)
            and checked.get('guard_function') is True and checked.get('guard_trigger') is True,
            'APP_CLONED_DATABASE_VALIDATION_FAILED')
    require({key: checked.get(key) for key in ('orders', 'staff', 'storage_objects')} == expected['restore']['counts'],
            'APP_CLONED_DATABASE_COUNTS_CHANGED')
    routes = session.runner(['exec', session.containers['db'], 'cat', '/proc/net/route'], limit=4096).decode().splitlines()
    require(len(routes) == 1, 'APP_POD_NETWORK_NOT_ISOLATED')
    tools = session.runner(['exec', session.containers['db'], '/bin/busybox', '--list'], limit=65536).decode().split()
    require('nc' in tools, 'APP_HTTP_RELAY_UNAVAILABLE')
    return {key: checked[key] for key in ('orders', 'staff', 'storage_objects')}


def wait_http(session, role, path, headers=None):
    deadline = time.monotonic() + 90
    while True:
        verify_container(session, session.containers[role], session._owned[session.containers[role]], running=True)
        try:
            result = app_transport.http_call(session.runner, session.containers['db'], 'GET', path,
                headers or {}, b'', port=app_plan.PORTS[role])
            if result[0] == 200:
                return result
        except Exception:
            pass
        require(time.monotonic() < deadline, 'APP_' + role.upper() + '_START_TIMEOUT')
        time.sleep(0.5)


def wait_edge(session):
    deadline = time.monotonic() + 90
    for slug in ('mini-app-api', 'password-session-api'):
        while True:
            verify_container(session, session.containers['edge'], session._owned[session.containers['edge']], running=True)
            try:
                status, headers, body = app_transport.http_call(session.runner, session.containers['db'],
                    'POST', '/functions/v1/' + slug, {'Content-Type': 'application/json'},
                    b'{"action":"__bos_restore_readiness_probe__"}', port=9000)
                payload = json.loads(body)
                if status in (200, 400, 401, 403, 404, 405, 422) and isinstance(payload, dict):
                    break
            except Exception:
                pass
            require(time.monotonic() < deadline, 'APP_EDGE_FUNCTION_START_TIMEOUT')
            time.sleep(0.5)


class AppSession:
    def __init__(self, runner, run_id, profile_dir=None):
        self.runner, self.run_id = runner, run_id
        self.volume = None
        self.containers, self._owned = {}, {}
        self._stopped = False
        self._plan, self._profile, self._admin, self._database = None, None, None, None
        self._mapped = {}
        self.report = {'format': 1, 'run_id': run_id, 'status': 'STARTING',
            'application': 'NOT_RUN', 'disaster_recovery_ready': False,
            'database_storage_consistency': 'NOT_PROVEN', 'storage_extended_attributes': 'NOT_CAPTURED',
            'network_isolation': 'NETWORK_NONE_SHARED_LOOPBACK_NO_HOST_PORTS'}
        self.portal = app_browser.LocalPortal(self._transport, profile_dir=profile_dir)
        self.origin = self.portal.origin
        self._thread = None

    def _transport(self, method, path, headers, body):
        require(not self._stopped and 'db' in self.containers, 'APP_NOT_RUNNING')
        anchor = self.containers['db']
        verify_container(self, anchor, self._owned[anchor], running=True)
        status, response_headers, data = app_transport.http_call(self.runner, anchor, method, path, headers, body)
        # Missing captured xattrs may require a verified DB content-type at the browser boundary.
        match = re.fullmatch(r'/storage/v1/object/(?:public|authenticated|sign)/(.+)', urlsplit(path).path)
        if status == 200 and method == 'GET' and match:
            obj = self._mapped.get(unquote(match[1]))
            if obj is not None and obj.mimetype and len(data) == obj.expected_bytes and hashlib.sha256(data).hexdigest() == obj.expected_sha256:
                response_headers = {k: v for k, v in response_headers.items() if k.lower() != 'content-type'}
                response_headers['content-type'] = obj.mimetype
                if obj.content_encoding:
                    response_headers['content-encoding'] = obj.content_encoding
                if obj.cache_control:
                    response_headers['cache-control'] = obj.cache_control
        return status, response_headers, data

    def _remove(self, cid):
        spec = self._owned[cid]
        record = verify_container(self, cid, spec)
        if record.get('State', {}).get('Running'):
            self.runner(['container', 'stop', '--time', '15', cid], timeout=30, limit=4096)
        verify_container(self, cid, spec, running=False)
        self.runner(['container', 'rm', '-v', cid], limit=4096)
        del self._owned[cid]

    def _private_logs(self):
        anchor = self.containers.get('db')
        if not anchor or anchor not in self._owned:
            return
        try:
            verify_container(self, anchor, self._owned[anchor], running=True)
            files = {}
            for role, cid in self.containers.items():
                try:
                    verify_container(self, cid, self._owned[cid])
                    data = self.runner(['logs', '--tail', '80', cid], timeout=10, limit=128 * 1024)
                    files['diagnostics/' + role + '.log'] = data
                except Exception:
                    continue
            if files:
                app_transport.input_call(self.runner, ['exec', '-i', '--user', '0:0', anchor,
                    'tar', '-xf', '-', '-C', '/bos/app'], tar_bytes(files), timeout=30, limit=4096)
        except Exception:
            pass

    def stop(self):
        if self._stopped and not self._owned:
            return
        self._stopped = True
        self.portal.shutdown()
        if self._thread is not None:
            self._thread.join(timeout=5)
        failed = False
        for cid in reversed(list(self._owned)):
            try:
                self._remove(cid)
            except Exception:
                failed = True
        self.report['cleanup'] = 'UNCONFIRMED' if failed else 'OWNED_CONTAINERS_REMOVED_APP_VOLUME_RETAINED'
        if failed:
            raise Stop('APP_CLEANUP_UNCONFIRMED')


def start_app(bundle, successful_report, runner, *, profile_dir=None, progress=None):
    """Return a running local app session; production and the baseline stay untouched."""
    emit = progress if callable(progress) else lambda stage: None
    emit('VERIFYING_COPY')
    context = drill_files.validate_bundle(Path(bundle))
    source_volume = validate_report(context, successful_report)
    daemon = drill.local_preflight(runner, context)
    baseline_available(runner, successful_report)
    images = ensure_images(runner, context)
    session = AppSession(runner, 'bos-app-' + uuid.uuid4().hex[:12], profile_dir)
    try:
        with tarfile.open(context['bundle'] / 'files.tar', 'r:') as archive:
            def read_file(name):
                member = archive.getmember(name)
                require(member.isfile() and member.size <= 4 * MIB, 'APP_CAPTURE_FILE_INVALID')
                return archive.extractfile(member).read(4 * MIB + 1)
            session._plan = app_plan.build_plan(context, read_file, session.origin)
        session.portal.allowed_origins |= frozenset(app_browser.validated_origin(value)
            for value in session._plan.get('source_origins', []))
        session._database = context['private']['database']['database']
        session._profile = drill_profile.build_runtime_profile(context['private']['database'])
        require(drill.local_preflight(runner, context) == daemon, 'APP_DOCKER_DAEMON_CHANGED')
        baseline_available(runner, successful_report)
        session.volume = create_volume(runner, session.run_id)
        session.report.update(volume=session.volume, baseline_volume=source_volume,
            source_manifest_sha256=successful_report['source_manifest_sha256'])
        emit('CLONING_VERIFIED_VOLUME')
        clone_baseline(session, context, successful_report, images[context['db_image']])
        emit('DATABASE')
        db_image = images[context['db_image']]
        mounts = {'/bos': mount_record(session.volume, '/bos')}
        anchor = create_container(session, 'db', db_image, clean_env(db_image), mounts, 'none', '/bin/sh',
            ['-ceu', 'exec env -i PATH="$1" postgres -D /bos/data -c config_file=/bos/data/postgresql.conf',
             'bos-app-db', drill_db.PATH], user='postgres')
        session.containers['db'] = anchor
        counts = wait_database(session, successful_report)
        session.report['database'] = {'status': 'CLONE_VALIDATED', 'counts': counts, 'background_workers': 'DISABLED'}
        emit('SERVICES')
        for role in ('rest', 'auth', 'storage', 'edge', 'https'):
            spec = session._plan['roles'][role]
            mounts = {entry['target']: mount_record(session.volume, entry['target'],
                subpath=('app/' if entry.get('generated') else 'files/') + entry['source'],
                readonly=entry['readonly']) for entry in spec['mounts']}
            session.containers[role] = create_container(session, role, images[spec['image']], spec['env'],
                mounts, 'container:' + anchor, spec['entrypoint'], spec['cmd'])
            if role == 'rest':
                wait_http(session, role, '/', {'Authorization': 'Bearer ' + session._plan['secrets']['service']})
            elif role == 'auth':
                wait_http(session, role, '/health')
            elif role == 'storage':
                wait_http(session, role, '/status')
            elif role == 'https':
                wait_http(session, role, '/')
        wait_edge(session)
        # Services may run their own schema migrations; recheck record counts afterwards.
        wait_database(session, successful_report)
        emit('VERIFYING_STORAGE')
        schema = json.loads(sql(session, app_storage.SCHEMA_SQL, readonly=True))
        require(schema.get('objects_exists') is True and {'id', 'bucket_id', 'name', 'metadata'} <= set(schema.get('columns', [])),
                'APP_STORAGE_SCHEMA_INVALID')
        objects = json.loads(sql(session, app_storage.OBJECTS_SQL, readonly=True))
        require(isinstance(objects, list) and len(objects) == counts['storage_objects'],
                'APP_STORAGE_OBJECT_COUNT_CHANGED')
        mapped = app_storage.map_objects(context, objects)
        token = session._plan['secrets']['service']
        def fetch(obj):
            return app_transport.http_call(runner, anchor, 'GET', obj.http_path,
                {'Authorization': 'Bearer ' + token, 'apikey': token, 'Accept-Encoding': 'identity'}, b'', port=5000)
        storage = app_storage.verify_objects(mapped, fetch)
        session.report['storage'] = storage
        require(storage['bytes_status'] == 'VERIFIED', 'APP_STORAGE_HTTP_VERIFICATION_FAILED')
        session._mapped = {obj.bucket_id + '/' + obj.name: obj for obj in mapped}
        session.report['storage_browser_content_type'] = 'VERIFIED_DB_METADATA_OVERRIDE_AVAILABLE'
        drill_files.verify_payloads(context['bundle'], context['manifest'])
        baseline_available(runner, successful_report)
        for cid, spec in session._owned.items():
            verify_container(session, cid, spec, running=True)
        inspect_volume(runner, session.run_id, session.volume)
        session.report.update(status='READY_FOR_MANUAL_CHECK', application='LOCAL_SERVICES_READY',
            browser_workflows='NOT_VERIFIED', origin=session.origin)
        session._thread = threading.Thread(target=session.portal.serve_forever, name='bos-local-portal', daemon=True)
        session._thread.start()
        require(session.portal._serving.wait(timeout=5), 'APP_PORTAL_START_FAILED')
        emit('READY_FOR_MANUAL_CHECK')
        return session
    except (Exception, KeyboardInterrupt) as exc:
        code = getattr(exc, 'reason_code', 'APP_START_FAILED')
        if not isinstance(code, str) or not re.fullmatch(r'[A-Z0-9_]{1,80}', code):
            code = 'APP_START_FAILED'
        session.report.update(status='STOPPED', reason=code)
        session._private_logs()
        try:
            session.stop()
        except Exception:
            session.report['cleanup'] = 'UNCONFIRMED'
        failure = Stop(code)
        failure.report = session.report
        raise failure from None
