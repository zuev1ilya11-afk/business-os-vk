#!/usr/bin/env python3
"""Pinned RU frontend helpers. Only release.py coordinates activation/rollback."""
import argparse
import concurrent.futures
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time
import urllib.request
import urllib.error
import zipfile

PARENT = Path('/opt/business-os/deploy')
STAGE = PARENT / 'lemana-297-web'
MAIN = '1ff029deaaa08d2d0181fea1826f912b47b19280'
MAX_BYTES = 256 * 1024 * 1024

class Stop(Exception):
    pass

def require(ok, message):
    if not ok:
        raise Stop(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def emit(message):
    print(message, flush=True)

def command(args, timeout=60):
    try:
        return subprocess.run(args, check=True, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=timeout).stdout
    except (subprocess.SubprocessError, OSError) as exc:
        # Do not expose Docker environment, credentials, or arbitrary stderr.
        raise Stop('Command failed: ' + ' '.join(str(x) for x in args[:2])) from exc

def package():
    with zipfile.ZipFile(Path(__file__).parent) as archive:
        meta = json.loads(archive.read('release.json'))
        require(meta['main_sha'] == MAIN and meta['format'] == 1, 'Wrong release package')
        files = {n: archive.read('payload/' + n) for n in meta['after']}
        optional = {n: archive.read('optional/' + n) for n in meta['optional']}
    for n, data in files.items():
        require(sha(data) == meta['after'][n], 'Damaged package: ' + n)
    for n, data in optional.items():
        require(sha(data) == meta['optional'][n]['after'], 'Damaged optional source: ' + n)
    return meta, files, optional

def snapshot(root):
    require(root.is_dir() and not root.is_symlink() and root.resolve() == root, 'Unsafe directory')
    result, total = {}, 0
    for p in [root] + sorted(root.rglob('*')):
        s = p.lstat()
        require(stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode), 'Symlink or special file: ' + p.name)
        require(s.st_dev == root.stat().st_dev, 'Nested filesystem in frontend')
        n = str(p.relative_to(root))
        item = {'mode': stat.S_IMODE(s.st_mode), 'uid': s.st_uid, 'gid': s.st_gid,
                'type': 'dir' if p.is_dir() else 'file'}
        if p.is_file():
            total += s.st_size
            require(s.st_size <= 32 * 1024 * 1024 and total <= MAX_BYTES, 'Unexpected frontend size')
            item.update(size=s.st_size, sha256=sha(p.read_bytes()))
        result[n] = item
        require(len(result) <= 10000, 'Unexpected frontend entry count')
    return result

def file_hashes(root, hashes):
    for n, digest in hashes.items():
        require(re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', n) and all(p not in ('.', '..') for p in n.split('/')), 'Unsafe filename')
        p = root / n
        require(p.is_file() and not p.is_symlink(), 'Missing or unsafe file: ' + n)
        require(sha(p.read_bytes()) == digest, 'Frontend differs from pinned release: ' + n)

def inspect(container):
    data = json.loads(command(['docker', 'inspect', container]))
    require(len(data) == 1, 'Ambiguous Docker container')
    return data[0]

def fingerprint(container):
    return sha(json.dumps({n: container[n] for n in ('Id', 'Config', 'HostConfig', 'Mounts')},
                          sort_keys=True).encode())

def discover(meta):
    ids = command(['docker', 'ps', '-q']).decode().split()
    require(ids, 'No running Docker containers')
    choices = []
    for container in json.loads(command(['docker', 'inspect'] + ids)):
        for mount in container.get('Mounts', []):
            if mount.get('Type') != 'bind' or mount.get('Destination') != '/srv':
                continue
            root = Path(mount['Source'])
            if root.parent.parent != PARENT or root.name != 'web' or not root.parent.name.startswith('release-'):
                continue
            p = root / 'build-version.js'
            if p.is_file() and sha(p.read_bytes()) == meta['before']['build-version.js']:
                choices.append((root, container))
    require(len(choices) == 1, 'Cannot uniquely identify the pinned live frontend; no changes made')
    root, container = choices[0]
    require(container['State']['Running'], 'Web container is not running')
    require('caddy' in json.dumps([container['Config'].get('Image'), container['Config'].get('Entrypoint'),
                                 container['Config'].get('Cmd')]).lower(), 'Expected existing Caddy container')
    require(command(['docker', 'exec', container['Id'], 'cat', '/srv/build-version.js']) == (root / 'build-version.js').read_bytes(),
            'Docker mount differs from host directory')
    return root, container

def http_get(origin, name):
    url = origin + '/' + ('' if name == 'index.html' else name)
    request = urllib.request.Request(url + '?bos_release=' + MAIN[:12], headers={'Cache-Control': 'no-cache'})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            require(response.status == 200, 'HTTP failure: ' + name)
            data = response.read(8_000_001)
    except urllib.error.HTTPError as error:
        raise Stop('HTTP ' + str(error.code) + ': ' + name) from error
    except urllib.error.URLError as error:
        raise Stop('Network failure: ' + name) from error
    require(len(data) <= 8_000_000, 'Oversize HTTP response: ' + name)
    return data

def public_verify(meta, hashes, full=True):
    names = list(hashes) if full else ['build-version.js', 'index.html', 'sw.js']
    def check(name):
        require(sha(http_get(meta['origin'], name)) == hashes[name], 'Served hash mismatch: ' + name)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for count, _ in enumerate(pool.map(check, names), 1):
            if count % 15 == 0:
                emit('Verified HTTPS files: ' + str(count) + '/' + str(len(names)))

def fsync_tree(root):
    for p in sorted(root.rglob('*'), reverse=True) + [root]:
        fd = os.open(p, os.O_RDONLY | (os.O_DIRECTORY if p.is_dir() else 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

def save(record):
    tmp = STAGE / 'journal.tmp'
    with open(tmp, 'w') as out:
        os.chmod(tmp, 0o600)
        json.dump(record, out, indent=2)
        out.flush()
        os.fsync(out.fileno())
    os.replace(tmp, STAGE / 'journal.json')
    fd = os.open(STAGE, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def exchange(first, second):
    libc = ctypes.CDLL(None, use_errno=True)
    require(hasattr(libc, 'renameat2'), 'Atomic directory exchange is not supported')
    fn = libc.renameat2
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    if fn(-100, os.fsencode(first), -100, os.fsencode(second), 2) != 0:
        raise Stop('Atomic directory exchange failed: errno ' + str(ctypes.get_errno()))
    for parent in {first.parent, second.parent}:
        fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

def copy_tree(source, dest):
    require(not dest.exists(), 'Backup/candidate directory already exists')
    command(['cp', '-a', '--', str(source), str(dest)], timeout=120)

def check_container(record, running=True):
    container = inspect(record['container'])
    require(fingerprint(container) == record['container_fingerprint'], 'Container configuration changed; stop')
    if running:
        require(container['State']['Running'], 'Web container is not running')
    return container

def restart(record):
    check_container(record, running=False)
    emit('Restarting only the existing Caddy container...')
    command(['docker', 'restart', '--time', '10', record['container']], timeout=60)
    check_container(record)
    expected = (Path(record['root']) / 'build-version.js').read_bytes()
    actual = command(['docker', 'exec', record['container'], 'cat', '/srv/build-version.js'])
    require(actual == expected, 'Container did not mount the expected frontend')
    for attempt in range(15):
        try:
            require(http_get(record['origin'], 'build-version.js') == expected, 'Web server not ready')
            return
        except Exception:
            if attempt == 14:
                raise
            time.sleep(1)

def write_candidate(candidate, name, data, owner):
    path = candidate / name
    source = path.stat() if path.exists() else owner
    tmp = path.parent / ('.bos-new-' + path.name)
    require(not tmp.exists(), 'Unexpected temporary file')
    with open(tmp, 'xb') as out:
        out.write(data)
        out.flush()
        os.fchmod(out.fileno(), stat.S_IMODE(source.st_mode))
        os.fchown(out.fileno(), source.st_uid, source.st_gid)
        os.fsync(out.fileno())
    os.replace(tmp, path)

def preflight(meta, optional):
    root, container = discover(meta)
    before = snapshot(root)
    file_hashes(root, meta['before'])
    for name in meta['new_dirs'] + meta['new_files']:
        require(not (root / name).exists(), 'New release filename already exists: ' + name)
    present = []
    for name in optional:
        if (root / name).exists():
            require(sha((root / name).read_bytes()) == meta['optional'][name]['before'],
                    'Existing source differs from pinned RU baseline: ' + name)
            present.append(name)
    public_verify(meta, meta['before'], full=False)
    require(snapshot(root) == before, 'Frontend changed during preflight')
    emit('ROOT=' + str(root))
    emit('BEFORE_BUILD=' + meta['before_build'])
    emit('AFTER_BUILD=' + meta['after_build'])
    emit('Runtime files: ' + str(len(meta['after'])) + '; existing source files: ' + str(len(present)))
    return root, container, before, present

def rollback_guard(record):
    root = Path(record['root'])
    check_container(record, running=False)
    before = record['before_snapshot']
    after = record['after_snapshot']
    require(snapshot(STAGE / 'backup') == before, 'Backup changed; rollback stopped')
    current = snapshot(root)
    require(current == before or current == after, 'Unrelated later changes; rollback stopped')
    return root, before, after, current

def restore(meta, record):
    root, before, after, current = rollback_guard(record)
    if record['state'] in ('prepared', 'rolled_back') and current == before:
        public_verify(meta, meta['before'])
        record['state'] = 'rolled_back'
        save(record)
        emit('FRONTEND_BASELINE_RETAINED BUILD_ID=' + meta['before_build'])
        return
    record['state'] = 'rolling_back'
    save(record)
    if current == after:
        previous = STAGE / 'swap'
        require(snapshot(previous) == before, 'Previous directory changed; rollback stopped')
        exchange(root, previous)
    require(snapshot(root) == before, 'Rollback filesystem check failed')
    restart(record)
    public_verify(meta, meta['before'])
    record['state'] = 'rolled_back'
    save(record)
    emit('ROLLED_BACK BUILD_ID=' + meta['before_build'])
    emit('BACKUP=' + str(STAGE / 'backup'))

def prepare(meta, files, optional):
    root, container, before, present = preflight(meta, optional)
    require(not STAGE.exists(), 'Release directory already exists; use --check or --rollback')
    STAGE.mkdir(mode=0o700)
    parent_fd = os.open(STAGE.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent_fd)
    finally:
        os.close(parent_fd)
    require(STAGE.stat().st_dev == root.stat().st_dev, 'Directories are on different filesystems')
    emit('Saving and verifying complete frontend backup...')
    copy_tree(root, STAGE / 'backup')
    require(snapshot(STAGE / 'backup') == before, 'Backup verification failed; live frontend unchanged')
    fsync_tree(STAGE / 'backup')
    copy_tree(STAGE / 'backup', STAGE / 'swap')
    candidate = STAGE / 'swap'
    owner = (candidate / 'index.html').stat()
    selected = dict(files)
    selected.update({n: optional[n] for n in present})
    for name in meta['new_dirs']:
        directory = candidate / name
        directory.mkdir(mode=0o755)
        os.chown(directory, owner.st_uid, owner.st_gid)
    for name, data in selected.items():
        write_candidate(candidate, name, data, owner)
    fsync_tree(candidate)
    after = snapshot(candidate)
    require(set(after) == set(before) | set(meta['new_dirs']) | set(meta['new_files']), 'Unexpected candidate file set')
    for name, entry in before.items():
        if name not in selected:
            require(after[name] == entry, 'Unrelated candidate file changed: ' + name)
        else:
            require(all(after[name][k] == entry[k] for k in ('mode', 'uid', 'gid', 'type')),
                    'File ownership or permissions changed: ' + name)
    served_after = dict(meta['before'])
    served_after.update(meta['after'])
    file_hashes(candidate, served_after)
    for name, data in selected.items():
        require(after[name]['sha256'] == sha(data), 'Candidate hash mismatch: ' + name)
    record = {'main_sha': MAIN, 'root': str(root), 'container': container['Id'],
              'container_name': container['Name'], 'container_fingerprint': fingerprint(container),
              'origin': meta['origin'], 'state': 'prepared', 'before_snapshot': before,
              'after_snapshot': after, 'served_after': served_after,
              'created_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    save(record)
    # Confirm atomic exchange support before publishing (private empty directories).
    probe_a, probe_b = STAGE / 'probe-a', STAGE / 'probe-b'
    probe_a.mkdir()
    probe_b.mkdir()
    exchange(probe_a, probe_b)
    probe_a.rmdir()
    probe_b.rmdir()
    require(snapshot(root) == before, 'Concurrent frontend change; live frontend unchanged')
    check_container(record)
    public_verify(meta, meta['before'], full=False)
    return record

def activate(meta, record):
    root = Path(record['root'])
    candidate = STAGE / 'swap'
    before, after = record['before_snapshot'], record['after_snapshot']
    served_after = record['served_after']
    require(record['state'] == 'prepared', 'Frontend was not prepared')
    require(snapshot(root) == before and snapshot(candidate) == after,
            'Frontend or candidate changed after preparation')
    require(snapshot(STAGE / 'backup') == before, 'Frontend backup changed')
    check_container(record)
    record['state'] = 'activating'
    save(record)
    # Rollback is exclusively coordinated after the database compatibility barrier.
    exchange(root, candidate)
    restart(record)
    file_hashes(root, served_after)
    public_verify(meta, served_after)
    require(snapshot(root) == after, 'Frontend changed during HTTPS verification')
    record['state'] = 'active'
    save(record)
    emit('DEPLOYED BUILD_ID=' + meta['after_build'])
    emit('MAIN_SHA=' + MAIN)
    emit('BACKUP=' + str(STAGE / 'backup'))
