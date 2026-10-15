#!/usr/bin/env python3
"""Repeat only disposable PostgreSQL startup; never activate the help release.
Uses the exact installed, hash-pinned candidate; emits errors from the synthetic
PostgreSQL only. No production rows/logs are read; live credentials are never
printed or forwarded to the disposable container.
"""
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import signal
import shutil
import subprocess
import sys
import time
import urllib.parse
import uuid
import zipfile

ZIP=Path('/root/bos293.pyz')
ZIP_SHA='527ccfe24723ebcdb449ae1290e18b021fc2c41c6c879c5e33497037bfe558da'


def safe_lines(raw,password):
    """Bounded test-process output; redact test credentials and terminal controls."""
    text=raw.decode(errors='replace') if isinstance(raw,bytes) else str(raw)
    text=text.replace(password,'[redacted]')
    text=re.sub(r'postgres(?:ql)?://\S+','[redacted URI]',text)
    lines=[]
    for line in text.splitlines():
        if not re.search(r'error|fatal|panic|denied|could not|cannot|not exist|not running|not permitted|not found|connection|socket|init process complete|ready to accept',line,re.I):continue
        lines.append(re.sub(r'[\x00-\x1f\x7f]',' ',line)[:350])
    return lines[-8:]


def fixture(archive):
    tree=ast.parse(archive.read('probe_runtime.py').decode())
    values=[node.value.value for node in ast.walk(tree) if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='fixture' for t in node.targets) and isinstance(node.value,ast.Constant) and isinstance(node.value.value,str)]
    if len(values)!=1:raise ValueError('Pinned test fixture unavailable')
    return values[0]+archive.read('schema.sql').decode()+archive.read('seed.sql').decode()


def test_sql(cid,statement,shell,name='help_preview'):
    # Only the container just created below is ever passed to this function.
    shell=shell.replace('-v VERBOSITY=sqlstate','-v VERBOSITY=default')
    return subprocess.run(['docker','exec','-i','-e','PGHOST=127.0.0.1',cid,'sh','-c',shell,'help-metadata',name],
                          input=statement.encode(),capture_output=True,timeout=20)


def report_and_cleanup(cid,nonce,password,record,f,b):
    try:
        if cid and re.fullmatch('[a-f0-9]{64}',cid):
            # Do not inspect or export logs from any pre-existing container.
            try:
                info=f.inspect(cid)
                if info['Config'].get('Labels',{}).get('bos.help293')==nonce and info['Id']==cid:
                    state=info['State']
                    print('TEST_PG_STATE='+str(state.get('Status'))+' EXIT='+str(state.get('ExitCode'))+' OOM='+str(state.get('OOMKilled')),flush=True)
                    logs=subprocess.run(['docker','logs','--tail','60',cid],capture_output=True,timeout=10)
                    for line in safe_lines(logs.stdout+logs.stderr,password):print('TEST_PG: '+line,flush=True)
            except (OSError,subprocess.SubprocessError,RuntimeError,f.Stop):print('TEST_PG_LOGS=UNAVAILABLE',flush=True)
    finally:
        b.cleanup(record)


def main():
    if os.geteuid()!=0 or not ZIP.is_file() or hashlib.sha256(ZIP.read_bytes()).hexdigest()!=ZIP_SHA:
        raise RuntimeError('Run as root with the previously downloaded bos293.pyz unchanged')
    sys.path.insert(0,str(ZIP))
    import frontend as f
    import backend as b
    import database as db
    import probe_runtime as probe
    os.umask(0o077)
    lock=os.open(f.PARENT,os.O_RDONLY|os.O_DIRECTORY)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        journal=b.STAGE/'journal.json'
        f.require(journal.is_file() and journal.resolve()==journal and journal.stat().st_uid==0,'Prepared private API journal missing')
        saved=json.loads(journal.read_text())
        f.require(saved['main_sha']==f.MAIN and saved['state']=='preparing','Expected failed preparation; live activation not supported')
        b.check(saved,'before');db.verify(saved['database'])
        available=re.search(r'^MemAvailable:\s+(\d+)\s+kB$',Path('/proc/meminfo').read_text(),re.M)
        f.require(available and int(available[1])>=512*1024,'Insufficient RAM for disposable PostgreSQL')
        f.require(shutil.disk_usage(f.PARENT).free>=512*1024*1024,'Insufficient disk for disposable PostgreSQL')
        nonce=uuid.uuid4().hex;record={**saved,'nonce':nonce}
        # Isolated diagnostic has its own directory and cleanup marker. Existing
        # preparation, candidate bundles, backups and journals remain untouched.
        b.STAGE=f.PARENT/('help293-pg-check-'+nonce)
        b.STAGE.mkdir(mode=0o700)
        data=b.STAGE/'data';data.mkdir(mode=0o700)
        password=secrets.token_hex(24)
        environment=probe.envfile('test.env',probe.pg_environment(password))
        aliases=[]
        for name in ('BOS_AUTH_ORIGIN','BOS_REST_ORIGIN','BOS_STORAGE_ORIGIN'):
            host=urllib.parse.urlsplit(record['environment'][name]).hostname
            f.require(host is not None,'Test service hostname missing')
            aliases+=['--add-host',host+':127.0.0.1']
        args=['docker','run','-d','--pull=never','--label','bos.help293='+nonce,'--name','bos-help293-pg-check-'+nonce,
              '--network','none','--memory','256m','--memory-swap','256m','--pids-limit','128','--cpus','1',*aliases,
              '--env-file',environment,'--mount','type=bind,src='+str(data)+',dst=/var/lib/postgresql/data',record['database']['db_image']]
        print('MODE=ISOLATED_PG_DIAGNOSTIC; production unchanged',flush=True)
        cid=None;last=None;phase='startup';okay=False
        try:
            cid=b.private_command(args,'start').decode().strip()
            f.require(re.fullmatch('[a-f0-9]{64}',cid),'Unexpected test container ID')
            info=f.inspect(cid)
            f.require(info['Config'].get('Labels',{}).get('bos.help293')==nonce and info['Id']==cid,'Test container ownership mismatch')
            b.assert_isolated(cid)
            for attempt in range(60):
                last=test_sql(cid,"BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT json_build_object('ok',true); ROLLBACK;",db.SHELL,'postgres')
                if last.returncode==0:break
                if not f.inspect(cid)['State']['Running']:break
                time.sleep(1)
            if last.returncode==0:
                print('TEST_PG_BOOTSTRAP=OK',flush=True);phase='create_database'
                last=test_sql(cid,'CREATE DATABASE help_preview;',db.SHELL,'postgres')
            if last.returncode==0:
                print('TEST_PG_CONNECT=OK',flush=True);phase='fixture'
                with zipfile.ZipFile(ZIP) as archive:statement=fixture(archive)
                last=test_sql(cid,"BEGIN; SET LOCAL statement_timeout='15s'; "+statement+' COMMIT;',db.SHELL)
                if last.returncode==0:print('TEST_PG_FIXTURE=OK',flush=True);okay=True
            if last.returncode:
                print('FAILED_PHASE='+phase,flush=True)
                for line in safe_lines(last.stderr,password):print('TEST_SQL: '+line,flush=True)
        finally:
            report_and_cleanup(cid,nonce,password,record,f,b)
        print('RESULT='+('TEST_PG_OK' if okay else 'TEST_PG_FAILED')+'; no application update performed',flush=True)
    finally:os.close(lock)


if __name__=='__main__':
    signal.signal(signal.SIGTERM,lambda signum,frame:(_ for _ in ()).throw(KeyboardInterrupt()))
    try:main()
    except (Exception,KeyboardInterrupt) as error:
        # No arbitrary exceptions/configuration values are printed.
        print('DIAGNOSTIC_STOP='+type(error).__name__+'; production unchanged',file=sys.stderr)
        sys.exit(1)
