#!/usr/bin/env python3
"""Add the stable domain using ZeroSSL ACME, preserving both IP sites.

Default: read-only preflight. --apply backs up, validates, reloads only Caddy
and checks real HTTPS/API responses. --rollback restores this change only.
No database, containers, application files or network routes are restarted.
"""
import argparse
import copy
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen
from urllib.error import URLError

DOMAIN = 'homemaster.qd.je'
IP = '136.234.17.113'
CONTAINER = 'bos-release-to2wblxf-https'
CONFIG = Path('/opt/business-os/deploy/release-to2wblxf/caddy/Caddyfile')
STAGE = Path('/root/bos-domain-homemaster-zerossl-20261028')
PREVIOUS = Path('/root/bos-domain-homemaster-20261028')
BEFORE = b'https://139.100.237.167, https://136.234.17.113 {'
IPS = {'139.100.237.167', IP}
ZERO_CA = 'https://acme.zerossl.com/v2/DV90'
LE_TLS = re.compile(rb'(?m)^[ \t]*tls[ \t]*\{\s*issuer acme https://acme-v02\.api\.letsencrypt\.org/directory[ \t]*\{\s*profile shortlived\s*\}\s*\}')

class Stop(Exception):pass

def digest(data):return hashlib.sha256(data).hexdigest()

def prepare(data,email):
    if data.count(BEFORE) != 1 or DOMAIN.encode() in data:
        raise Stop('Caddy site differs from reviewed configuration; no changes made')
    if b'admin 127.0.0.1:12019' not in data:
        raise Stop('Unexpected Caddy admin endpoint')
    if not re.fullmatch(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',email or ''):
        raise Stop('A valid ACME contact --email is required')
    body=data.split(BEFORE,1)[1]
    if len(LE_TLS.findall(body))!=1:raise Stop('Expected IP TLS block differs; no changes made')
    tls=(' tls {\n  issuer acme '+ZERO_CA+' {\n   email '+email+'\n  }\n }').encode()
    domain_body=LE_TLS.sub(lambda _:tls,body,count=1)
    return data+b'\nhttps://'+DOMAIN.encode()+b' {'+domain_body

def normalized_route(route,config_path):
    groups={}
    def walk(value):
        if isinstance(value,list):return [walk(x) for x in value]
        if isinstance(value,dict):
            result={}
            for k,v in value.items():
                if value.get('handler')=='file_server' and k=='hide' and isinstance(v,list):
                    result[k]=['<Caddyfile>' if x==config_path else x for x in v]
                elif k=='group' and isinstance(v,str):
                    if v not in groups:groups[v]='g'+str(len(groups))
                    result[k]=groups[v]
                else:result[k]=walk(v)
            return result
        return value
    return walk(route)

def verify_adaptation(before,after,email,old_path='/etc/caddy/Caddyfile',new_path='/etc/caddy/Caddyfile.homemaster.zerossl.next'):
    """Refuse any change except adding the identical app under a new TLS name."""
    original=copy.deepcopy(before);candidate=copy.deepcopy(after)
    bs=original['apps']['http']['servers'];ns=candidate['apps']['http']['servers']
    if len(bs)!=1 or set(bs)!=set(ns):raise Stop('Unexpected HTTP server topology')
    old=next(iter(bs.values()));new=next(iter(ns.values()))
    old_routes=old.pop('routes');new_routes=new.pop('routes')
    if len(old_routes)!=1 or old_routes[0].get('match')!=[{'host':['139.100.237.167',IP]}]:
        raise Stop('Expected one existing IP site; no changes made')
    if len(new_routes)!=2:raise Stop('Unexpected number of adapted routes')
    by_hosts={frozenset(r['match'][0]['host']):r for r in new_routes if len(r.get('match',[]))==1 and set(r['match'][0])=={'host'}}
    if set(by_hosts)!={frozenset(IPS),frozenset({DOMAIN})}:raise Stop('Unexpected hostname routes')
    for route in by_hosts.values():
        comparable=copy.deepcopy(route);comparable['match']=old_routes[0]['match']
        if normalized_route(comparable,new_path)!=normalized_route(old_routes[0],old_path):raise Stop('Application routes changed')
    old_tls=old.pop('tls_connection_policies',[]);new_tls=new.pop('tls_connection_policies',[])
    def stripped(p):
        p=copy.deepcopy(p);match=p.pop('match',{})
        if set(match)-{'sni'}:raise Stop('Unexpected TLS connection matcher')
        if set(match.get('sni',[]))-IPS-{'',DOMAIN}:raise Stop('Unexpected TLS server name')
        return p
    allowed=[stripped(p) for p in old_tls]
    if any(stripped(p) not in allowed for p in new_tls):raise Stop('TLS connection settings changed')
    policies=candidate['apps']['tls']['automation']['policies']
    domain_policy=[p for p in policies if p.get('subjects')==[DOMAIN]]
    expected={'subjects':[DOMAIN],'issuers':[{'module':'acme','ca':ZERO_CA,'email':email}]}
    if domain_policy!=[expected]:raise Stop('Unexpected domain certificate issuer settings')
    candidate['apps']['tls']['automation']['policies']=[p for p in policies if p not in domain_policy]
    if original!=candidate:raise Stop('An unrelated Caddy setting changed')

def validate_candidate(name,email):
    base=['docker','exec',CONTAINER,'caddy','adapt','--adapter','caddyfile','--config']
    old=json.loads(command(base+['/etc/caddy/'+CONFIG.name]))
    new=json.loads(command(base+['/etc/caddy/'+name]))
    verify_adaptation(old,new,email)
    command(['docker','exec',CONTAINER,'caddy','validate','--config','/etc/caddy/'+name,'--adapter','caddyfile'])

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

def verify_domain(window=300,clock=time.monotonic,sleep=time.sleep):
    last=None
    deadline=clock()+window
    attempt=0
    while True:
        attempt+=1
        try:
            health('https://'+DOMAIN)
            for _ in range(2):
                if get_json('https://'+DOMAIN,'/functions/v1/mini-app-api',{'action':'health'}).get('ok') is not True:raise Stop('Repeated API health failed')
            with urlopen('https://'+DOMAIN+'/build-version.js',timeout=12) as r:
                if r.status!=200 or b'self.BOS_BUILD=' not in r.read(200_000):raise Stop('Frontend manifest unavailable')
            return
        except Exception as e:
            reason=e.reason if isinstance(e,URLError) else e
            last=type(reason).__name__+': '+str(reason)[:220]
            if clock()>=deadline:break
            print('Waiting for domain HTTPS, attempt '+str(attempt)+' (up to 5 minutes)',flush=True)
            sleep(min(10,max(0,deadline-clock())))
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
    candidate=config.with_name('Caddyfile.homemaster.zerossl.next')
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
    g.add_argument('--apply',action='store_true');g.add_argument('--rollback',action='store_true');g.add_argument('--check',action='store_true')
    p.add_argument('--email',help='Contact email for automatic ZeroSSL ACME account setup');a=p.parse_args()
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
        before=CONFIG.read_bytes();after=prepare(before,a.email)
        previous=json.loads((PREVIOUS/'journal.json').read_text())
        if previous.get('status')!='rolled_back' or digest(before)!=previous['before']:
            raise Stop('Previous attempt is not fully rolled back; no changes made')
        check_dns();health('https://'+IP)
        if not get_json(ZERO_CA,'').get('newOrder'):raise Stop('ZeroSSL ACME directory is unavailable')
        print('BOS_DOMAIN_PREFLIGHT_OK',flush=True)
        if not a.apply:return
        install(CONFIG,STAGE,before,after,validate_fn=lambda name:validate_candidate(name,a.email))
        print('BOS_DOMAIN_CONNECTED https://'+DOMAIN)
        print('BACKUP='+str(STAGE))
        print('TLS and three API checks passed. Actual user login and PWA checks remain required.')

if __name__=='__main__':
    try:main()
    except Exception as e:
        print('BOS_DOMAIN_STOPPED: '+(str(e) if isinstance(e,Stop) else type(e).__name__));sys.exit(1)
