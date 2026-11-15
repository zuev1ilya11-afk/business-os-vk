#!/usr/bin/env python3
"""Capture a private, local recovery bundle; never restore into a live service.

Python 3.10+, standard library only. A verified archive is not a verified restore.
See README.md for the boundaries of online DB + filesystem capture.
"""
import argparse
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time
import uuid

import discovery

MIB = 1024 * 1024
RESERVE = 512 * MIB
MAX_FILES = 500_000
MAX_MANIFEST = 128 * MIB
DEFAULT_OUTPUT = Path('/root/bos-recovery')
FORMAT = 1


class Stop(Exception):
    """Only fixed, non-sensitive codes may cross the CLI boundary."""
    def __init__(self, reason_code):
        super().__init__(reason_code)
        self.reason_code = reason_code


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def safe_path(path):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path or '..' in path.parts:
        raise Stop('PATH_UNSAFE')
    # resolve() alone misses a dangling symlink at the final component.
    for part in [path, *path.parents]:
        if part.is_symlink():
            raise Stop('PATH_UNSAFE')
    return path


def overlaps(a, b):
    return a == b or a in b.parents or b in a.parents


def private_dir(path, create=False):
    path = safe_path(path)
    if create and not path.exists():
        # Never mkdir parents under a live mount or silently change permissions.
        if not path.parent.is_dir():
            raise Stop('OUTPUT_PARENT_MISSING')
        path.mkdir(mode=0o700)
    s = path.stat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != os.geteuid() or s.st_mode & 0o077:
        raise Stop('PRIVATE_DIRECTORY_REQUIRED')
    return path


def exclusive(path):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    return os.fdopen(fd, 'wb')


def stable_stat(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def hash_file(path):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode):
        raise Stop('FILE_TYPE_UNSUPPORTED')
    h = hashlib.sha256()
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as f:
        if stable_stat(os.fstat(f.fileno())) != stable_stat(before):
            raise Stop('FILE_CHANGED')
        for chunk in iter(lambda: f.read(MIB), b''):
            h.update(chunk)
    if stable_stat(before) != stable_stat(path.lstat()):
        raise Stop('FILE_CHANGED')
    return {'sha256': h.hexdigest(), 'bytes': before.st_size}


def write_json(path, data):
    with exclusive(path) as f:
        f.write(json.dumps(data, ensure_ascii=True, sort_keys=True,
                           separators=(',', ':')).encode() + b'\n')
        f.flush()
        os.fsync(f.fileno())


def read_json(path, limit=MAX_MANIFEST):
    if not path.is_file() or path.is_symlink() or path.stat().st_size > limit:
        raise Stop('JSON_FILE_INVALID')
    with path.open('rb') as f:
        return json.loads(f.read(limit + 1))


def command_failure(args, returncode, stderr):
    """Classify a bounded private error prefix; never return the error text."""
    if not args or args[0] != 'exec':
        return 'COMMAND_FAILED'
    error = stderr[:8192].lower()
    if returncode == 124:
        return 'COMMAND_TIMEOUT'
    missing = (b'executable file not found', b'no such file or directory',
               b'not found', b'failed to run command')
    if b'psql' in error and any(part in error for part in missing) and (
            b'failed to run command' in error or b'executable file not found' in error
            or b'env:' in error):
        return 'DATABASE_CLIENT_UNAVAILABLE'
    if b'timeout' in error and any(part in error for part in missing):
        return 'DATABASE_TIMEOUT_UNAVAILABLE'
    if b'no password supplied' in error:
        return 'DATABASE_PASSWORD_REQUIRED'
    if b'password authentication failed' in error:
        return 'DATABASE_PASSWORD_REJECTED'
    if b'permission denied' in error and any(name in error for name in
            (b'pg_file_settings', b'pg_settings', b'pg_show_all_file_settings',
             b'data_directory', b'config_file', b'hba_file', b'ident_file')):
        return 'DATABASE_METADATA_PERMISSION_DENIED'
    if b'psql' in error and b'/var/run/postgresql/' in error and (
            b'no such file or directory' in error or b'connection refused' in error):
        return 'DATABASE_SOCKET_UNAVAILABLE'
    if b'canceling statement due to statement timeout' in error:
        return 'COMMAND_TIMEOUT'
    return 'COMMAND_FAILED'


class LocalDocker:
    """Explicit local Unix socket; never inherit a remote Docker context.

    No shell, no raw subprocess exception/stderr in the report. Both streams are
    drained with limits. Database processes also have an in-container timeout.
    """
    def __init__(self):
        self.binary = shutil.which('docker')
        if not self.binary:
            raise Stop('DOCKER_UNAVAILABLE')

    def _run(self, args, output, timeout, limit, input_path=None, output_parent=None):
        env = {k: v for k, v in os.environ.items() if not k.startswith('DOCKER_')}
        command = [self.binary, '--host=unix:///var/run/docker.sock', *args]
        started, count, errors = time.monotonic(), 0, 0
        error_prefix = bytearray()
        with (input_path.open('rb') if input_path else open(os.devnull, 'rb')) as stdin:
            p = subprocess.Popen(command, stdin=stdin, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, env=env, start_new_session=True)
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(p.stdout, selectors.EVENT_READ, 'out')
                    selector.register(p.stderr, selectors.EVENT_READ, 'err')
                    while selector.get_map():
                        if time.monotonic() - started > timeout:
                            raise Stop('COMMAND_TIMEOUT')
                        for key, _ in selector.select(timeout=0.2):
                            chunk = os.read(key.fileobj.fileno(), 65536)
                            if not chunk:
                                selector.unregister(key.fileobj)
                                continue
                            if key.data == 'out':
                                count += len(chunk)
                                if count > limit:
                                    raise Stop('COMMAND_OUTPUT_LIMIT')
                                if output_parent is not None:
                                    if shutil.disk_usage(output_parent).free < RESERVE:
                                        raise Stop('INSUFFICIENT_SPACE')
                                output.write(chunk)
                            else:
                                errors += len(chunk)
                                if len(error_prefix) < 8192:
                                    error_prefix.extend(chunk[:8192 - len(error_prefix)])
                                if errors > MIB:
                                    raise Stop('COMMAND_ERROR_OUTPUT_LIMIT')
                    p.wait(timeout=max(1, timeout - (time.monotonic() - started)))
                if p.returncode != 0:
                    raise Stop(command_failure(args, p.returncode, bytes(error_prefix)))
                # pg_dump warnings must be investigated, not discarded as success.
                if errors:
                    raise Stop('COMMAND_WARNINGS')
            finally:
                if p.poll() is None:
                    os.killpg(p.pid, signal.SIGKILL)
                    p.wait(timeout=5)
                p.stdout.close()
                p.stderr.close()

    def __call__(self, args, *, timeout=30, limit=16 * MIB):
        data = io.BytesIO()
        self._run(args, data, timeout, limit)
        return data.getvalue()

    def write(self, args, path, *, timeout, limit, input_path=None):
        with exclusive(path) as f:
            self._run(args, f, timeout, limit, input_path, path.parent)
            f.flush()
            os.fsync(f.fileno())


db_command = discovery.db_command


META_SQL = """BEGIN READ ONLY;
SELECT json_build_object('version',current_setting('server_version_num')::int,
 'database',current_database(),'bytes',pg_database_size(current_database()),
 'extensions',(SELECT coalesce(json_agg(json_build_array(extname,extversion)), '[]'::json)
               FROM pg_extension));
ROLLBACK;"""


def inventory(roots):
    """No links or devices; bounded inventory, including empty directories."""
    # st_dev does not identify a same-filesystem bind mount. Reject nested host
    # mountpoints as well, so a bind of PGDATA under a copied root cannot slip in.
    mountpoints = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        fields = line.split()
        if len(fields) < 6:
            raise Stop('HOST_MOUNT_LAYOUT_UNSUPPORTED')
        value = re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), fields[4])
        mountpoints.append(Path(value))
    if any(root != point and root in point.parents for root in roots for point in mountpoints):
        raise Stop('NESTED_HOST_MOUNT_UNSUPPORTED')
    result = {}
    def visit(path, archive_name, device):
        safe_path(path)
        if len(result) >= MAX_FILES:
            raise Stop('FILE_COUNT_LIMIT')
        s = path.lstat()
        if s.st_dev != device:
            raise Stop('NESTED_FILESYSTEM_UNSUPPORTED')
        if stat.S_ISREG(s.st_mode):
            if s.st_nlink != 1:
                raise Stop('HARDLINK_UNSUPPORTED')
        elif not stat.S_ISDIR(s.st_mode):
            raise Stop('FILE_TYPE_UNSUPPORTED')
        result[archive_name] = (path, stable_stat(s))
        if stat.S_ISDIR(s.st_mode):
            for child in sorted(path.iterdir()):
                visit(child, archive_name + '/' + child.name, device)
    for i, root in enumerate(roots):
        root = safe_path(root)
        visit(root, 'root-' + str(i).zfill(3), root.lstat().st_dev)
    return result


class HashReader:
    def __init__(self, stream):
        self.stream, self.hash = stream, hashlib.sha256()
    def read(self, size=-1):
        data = self.stream.read(size)
        self.hash.update(data)
        return data


def archive_roots(path, entries):
    files = {}
    with exclusive(path) as output, tarfile.open(fileobj=output, mode='w|') as archive:
        for name, (source, expected) in entries.items():
            safe_path(source)
            if shutil.disk_usage(path.parent).free < RESERVE:
                raise Stop('INSUFFICIENT_SPACE')
            s = source.lstat()
            if stable_stat(s) != expected:
                raise Stop('SOURCE_CHANGED')
            info = tarfile.TarInfo(name)
            info.uid, info.gid = s.st_uid, s.st_gid
            info.mode, info.mtime = stat.S_IMODE(s.st_mode), int(s.st_mtime)
            if stat.S_ISDIR(s.st_mode):
                info.type = tarfile.DIRTYPE
                archive.addfile(info)
                files[name] = {'type': 'directory', 'bytes': 0}
            else:
                info.size = s.st_size
                with os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as f:
                    if stable_stat(os.fstat(f.fileno())) != expected:
                        raise Stop('SOURCE_CHANGED')
                    reader = HashReader(f)
                    archive.addfile(info, reader)
                    files[name] = {'type': 'file', 'bytes': info.size,
                                   'sha256': reader.hash.hexdigest()}
                if stable_stat(source.lstat()) != expected:
                    raise Stop('SOURCE_CHANGED')
    return files


def valid_member(name):
    p = PurePosixPath(name)
    return (name and not p.is_absolute() and '..' not in p.parts
            and str(p) == name and '\\' not in name)


def verify_tar(path, expected):
    seen = set()
    with tarfile.open(path, 'r|') as archive:
        for item in archive:
            if not valid_member(item.name) or item.name in seen or item.name not in expected:
                raise Stop('ARCHIVE_MEMBER_INVALID')
            seen.add(item.name)
            record = expected[item.name]
            if item.isdir() and record == {'type': 'directory', 'bytes': 0}:
                continue
            if not item.isfile() or record['type'] != 'file' or item.size != record['bytes']:
                raise Stop('ARCHIVE_MEMBER_INVALID')
            h = hashlib.sha256()
            stream = archive.extractfile(item)
            for chunk in iter(lambda: stream.read(MIB), b''):
                h.update(chunk)
            if h.hexdigest() != record['sha256']:
                raise Stop('ARCHIVE_CONTENT_MISMATCH')
    if seen != set(expected):
        raise Stop('ARCHIVE_INCOMPLETE')


PAYLOADS = {'database.dump', 'globals.sql', 'files.tar', 'images.tar',
            'private-config.json', 'inventory.json'}


def verify_images(path, expected_ids):
    """Inspect Docker save envelope/config hashes, without loading or extracting."""
    if not expected_ids or any(not re.fullmatch(r'sha256:[0-9a-f]{64}', i) for i in expected_ids):
        raise Stop('IMAGE_IDS_INVALID')
    config_paths = {p for i in expected_ids for p in
                    (i[7:] + '.json', 'blobs/sha256/' + i[7:])}
    members, configs, listing = {}, {}, None
    with tarfile.open(path, 'r|') as archive:
        for item in archive:
            if (not valid_member(item.name.rstrip('/')) or item.name in members
                    or not (item.isfile() or item.isdir()) or len(members) >= MAX_FILES):
                raise Stop('IMAGE_ARCHIVE_INVALID')
            members[item.name] = item.size if item.isfile() else None
            if item.name == 'manifest.json' or item.name in config_paths:
                if not item.isfile() or item.size > 16 * MIB:
                    raise Stop('IMAGE_ARCHIVE_INVALID')
                data = archive.extractfile(item).read(16 * MIB + 1)
                if item.name == 'manifest.json':
                    listing = json.loads(data)
                else:
                    configs[item.name] = 'sha256:' + hashlib.sha256(data).hexdigest()
    if not isinstance(listing, list):
        raise Stop('IMAGE_MANIFEST_MISSING')
    found = set()
    for record in listing:
        config, layers = record.get('Config'), record.get('Layers')
        if (config not in configs or not isinstance(layers, list) or not layers
                or any(name not in members or members[name] is None for name in layers)):
            raise Stop('IMAGE_ARCHIVE_INCOMPLETE')
        found.add(configs[config])
    if found != set(expected_ids):
        raise Stop('IMAGE_ARCHIVE_MISMATCH')


def verify(bundle, *, allow_partial=False):
    bundle = private_dir(bundle)
    if not allow_partial and (bundle.name.startswith('.') or bundle.name.endswith('.partial')):
        raise Stop('PARTIAL_BUNDLE')
    if set(p.name for p in bundle.iterdir()) != PAYLOADS | {'manifest.json'}:
        raise Stop('BUNDLE_CONTENTS_INVALID')
    ms = (bundle / 'manifest.json').lstat()
    if ms.st_uid != os.geteuid() or ms.st_mode & 0o077:
        raise Stop('PRIVATE_FILE_REQUIRED')
    manifest = read_json(bundle / 'manifest.json')
    if (manifest.get('format') != FORMAT or manifest.get('capture') != 'COMPLETE'
            or set(manifest.get('payloads', {})) != PAYLOADS):
        raise Stop('MANIFEST_INVALID')
    for name, expected in manifest['payloads'].items():
        p = bundle / name
        s = p.lstat()
        if s.st_uid != os.geteuid() or s.st_mode & 0o077:
            raise Stop('PRIVATE_FILE_REQUIRED')
        if hash_file(p) != expected:
            raise Stop('PAYLOAD_HASH_MISMATCH')
    inventory_data = read_json(bundle / 'inventory.json')
    verify_tar(bundle / 'files.tar', inventory_data)
    private = read_json(bundle / 'private-config.json')
    verify_images(bundle / 'images.tar', [i['Id'] for i in private['images']])
    with (bundle / 'database.dump').open('rb') as f:
        if f.read(5) != b'PGDMP':
            raise Stop('DUMP_FORMAT_INVALID')
    # These are deliberately fixed rather than trusting an editable manifest to
    # claim a live restore/independent copy/online filesystem snapshot succeeded.
    return {'capture': 'COMPLETE', 'integrity': 'VERIFIED',
            'database_storage_consistency': 'NOT_PROVEN',
            'independent_copy': 'NOT_VERIFIED', 'restore': 'NOT_RUN',
            'disaster_recovery_ready': False, 'bundle': str(bundle)}


def capture(layout, output_root, runner):
    output_root = safe_path(output_root)
    sources = [safe_path(Path(p)) for p in layout['roots']]
    protected = [safe_path(Path(p)) for p in layout['protected']]
    if any(overlaps(output_root, p) for p in [*protected, *sources, Path(layout['release'])]):
        raise Stop('OUTPUT_OVERLAPS_SOURCE')
    output_root = private_dir(output_root, create=True)
    entries = inventory(sources)
    meta = json.loads(runner(db_command(layout, 'psql',
        ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', layout['database'], '-c', META_SQL], 30)))
    if (meta['database'] != layout['database'] or not 170000 <= meta['version'] < 180000
            or not isinstance(meta['bytes'], int) or meta['bytes'] <= 0):
        raise Stop('DATABASE_METADATA_MISMATCH')
    image_ids = sorted(set(layout['images'].values()))
    image_meta = json.loads(runner(['image', 'inspect', *image_ids]))
    if {i['Id'] for i in image_meta} != set(image_ids):
        raise Stop('IMAGE_METADATA_MISMATCH')
    image_bytes = sum(i['Size'] for i in image_meta)
    if not isinstance(image_bytes, int) or image_bytes <= 0:
        raise Stop('IMAGE_SIZE_INVALID')
    source_bytes = sum(s[3] for _, s in entries.values() if stat.S_ISREG(s[2]))
    estimate = source_bytes + len(entries) * 4096 + meta['bytes'] * 2 + image_bytes * 2 + 128 * MIB
    if shutil.disk_usage(output_root).free < estimate + RESERVE:
        raise Stop('INSUFFICIENT_SPACE')
    identifier = 'capture-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:12]
    partial, final = output_root / ('.' + identifier + '.partial'), output_root / identifier
    partial.mkdir(mode=0o700)
    started = utc()
    # A failed capture remains private and explicitly partial for review; never
    # delete a user path or silently promote an interrupted bundle.
    runner.write(db_command(layout, 'pg_dump', ['-Fc', '--lock-wait-timeout=10s', '-d', layout['database']]),
                 partial / 'database.dump', timeout=630, limit=max(meta['bytes'] * 2, 64 * MIB))
    runner.write(db_command(layout, 'pg_dumpall', ['--globals-only', '-l', layout['database']]),
                 partial / 'globals.sql', timeout=630, limit=64 * MIB)
    # --list reads the dump without connecting to any database or executing SQL.
    # Its potentially sensitive TOC is never included in a report.
    runner.write(['exec', '-i', '-u', 'postgres', layout['database_container'],
                  'timeout', '-k', '10', '60', 'pg_restore', '--list'],
                 partial / 'toc.partial', timeout=90, limit=64 * MIB,
                 input_path=partial / 'database.dump')
    (partial / 'toc.partial').unlink()
    files = archive_roots(partial / 'files.tar', entries)
    if inventory(sources) != entries:
        raise Stop('SOURCE_CHANGED')
    runner.write(['image', 'save', *image_ids], partial / 'images.tar',
                 timeout=1800, limit=image_bytes * 2 + 128 * MIB)
    # Catch a rollout/recreate during capture. No secrets are emitted; all full
    # container settings are confined to the private bundle.
    after = discovery.discover(runner)
    def signature(containers):
        return [(c['Id'], c['Image'], c['Mounts'], c['Config'],
                 c.get('State', {}).get('StartedAt'), c.get('RestartCount')) for c in containers]
    before_signature = signature(layout['containers'])
    after_signature = signature(after['containers'])
    if (before_signature != after_signature or layout['roots'] != after['roots']
            or layout['protected'] != after['protected']
            or layout.get('database_user', 'postgres') != after.get('database_user', 'postgres')
            or inventory(sources) != entries):
        raise Stop('SOURCE_CHANGED')
    write_json(partial / 'private-config.json',
               {'containers': layout['containers'], 'database': meta,
                'database_user': layout.get('database_user', 'postgres'),
                'images': image_meta, 'roots': [str(p) for p in sources],
                'contains_secrets': True})
    write_json(partial / 'inventory.json', files)
    manifest = {'format': FORMAT, 'capture': 'COMPLETE', 'started_at': started,
                'finished_at': utc(), 'build': layout['build'],
                'database_snapshot': 'PG_DUMP', 'database_storage_consistency': 'NOT_PROVEN',
                'independent_copy': 'NOT_VERIFIED', 'restore': 'NOT_RUN',
                'disaster_recovery_ready': False,
                'payloads': {p: hash_file(partial / p) for p in sorted(PAYLOADS)}}
    write_json(partial / 'manifest.json', manifest)
    verify(partial, allow_partial=True)
    # Rename within the private same-filesystem destination; no ready pointer is
    # written before all checks and syncs have completed.
    for path in partial.iterdir():
        with path.open('rb') as f:
            os.fsync(f.fileno())
    fd = os.open(partial, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    if final.exists():
        raise Stop('OUTPUT_COLLISION')
    fd = os.open(output_root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.rename(partial, final)
        try:
            os.fsync(fd)
        except BaseException:
            # This is only our new UUID directory. Keep a failed promotion marked
            # partial when the filesystem still permits renaming it back.
            try:
                os.rename(final, partial)
                os.fsync(fd)
            except OSError:
                pass
            raise Stop('FINALIZE_DURABILITY_UNCONFIRMED') from None
    finally:
        os.close(fd)
    return final


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('capture')
    create.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    check = commands.add_parser('verify')
    check.add_argument('bundle', type=Path)
    args = parser.parse_args(argv)
    os.umask(0o077)
    try:
        if args.command == 'capture':
            runner = LocalDocker()
            bundle = capture(discovery.discover(runner), args.output, runner)
        else:
            bundle = args.bundle
        result = verify(bundle)
        print(json.dumps(result, ensure_ascii=True, separators=(',', ':')))
        return 0
    except (Stop, discovery.Stop) as exc:
        code = str(exc)
        if not re.fullmatch(r'[A-Z][A-Z0-9_]{1,80}', code):
            code = 'CAPTURE_STOPPED'
    except KeyboardInterrupt:
        code = 'INTERRUPTED'
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError, subprocess.SubprocessError):
        code = 'IO_OR_LAYOUT_ERROR'
    print(json.dumps({'capture': 'STOPPED', 'reason': code,
                      'disaster_recovery_ready': False}, separators=(',', ':')))
    return 1


if __name__ == '__main__':
    sys.exit(main())
