"""Read retained startup logs from one failed application clone, never start SQL.

The existing failed volume is mounted read-only to an isolated helper using the
exact already-local captured database image. Source backups and the verified
restore volume are never mounted, and private log bytes remain in memory.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import uuid

import app_cli
import app_db_log_sanitize
import drill
import drill_db
import drill_files as files

MIB = 1024 * 1024
MAX_LOG = 64 * 1024
MAX_FAILED_REPORT = MIB
APP_LABEL = 'io.business-os.local-app'
HELPER_LABEL = 'io.business-os.app-log-diagnostic'
APP_RUN = re.compile(r'bos-app-[0-9a-f]{12}')
RESTORE_RUN = re.compile(r'bos-drill-[0-9a-f]{12}')
ID = re.compile(r'[0-9a-f]{64}')
DIGEST = re.compile(r'[0-9a-f]{64}')
REPORT_NAME = re.compile(r'BOS-App-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.json')
ENV_KEY = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
LOG_PATHS = {'db': '/bos/app/diagnostics/db.log',
             'init': '/bos/app/diagnostics/init.log',
             'rest': '/bos/app/diagnostics/rest.log',
             'auth': '/bos/app/diagnostics/auth.log',
             'storage': '/bos/app/diagnostics/storage.log',
             'edge': '/bos/app/diagnostics/edge.log',
             'https': '/bos/app/diagnostics/https.log',
             'command': '/bos/app/diagnostics/command.stderr.log',
             'bootstrap': '/bos/data/app-bootstrap.stderr.log'}
FAILURES = {'DATABASE': {'db'}, 'SERVICES': {'db', 'rest', 'auth', 'storage', 'edge', 'https'}}

# A fixed status byte precedes bounded file content. No arbitrary filename is
# accepted; every ancestor is checked before opening a regular file.
READ_LOG = r'''set -eu
case "$1" in
 /bos/app/diagnostics/db.log|/bos/app/diagnostics/init.log|/bos/app/diagnostics/rest.log|/bos/app/diagnostics/auth.log|/bos/app/diagnostics/storage.log|/bos/app/diagnostics/edge.log|/bos/app/diagnostics/https.log|/bos/app/diagnostics/command.stderr.log)
  for p in /bos /bos/app /bos/app/diagnostics; do
   if test -L "$p"; then printf U; exit 0; fi
   if ! test -d "$p"; then printf M; exit 0; fi
  done;;
 /bos/data/app-bootstrap.stderr.log)
  for p in /bos /bos/data; do
   if test -L "$p"; then printf U; exit 0; fi
   if ! test -d "$p"; then printf M; exit 0; fi
  done;;
 *) exit 44;;
esac
if test -L "$1"; then printf U; exit 0; fi
if ! test -e "$1"; then printf M; exit 0; fi
if ! test -f "$1"; then printf U; exit 0; fi
printf P
head -c 65537 "$1"
'''


def require(condition, code):
    if not condition:
        raise app_cli.Stop(code)


def one(runner, args):
    try:
        value = json.loads(runner(args, limit=4 * MIB))
    except (ValueError, TypeError, UnicodeError):
        raise app_cli.Stop('DB_DIAGNOSTIC_DOCKER_METADATA_INVALID') from None
    require(isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict),
            'DB_DIAGNOSTIC_DOCKER_METADATA_INVALID')
    return value[0]


def validate_successful(successful):
    require(isinstance(successful, dict) and successful.get('status') == 'DRILL_COMPLETED',
            'DB_DIAGNOSTIC_RESTORE_REPORT_INVALID')
    run = successful.get('run_id')
    require(isinstance(run, str) and RESTORE_RUN.fullmatch(run)
            and successful.get('volume') == run + '-data'
            and isinstance(successful.get('source_manifest_sha256'), str)
            and DIGEST.fullmatch(successful['source_manifest_sha256']),
            'DB_DIAGNOSTIC_RESTORE_REPORT_INVALID')


def validate_failure(launch, successful):
    validate_successful(successful)
    require(isinstance(launch, dict) and launch.get('status') == 'STOPPED'
            and launch.get('failed_stage') in FAILURES
            and launch.get('failed_service') in FAILURES[launch['failed_stage']],
            'DB_DIAGNOSTIC_FAILED_REPORT_INVALID')
    run = launch.get('run_id')
    require(isinstance(run, str) and APP_RUN.fullmatch(run)
            and launch.get('volume') == run + '-data'
            and launch.get('baseline_volume') == successful['volume']
            and launch.get('source_manifest_sha256') == successful['source_manifest_sha256'],
            'DB_DIAGNOSTIC_FAILED_REPORT_MISMATCH')
    return launch


def select_failure(work, successful):
    """Select the latest timestamped database/service failure for this restore."""
    validate_successful(successful)
    candidates = sorted((p for p in work.glob('BOS-App-*.json') if REPORT_NAME.fullmatch(p.name)),
                        key=lambda p: p.name, reverse=True)
    require(len(candidates) <= 512, 'DB_DIAGNOSTIC_REPORT_COUNT_LIMIT')
    for path in candidates:
        try:
            raw, _ = files._read(path, limit=MAX_FAILED_REPORT, collect=True)
            report = json.loads(raw, object_pairs_hook=files._unique_pairs)
        except Exception:
            # Never silently diagnose an older clone when a newer report is
            # unreadable, malformed, a symlink, or beyond the bounded limit.
            raise app_cli.Stop('DB_DIAGNOSTIC_FAILED_REPORT_INVALID') from None
        if not isinstance(report, dict) or report.get('status') != 'STOPPED':
            continue
        launch = report.get('launch')
        if not isinstance(launch, dict) or launch.get('status') != 'STOPPED':
            continue
        if (launch.get('failed_stage') not in FAILURES
                or launch.get('failed_service') not in FAILURES[launch['failed_stage']]):
            continue
        # An eligible newest report with another identity must not silently
        # select an older clone, even when the older clone still exists.
        return validate_failure(launch, successful)
    raise app_cli.Stop('DB_DIAGNOSTIC_FAILED_REPORT_NOT_FOUND')


def load_metadata(bundle, successful):
    validate_successful(successful)
    raw, identity = files._read(bundle / 'manifest.json', limit=MIB, collect=True)
    require(identity['sha256'] == successful['source_manifest_sha256'], 'DB_DIAGNOSTIC_WRONG_BUNDLE')
    try:
        manifest = json.loads(raw, object_pairs_hook=files._unique_pairs)
    except (ValueError, UnicodeError):
        raise app_cli.Stop('MANIFEST_INVALID') from None
    require(isinstance(manifest, dict) and manifest.get('capture') == 'COMPLETE'
            and isinstance(manifest.get('payloads'), dict), 'MANIFEST_INVALID')
    expected = manifest['payloads'].get('private-config.json')
    require(isinstance(expected, dict) and set(expected) == {'bytes', 'sha256'}
            and type(expected['bytes']) is int and 0 < expected['bytes'] <= files.MAX_JSON
            and isinstance(expected['sha256'], str) and DIGEST.fullmatch(expected['sha256']),
            'MANIFEST_INVALID')
    private = files._json(bundle / 'private-config.json', expected)
    roles, _, images = files._private_layout(private)
    image = roles['db']['Image']
    return {'private': private, 'db_image': image, 'db_image_meta': images[image]}


def volume_available(runner, launch, own_helper=None):
    name = launch['volume']
    value = one(runner, ['volume', 'inspect', name])
    require(value.get('Name') == name and value.get('Driver') == 'local' and not value.get('Options')
            and (value.get('Labels') or {}).get(APP_LABEL) == launch['run_id'],
            'DB_DIAGNOSTIC_VOLUME_IDENTITY_INVALID')
    references = runner(['container', 'ls', '--all', '--quiet', '--no-trunc',
                         '--filter', 'volume=' + name], limit=65536).decode().split()
    require(len(references) <= 512 and all(ID.fullmatch(item) for item in references),
            'DB_DIAGNOSTIC_VOLUME_REFERENCES_INVALID')
    require(set(references) <= ({own_helper} if own_helper else set()),
            'DB_DIAGNOSTIC_VOLUME_IN_USE')


def helper_args(image, launch, token):
    """Clear all inherited image ENV values; never execute captured entrypoints."""
    env = {}
    values = (image.get('Config') or {}).get('Env') or []
    require(isinstance(values, list) and len(values) <= 4096, 'DB_DIAGNOSTIC_IMAGE_ENV_INVALID')
    for value in values:
        require(isinstance(value, str) and '=' in value, 'DB_DIAGNOSTIC_IMAGE_ENV_INVALID')
        key = value.split('=', 1)[0]
        require(ENV_KEY.fullmatch(key) and key not in env, 'DB_DIAGNOSTIC_IMAGE_ENV_INVALID')
        env[key] = ''
    env.update(PATH=drill_db.PATH, LANG='C', LC_ALL='C', TZ='UTC')
    temporary = set(drill_db._tmpfs(image))
    name = 'bos-app-logs-' + token
    command = ['-ceu', 'exec sleep 300']
    args = ['container', 'create', '--name', name, '--label', HELPER_LABEL + '=' + token,
            '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
            '--cap-add', 'DAC_READ_SEARCH', '--security-opt', 'no-new-privileges',
            '--restart', 'no', '--no-healthcheck', '--log-driver', 'none', '--user', '0:0',
            '--workdir', '/', '--pids-limit', '32', '--memory', str(64 * MIB),
            '--memory-swap', str(64 * MIB), '--cpus', '1', '--entrypoint', '/bin/sh',
            '--mount', 'type=volume,source=' + launch['volume'] + ',target=/bos,readonly,volume-nocopy']
    for key, value in env.items():
        args += ['--env', key + '=' + value]
    for target in sorted(temporary):
        args += ['--tmpfs', target + ':rw,noexec,nosuid,nodev,size=1m,mode=1777']
    args += [image['Id'], *command]
    spec = {'name': name, 'token': token, 'image': image['Id'], 'volume': launch['volume'],
            'env': env, 'tmpfs': temporary, 'command': command}
    return args, spec


def inspect_helper(runner, cid, spec, running=None):
    value = one(runner, ['container', 'inspect', cid])
    host, config = value.get('HostConfig') or {}, value.get('Config') or {}
    require(value.get('Id') == cid and value.get('Name') == '/' + spec['name']
            and value.get('Image') == spec['image']
            and (config.get('Labels') or {}).get(HELPER_LABEL) == spec['token']
            and config.get('User') == '0:0' and config.get('WorkingDir') == '/'
            and config.get('Entrypoint') == ['/bin/sh'] and config.get('Cmd') == spec['command']
            and config.get('Healthcheck', {}).get('Test') == ['NONE'],
            'DB_DIAGNOSTIC_HELPER_IDENTITY_CHANGED')
    actual_env = config.get('Env') or []
    require(isinstance(actual_env, list) and len(actual_env) == len(spec['env'])
            and set(actual_env) == {key + '=' + content for key, content in spec['env'].items()},
            'DB_DIAGNOSTIC_HELPER_ENV_CHANGED')
    require(host.get('NetworkMode') == 'none' and host.get('ReadonlyRootfs') is True
            and not host.get('Privileged') and not host.get('PortBindings') and not host.get('PublishAllPorts')
            and not host.get('Devices') and not host.get('DeviceRequests') and not host.get('DeviceCgroupRules')
            and not host.get('VolumesFrom') and host.get('PidMode', '') in ('', 'private')
            and host.get('IpcMode', '') in ('', 'private') and host.get('UTSMode', '') in ('', 'private')
            and host.get('RestartPolicy', {}).get('Name') in ('', 'no')
            and host.get('LogConfig', {}).get('Type') == 'none'
            and drill_db._capabilities(host.get('CapDrop')) == {'ALL'}
            and drill_db._capabilities(host.get('CapAdd')) == {'DAC_READ_SEARCH'}
            and drill_db._no_new_privileges(host.get('SecurityOpt'))
            and host.get('Memory') == 64 * MIB and host.get('MemorySwap') == 64 * MIB
            and host.get('NanoCpus') == 1_000_000_000 and host.get('PidsLimit') == 32,
            'DB_DIAGNOSTIC_HELPER_ISOLATION_CHANGED')
    configured = host.get('Mounts') or []
    require(len(configured) == 1 and configured[0].get('Type') == 'volume'
            and configured[0].get('Source') == spec['volume'] and configured[0].get('Target') == '/bos'
            and configured[0].get('ReadOnly') is True
            and (configured[0].get('VolumeOptions') or {}).get('NoCopy') is True
            and not (configured[0].get('VolumeOptions') or {}).get('Subpath')
            and set(host.get('Tmpfs') or {}) == spec['tmpfs'],
            'DB_DIAGNOSTIC_HELPER_MOUNTS_CHANGED')
    seen = set()
    for mounted in value.get('Mounts') or []:
        target = mounted.get('Destination')
        require(target not in seen, 'DB_DIAGNOSTIC_HELPER_MOUNTS_CHANGED')
        seen.add(target)
        if target in spec['tmpfs']:
            require(mounted.get('Type') == 'tmpfs', 'DB_DIAGNOSTIC_HELPER_MOUNTS_CHANGED')
        else:
            require(target == '/bos' and mounted.get('Type') == 'volume'
                    and mounted.get('Name') == spec['volume'] and mounted.get('RW') is False,
                    'DB_DIAGNOSTIC_HELPER_MOUNTS_CHANGED')
    require('/bos' in seen, 'DB_DIAGNOSTIC_HELPER_MOUNTS_CHANGED')
    networks = value.get('NetworkSettings', {}).get('Networks') or {}
    require(set(networks) <= {'none'} and all(not item.get('IPAddress') and not item.get('GlobalIPv6Address')
            for item in networks.values()), 'DB_DIAGNOSTIC_HELPER_NETWORK_CHANGED')
    if running is not None:
        require(value.get('State', {}).get('Running') is running, 'DB_DIAGNOSTIC_HELPER_NOT_RUNNING')


def collect(context, successful, launch, runner):
    validate_failure(launch, successful)
    # DockerRunner independently pins a local Unix socket or Windows named pipe.
    daemon = drill.local_preflight(runner, context)
    volume_available(runner, launch)
    image = one(runner, ['image', 'inspect', context['db_image']])
    expected = context['db_image_meta']
    require(image.get('Id') == context['db_image'] and image.get('Os') == 'linux'
            and image.get('Architecture') == 'amd64'
            and all(image.get(key) == expected.get(key) for key in ('Os', 'Architecture', 'Variant', 'RootFS', 'Config')),
            'DB_DIAGNOSTIC_LOCAL_IMAGE_CHANGED')
    args, spec = helper_args(image, launch, uuid.uuid4().hex[:12])
    require(drill.local_preflight(runner, context) == daemon, 'DB_DIAGNOSTIC_DAEMON_CHANGED')
    volume_available(runner, launch)
    cid = None
    raw_logs, log_states = {}, {}
    try:
        cid = runner(args, limit=4096).decode().strip()
        require(ID.fullmatch(cid), 'DB_DIAGNOSTIC_HELPER_CREATE_FAILED')
        inspect_helper(runner, cid, spec, running=False)
        volume_available(runner, launch, own_helper=cid)
        runner(['container', 'start', cid], limit=4096)
        inspect_helper(runner, cid, spec, running=True)
        for key, path in LOG_PATHS.items():
            volume_available(runner, launch, own_helper=cid)
            raw = runner(['exec', cid, '/bin/sh', '-ceu', READ_LOG, 'bos-read-retained-log', path],
                         timeout=15, limit=MAX_LOG + 2)
            require(raw and raw[:1] in (b'P', b'M', b'U'), 'DB_DIAGNOSTIC_LOG_READ_INVALID')
            if raw[:1] == b'P':
                raw_logs[key] = raw[1:]
                log_states[key] = {'status': 'READ', 'truncated': len(raw[1:]) > MAX_LOG}
            else:
                require(len(raw) == 1, 'DB_DIAGNOSTIC_LOG_READ_INVALID')
                log_states[key] = {'status': 'MISSING' if raw == b'M' else 'UNSAFE_PATH_REFUSED'}
        inspect_helper(runner, cid, spec, running=True)
        sanitized = app_db_log_sanitize.collect_logs(raw_logs)
    finally:
        if cid is not None and ID.fullmatch(cid):
            try:
                inspect_helper(runner, cid, spec)
                runner(['container', 'rm', '--force', cid], timeout=30, limit=4096)
            except Exception:
                raise app_cli.Stop('DB_DIAGNOSTIC_HELPER_CLEANUP_UNCONFIRMED') from None
    volume_available(runner, launch)
    return {'format': 2, 'status': ('DB_DIAGNOSTIC_COMPLETE' if launch['failed_stage'] == 'DATABASE'
                                   else 'SERVICES_DIAGNOSTIC_COMPLETE'),
            'failed_stage': launch['failed_stage'], 'failed_service': launch['failed_service'],
            'scope': 'RETAINED_FAILED_CLONE_LOGS_ONLY', 'run_id': launch['run_id'],
            'volume': launch['volume'], 'baseline_volume': successful['volume'],
            'source_manifest_sha256': successful['source_manifest_sha256'],
            'failed_clone_mount': 'READ_ONLY', 'database_started': False,
            'baseline_mounted': False, 'new_volume_created': False, 'backup_modified': False,
            'image_pulled': False, 'cleanup': 'OWN_HELPER_REMOVED_VOLUME_RETAINED',
            'disaster_recovery_ready': False, 'log_states': log_states, 'diagnostics': sanitized}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Read retained failed-clone database logs')
    parser.add_argument('--package-dir', required=True)
    parser.add_argument('--bundle')
    parser.add_argument('--report')
    args = parser.parse_args(argv)
    try:
        work = Path(args.package_dir).resolve(strict=True)
        require(work.is_dir(), 'DB_DIAGNOSTIC_WORK_DIRECTORY_INVALID')
        successful = app_cli.read_report(Path(args.report) if args.report else work / 'restore-report.json')
        bundle = app_cli.select_bundle(args.bundle, successful, work)
        require(work != bundle and bundle not in work.parents, 'DIAGNOSTIC_OUTPUT_INSIDE_BACKUP')
        launch = select_failure(work, successful)
        context = load_metadata(bundle, successful)
        result = collect(context, successful, launch, drill.DockerRunner())
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        prefix = 'BOS-DB-Diagnostic-' if launch['failed_stage'] == 'DATABASE' else 'BOS-Services-Diagnostic-'
        output = work / (prefix + stamp + '-' + uuid.uuid4().hex[:8] + '.json')
        app_cli.write_report(output, result)
        print(json.dumps({'status': result['status'], 'report': str(output),
                          'disaster_recovery_ready': False}))
        return 0
    except Exception as error:
        print(json.dumps({'status': 'DB_DIAGNOSTIC_STOPPED', 'reason': app_cli.safe_code(error)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
