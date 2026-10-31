"""Pinned finance overlay. No schema/data writes; existing RU routes retained."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import sys
import time
from urllib.request import Request, urlopen
import zipfile
import backend
import check
import web
from common import Stop, require, read, sha, item, tree, atomic, sync, run, inspect, fingerprint, safe_relative, emit

APP = '54f9b0b32e675b3305cde9aa36221dd6841f88b7'
BEFORE_BUILD = 'bb0d9be565e2393c447f'
PARENT = Path('/opt/business-os/deploy')
ROOT = PARENT / 'release-to2wblxf'
STAGE = PARENT / 'finance-xlsx-54f9b0b'
EDGE = 'bos-release-to2wblxf-edge'
WEB = 'bos-release-to2wblxf-https'
ORIGIN = 'https://homemaster.qd.je'
SOURCE_PREFIX = 'edge/sources/mini-app-api/'
BUNDLE = 'edge/bundles/mini-app-api.eszip'
ALLOWED = set('web/' + name for name in (*web.EDITED, *web.ADDED, *web.VERSIONS)) | {BUNDLE} | {
    SOURCE_PREFIX + name for name in (*backend.MODEL_FILES, *backend.NEW_HELPERS, backend.API)}


def package(path):
    with zipfile.ZipFile(path) as archive:
        meta = json.loads(archive.read('package.json'))
        require(meta['application'] == APP, 'PACKAGE_APPLICATION')
        values = {name: archive.read('payload/' + name) for name in meta['files']}
    require(all(sha(data) == meta['files'][name] for name, data in values.items()), 'PACKAGE_DIGEST')
    return values


def save(record):
    atomic(STAGE / 'journal.json', json.dumps(record, sort_keys=True).encode())


def host(running=True):
    require(os.geteuid() == 0 and sys.platform == 'linux', 'ROOT_LINUX_REQUIRED')
    require(ROOT.resolve() == ROOT and ROOT.is_dir() and PARENT.resolve() == PARENT, 'RELEASE_PATH_CHANGED')
    edge, front = inspect(EDGE), inspect(WEB)
    if running: require(edge['State']['Running'] and front['State']['Running'], 'PRODUCTION_NOT_RUNNING')
    require(edge['Image'].startswith('sha256:edd22bef4477'), 'RUNTIME_IMAGE_CHANGED')
    require(check.mount(front, '/srv') == ROOT / 'web', 'WEB_MOUNT_CHANGED')
    for part, dest in [('sources', '/bos-src'), ('bundles', '/bos-bundles'), ('main', '/bos-main')]:
        require(check.mount(edge, dest) == ROOT / 'edge' / part, 'EDGE_MOUNT_CHANGED')
    return edge, front


def inventory():
    return {'web': tree(ROOT / 'web'), 'source': tree(ROOT / 'edge/sources/mini-app-api'),
            'main': tree(ROOT / 'edge/main'), 'bundle': item(ROOT / BUNDLE)}


def desired_api(payload):
    source = ROOT / SOURCE_PREFIX
    changes = {backend.API: web.transform(payload['before/' + backend.API], read(source / backend.API), payload['after/' + backend.API])}
    for filename in (*backend.MODEL_FILES, *backend.NEW_HELPERS):
        after = payload['after/' + filename]
        target = source / filename
        if target.exists() or target.is_symlink():
            require(read(target).rstrip() == after.rstrip(), 'SERVER_MODEL_DIFFERS_' + Path(filename).name)
        else: changes[filename] = after
    return changes


def fetch(url):
    with urlopen(Request(url, headers={'Cache-Control': 'no-cache'}), timeout=20) as response:
        require(response.status == 200, 'PUBLIC_HTTP_STATUS')
        raw = response.read(4_000_001)
        require(len(raw) <= 4_000_000, 'PUBLIC_RESPONSE_LIMIT')
        return raw


def verify_public(files, build):
    for key, data in files.items():
        if key.startswith('web/'):
            name = key.removeprefix('web/')
            require(fetch(ORIGIN + '/' + name + '?bos_finance=' + build) == data, 'PUBLIC_ASSET_DIFFERS_' + name)
    if 'web/index.html' in files:
        require(fetch(ORIGIN + '/') == files['web/index.html'], 'PUBLIC_HTML_DIFFERS')


def preflight(payload):
    edge, front = host()
    values, build = web.prepare(ROOT / 'web', payload, BEFORE_BUILD, APP)
    changes = desired_api(payload)
    ids = run(['docker', 'ps', '-q']).decode().split()
    require(not check.schema(edge, json.loads(run(['docker', 'inspect', *ids]))), 'DATABASE_COLUMNS_CHANGED')
    verify_public({'web/' + n: read(ROOT / 'web' / n) for n in web.VERSIONS}, BEFORE_BUILD)
    require(shutil.which('nsenter'), 'NSENTER_REQUIRED')
    memory = next(int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
    require(memory >= 1024 * 1024 and shutil.disk_usage(PARENT).free >= 1024 * 1024 * 1024, 'BUILD_RESOURCES_REQUIRED')
    return edge, front, values, build, changes


def allowed_files(record):
    require(record.get('application') == APP and record.get('root') == str(ROOT), 'JOURNAL_IDENTITY')
    require(set(record.get('files', {})) <= ALLOWED, 'JOURNAL_SCOPE')
    for name in record.get('files', {}): safe_relative(name)
    for name in record.get('created_dirs', []):
        safe_relative(name); require(name.startswith(SOURCE_PREFIX), 'JOURNAL_DIRECTORY_SCOPE')


def guard(record, phase='either'):
    allowed_files(record)
    require(fingerprint(inspect(EDGE)) == record['edge_fingerprint'] and
            fingerprint(inspect(WEB)) == record['web_fingerprint'], 'CONTAINER_CONFIGURATION_CHANGED')
    actual = inventory()
    require(actual['main'] == record['before']['main'], 'GATEWAY_CHANGED')
    scopes = [('web', 'web/'), ('source', SOURCE_PREFIX)]
    for kind, prefix in scopes:
        before, now = record['before'][kind], actual[kind]
        permitted = set(before) | {n.removeprefix(prefix) for n in record['files'] if n.startswith(prefix)}
        require(set(now) <= permitted, 'UNRELATED_FILE_ADDED')
        for relative in permitted:
            key = prefix + relative; old = before.get(relative)
            entry = record['files'].get(key)
            states = [old] if entry is None or phase == 'before' else [entry['after']] if phase == 'after' else [old, entry['after']]
            require(now.get(relative) in states, 'FILE_CHANGED_OUTSIDE_RELEASE_' + Path(relative).name)
    old = record['before']['bundle']; entry = record['files'].get(BUNDLE)
    states = [old] if entry is None or phase == 'before' else [entry['after']] if phase == 'after' else [old, entry['after']]
    require(actual['bundle'] in states, 'BUNDLE_CHANGED_OUTSIDE_RELEASE')


def prepare(payload):
    edge, front, frontend, build, changed = preflight(payload)
    before = inventory()
    STAGE.mkdir(mode=0o700); (STAGE / 'logs').mkdir(mode=0o700)
    record = {'application': APP, 'root': str(ROOT), 'phase': 'preparing', 'before': before,
              'edge_fingerprint': fingerprint(edge), 'web_fingerprint': fingerprint(front), 'image': edge['Image'],
              'build': build, 'files': {}, 'created_dirs': []}
    save(record)
    shutil.copytree(ROOT / 'edge/sources/mini-app-api', STAGE / 'backup-source')
    require(tree(STAGE / 'backup-source') == before['source'], 'SOURCE_BACKUP_DIFFERS')
    atomic(STAGE / 'backup-bundle.eszip', read(ROOT / BUNDLE))
    compiled = backend.compile_api(STAGE, edge['Image'], changed)
    backend.test_runtime(STAGE, edge, ROOT / 'edge/main', payload)
    changes = {**frontend, **{SOURCE_PREFIX + n: data for n, data in changed.items()}, BUNDLE: compiled}
    require(set(changes) <= ALLOWED, 'CANDIDATE_SCOPE')
    for name, data in changes.items():
        before_item = item(ROOT / name)
        metadata = {key: before_item[key] for key in ('mode', 'uid', 'gid')} if before_item else {
            'mode': 0o644, 'uid': 0, 'gid': 0}
        for folder in ('candidate', 'backup'):
            (STAGE / folder / name).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if before_item: atomic(STAGE / 'backup' / name, read(ROOT / name))
        atomic(STAGE / 'candidate' / name, data)
        record['files'][name] = {'before': before_item, 'after': {**metadata, 'sha': sha(data)}}
    require(inventory() == before, 'LIVE_CHANGED_DURING_PREPARATION')
    record['phase'] = 'prepared'; save(record); guard(record, 'before')
    emit('FINANCE_PREPARED', {'before': BEFORE_BUILD, 'after': build, 'database_changes': False})
    return record


def unit_state(unit):
    raw = run(['systemctl', 'show', unit, '-p', 'LoadState', '-p', 'ActiveState'])
    return dict(line.split('=', 1) for line in raw.decode().splitlines() if '=' in line)


def pause_archive(record):
    if not record.get('archive_paused'):
        timer = unit_state('bos-drive-archive.timer')
        record['archive_timer_active'] = timer.get('ActiveState') == 'active'
        record['archive_paused'] = True; save(record)
    if record['archive_timer_active']: run(['systemctl', 'stop', 'bos-drive-archive.timer'], STAGE, 'pause-timer')
    for _ in range(90):
        if unit_state('bos-drive-archive.service').get('ActiveState') not in ('active', 'activating', 'deactivating'): return
        time.sleep(1)
    raise Stop('ARCHIVE_WORKER_BUSY')


def restore_archive(record):
    if record.get('archive_paused'):
        if record.get('archive_timer_active'): run(['systemctl', 'start', 'bos-drive-archive.timer'], STAGE, 'resume-timer')
        record['archive_paused'] = False; save(record)


def restart_edge(record):
    require(fingerprint(inspect(EDGE)) == record['edge_fingerprint'], 'EDGE_CONFIGURATION_CHANGED')
    run(['docker', 'restart', '--time=10', EDGE], STAGE, 'edge-restart', timeout=60)
    # Reapply the existing owned Google route after Docker refreshes its hosts file.
    if Path('/etc/business-os/google-route.json').exists():
        require(unit_state('bos-google-route.service').get('LoadState') == 'loaded', 'GOOGLE_ROUTE_SERVICE_MISSING')
        run(['systemctl', 'start', 'bos-google-route.service'], STAGE, 'google-route', timeout=60)
    ready = False
    deadline = time.monotonic() + 75
    for _ in range(6):
        try:
            info = inspect(EDGE)
            require(info['State']['Running'] and info['State']['Pid'] > 0, 'EDGE_NOT_READY')
            run(['nsenter', '-t', str(info['State']['Pid']), '-n', sys.executable, str(STAGE / 'probe.py'), '--live'],
                STAGE, 'live-probe', timeout=50, data=b'{"base":"http://127.0.0.1:9000"}')
            ready = True; break
        except Stop:
            if time.monotonic() >= deadline: break
            time.sleep(0.5)
    require(ready, 'LIVE_API_CHECK_FAILED')
    run([sys.executable, str(STAGE / 'probe.py'), '--live'], STAGE, 'public-probe', timeout=50,
        data=json.dumps({'base': ORIGIN}).encode())


def candidate(record, name):
    data = read(STAGE / 'candidate' / name)
    require(sha(data) == record['files'][name]['after']['sha'], 'CANDIDATE_CHANGED')
    return data


def make_parents(record, path):
    missing = []; parent = path.parent
    while not parent.exists(): missing.append(parent); parent = parent.parent
    require(parent.resolve() == parent and parent.is_relative_to(ROOT), 'PARENT_PATH_CHANGED')
    for directory in reversed(missing):
        relative = directory.relative_to(ROOT).as_posix()
        require(relative.startswith(SOURCE_PREFIX), 'NEW_DIRECTORY_SCOPE')
        if relative not in record['created_dirs']: record['created_dirs'].append(relative); save(record)
        directory.mkdir(mode=0o755); sync(directory.parent)


def restore(record):
    guard(record)
    for name, entry in record['files'].items():
        if entry['before']:
            require(sha(read(STAGE / 'backup' / name)) == entry['before']['sha'], 'BACKUP_CHANGED')
    # Manual rollback must quiesce the same worker as activation. An automatic
    # rollback retains the original timer state recorded before activation.
    if record.get('backend_activation_started'): pause_archive(record)
    record['phase'] = 'rolling_back'; save(record)
    for name, entry in reversed(list(record['files'].items())):
        target = ROOT / name
        if entry['before']: atomic(target, read(STAGE / 'backup' / name), entry['before'])
        elif target.exists(): target.unlink(); sync(target.parent)
    for name in sorted(record['created_dirs'], key=len, reverse=True):
        directory = ROOT / safe_relative(name)
        if directory.exists(): directory.rmdir(); sync(directory.parent)
    guard(record, 'before')
    if record.get('backend_activation_started'): restart_edge(record)
    restore_archive(record)
    verify_public({'web/' + n: read(ROOT / 'web' / n) for n in web.VERSIONS}, BEFORE_BUILD)
    record['phase'] = 'rolled_back'; save(record); emit('FINANCE_ROLLED_BACK', BEFORE_BUILD)


def activate(record):
    require(record['phase'] == 'prepared', 'RELEASE_NOT_PREPARED')
    guard(record, 'before')
    for name in record['files']: candidate(record, name)
    record['phase'] = 'activating'; save(record)
    try:
        pause_archive(record)
        record['backend_activation_started'] = True; save(record)
        for name, entry in record['files'].items():
            if name.startswith('web/'): continue
            require(item(ROOT / name) == entry['before'], 'CONCURRENT_API_CHANGE')
            make_parents(record, ROOT / name)
            atomic(ROOT / name, candidate(record, name), entry['after'])
        restart_edge(record)
        names = [n for n in record['files'] if n.startswith('web/') and n.removeprefix('web/') not in web.VERSIONS]
        names = sorted(names, key=lambda n: n.removeprefix('web/') not in web.ADDED) + ['web/' + n for n in web.VERSIONS]
        for name in names:
            entry = record['files'][name]
            require(item(ROOT / name) == entry['before'], 'CONCURRENT_WEB_CHANGE')
            atomic(ROOT / name, candidate(record, name), entry['after'])
        guard(record, 'after'); web.manifest(ROOT / 'web')
        verify_public({n: candidate(record, n) for n in record['files'] if n.startswith('web/')}, record['build'])
        restore_archive(record)
        record['phase'] = 'active'; save(record)
    except BaseException:
        try: restore(record)
        except BaseException: raise Stop('ROLLBACK_INCOMPLETE_RETAIN_BACKUP_AND_RUN_ROLLBACK') from None
        raise
    emit('FINANCE_DEPLOYED', record['build']); emit('BACKUP', str(STAGE)); emit('DATABASE_CHANGED', False)


def main():
    sys.dont_write_bytecode = True; os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    for name in ('check', 'prepare', 'apply', 'rollback'): mode.add_argument('--' + name, action='store_true')
    args = parser.parse_args()
    host(running=not args.rollback); payload = package(sys.argv[0])
    fd = os.open(PARENT, os.O_RDONLY | os.O_DIRECTORY)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        record = None
        if STAGE.exists():
            require(STAGE.resolve() == STAGE and STAGE.stat().st_uid == 0, 'STAGE_UNSAFE')
            record = json.loads(read(STAGE / 'journal.json')); allowed_files(record)
            backend.cleanup(STAGE)
            if args.rollback: restore(record); return
            if record['phase'] == 'active':
                guard(record, 'after'); verify_public({n: candidate(record, n) for n in record['files'] if n.startswith('web/')}, record['build'])
                emit('FINANCE_ALREADY_DEPLOYED', record['build']); return
            require(record['phase'] in ('preparing', 'prepared', 'rolled_back'), 'INTERRUPTED_RELEASE_RUN_ROLLBACK')
            if record['phase'] == 'prepared': guard(record, 'before')
            else:
                preflight(payload)
                if args.check: emit('PREVIOUS_ATTEMPT', record['phase']); return
                archived = STAGE.with_name(STAGE.name + '-history-' + str(time.time_ns()))
                os.rename(STAGE, archived); sync(PARENT); record = None
        require(not args.rollback, 'NO_RELEASE_BACKUP')
        if args.check:
            preflight(payload); emit('FINANCE_CHECK_OK'); return
        if record is None: record = prepare(payload)
        if args.prepare: emit('PRODUCTION_CHANGED', False); return
        activate(record)
    finally: os.close(fd)


if __name__ == '__main__':
    def interrupted(signum, frame): raise Stop('INTERRUPTED')
    signal.signal(signal.SIGTERM, interrupted)
    try: main()
    except BaseException as error:
        emit('FINANCE_STOPPED', str(error) if isinstance(error, Stop) else type(error).__name__)
        raise SystemExit(1)
