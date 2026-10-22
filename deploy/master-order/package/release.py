"""Coordinate only the static frontend update; no backend/database operations."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import sys
import uuid
import zipfile
import frontend as f

INACTIVE = {'not_journalled', 'prepared', 'rolled_back'}

def load():
    if not f.STAGE.exists():
        return None
    f.require(f.STAGE.resolve() == f.STAGE and not f.STAGE.is_symlink()
              and f.STAGE.stat().st_uid == 0 and f.STAGE.stat().st_mode & 0o077 == 0,
              'Unsafe release stage')
    path = f.STAGE/'journal.json'
    f.require(not path.is_symlink(), 'Unsafe release journal')
    if not path.exists():
        return {'state': 'not_journalled'}
    f.require(path.is_file() and path.stat().st_uid == 0, 'Unsafe release journal')
    record = json.loads(path.read_text())
    f.require(record['main_sha'] == f.MAIN, 'Wrong release journal')
    root = Path(record['root'])
    f.require(root.parent.parent == f.PARENT and root.name == 'web'
              and root.parent.name.startswith('release-') and root.resolve() == root,
              'Wrong frontend root in journal')
    return record

def rollback(meta, record):
    f.require(record is not None, 'No release journal found')
    if record['state'] == 'not_journalled':
        f.preflight(meta, {})
        f.emit('NOT_ACTIVATED; incomplete private preparation retained')
    else:
        f.restore(meta, record)
    f.emit('ROLLBACK_OK BUILD_ID='+meta['before_build'])

def archive(meta, record):
    f.require(record['state'] in INACTIVE, 'Interrupted activation; run --rollback first')
    root, _, before, _ = f.preflight(meta, {})
    if record['state'] != 'not_journalled':
        f.rollback_guard(record)
        f.require(before == record['before_snapshot'], 'Baseline changed after rollback')
    target = f.STAGE.with_name(f.STAGE.name+'-history-'+uuid.uuid4().hex[:12])
    f.require(not target.exists(), 'Archive already exists')
    os.rename(f.STAGE, target)
    fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    f.emit('PREVIOUS_ATTEMPT_SAVED='+str(target))

def activate(meta, files, optional):
    record = f.prepare(meta, files, optional)
    try:
        f.activate(meta, record)
    except BaseException as error:
        f.emit('Activation failed; restoring the preceding frontend...')
        try:
            rollback(meta, record)
        except BaseException as recovery:
            raise f.Stop('ROLLBACK_INCOMPLETE; keep backups and run --rollback. '+str(recovery)) from recovery
        raise f.Stop('Release rolled back: '+(str(error) if isinstance(error, f.Stop) else type(error).__name__)) from error
    f.emit('RELEASE_OK BUILD_ID='+meta['after_build'])

def execute(mode, meta, files, optional):
    record = load()
    if mode == 'rollback':
        rollback(meta, record)
        return
    if record:
        if record['state'] == 'active':
            f.check_container(record)
            f.require(f.snapshot(Path(record['root'])) == record['after_snapshot'], 'Active frontend changed')
            f.public_verify(meta, record['served_after'])
            f.emit('ALREADY_DEPLOYED BUILD_ID='+meta['after_build'])
            return
        f.require(record['state'] in INACTIVE, 'Interrupted activation; run --rollback first')
        if mode == 'apply':
            archive(meta, record)
    root, _, before, _ = f.preflight(meta, optional)
    size = sum(entry.get('size', 0) for entry in before.values())
    f.require(shutil.disk_usage(f.PARENT).free >= size*3+64*1024*1024, 'Insufficient space for complete backup')
    if mode == 'check':
        f.emit('CHECK_OK; no files or services changed')
        return
    activate(meta, files, optional)

def main():
    parser = argparse.ArgumentParser(description='PR300 compact master card: frontend only')
    modes = parser.add_mutually_exclusive_group(required=True)
    for name in ['check', 'apply', 'rollback']:
        modes.add_argument('--'+name, action='store_true')
    args = parser.parse_args()
    f.require(os.geteuid() == 0 and sys.platform == 'linux', 'Run as root on the existing Linux server')
    f.require(f.PARENT.is_dir() and f.PARENT.resolve() == f.PARENT, 'Existing deployment directory not found')
    os.umask(0o077)
    meta, files, optional = f.package()
    lock = os.open(f.PARENT, os.O_RDONLY | os.O_DIRECTORY)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        execute('check' if args.check else 'apply' if args.apply else 'rollback', meta, files, optional)
    finally:
        os.close(lock)

def run():
    def interrupted(signum, frame):
        raise f.Stop('Interrupted by signal '+str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except (f.Stop, OSError, ValueError, KeyError, zipfile.BadZipFile, KeyboardInterrupt) as error:
        print('STOP: '+(str(error) if isinstance(error, f.Stop) else type(error).__name__), file=sys.stderr, flush=True)
        sys.exit(1)
