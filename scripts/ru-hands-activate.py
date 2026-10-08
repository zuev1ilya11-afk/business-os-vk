#!/usr/bin/env python3
"""Guarded RU Hands activation. No imports, DB writes or provider changes.

Run as root on the RU host. No arguments selects the only prepared stage.
An interrupted run is rolled back on the next invocation, never resumed blindly.
All original sources, Docker metadata and command logs remain private on the host.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = pathlib.Path('/opt/business-os/deploy')
PUBLIC = 'https://139.100.237.167'
STAGE_PIN = '1d98b733bfa8dcec2890b8f598a9499c255a3594'
STAGE_SHA = 'b45ccf6eb4815c5b0545f63a3175885cb4545ca54b7c447f62ad38d2310461b9'
# Hashes of the freshly reviewed private v11 export, with one appended LF.
# Publishing hashes does not publish private source/configuration.
SOURCE_REVIEWED = 'c802d0d9cffbeddebf9b6a149b838edf2a82c71808f5b71d54ecbf86e2a5b3c1'
DETAILS_REVIEWED = 'eeda8dcca8aaea420bcc0b58c30ed82aea3bb9105ceeca79bc1367fe437c8d7f'


class Stop(Exception):
    pass


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(path):
    path = pathlib.Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise Stop('absolute canonical path required')
    for part in (path, *path.parents):
        if part.is_symlink():
            raise Stop('symbolic links are not allowed')
    if path.exists() and not (path.is_file() or path.is_dir()):
        raise Stop('special files are not allowed')
    return path


def read(path, limit=64 * 1024 * 1024):
    path = safe_path(path)
    if not path.is_file() or path.stat().st_size > limit:
        raise Stop('required private file missing or too large')
    return path.read_bytes()


def digest(path):
    path = safe_path(path)
    return sha(read(path)) if path.exists() else None


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_replace(path, data, metadata):
    path = safe_path(path)
    fd, temporary = tempfile.mkstemp(prefix='.hands-swap-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fchown(stream.fileno(), metadata['uid'], metadata['gid'])
            os.fchmod(stream.fileno(), metadata['mode'])
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        fsync_dir(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_json(path, obj):
    atomic_replace(path, (json.dumps(obj, indent=2) + '\n').encode(),
                   {'uid': os.geteuid(), 'gid': os.getegid(), 'mode': 0o600})


def file_item(target, new, backup, *, reference=None):
    target, new = safe_path(target), safe_path(new)
    before = digest(target)
    if (backup is None) != (before is None) or (backup is not None and digest(backup) != before):
        raise Stop('original backup does not match target')
    info = safe_path(reference or target).stat()
    if info.st_nlink != 1 or stat.S_IMODE(info.st_mode) & 0o7000:
        raise Stop('unexpected target link count or special permission bits')
    return {'target': str(target), 'new': str(new), 'backup': str(backup) if backup else None,
            'before': before, 'after': digest(new),
            'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}


def validate_items(items, states):
    for item in items:
        if digest(item['new']) != item['after'] or item['after'] is None:
            raise Stop('prepared file changed')
        if item['backup'] and digest(item['backup']) != item['before']:
            raise Stop('original backup changed')
        if digest(item['target']) not in {item[state] for state in states}:
            raise Stop('target changed outside this activation; refusing overwrite')


def rollback(stage, journal, restart_check):
    items = journal['items']
    try:
        validate_items(items, ('before', 'after'))
        journal['state'] = 'rolling_back'
        write_json(stage / 'activation.json', journal)
        # Bundle first; delete the helper last, after source has been restored.
        for item in reversed(items):
            validate_items([item], ('before', 'after'))
            target = pathlib.Path(item['target'])
            if digest(target) == item['before']:
                continue
            if item['backup']:
                atomic_replace(target, read(item['backup']), item)
            else:
                target.unlink()
                fsync_dir(target.parent)
        validate_items(items, ('before',))
        restart_check()
        journal['state'] = 'rolled_back'
        write_json(stage / 'activation.json', journal)
    except BaseException:
        journal['state'] = 'rollback_failed'
        write_json(stage / 'activation.json', journal)
        raise Stop('ROLLBACK_REQUIRES_ATTENTION; originals and journal retained privately') from None


def recover(stage, restart_check):
    journal = json.loads(read(stage / 'activation.json'))
    rollback(stage, journal, restart_check)


def install(stage, items, verify, restart_old):
    validate_items(items, ('before',))
    # Backups and new content must be durable before the first live rename.
    for item in items:
        for filename in (item['new'], item['backup']):
            if filename:
                with open(filename, 'rb') as stream:
                    os.fsync(stream.fileno())
                fsync_dir(pathlib.Path(filename).parent)
    journal = {'state': 'installing', 'items': items}
    write_json(stage / 'activation.json', journal)
    try:
        for item in items:
            validate_items([item], ('before',))
            atomic_replace(pathlib.Path(item['target']), read(item['new']), item)
        journal['state'] = 'verifying'
        write_json(stage / 'activation.json', journal)
        verify()
        validate_items(items, ('after',))
        journal['state'] = 'activated'
        write_json(stage / 'activation.json', journal)
    except BaseException:
        rollback(stage, journal, restart_old)
        raise Stop('ACTIVATION_ROLLED_BACK; previous files and API restored') from None


def identity(container):
    # Runtime state/PIDs/IP leases can change on restart; immutable config cannot.
    result = {key: container.get(key) for key in ('Id', 'Image', 'Name', 'Config', 'HostConfig')}
    result['Mounts'] = sorted(container.get('Mounts', []), key=lambda item: item['Destination'])
    return result


def validate_journal(stage, manifest, journal):
    source = pathlib.Path(manifest['source'])
    expected = [
        (source.with_name('hands-sync.ts'), stage / 'sources/hands-api/hands-sync.ts', None,
         None, manifest['helper_after']),
        (source, stage / 'sources/hands-api/index.ts', stage / 'backup/index.ts',
         manifest['source_before'], manifest['source_after']),
        (pathlib.Path(manifest['bundle']), stage / 'bundles/hands-api.eszip', stage / 'backup/hands-api.eszip',
         manifest['bundle_before'], manifest['bundle_after']),
    ]
    items = journal.get('items', [])
    if len(items) != 3:
        raise Stop('recovery journal file list differs from manifest')
    for item, (target, new, backup, before, after) in zip(items, expected):
        actual = (item.get('target'), item.get('new'), item.get('backup'), item.get('before'), item.get('after'))
        if actual != (str(target), str(new), str(backup) if backup else None, before, after):
            raise Stop('recovery journal paths/checksums differ from manifest')
        if any(type(item.get(k)) is not int or item[k] < 0 for k in ('uid', 'gid', 'mode')) or item['mode'] > 0o777:
            raise Stop('recovery journal permissions invalid')


def validate_manifest_target(manifest, saved):
    roots = []
    for destination, key, suffix in (('/bos-src', 'source', 'hands-api/index.ts'),
                                      ('/bos-bundles', 'bundle', 'hands-api.eszip')):
        mounts = [x for x in saved['Mounts'] if x['Destination'] == destination and x['Type'] == 'bind']
        if len(mounts) != 1:
            raise Stop('original release mounts missing or ambiguous')
        root = safe_path(pathlib.Path(mounts[0]['Source']))
        if not root.is_relative_to(BASE) or str(root / suffix) != manifest.get(key):
            raise Stop('manifest file path disagrees with original release mount')
        roots.append(root.parent)
    if roots[0] != roots[1] or saved['Id'] != manifest.get('edge_id') or saved['Image'] != manifest.get('image'):
        raise Stop('manifest release identity mismatch')


def choose_stage(base):
    stages = []
    for folder in sorted(base.glob('hands-stage-*')):
        if (folder / 'manifest.json').is_file():
            manifest = json.loads(read(folder / 'manifest.json'))
            if manifest.get('prepared') is True:
                stages.append(folder)
    if len(stages) != 1:
        raise Stop('prepared stage missing or ambiguous; pass its exact absolute path')
    return stages[0]


def command(args, stage, label, timeout=30):
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise Stop(label + ': unavailable or timed out') from None
    (stage / (label + '.log')).write_bytes(result.stdout + b'\n' + result.stderr)
    if result.returncode:
        raise Stop(label + ': failed; details retained privately')
    return result.stdout


def inspect(edge_id, stage):
    return json.loads(command(['docker', 'inspect', edge_id], stage, 'activation-inspect'))[0]


def get_helpers(stage):
    path = stage / 'activation-stage-helper.py'
    if not path.exists():
        url = ('https://raw.githubusercontent.com/zuev1ilya11-afk/business-os-vk/'
               + STAGE_PIN + '/scripts/ru-hands-stage.py')
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                data = response.read(100000)
        except Exception:
            raise Stop('cannot download pinned activation helper') from None
        if sha(data) != STAGE_SHA:
            raise Stop('activation helper download checksum mismatch')
        atomic_replace(path, data, {'uid': 0, 'gid': 0, 'mode': 0o600})
    if digest(path) != STAGE_SHA:
        raise Stop('activation helper checksum mismatch')
    spec = importlib.util.spec_from_file_location('activation_stage', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def tree_hashes(root):
    result = {}
    for path in safe_path(root).rglob('*'):
        safe_path(path)
        if path.is_file():
            result[str(path.relative_to(root))] = digest(path)
    return result


def validate_payload(stage, manifest, helper, edge):
    if (manifest.get('prepared') is not True or manifest.get('activated') is not False
            or manifest.get('isolated_webhook_validation') is not True
            or manifest.get('patch_commit') != helper.PIN):
        raise Stop('unrecognized or unvalidated prepared manifest')
    src = helper.mount_path(edge, '/bos-src')
    bundles = helper.mount_path(edge, '/bos-bundles')
    main = helper.mount_path(edge, '/bos-main')
    source, bundle = src / 'hands-api/index.ts', bundles / 'hands-api.eszip'
    if (len({src.parent, bundles.parent, main.parent}) != 1
            or str(source) != manifest.get('source') or str(bundle) != manifest.get('bundle')
            or edge['Id'] != manifest.get('edge_id') or edge['Image'] != manifest.get('image')):
        raise Stop('release paths, container or image changed')
    mapping = {
        'source_before': stage / 'backup/index.ts', 'bundle_before': stage / 'backup/hands-api.eszip',
        'source_after': stage / 'sources/hands-api/index.ts',
        'bundle_after': stage / 'bundles/hands-api.eszip',
        'helper_after': stage / 'sources/hands-api/hands-sync.ts',
    }
    for key, path in mapping.items():
        if digest(path) != manifest.get(key):
            raise Stop('prepared content or backup checksum mismatch: ' + key)
    if digest(stage / 'output/hands-api.eszip') != manifest['bundle_after']:
        raise Stop('compiler output no longer matches tested bundle')
    original = read(mapping['source_before'])
    if (sha(original + b'\n') != SOURCE_REVIEWED or
            sha(read(stage / 'sources/hands-api/hands-details.ts') + b'\n') != DETAILS_REVIEWED):
        raise Stop('private handler/dependency differs from reviewed v11 export')
    expected = helper.download('tests/fixtures/hands-v11-sync.ts').rstrip(b'\n')
    if read(mapping['source_after']) != helper.patch_source(original, expected):
        raise Stop('staged source is not the exact reviewed minimal patch')
    if manifest['helper_after'] != helper.ASSETS['supabase/functions/_shared/hands-sync.ts']:
        raise Stop('unreviewed sync helper')
    # Whole-tree equality prevents an unnoticed local dependency/gateway update.
    for root, copied, exceptions in (
        (src, stage / 'sources', {'hands-api/index.ts', 'hands-api/hands-sync.ts'}),
        (bundles, stage / 'bundles', {'hands-api.eszip'}), (main, stage / 'main', set()),
    ):
        left, right = tree_hashes(root), tree_hashes(copied)
        if {k: v for k, v in left.items() if k not in exceptions} != {
                k: v for k, v in right.items() if k not in exceptions}:
            raise Stop('release dependency/gateway tree changed since preparation')
    if digest(source) != manifest['source_before'] or digest(bundle) != manifest['bundle_before']:
        raise Stop('production source or bundle changed since preparation')
    helper_target = source.with_name('hands-sync.ts')
    if helper_target.exists():
        raise Stop('production helper already exists')
    return [file_item(helper_target, mapping['helper_after'], None, reference=source),
            file_item(source, mapping['source_after'], mapping['source_before']),
            file_item(bundle, mapping['bundle_after'], mapping['bundle_before'])]


def dependency_proof(stage, manifest, helper):
    """Fail closed unless both builds reproduce using one resolver cache.

    A baseline mismatch is inconclusive, not an assertion of dependency drift.
    No custom ESZIP parser or incomplete managed-NPM unbundle comparison.
    """
    helper.require_memory(pathlib.Path('/proc/meminfo').read_text())
    work = pathlib.Path(tempfile.mkdtemp(prefix='dependency-proof-', dir=stage))
    shutil.copytree(stage / 'sources', work / 'sources')
    source = work / 'sources/hands-api/index.ts'
    source.write_bytes(read(stage / 'backup/index.ts'))
    source.with_name('hands-sync.ts').unlink()
    output = work / 'output'
    output.mkdir()
    name = 'bos-hands-proof-' + uuid.uuid4().hex
    cid = None
    try:
        cid = command(['docker', 'run', '-d', '--pull=never', '--network', 'bridge',
                       '--name', name, *helper.RESOURCE_LIMITS, '--entrypoint', '/bin/sh',
                       '--mount', 'type=bind,src=' + str(work / 'sources') + ',dst=/bos-src,readonly',
                       '--mount', 'type=bind,src=' + str(output) + ',dst=/bos-output',
                       manifest['image'], '-c', 'while :; do sleep 1; done'],
                      stage, 'dependency-container').decode().strip()
        build = ['docker', 'exec', cid, 'edge-runtime', 'bundle', '--entrypoint',
                 '/bos-src/hands-api/index.ts', '--output', '/bos-output/hands-api.eszip',
                 '--quiet', '--timeout', '90']
        command(build, stage, 'dependency-baseline-build', timeout=120)
        if digest(output / 'hands-api.eszip') != manifest['bundle_before']:
            raise Stop('DEPENDENCY_PROOF_UNKNOWN: baseline build differs; production unchanged')
        command(['docker', 'network', 'disconnect', 'bridge', cid], stage, 'dependency-disconnect')
        info = inspect(cid, stage)
        if info['NetworkSettings']['Networks'] or not info['State']['Running']:
            raise Stop('dependency container network isolation failed')
        interfaces = command(['nsenter', '-t', str(info['State']['Pid']), '-n', sys.executable,
                              '-c', 'import socket,json; print(json.dumps([n for _,n in socket.if_nameindex()]))'],
                             stage, 'dependency-interfaces')
        if json.loads(interfaces) != ['lo']:
            raise Stop('dependency container still has an external interface')
        source.write_bytes(read(stage / 'sources/hands-api/index.ts'))
        source.with_name('hands-sync.ts').write_bytes(read(stage / 'sources/hands-api/hands-sync.ts'))
        (output / 'hands-api.eszip').unlink()
        command(build, stage, 'dependency-patched-build', timeout=120)
        if digest(output / 'hands-api.eszip') != manifest['bundle_after']:
            raise Stop('DEPENDENCY_PROOF_UNKNOWN: offline patch differs from tested artifact; production unchanged')
        print('DEPENDENCY_PROOF_OK', flush=True)
    finally:
        # Cleanup by unpredictable name also covers a timeout before the ID arrived.
        try:
            command(['docker', 'rm', '-f', cid or name], stage, 'dependency-cleanup')
        except Stop:
            print('DEPENDENCY_CONTAINER_CLEANUP_REQUIRED', flush=True)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def public_check(token=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    requests = [('/', None, 200, None), ('/functions/v1/hands-api', None, 405, 'METHOD_NOT_ALLOWED')]
    if token is not None:
        requests.append(('/functions/v1/hands-api?' + urllib.parse.urlencode({'token': token}),
                         b'{}', 400, 'MISSING_DELIVERY'))
    for path, data, status, error in requests:
        request = urllib.request.Request(PUBLIC + path, data=data,
                                         headers={'Content-Type': 'application/json'})
        try:
            try:
                response = opener.open(request, timeout=8)
            except urllib.error.HTTPError as failure:
                response = failure
            with response:
                body = response.read(16384)
                if response.status != status:
                    raise ValueError()
                if error and json.loads(body).get('error') != error:
                    raise ValueError()
        except Exception:
            # urllib errors contain URLs, which may contain the private token.
            raise Stop('public HTTPS/route verification failed') from None


def restart_and_check(stage, saved, token=None):
    if identity(inspect(saved['Id'], stage)) != identity(saved):
        raise Stop('edge identity/configuration changed before restart')
    ids = command(['docker', 'ps', '-q'], stage, 'restart-active-list').decode().split()
    running = json.loads(command(['docker', 'inspect', *ids], stage, 'restart-active-metadata')) if ids else []
    if any(x['Name'].startswith('/bos-release-') and x['Name'].endswith('-edge') and x['Id'] != saved['Id']
           for x in running):
        raise Stop('another release is active; refusing to restart the superseded edge')
    command(['docker', 'restart', '--time', '10', saved['Id']], stage, 'activation-restart', timeout=40)
    for attempt in range(8):
        info = inspect(saved['Id'], stage)
        if identity(info) != identity(saved):
            raise Stop('edge configuration changed during restart')
        if info['State']['Running']:
            try:
                public_check(token)
                return
            except Stop:
                pass
        time.sleep(1)
    raise Stop('restarted API failed verification')


def client_target_ok(edge, origin, helper):
    try:
        url = urllib.parse.urlsplit(origin)
        if (any(c.isspace() for c in origin) or url.username is not None or url.password is not None
                or url.path not in ('', '/') or url.query or url.fragment):
            return False
        if origin.rstrip('/') == PUBLIC:
            return True
        if url.scheme != 'http' or url.port != 9000:
            return False
        return (url.hostname in ('127.0.0.1', 'localhost') or
                helper.route_matches(edge, edge, origin))
    except (TypeError, ValueError):
        return False


def validate_environment(stage, helper, saved, manifest):
    ids = command(['docker', 'ps', '-q'], stage, 'activation-containers').decode().split()
    if not ids:
        raise Stop('no active release containers')
    containers = json.loads(command(['docker', 'inspect', *ids], stage, 'activation-containers-metadata'))
    edges = [x for x in containers if x['Name'].startswith('/bos-release-') and x['Name'].endswith('-edge')]
    if len(edges) != 1 or identity(edges[0]) != identity(saved):
        raise Stop('active edge identity or configuration changed')
    edge = edges[0]
    diag_path = stage / 'ru-check.py'
    if digest(diag_path) != helper.ASSETS['scripts/ru-check.py']:
        raise Stop('read-only routing helper checksum mismatch')
    spec = importlib.util.spec_from_file_location('activation_diag', diag_path)
    diag = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(diag)
    gateway = helper.mount_path(edge, '/bos-main')
    checks = helper.production_preflight(diag, edge, containers,
                                        '\n'.join(p.read_text() for p in gateway.rglob('*.ts')))
    if (checks['gateway_env_missing_or_empty'] or not all(checks['route_hosts_match_release'].values())
            or checks['database_container_matches_release'] is not True):
        raise Stop('release service routing preflight failed')
    # createClient must target this release gateway, never the old Supabase project.
    env = diag.env(edge)
    if (not client_target_ok(edge, env.get('SUPABASE_URL', ''), helper)
            or not env.get('SUPABASE_SERVICE_ROLE_KEY')):
        raise Stop('Supabase client target is not the reviewed RU gateway')
    if edge['Id'] != manifest['edge_id'] or edge['Image'] != manifest['image']:
        raise Stop('manifest container/image mismatch')
    return edge


def main():
    if os.geteuid() != 0 or len(sys.argv) > 2 or not BASE.is_dir():
        raise Stop('run as root on the RU host, optionally with one prepared-stage path')
    os.umask(0o077)
    sys.dont_write_bytecode = True
    lock_path = safe_path(BASE / '.hands-activation.lock')
    with open(lock_path, 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Stop('another Hands activation is running') from None
        stage = safe_path(pathlib.Path(sys.argv[1]) if len(sys.argv) == 2 else choose_stage(BASE))
        if stage.parent != BASE or not stage.name.startswith('hands-stage-'):
            raise Stop('stage must be a direct private deployment subdirectory')
        if stage.stat().st_uid != 0 or stat.S_IMODE(stage.stat().st_mode) != 0o700:
            raise Stop('stage ownership or permissions changed')
        manifest = json.loads(read(stage / 'manifest.json'))
        metadata = json.loads(read(stage / 'container-metadata.log', 8 * 1024 * 1024))
        matches = [x for x in metadata if x['Id'] == manifest.get('edge_id')]
        if len(matches) != 1:
            raise Stop('original edge metadata missing')
        saved = matches[0]
        validate_manifest_target(manifest, saved)
        print('ACTIVATION_STAGE=' + str(stage), flush=True)
        if identity(inspect(saved['Id'], stage)) != identity(saved):
            raise Stop('edge configuration changed; no file replacements attempted')
        journal_path = stage / 'activation.json'
        if journal_path.exists():
            journal = json.loads(read(journal_path))
            validate_journal(stage, manifest, journal)
            if journal.get('state') == 'activated':
                validate_items(journal['items'], ('after',))
                public_check()
                print('BOS_HANDS_ALREADY_ACTIVATED=' + str(stage), flush=True)
                return
            if journal.get('state') != 'rolled_back':
                recover(stage, lambda: restart_and_check(stage, saved))
                print('BOS_HANDS_INTERRUPTED_RUN_ROLLED_BACK; rerun only after reviewing the cause', flush=True)
                return
            raise Stop('previous activation was rolled back; prepare/review before retrying')
        helper = get_helpers(stage)
        edge = validate_environment(stage, helper, saved, manifest)
        items = validate_payload(stage, manifest, helper, edge)
        if shutil.disk_usage(stage).free < 1024 * 1024 * 1024:
            raise Stop('at least 1 GiB free disk space required')
        public_check()  # Read-only baseline before any build or replacement.
        print('ACTIVATION_PREFLIGHT_OK; checking reproducible dependencies', flush=True)
        dependency_proof(stage, manifest, helper)
        # Recheck the full contract after the potentially slow compilation.
        edge = validate_environment(stage, helper, saved, manifest)
        items = validate_payload(stage, manifest, helper, edge)
        token = helper.token_from(read(stage / 'sources/hands-api/index.ts'))
        print('ACTIVATING; a brief API interruption is expected', flush=True)
        install(stage, items, lambda: restart_and_check(stage, saved, token),
                lambda: restart_and_check(stage, saved))
        print('BOS_HANDS_ACTIVATED=' + str(stage), flush=True)
        print('HTTPS and webhook validation passed. No recovery imports or provider changes performed.', flush=True)


if __name__ == '__main__':
    # Catch normal termination during replacement so it enters rollback.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    try:
        main()
    except Stop as error:
        print('ACTIVATION_STOPPED: ' + str(error), flush=True)
        sys.exit(1)
    except BaseException as error:
        print('ACTIVATION_STOPPED: ' + type(error).__name__ + '; inspect saved activation journal', flush=True)
        sys.exit(1)
