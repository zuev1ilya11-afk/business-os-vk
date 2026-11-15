"""Offline restore drill on a local Docker daemon; never contact production.

The source bundle is read only. The only writable container mount is a freshly
created, uniquely labelled volume. No application/integration process is started.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import uuid

import drill_db
import drill_errors
import drill_files
import drill_roles

MIB = 1024 * 1024
LABEL = 'io.business-os.restore-drill'
IMAGE_ID = re.compile(r'sha256:[0-9a-f]{64}')
FILE_SCRIPT = ('set -eu; umask 077; test ! -e /bos/files; test ! -e /bos/files-ready; '
               'mkdir -m 700 /bos/files; tar -xf /bos/input/files.tar -C /bos/files -o; '
               'chmod -R u+rwX,go-rwx /bos/files; '
               'find /bos/files -type d -exec chmod 700 {} +; '
               'find /bos/files -type f -exec chmod 600 {} +; '
               ': > /bos/files-ready; exec sleep 1200')


class Stop(Exception):
    def __init__(self, reason_code):
        self.reason_code = reason_code
        super().__init__(reason_code)


def require(condition, code):
    if not condition:
        raise Stop(code)


class DockerRunner:
    """Pin a local endpoint; bounded private stdout/stderr, also on Windows."""
    def __init__(self, host=None):
        self.binary = shutil.which('docker')
        require(self.binary is not None, 'DOCKER_UNAVAILABLE')
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith('DOCKER_') and not k.startswith('PG')}
        self.host = None
        if host is None:
            context = self(['context', 'show']).decode().strip()
            require(re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', context), 'DOCKER_CONTEXT_INVALID')
            details = json.loads(self(['context', 'inspect', context]))
            require(len(details) == 1, 'DOCKER_CONTEXT_INVALID')
            host = details[0]['Endpoints']['docker']['Host']
        if os.name == 'nt':
            require(host in ('npipe:////./pipe/docker_engine',
                             'npipe:////./pipe/dockerDesktopLinuxEngine'),
                    'LOCAL_DOCKER_REQUIRED')
        else:
            require(isinstance(host, str) and host.startswith('unix:///')
                    and '..' not in Path(host[7:]).parts, 'LOCAL_DOCKER_REQUIRED')
        self.host = host

    def _command(self, args):
        return [self.binary, *(['--host=' + self.host] if self.host else []), *args]

    def __call__(self, args, *, timeout=30, input_path=None, limit=16 * MIB):
        self.last_error = b''
        stdout, stderr, overflow = bytearray(), bytearray(), threading.Event()
        def read(stream, output, maximum):
            try:
                for block in iter(lambda: stream.read(65536), b''):
                    if len(output) + len(block) > maximum:
                        overflow.set()
                        break
                    output.extend(block)
            finally:
                stream.close()
        with (open(input_path, 'rb') if input_path else open(os.devnull, 'rb')) as source:
            process = subprocess.Popen(self._command(args), stdin=source,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       env=self.env)
            threads = [threading.Thread(target=read, args=(process.stdout, stdout, limit), daemon=True),
                       threading.Thread(target=read, args=(process.stderr, stderr, MIB), daemon=True)]
            for thread in threads:
                thread.start()
            deadline = time.monotonic() + timeout
            try:
                while process.poll() is None:
                    require(not overflow.is_set(), 'DOCKER_OUTPUT_LIMIT')
                    require(time.monotonic() < deadline, 'DOCKER_COMMAND_TIMEOUT')
                    time.sleep(0.05)
                for thread in threads:
                    thread.join(timeout=5)
                require(not any(thread.is_alive() for thread in threads), 'DOCKER_OUTPUT_TIMEOUT')
                require(not overflow.is_set(), 'DOCKER_OUTPUT_LIMIT')
                self.last_error = bytes(stderr[:8192])
                require(process.returncode == 0, 'DOCKER_COMMAND_FAILED')
                return bytes(stdout)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
                for thread in threads:
                    thread.join(timeout=5)

    def verify_stream(self, args, inventory, *, timeout=900):
        """Read restored tar directly; never write secret files to host temp."""
        process = subprocess.Popen(self._command(args), stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env)
        errors, overflow = bytearray(), threading.Event()
        def drain():
            for block in iter(lambda: process.stderr.read(65536), b''):
                if len(errors) + len(block) > MIB:
                    overflow.set()
                    process.kill()
                    break
                errors.extend(block)
        thread = threading.Thread(target=drain, daemon=True)
        thread.start()
        timer = threading.Timer(timeout, process.kill)
        timer.start()
        try:
            result = drill_files.verify_reexport(process.stdout, inventory)
            process.stdout.close()
            code = process.wait(timeout=10)
            thread.join(timeout=5)
            require(code == 0 and not errors and not overflow.is_set(), 'FILES_EXPORT_FAILED')
            return result
        finally:
            timer.cancel()
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            process.stdout.close()
            thread.join(timeout=5)
            process.stderr.close()


def local_preflight(runner, context):
    info = json.loads(runner(['info', '--format', '{{json .}}']))
    require(info.get('OSType') == 'linux' and info.get('Architecture') in ('x86_64', 'amd64'),
            'LINUX_AMD64_ENGINE_REQUIRED')
    require(isinstance(info.get('ID'), str) and info['ID'], 'DAEMON_ID_UNAVAILABLE')
    require(info.get('MemTotal', 0) >= 2 * 1024 * MIB, 'DOCKER_MEMORY_TOO_SMALL')
    ids = runner(['container', 'ls', '--all', '--quiet', '--no-trunc']).decode().split()
    require(len(ids) <= 512, 'LOCAL_CONTAINER_COUNT_LIMIT')
    saved = {c['Id'] for c in context['private']['containers']}
    if ids:
        containers = json.loads(runner(['container', 'inspect', *ids]))
        for item in containers:
            name = item.get('Name', '').lstrip('/')
            require(item.get('Id') not in saved and name != 'business-os-db'
                    and not name.startswith('bos-release-'), 'PRODUCTION_DAEMON_REFUSED')
    return info['ID']


def tagless_archive(path):
    """Avoid changing any existing local image tag during docker load."""
    listing_seen = False
    with tarfile.open(path, 'r|') as archive:
        for member in archive:
            if member.name not in ('manifest.json', 'index.json'):
                continue
            require(member.isfile() and member.size <= 16 * MIB, 'IMAGE_MANIFEST_INVALID')
            value = json.loads(archive.extractfile(member).read())
            if member.name == 'manifest.json':
                listing_seen = True
                require(isinstance(value, list) and value, 'IMAGE_MANIFEST_INVALID')
                require(all(not item.get('RepoTags') for item in value), 'TAGGED_IMAGE_ARCHIVE_REFUSED')
            else:
                for descriptor in value.get('manifests', []):
                    annotations = descriptor.get('annotations') or {}
                    for key in ('io.containerd.image.name', 'org.opencontainers.image.ref.name'):
                        reference = annotations.get(key)
                        require(not reference or IMAGE_ID.fullmatch(reference),
                                'TAGGED_IMAGE_ARCHIVE_REFUSED')
    require(listing_seen, 'IMAGE_MANIFEST_INVALID')


def load_images(runner, context):
    tagless_archive(context['bundle'] / 'images.tar')
    runner(['image', 'load', '--input', str(context['bundle'] / 'images.tar')], timeout=1800)
    ids = [i['Id'] for i in context['private']['images']]
    # Cross-store identity conversion is not guessed. The exact captured images
    # must resolve after load before any image process is started.
    images = json.loads(runner(['image', 'inspect', *ids]))
    by_id = {image['Id']: image for image in images}
    require(set(by_id) == set(ids), 'LOADED_IMAGE_ID_CHANGED')
    for expected in context['private']['images']:
        actual = by_id[expected['Id']]
        require(all(actual.get(key) == expected.get(key)
                    for key in ('Os', 'Architecture', 'Variant', 'RootFS', 'Config')),
                'LOADED_IMAGE_METADATA_MISMATCH')


def volume_create(runner, run_id):
    name = run_id + '-data'
    # A query before creation prevents accidentally reusing even our own volume.
    names = runner(['volume', 'ls', '--quiet']).decode().split()
    require(name not in names, 'VOLUME_ALREADY_EXISTS')
    actual = runner(['volume', 'create', '--driver', 'local', '--label', LABEL + '=' + run_id,
                     name]).decode().strip()
    require(actual == name, 'VOLUME_CREATE_MISMATCH')
    item = json.loads(runner(['volume', 'inspect', name]))[0]
    require(item.get('Name') == name and item.get('Driver') == 'local'
            and not item.get('Options') and item.get('Labels', {}).get(LABEL) == run_id,
            'VOLUME_ISOLATION_FAILED')
    return name


def helper_isolated(runner, identifier, run_id, volume, bundle):
    item = json.loads(runner(['container', 'inspect', identifier]))[0]
    config, host = item['Config'], item['HostConfig']
    require(item['Id'] == identifier and config.get('Labels', {}).get(LABEL) == run_id,
            'HELPER_IDENTITY_CHANGED')
    require(host.get('NetworkMode') == 'none' and host.get('ReadonlyRootfs')
            and not host.get('Privileged') and not host.get('PortBindings')
            and not host.get('PublishAllPorts')
            and not host.get('Devices') and not host.get('VolumesFrom')
            and not host.get('DeviceRequests')
            and not host.get('PidMode') and not host.get('IpcMode') == 'host'
            and host.get('UTSMode', '') in ('', 'private')
            and host.get('RestartPolicy', {}).get('Name') in ('no', '')
            and host.get('LogConfig', {}).get('Type') == 'none'
            and drill_db._capabilities(host.get('CapDrop')) == {'ALL'} and not host.get('CapAdd')
            and drill_db._no_new_privileges(host.get('SecurityOpt')),
            'HELPER_ISOLATION_FAILED')
    networks = item.get('NetworkSettings', {}).get('Networks') or {}
    require(set(networks) <= {'none'} and all(not n.get('IPAddress') for n in networks.values()),
            'HELPER_ISOLATION_FAILED')
    require(not any(m.get('Type') == 'tmpfs' and m.get('Destination') not in (host.get('Tmpfs') or {})
                    for m in item['Mounts']), 'HELPER_MOUNTS_CHANGED')
    mounts = {mount['Destination']: mount for mount in item['Mounts'] if mount.get('Type') != 'tmpfs'}
    require(set(mounts) == {'/bos'}, 'HELPER_MOUNTS_CHANGED')
    require(mounts['/bos'].get('Type') == 'volume'
            and mounts['/bos'].get('Name') == volume and mounts['/bos'].get('RW'),
            'HELPER_MOUNTS_CHANGED')
    require(config.get('User') == 'postgres' and config.get('Entrypoint') == ['/bin/sh'],
            'HELPER_COMMAND_CHANGED')
    return item


def restore_files(runner, context, run_id, volume):
    bundle, image = context['bundle'], context['db_image']
    identifier = None
    args = ['container', 'create', '--name', run_id + '-files', '--label', LABEL + '=' + run_id,
            '--network', 'none', '--read-only', '--user', 'postgres', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--restart', 'no', '--no-healthcheck',
            '--log-driver', 'none', '--pids-limit', '64', '--memory', '256m', '--cpus', '1',
            '--mount', f'type=volume,src={volume},dst=/bos,volume-nocopy',
            '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m']
    for path in drill_db._tmpfs(context['db_image_meta']):
        if path != '/tmp':
            args += ['--tmpfs', path + ':rw,noexec,nosuid,nodev,size=1m']
    try:
        identifier = runner([*args, '--entrypoint', '/bin/sh', image, '-c', FILE_SCRIPT]).decode().strip()
        require(re.fullmatch(r'[0-9a-f]{64}', identifier), 'HELPER_ID_INVALID')
        helper_isolated(runner, identifier, run_id, volume, bundle)
        runner(['container', 'start', identifier])
        # The marker is outside the extracted tree and is created only after
        # tar and private copy permissions both succeed.
        deadline = time.monotonic() + 600
        ready = False
        while time.monotonic() < deadline:
            item = helper_isolated(runner, identifier, run_id, volume, bundle)
            require(item.get('State', {}).get('Running'), 'FILES_EXTRACTION_FAILED')
            try:
                command = runner(['exec', identifier, '/bin/sh', '-c',
                                  'if test -f /bos/files-ready; then printf READY; '
                                  'else printf WAIT; fi'])
            except Stop:
                # The helper may exit between inspect and exec. Preserve the
                # extraction failure instead of reporting an opaque exec error.
                item = helper_isolated(runner, identifier, run_id, volume, bundle)
                require(item.get('State', {}).get('Running'), 'FILES_EXTRACTION_FAILED')
                raise
            require(command in (b'WAIT', b'READY'), 'FILES_EXTRACTION_FAILED')
            if command == b'READY':
                ready = True
                break
            time.sleep(0.2)
        require(ready, 'FILES_EXTRACTION_TIMEOUT')
        result = runner.verify_stream(['exec', '--user', 'postgres', identifier,
                                       'tar', '-cf', '-', '-C', '/bos/files', '.'],
                                      context['inventory'])
        helper_isolated(runner, identifier, run_id, volume, bundle)
        return result
    finally:
        if identifier:
            # A pinned id and run label are mandatory even for cleanup.
            helper_isolated(runner, identifier, run_id, volume, bundle)
            runner(['container', 'rm', '--force', identifier])


def write_report(path, report):
    # Exclusive output: no caller-provided or earlier report is overwritten.
    with open(path, 'x', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=True, indent=2)
        stream.write('\n')


def file_mode_preflight(context):
    # BusyBox tar sets directory modes immediately; a non-writable or
    # non-searchable directory prevents creation of its children. Reject this
    # before any Docker mutation. File modes can safely be normalized later in
    # the isolated copy, since tar already holds the created file descriptor.
    with tarfile.open(context['bundle'] / 'files.tar', 'r:') as archive:
        for member in archive:
            require(not member.isdir() or member.mode & 0o700 == 0o700,
                    'FILE_DIRECTORY_MODE_UNSUPPORTED')


def failure_payload(exc, report_path=None):
    code = getattr(exc, 'reason_code', 'RESTORE_DRILL_FAILED')
    if type(code) is not str or not re.fullmatch(r'[A-Z0-9_]{1,80}', code):
        code = 'RESTORE_DRILL_FAILED'
    result = {'status': 'STOPPED', 'reason': code, 'disaster_recovery_ready': False}
    detail = drill_errors.safe_detail(getattr(exc, 'detail', None))
    if detail is not None:
        result['diagnostics'] = detail
    # Only the generated exclusive report path may be advertised, and only
    # after run_drill has actually written it successfully.
    if report_path is not None and getattr(exc, 'report_path', None) == str(report_path):
        result['report'] = str(report_path)
    if getattr(exc, 'report_write_failed', False) is True:
        result['report_status'] = 'WRITE_FAILED'
    return result


def run_drill(bundle, runner, report_path=None):
    started = time.monotonic()
    context = drill_files.validate_bundle(Path(bundle))
    bootstrap = drill_roles.source_bootstrap((context['bundle'] / 'globals.sql').read_bytes())
    run_id = 'bos-drill-' + uuid.uuid4().hex[:12]
    report = {'format': 1, 'run_id': run_id, 'status': 'INCOMPLETE',
              'scope': 'DATABASE_GLOBALS_AND_FILE_BYTES', 'restore': 'NOT_RUN',
              'files': 'NOT_RUN', 'application': 'NOT_RUN',
              'storage_relationships': 'NOT_VERIFIED',
              'storage_extended_attributes': 'NOT_CAPTURED',
              'database_storage_consistency': 'NOT_PROVEN',
              'disaster_recovery_ready': False,
              'source_manifest_sha256': hashlib.sha256((context['bundle'] / 'manifest.json').read_bytes()).hexdigest(),
              'source_capture_started_at': context['manifest']['started_at'],
              'source_capture_finished_at': context['manifest']['finished_at']}
    try:
        file_mode_preflight(context)
        daemon_id = local_preflight(runner, context)
        load_images(runner, context)
        require(local_preflight(runner, context) == daemon_id, 'DOCKER_DAEMON_CHANGED')
        volume = volume_create(runner, run_id)
        report['volume'] = volume
        report['private_error_logs'] = {
            'status': 'MAY_EXIST', 'location': 'RETAINED_DOCKER_VOLUME',
            'paths': ['/bos/globals-restore.stderr.log', '/bos/database-restore.stderr.log']}
        print('RESTORE_STAGE=DATABASE', flush=True)
        required_bytes = context['private']['database']['bytes'] * 3 + context['file_bytes'] * 2 + 512 * MIB
        report['restore'] = drill_db.restore_database(runner, context['db_image'], run_id, volume,
                                                      str(context['bundle']), context['private'],
                                                      required_bytes=required_bytes,
                                                      expected_payloads=context['manifest']['payloads'],
                                                      bootstrap_role=bootstrap['role'],
                                                      bootstrap_create_span=bootstrap['create_span'])
        print('RESTORE_STAGE=FILES', flush=True)
        report['files'] = restore_files(runner, context, run_id, volume)
        drill_files.verify_payloads(context['bundle'], context['manifest'])
        report['status'] = 'DRILL_COMPLETED'
        report['network_isolation'] = 'NONE_NO_PORTS_NO_PRODUCTION_MOUNTS'
        report['elapsed_seconds'] = round(time.monotonic() - started, 2)
        if report_path:
            write_report(report_path, report)
        return report
    except (Exception, KeyboardInterrupt) as exc:
        failure = failure_payload(exc)
        report['reason'] = failure['reason']
        if 'diagnostics' in failure:
            report['diagnostics'] = failure['diagnostics']
        report['elapsed_seconds'] = round(time.monotonic() - started, 2)
        if report_path:
            try:
                write_report(report_path, report)
            except OSError:
                # A report write failure must not hide the restore failure.
                exc.report_write_failed = True
            else:
                exc.report_path = str(report_path)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True, type=Path)
    args = parser.parse_args(argv)
    output = None
    try:
        bundle = args.bundle.absolute()
        require(bundle.is_dir(), 'BUNDLE_DIRECTORY_MISSING')
        require(',' not in str(bundle), 'BUNDLE_PATH_COMMA_UNSUPPORTED')
        output = bundle.parent / ('BOS-Restore-' + uuid.uuid4().hex[:12] + '.json')
        print('RESTORE_STAGE=VERIFYING_COPY', flush=True)
        result = run_drill(bundle, DockerRunner(), output)
        print(json.dumps({'status': result['status'], 'database': result['restore'],
                          'files': result['files'], 'application': 'NOT_RUN',
                          'disaster_recovery_ready': False, 'report': str(output)}, ensure_ascii=True))
        return 0
    except (Exception, KeyboardInterrupt) as exc:
        print(json.dumps(failure_payload(exc, output), ensure_ascii=True))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
