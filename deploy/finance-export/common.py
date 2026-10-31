"""Bounded private staging I/O; never prints command output or credentials."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile


class Stop(Exception): pass


def require(ok, code):
    if not ok: raise Stop(code)


def sha(data): return hashlib.sha256(data).hexdigest()


def emit(key, value=True):
    print(key + '=' + json.dumps(value, ensure_ascii=True, separators=(',', ':')), flush=True)


def read(path, limit=128 * 1024 * 1024):
    require(path.is_file() and path.resolve() == path and not path.is_symlink(), 'FILE_UNSAFE_OR_MISSING')
    require(path.stat().st_size <= limit, 'FILE_SIZE_LIMIT')
    return path.read_bytes()


def item(path):
    if not path.exists() and not path.is_symlink(): return None
    data = read(path)
    info = path.stat()
    return {'sha': sha(data), 'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def atomic(path, data, metadata=None):
    require(path.parent.is_dir() and path.parent.resolve() == path.parent and not path.is_symlink(), 'ATOMIC_PATH_UNSAFE')
    metadata = metadata or {'mode': 0o600, 'uid': os.geteuid(), 'gid': os.getegid()}
    fd, temporary = tempfile.mkstemp(prefix='.bos-finance-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            os.fchmod(out.fileno(), metadata['mode'])
            os.fchown(out.fileno(), metadata['uid'], metadata['gid'])
            out.write(data); out.flush(); os.fsync(out.fileno())
        os.replace(temporary, path); sync(path.parent)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def tree(root):
    require(root.is_dir() and root.resolve() == root, 'TREE_ROOT_UNSAFE')
    files, total = {}, 0
    for path in sorted(root.rglob('*')):
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode), 'TREE_LINK_OR_SPECIAL_FILE')
        require(info.st_dev == root.stat().st_dev, 'TREE_FILESYSTEM_CHANGED')
        if path.is_file():
            total += info.st_size
            require(total <= 256 * 1024 * 1024 and len(files) < 10000, 'TREE_SIZE_LIMIT')
            files[path.relative_to(root).as_posix()] = item(path)
    return files


def run(args, stage=None, label='command', timeout=60, data=None):
    try: result = subprocess.run(args, input=data, capture_output=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError): raise Stop(label + '_UNAVAILABLE') from None
    if stage is not None:
        atomic(stage / 'logs' / (label + '.log'), result.stdout + b'\n' + result.stderr)
    require(result.returncode == 0, label + '_FAILED')
    return result.stdout


def inspect(container):
    data = json.loads(run(['docker', 'inspect', container]))
    require(len(data) == 1, 'CONTAINER_NOT_UNIQUE')
    return data[0]


def fingerprint(container):
    return sha(json.dumps({key: container[key] for key in ('Id', 'Image', 'Config', 'HostConfig', 'Mounts')}, sort_keys=True).encode())


def safe_relative(name):
    import re
    require(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', name)
            and all(x not in ('.', '..') for x in name.split('/')), 'RELATIVE_PATH_UNSAFE')
    return name
