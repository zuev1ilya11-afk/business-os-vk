#!/usr/bin/env python3
"""Persist the already-working eth1 policy route without applying or restarting networking."""
import argparse
import fcntl
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.request import Request, urlopen
import yaml

ROOT=Path('/')
STAGE=Path('/root/bos-netplan-persistent-20261028')
TARGET=Path('etc/netplan/90-business-os-public-ip.yaml')
DEVICE='eth1'
MAC='fa:16:3e:46:12:31'
IP='136.234.17.113'
GATEWAY='136.234.17.1'
TABLE=42113
PRIORITY=12113
NET_ID='bos-public2'
CONTENT=b'''network:
  version: 2
  ethernets:
    bos-public2:
      renderer: networkd
      match:
        macaddress: fa:16:3e:46:12:31
      set-name: eth1
      dhcp4: false
      dhcp6: false
      optional: true
      mtu: 1500
      addresses:
        - 136.234.17.113/24
      routes:
        - to: 136.234.17.0/24
          scope: link
          table: 42113
        - to: default
          via: 136.234.17.1
          table: 42113
      routing-policy:
        - from: 136.234.17.113/32
          table: 42113
          priority: 12113
'''

class Stop(Exception):pass
def digest(value):return hashlib.sha256(value).hexdigest()
def run(args):
    p=subprocess.run(args,capture_output=True,text=True,timeout=30)
    if p.returncode:raise Stop(args[0]+' read/validation failed (exit '+str(p.returncode)+')')
    return p.stdout
def ip_json(*args):return json.loads(run(['ip','-j',*args]))

def validate_runtime(addresses,routes,rules,main):
    if len(addresses)!=1 or addresses[0].get('address','').lower()!=MAC:raise Stop('eth1 MAC differs from the reviewed port')
    if addresses[0].get('mtu')!=1500:raise Stop('eth1 MTU differs from the reviewed value')
    if not any(x.get('family')=='inet' and x.get('local')==IP and x.get('prefixlen')==24 for x in addresses[0].get('addr_info',[])):
        raise Stop('The new IPv4 address is not active on eth1')
    route=routes[0] if len(routes)==1 else {}
    if route.get('dev')!=DEVICE or route.get('gateway')!=GATEWAY or str(route.get('table'))!=str(TABLE):
        raise Stop('Source routing through eth1 is not the expected working route')
    owned=[r for r in rules if r.get('priority')==PRIORITY]
    if len(owned)!=1 or owned[0].get('src') not in (IP,IP+'/32') or str(owned[0].get('table'))!=str(TABLE):
        raise Stop('Source policy rule is missing or conflicts')
    if len(main)!=1 or main[0].get('dev')!='eth0' or main[0].get('gateway')!='139.100.237.1':
        raise Stop('The primary default route has changed; no persistence changes made')

def runtime_check():
    if run(['systemctl','is-active','systemd-networkd']).strip()!='active':raise Stop('networkd is not active')
    validate_runtime(ip_json('addr','show','dev',DEVICE),ip_json('route','get','1.1.1.1','from',IP),
                     ip_json('rule','show'),ip_json('route','show','table','main','default'))

def files(root,exclude_target=False):
    result={}
    for directory in ('lib/netplan','etc/netplan','run/netplan'):
        for file in (root/directory).glob('*.yaml'):
            relative=file.relative_to(root)
            if exclude_target and relative==TARGET:continue
            if file.is_symlink():raise Stop('A Netplan YAML is symlinked; inspect manually')
            result[str(relative)]=file.read_bytes()
    return result

def conflicts(snapshot):
    for name,data in snapshot.items():
        if any(x in data for x in (MAC.encode(),IP.encode(),b'42113',b'12113')):
            raise Stop('A current Netplan file already references the new port or policy; no overwrite')
        doc=yaml.safe_load(data) or {}
        network=doc.get('network',{})
        for kind in ('ethernets','bonds','bridges','vlans'):
            for ident,settings in (network.get(kind,{}) or {}).items():
                if not isinstance(settings,dict):raise Stop('Unexpected Netplan definition')
                if ident in (NET_ID,DEVICE) or settings.get('set-name')==DEVICE:
                    raise Stop('eth1 already has a persistent definition')
                match=settings.get('match',{})
                if match.get('macaddress') and str(match['macaddress']).lower()!=MAC:continue
                if 'name' in match and fnmatch.fnmatchcase(DEVICE,str(match['name'])):
                    raise Stop('An existing interface match also selects eth1')
                if match.get('driver') and 'name' not in match and 'macaddress' not in match:
                    raise Stop('An existing driver match might select eth1')

def write_new(path,data,mode=0o600):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix='.bos-netplan-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as out:
            os.fchmod(out.fileno(),mode);out.write(data);out.flush();os.fsync(out.fileno())
        os.link(temp,path)
        directory=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def sections(text):
    result=[];current=None
    for line in text.splitlines():
        line=line.strip()
        if line.startswith('[') and line.endswith(']'):
            current=(line[1:-1],{});result.append(current)
        elif current and '=' in line and not line.startswith('#'):
            key,value=line.split('=',1);current[1].setdefault(key,[]).append(value)
    return result

def validate_generated(text):
    blocks=sections(text)
    has=lambda kind,key,value:any(n==kind and value in values.get(key,[]) for n,values in blocks)
    if not has('Network','Address',IP+'/24'):raise Stop('Generated eth1 address differs')
    routes=[v for n,v in blocks if n=='Route']
    if len(routes)!=2 or any(v.get('Table')!=[str(TABLE)] for v in routes):raise Stop('Generated routes would affect another routing table')
    if not any(v.get('Destination')==['136.234.17.0/24'] and v.get('Scope')==['link'] for v in routes):raise Stop('Generated connected route differs')
    if not any(v.get('Destination')==['0.0.0.0/0'] and v.get('Gateway')==[GATEWAY] for v in routes):raise Stop('Generated policy default route differs')
    policies=[v for n,v in blocks if n=='RoutingPolicyRule']
    if len(policies)!=1 or policies[0].get('Table')!=[str(TABLE)] or policies[0].get('Priority')!=[str(PRIORITY)] or policies[0].get('From') not in ([IP],[IP+'/32']):
        raise Stop('Generated source policy differs')

def generate_safely(snapshot):
    generated=[]
    with tempfile.TemporaryDirectory(prefix='bos-netplan-') as folder:
        for mode in ('before','after'):
            root=Path(folder)/mode;root.mkdir(mode=0o700)
            for name,data in snapshot.items():write_new(root/name,data)
            if mode=='after':write_new(root/TARGET,CONTENT)
            run(['netplan','generate','--root-dir',str(root)])
            directory=root/'run/systemd/network'
            generated.append({p.name:p.read_bytes() for p in directory.glob('*') if p.is_file()})
    before,after=generated
    if any(after.get(name)!=data for name,data in before.items()):raise Stop('Existing generated network settings would change')
    allowed={'10-netplan-'+NET_ID+'.network','10-netplan-'+NET_ID+'.link'}
    if set(after)-set(before)!=allowed:raise Stop('Unexpected generated network file set')
    validate_generated(after['10-netplan-'+NET_ID+'.network'].decode())
    link=after['10-netplan-'+NET_ID+'.link'].decode()
    if MAC not in link or 'Name=eth1' not in link:raise Stop('Generated port identity differs')

def health():
    req=Request('https://'+IP+'/functions/v1/mini-app-api',data=b'{"action":"health"}',headers={'Content-Type':'application/json'})
    with urlopen(req,timeout=12) as response:
        if response.status!=200 or json.load(response).get('ok') is not True:raise Stop('Current API health failed')

def save(root,stage,snapshot,verify=lambda:None):
    if files(root)!=snapshot:raise Stop('Netplan files changed concurrently')
    if (root/TARGET).exists():raise Stop('Target already exists; no overwrite')
    stage.mkdir(mode=0o700,exist_ok=False)
    for name,data in snapshot.items():write_new(stage/'before'/name,data)
    record={'status':'prepared','target':str(TARGET),'sha256':digest(CONTENT),'original':{k:digest(v) for k,v in snapshot.items()}}
    write_new(stage/'journal.json',json.dumps(record).encode())
    owned=False
    try:
        if files(root)!=snapshot:raise Stop('Netplan files changed during backup')
        write_new(root/TARGET,CONTENT);owned=True
        verify()
        if files(root,exclude_target=True)!=snapshot:raise Stop('Unrelated Netplan files changed during save')
        record['status']='saved_no_restart'
    except BaseException:
        if owned and (root/TARGET).read_bytes()==CONTENT:(root/TARGET).unlink()
        record['status']='rolled_back'
        raise
    finally:
        (stage/'journal.json').write_text(json.dumps(record))

def rollback(root,stage):
    record=json.loads((stage/'journal.json').read_text())
    target=root/TARGET
    if record.get('sha256')!=digest(CONTENT):raise Stop('Unexpected persistence journal')
    if target.exists():
        if target.is_symlink() or target.read_bytes()!=CONTENT:raise Stop('Rollback refuses an unrelated target change')
        target.unlink()
    record['status']='rolled_back';(stage/'journal.json').write_text(json.dumps(record))

def main():
    parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group()
    group.add_argument('--save',action='store_true');group.add_argument('--rollback',action='store_true')
    args=parser.parse_args()
    if os.geteuid()!=0:raise Stop('Run on the production host as root')
    with Path('/run/lock/bos-netplan-persistence.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.rollback:rollback(ROOT,STAGE);print('BOS_NETWORK_CONFIG_ROLLED_BACK_NO_RESTART');return
        runtime_check();health()
        if (ROOT/TARGET).exists():
            if (ROOT/TARGET).read_bytes()==CONTENT and (STAGE/'journal.json').exists():
                print('BOS_NETWORK_CONFIG_ALREADY_SAVED_NO_RESTART');return
            raise Stop('Target already exists; no overwrite')
        snapshot=files(ROOT)
        if not snapshot:raise Stop('No current Netplan files were found')
        conflicts(snapshot);generate_safely(snapshot)
        print('BOS_NETWORK_PERSISTENCE_PREFLIGHT_OK',flush=True)
        if not args.save:return
        save(ROOT,STAGE,snapshot,lambda:(runtime_check(),health()))
        print('BOS_NETWORK_CONFIG_SAVED_NO_RESTART')
        print('BACKUP='+str(STAGE))
        print('Current API and routing passed. Boot behavior has not been tested.')

if __name__=='__main__':
    try:main()
    except Exception as e:
        print('BOS_NETWORK_STOPPED: '+(str(e) if isinstance(e,Stop) else type(e).__name__));raise SystemExit(1)
