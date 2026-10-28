#!/usr/bin/env python3
"""Add the user's stable domain to the existing Caddy site. No DNS mutations.

Default: read-only preflight. --apply backs up, validates, reloads only Caddy
and checks real HTTPS/API responses. --rollback restores this change only.
No database, containers, application files or network routes are restarted.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen

DOMAIN = 'homemaster.qd.je'
IP = '136.234.17.113'
CONTAINER = 'bos-release-to2wblxf-https'
CONFIG = Path('/opt/business-os/deploy/release-to2wblxf/caddy/Caddyfile')
STAGE = Path('/root/bos-domain-homemaster-20261028')
BEFORE = b'https://139.100.237.167, https://136.234.17.113 {'
AFTER = b'https://139.100.237.167, https://136.234.17.113, https://homemaster.qd.je {'

class Stop(Exception):pass

def digest(data):return hashlib.sha256(data).hexdigest()

def prepare(data):
    if data.count(BEFORE) != 1 or DOMAIN.encode() in data:
        raise Stop('Caddy site differs from reviewed configuration; no changes made')
    if b'admin 127.0.0.1:12019' not in data:
        raise Stop('Unexpected Caddy admin endpoint')
    return data.replace(BEFORE, AFTER)

def atomic(path, data, mode=0o600, uid=None, gid=None):
    fd, temp = tempfile.mkstemp(prefix='.bos-domain-', dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as out:
            out.write(data);out.flush();os.fchmod(out.fileno(),mode)
            if uid is not None:os.fchown(out.fileno(),uid,gid)
            os.fsync(out.fileno())
        os.replace(temp,path)
        fd=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(fd)
        finally:os.close(fd)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def command(args):
    p=subprocess.run(args,capture_output=True,text=True,timeout=30)
    if p.returncode:raise Stop('Command failed: '+args[0]+' '+('Caddy validation/reload' if 'caddy' in args else 'container inspection'))
    return p.stdout

def reload_config(name):
    command(['docker','exec',CONTAINER,'caddy','reload','--config','/etc/caddy/'+name,'--adapter','caddyfile','--address','127.0.0.1:12019'])

def check_container():
    data=json.loads(command(['docker','inspect',CONTAINER]))[0]
    if not data.get('State',{}).get('Running'):raise Stop('Expected Caddy container is not running')
    matches=[m for m in data.get('Mounts',[]) if m.get('Destination')=='/etc/caddy' and m.get('Type')=='bind']
    if len(matches)!=1 or Path(matches[0]['Source']).resolve()!=CONFIG.parent.resolve():raise Stop('Caddy configuration mount changed')
    if CONFIG.is_symlink() or not CONFIG.is_file():raise Stop('Caddyfile missing or symlinked')

def check_dns():
    try:addresses={x[4][0] for x in socket.getaddrinfo(DOMAIN,443,socket.AF_INET,socket.SOCK_STREAM)}
    except socket.gaierror:raise Stop('DNS A record is not ready; expected '+IP)
    if addresses!={IP}:raise Stop('DNS A record must point only to '+IP)
    try:ipv6={x[4][0] for x in socket.getaddrinfo(DOMAIN,443,socket.AF_INET6,socket.SOCK_STREAM)}
    except socket.gaierror:ipv6=set()
    if ipv6:raise Stop('An AAAA record exists; verify IPv6 before connecting this domain')

def get_json(origin,path,data=None):
    body=None if data is None else json.dumps(data).encode()
    req=Request(origin+path,data=body,headers={'Content-Type':'application/json','Cache-Control':'no-cache'})
    with urlopen(req,timeout=12) as r:
        if r.status!=200:raise Stop('HTTPS API did not return 200')
        return json.load(r)

def health(origin):
    if get_json(origin,'/functions/v1/mini-app-api',{'action':'health'}).get('ok') is not True:raise Stop('mini-app health failed')
    if not get_json(origin,'/auth/v1/health'):raise Stop('Auth health failed')

def verify_domain():
    last=None
    for attempt in range(1,7):
        try:
            health('https://'+DOMAIN)
            for _ in range(2):
                if get_json('https://'+DOMAIN,'/functions/v1/mini-app-api',{'action':'health'}).get('ok') is not True:raise Stop('Repeated API health failed')
            with urlopen('https://'+DOMAIN+'/build-version.js',timeout=12) as r:
                if r.status!=200 or b'self.BOS_BUILD=' not in r.read(200_000):raise Stop('Frontend manifest unavailable')
            return
        except Exception as e:
            last=type(e).__name__
            print('Waiting for domain HTTPS certificate/check, attempt '+str(attempt)+'/6',flush=True)
            if attempt<6:time.sleep(2)
    raise Stop('Domain HTTPS verification failed: '+str(last))

def journal(stage,record):atomic(stage/'journal.json',json.dumps(record).encode())

def rollback(config,stage,record,reload_fn=reload_config):
    current=digest(config.read_bytes());backup=(stage/'Caddyfile.before').read_bytes()
    if current not in (record['before'],record['after']) or digest(backup)!=record['before']:raise Stop('Rollback refuses to overwrite an unrelated change or invalid backup')
    atomic(config,backup,record['mode'],record['uid'],record['gid'])
    reload_fn(config.name)
    record['status']='rolled_back';journal(stage,record)

def install(config,stage,before,after,verify=verify_domain,reload_fn=reload_config,validate_fn=None):
    if config.read_bytes()!=before:raise Stop('Caddyfile changed concurrently')
    info=config.stat();stage.mkdir(mode=0o700,exist_ok=False)
    record={'before':digest(before),'after':digest(after),'mode':stat.S_IMODE(info.st_mode),'uid':info.st_uid,'gid':info.st_gid,'status':'prepared'}
    atomic(stage/'Caddyfile.before',before);journal(stage,record)
    candidate=config.with_name('Caddyfile.homemaster.next')
    if candidate.exists():raise Stop('Candidate file already exists; inspect before retrying')
    atomic(candidate,after,record['mode'],record['uid'],record['gid'])
    try:
        if validate_fn:validate_fn(candidate.name)
        else:command(['docker','exec',CONTAINER,'caddy','validate','--config','/etc/caddy/'+candidate.name,'--adapter','caddyfile'])
        if config.read_bytes()!=before:raise Stop('Caddyfile changed concurrently')
        record['status']='installing';journal(stage,record)
        reload_fn(candidate.name)
        if config.read_bytes()!=before:raise Stop('Caddyfile changed during reload')
        atomic(config,after,record['mode'],record['uid'],record['gid'])
        verify();record['status']='deployed';journal(stage,record)
    except BaseException:
        if record['status']=='installing':rollback(config,stage,record,reload_fn)
        raise
    finally:
        if candidate.exists() and candidate.read_bytes()==after:candidate.unlink()
    return record

def main():
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group()
    g.add_argument('--apply',action='store_true');g.add_argument('--rollback',action='store_true');g.add_argument('--check',action='store_true');a=p.parse_args()
    check_container()
    with (CONFIG.parent/'.bos-domain.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if (STAGE/'journal.json').exists():
            record=json.loads((STAGE/'journal.json').read_text())
            if a.rollback or (a.apply and record['status']=='installing'):
                rollback(CONFIG,STAGE,record);print('BOS_DOMAIN_ROLLED_BACK');return
            if record['status']=='deployed' and digest(CONFIG.read_bytes())==record['after']:
                verify_domain();print('BOS_DOMAIN_CONNECTED https://'+DOMAIN);return
            raise Stop('Existing deployment journal requires inspection; no overwrite')
        if a.rollback:raise Stop('No domain backup exists')
        before=CONFIG.read_bytes();after=prepare(before)
        check_dns();health('https://'+IP)
        print('BOS_DOMAIN_PREFLIGHT_OK',flush=True)
        if not a.apply:return
        install(CONFIG,STAGE,before,after)
        print('BOS_DOMAIN_CONNECTED https://'+DOMAIN)
        print('BACKUP='+str(STAGE))
        print('TLS and three API checks passed. Actual user login and PWA checks remain required.')

if __name__=='__main__':
    try:main()
    except Exception as e:
        print('BOS_DOMAIN_STOPPED: '+(str(e) if isinstance(e,Stop) else type(e).__name__));sys.exit(1)
