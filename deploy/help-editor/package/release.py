"""Pinned help release. --prepare never activates files or writes live SQL."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import time
import uuid
import zipfile
import frontend as f
import backend as b
import database as db
import health
import probe_runtime

ROOT=f.PARENT/'help293'
b.probe=health.probe
b.probe_candidate=probe_runtime.probe_candidate


def save(rec):
    path=ROOT/'journal.tmp'
    with open(path,'w') as stream:
        os.chmod(path,0o600);json.dump(rec,stream,indent=2);stream.flush();os.fsync(stream.fileno())
    os.replace(path,ROOT/'journal.json');b.sync_dir(ROOT)


def load(path):
    f.require(path.resolve()==path and not path.is_symlink() and path.stat().st_uid==0,'Unsafe release journal')
    data=json.loads(path.read_text())
    f.require(data['main_sha']==f.MAIN,'Wrong release journal')
    return data


def resources(info):
    available=re.search(r'^MemAvailable:\s+(\d+)\s+kB$',Path('/proc/meminfo').read_text(),re.M)
    f.require(available and int(available[1])>=1024*1024,'At least 1 GiB free RAM required for isolated checks')
    size=sum(e.get('size',0) for tree in info['before'].values() for e in tree.values())
    f.require(size<=512*1024*1024 and shutil.disk_usage(f.PARENT).free>=size*4+1024*1024*1024,'Insufficient private staging space')
    f.require(shutil.which('nsenter') is not None,'nsenter required for isolated checks')


def archive_unactivated(meta):
    paths=[ROOT,b.STAGE,f.STAGE]
    if not any(p.exists() for p in paths):return
    # Never discard a journal after activation/SQL may have started.
    record=load(ROOT/'journal.json') if (ROOT/'journal.json').exists() else None
    f.require(record is None or record['state'] in ('preparing','prepared','rolled_back'),'Existing deployment requires --rollback / status review')
    web,_,_,_=f.preflight(meta,{})
    info=b.discover(web)
    if (b.STAGE/'journal.json').exists():
        previous=load(b.STAGE/'journal.json');b.check(previous,'before');b.cleanup(previous)
    suffix='-history-'+uuid.uuid4().hex[:12]
    for path in paths:
        if path.exists():
            f.require(path.resolve()==path and not path.is_symlink(),'Unsafe private staging directory')
            if path==ROOT:
                # Keep the ownership marker discoverable even after a crash
                # between archiving child stages and writing the new journal.
                f.copy_tree(path,path.with_name(path.name+suffix))
                f.fsync_tree(path.with_name(path.name+suffix))
            else:os.rename(path,path.with_name(path.name+suffix))
    b.sync_dir(f.PARENT)
    return info


def prepared_records(rec):
    api=load(b.STAGE/'journal.json');web=load(f.STAGE/'journal.json')
    f.require(api['state']=='prepared' and web['state']=='prepared','Preparation incomplete')
    b.checked_payload(api);b.check(api,'before');f.rollback_guard(web)
    f.require(f.snapshot(Path(web['root']))==web['before_snapshot'] and f.snapshot(f.STAGE/'swap')==web['after_snapshot'],'Web changed after preparation')
    db.verify(rec['database'])
    return api,web


def rollback(meta,rec):
    api=load(b.STAGE/'journal.json');web=load(f.STAGE/'journal.json')
    # Validate both independent snapshots before restoring either component.
    f.rollback_guard(web);b.checked_payload(api);b.check(api)
    failures=[]
    try:f.restore(meta,web)
    except BaseException as error:
        if f.snapshot(Path(web['root']))!=web['before_snapshot']:raise
        failures.append(type(error).__name__)
    try:b.restore(api)
    except BaseException as error:failures.append(type(error).__name__)
    f.require(not failures,'Rollback verification incomplete; keep backups and repeat --rollback')
    rec['state']='rolled_back';save(rec)
    # Never drop/restore the help table: employees may already have saved edits.
    f.emit('ROLLED_BACK BUILD_ID='+meta['before_build']+'; help table retained, existing data unchanged')


def activate(meta,rec,schema,seed):
    api,web=prepared_records(rec)
    f.require(rec['state']=='prepared','Run --prepare successfully first')
    storage=db.metadata(rec['database'])
    f.require(not storage['exists'] or db.owned(storage,rec['marker']),'Help table appeared after preparation; no live files changed')
    rec['state']='applying_database';save(rec)
    try:
        db.migrate(rec['database'],rec['marker'],schema,seed)
        rec['state']='activating';save(rec)
        b.activate(api)
        f.activate(meta,web)
        b.check(api,'after');b.probe_live(api)
        db.verify(rec['database'])
        f.require(db.owned(db.metadata(rec['database']),rec['marker']),'Help storage changed during activation')
    except BaseException as error:
        f.emit('Activation failed; restoring the previous web/API files. Help data will be retained.')
        try:rollback(meta,rec)
        except BaseException:raise f.Stop('ROLLBACK_INCOMPLETE: retain backups and run --rollback') from None
        raise f.Stop('Activation failed; previous web/API restored. '+(str(error) if isinstance(error,f.Stop) else type(error).__name__)) from None
    rec['state']='active';save(rec)
    f.emit('RELEASE_OK BUILD_ID='+meta['after_build'])
    f.emit('STORAGE=existing RU PostgreSQL; TABLE=master_help_materials')
    f.emit('Verify owner/manager/master in the app. Real employee login has not been automated.')
    f.emit('ROLLBACK: python3 /root/bos293.pyz --rollback')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    for action in ('check','prepare','apply','rollback'):group.add_argument('--'+action,action='store_true')
    args=parser.parse_args()
    if args.check:b.probe=health.probe_readonly
    f.require(os.geteuid()==0 and sys.platform=='linux','Run as root on the existing Linux server')
    f.require(f.PARENT.is_dir() and f.PARENT.resolve()==f.PARENT,'Existing deployment directory missing')
    os.umask(0o077)
    meta,files,optional=f.package()
    with zipfile.ZipFile(Path(__file__).parent) as archive:
        patched=archive.read('master-memo-api.ts');sql={n:archive.read(n) for n in ['schema.sql','seed.sql']}
    f.require(f.sha(patched)==meta['api_source_sha256']==b.SOURCE_AFTER,'API package changed')
    f.require(all(f.sha(data)==meta['sql_sha256'][name] for name,data in sql.items()),'SQL package changed')
    lock=os.open(f.PARENT,os.O_RDONLY|os.O_DIRECTORY)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        record=load(ROOT/'journal.json') if (ROOT/'journal.json').exists() else None
        if args.rollback:
            f.require(record is not None and (f.STAGE/'journal.json').exists(),'No complete release backup; production activation has not started')
            rollback(meta,record);return
        if record and record['state']=='active':
            api=load(b.STAGE/'journal.json');web=load(f.STAGE/'journal.json')
            b.check(api,'after');b.probe_live(api);f.check_container(web)
            f.require(f.snapshot(Path(web['root']))==web['after_snapshot'],'Active frontend changed')
            f.public_verify(meta,web['served_after']);db.verify(record['database'])
            f.require(db.owned(db.metadata(record['database']),record['marker']),'Help storage changed')
            f.emit('ALREADY_DEPLOYED; content and versions preserved');return
        if args.apply:
            f.require(record is not None,'Run --prepare first')
            activate(meta,record,sql['schema.sql'].decode(),sql['seed.sql'].decode());return
        if args.prepare and record and record['state']=='prepared':
            prepared_records(record)
            f.emit('PREPARED; production unchanged. Installation: python3 /root/bos293.pyz --apply');return
        root,_,_,_=f.preflight(meta,optional)
        info=b.discover(root);context,storage=db.discover();resources(info)
        reuse=storage['exists'] and record is not None and context==record['database'] and db.owned(storage,record['marker'])
        f.require(not storage['exists'] or reuse,'Help table already exists outside this saved release; preserve it for review')
        if args.check:
            f.emit('CHECK_OK; database roles and active release verified; no files or services changed');return
        archive_unactivated(meta)
        ROOT.mkdir(mode=0o700,exist_ok=True);b.sync_dir(ROOT.parent)
        marker=record['marker'] if reuse else 'bos-help293:'+uuid.uuid4().hex
        record=dict(main_sha=f.MAIN,state='preparing',marker=marker,database=context)
        save(record)
        f.emit('Preparing private copies and compiling only master-memo-api...')
        b.prepare({**info,'database':context},patched)
        f.prepare(meta,files,optional)
        db.verify(context);storage=db.metadata(context)
        f.require(not storage['exists'] or db.owned(storage,marker),'Help table appeared during preparation')
        record['state']='prepared';save(record)
        f.emit('PREPARED_OK; production files, database and services unchanged')
        f.emit('Installation after Preview approval: python3 /root/bos293.pyz --apply')
    finally:os.close(lock)


def run():
    signal.signal(signal.SIGTERM,lambda signum,frame:(_ for _ in ()).throw(f.Stop('Interrupted; keep private release journals')))
    try:main()
    except (f.Stop,OSError,ValueError,zipfile.BadZipFile,KeyboardInterrupt) as error:
        print('STOP: '+(str(error) if isinstance(error,f.Stop) else type(error).__name__),file=sys.stderr,flush=True);sys.exit(1)
