"""Coordinate the pinned frontend and CORS-only backend release."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import zipfile
import uuid
import frontend as f
import backend as b


def load(stage, allow_incomplete=False):
    if not stage.exists(): return None
    f.require(stage.resolve()==stage and not stage.is_symlink() and stage.stat().st_uid==0,
              'Unsafe staging directory')
    p=stage/'journal.json'
    if not p.exists() and allow_incomplete:
        return {'state':'not_journalled'}
    f.require(p.is_file() and not p.is_symlink(),'Incomplete private stage; production activation has not started')
    rec=json.loads(p.read_text())
    f.require(rec['main_sha']==f.MAIN,'Wrong release journal')
    return rec


def rollback_all(meta):
    web=load(f.STAGE,allow_incomplete=True)
    api=load(b.STAGE,allow_incomplete=True)
    f.require(web is not None or api is not None,'No deployment journal found')
    # Validate both components before restoring either. Refuse later deployments.
    if web is not None and web['state']!='not_journalled': f.rollback_guard(web)
    if api is not None and api['state']!='not_journalled':
        b.check(api)
        if api['state']!='preparing': b.checked_payload(api)
    errors=[]
    if web is not None:
        # Restore web first. If a later deployment is detected, do not touch API.
        if web['state']=='not_journalled':
            # All frontend mutations follow its first durable journal save.
            # An incomplete private copy never became the published directory.
            f.preflight(meta,{})
            f.emit('FRONTEND_NOT_ACTIVATED; incomplete preparation retained')
        else:
            try: f.restore(meta,web)
            except BaseException as error:
                # A network/restart failure after filesystem restoration must
                # not leave the independent API replacement installed.
                if f.snapshot(Path(web['root']))!=web['before_snapshot']: raise
                errors.append('frontend verification: '+str(error))
    if api is not None:
        if api['state']=='not_journalled':
            f.emit('BACKEND_NOT_ACTIVATED; incomplete preparation retained')
        elif api['state']=='preparing':
            b.check(api,'before')
            b.cleanup(api)
            f.emit('BACKEND_NOT_ACTIVATED; preparation files retained for diagnosis')
        else:
            try: b.restore(api)
            except BaseException as error: errors.append('backend verification: '+str(error))
    f.require(not errors,'Rollback files restored where possible; verification incomplete: '+'; '.join(errors))
    f.emit('RELEASE_ROLLBACK_OK BUILD_ID='+meta['before_build'])


INACTIVE={'not_journalled','preparing','prepared','rolled_back'}

def archive_inactive(meta,api,web):
    """Retry only from verified baseline; retain every previous attempt."""
    f.require(all(rec is None or rec['state'] in INACTIVE for rec in [api,web]),
              'Activation was interrupted. Run --rollback before retrying')
    root,_,_,_=f.preflight(meta,{})
    if web and web['state']!='not_journalled':
        f.rollback_guard(web)
        f.require(f.snapshot(root)==web['before_snapshot'],'Frontend is not rolled back')
    if api and api['state']!='not_journalled':
        b.check(api,'before')
        if api['state']!='preparing': b.checked_payload(api)
        b.cleanup(api)
    else:
        b.discover(root)
    nonce=uuid.uuid4().hex[:12]
    for stage in [f.STAGE,b.STAGE]:
        if stage.exists():
            archived=stage.with_name(stage.name+'-history-'+nonce)
            f.require(not archived.exists(),'Archive path already exists')
            os.rename(stage,archived)
            b.sync_dir(stage.parent)
            f.emit('PREVIOUS_ATTEMPT_SAVED='+str(archived))


def activate_all(meta,files,optional,api):
    try:
        # Complete both backups and durable journals before the first mutation.
        web=f.prepare(meta,files,optional)
        b.activate(api)
        f.activate(meta,web)
        b.check(api,'after')
        b.probe_live(api)
    except BaseException as exc:
        f.emit('Release failed; restoring the previous release...')
        try: rollback_all(meta)
        except BaseException as error:
            raise f.Stop('ROLLBACK_INCOMPLETE; retain backups and run --rollback. '+str(error)) from error
        raise f.Stop('Release failed and was rolled back: '+(str(exc) if isinstance(exc,f.Stop) else type(exc).__name__)) from exc
    f.emit('RELEASE_OK BUILD_ID='+meta['after_build'])
    f.emit('MAIN_SHA='+f.MAIN)
    f.emit('ROLLBACK: python3 bos289.pyz --rollback')


def resources(info):
    mem=re.search(r'^MemAvailable:\s+(\d+)\s+kB$',Path('/proc/meminfo').read_text(),re.M)
    f.require(mem and int(mem[1])>=1024*1024,'At least 1 GiB available RAM required for bounded staging')
    size=sum(entry.get('size',0) for tree in info['before'].values() for entry in tree.values())
    f.require(size<=512*1024*1024 and shutil.disk_usage(f.PARENT).free>=size*4+512*1024*1024,
              'Insufficient staging disk space or unexpected backend size')
    f.require(shutil.which('nsenter') is not None,'nsenter is required for isolated runtime checks')


def main():
    parser=argparse.ArgumentParser(description='PR 289: pinned RU frontend and CORS-only push-api; no DB/key changes')
    group=parser.add_mutually_exclusive_group(required=True)
    for opt in ['check','apply','rollback']: group.add_argument('--'+opt,action='store_true')
    args=parser.parse_args()
    f.require(os.geteuid()==0 and sys.platform=='linux','Run as root on the existing Linux server')
    f.require(f.PARENT.is_dir() and f.PARENT.resolve()==f.PARENT,'Existing deployment directory not found')
    os.umask(0o077)
    meta,files,optional=f.package()
    with zipfile.ZipFile(Path(__file__).parent) as archive: patched=archive.read('push-api.ts')
    f.require(f.sha(patched)==b.SOURCE_AFTER,'Damaged push-api package')
    lock=os.open(f.PARENT,os.O_RDONLY|os.O_DIRECTORY)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.rollback:
            rollback_all(meta); return
        api,web=load(b.STAGE,allow_incomplete=True),load(f.STAGE,allow_incomplete=True)
        if api is not None or web is not None:
            if api and web and api['state']==web['state']=='active':
                b.check(api,'after'); b.probe_live(api)
                f.check_container(web)
                f.require(f.snapshot(Path(web['root']))==web['after_snapshot'],'Active frontend changed')
                f.public_verify(meta,web['served_after'])
                f.emit('ALREADY_DEPLOYED BUILD_ID='+meta['after_build']); return
            f.require(all(rec is None or rec['state'] in INACTIVE for rec in [api,web]),
                      'Interrupted activation retained. Run --rollback before further action')
            if args.apply: archive_inactive(meta,api,web)
        root,_,_,_=f.preflight(meta,optional)
        info=b.discover(root)
        resources(info)
        if args.check:
            f.emit('CHECK_OK; no files or services changed'); return
        api=b.prepare(info,patched)
        activate_all(meta,files,optional,api)
    finally: os.close(lock)


def run():
    def interrupted(signum,frame): raise f.Stop('Interrupted by signal '+str(signum))
    signal.signal(signal.SIGTERM,interrupted)
    try: main()
    except (f.Stop,OSError,ValueError,zipfile.BadZipFile,KeyboardInterrupt) as error:
        print('STOP: '+(str(error) if isinstance(error,f.Stop) else type(error).__name__),file=sys.stderr,flush=True)
        sys.exit(1)
