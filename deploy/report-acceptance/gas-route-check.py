#!/usr/bin/env python3
"""Check the alternate Google route with signed, attachment-free GAS requests.

No hosts/DNS files, application files, database rows or service states change.
The resolver override is confined to this short-lived Python process.
"""
from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
from types import SimpleNamespace

ACTIVATE_SHA = '42d71a8b41072b383787f7fe8abccbc3b9a6121d363cdbb9d4d7b0b8f6b95059'
SOURCE = 'script.google.com'
TARGET = 'script.googleusercontent.com'


def emit(label,value):
    print(label+'='+json.dumps(value,separators=(',',':')),flush=True)


@contextmanager
def route_target(address):
    original = socket.getaddrinfo
    def routed(host,*args,**kwargs):
        return original(address if host==TARGET else host,*args,**kwargs)
    socket.getaddrinfo = routed
    try:
        yield
    finally:
        socket.getaddrinfo = original


def candidate_addresses():
    answers = socket.getaddrinfo(SOURCE,443,family=socket.AF_INET,type=socket.SOCK_STREAM)
    return list(dict.fromkeys(a[4][0] for a in answers if ipaddress.ip_address(a[4][0]).is_global))[:6]


def load_app():
    path = Path('/tmp/bos-activate.py')
    if path.resolve()!=path or hashlib.sha256(path.read_bytes()).hexdigest()!=ACTIVATE_SHA:
        raise RuntimeError('ACTIVATION_HELPER_CHANGED')
    spec = importlib.util.spec_from_file_location('bos_route_activation',path)
    app = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(app)
    app.s = SimpleNamespace(emit=emit)
    return app


def probe(app,sync,address):
    emit('GOOGLE_ROUTE_IP',address)
    try:
        with route_target(address):
            app.verify_gas(sync)
    except Exception as error:
        label = str(error)
        emit('GOOGLE_ROUTE_ERROR',label if re.fullmatch(r'[A-Z_]{1,100}',label) else 'PROBE_FAILED')
        return False
    emit('GAS_ROUTE_SIGNED_CHECK',True)
    return True


def main():
    sys.dont_write_bytecode = True
    app = load_app()
    if len(sys.argv)==3 and sys.argv[1]=='--network-probe':
        address = ipaddress.ip_address(sys.argv[2])
        app.require(address.version==4 and address.is_global,'PUBLIC_IPV4_REQUIRED')
        key = sys.stdin.read(4097)
        app.require(0<len(key)<=4096,'SIGNING_KEY_MISSING')
        raise SystemExit(0 if probe(app,key,str(address)) else 1)
    app.require(len(sys.argv)==1 and os.geteuid()==0,'ROOT_REQUIRED')
    app.s,app.v,app.r = app.load_helpers()
    with (app.s.PARENT/'.report-acceptance-stage.lock').open('r') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        journals = list(app.s.PARENT.glob('report-acceptance-stage-*/locked-*/runtime-*/activate-*/activation.json'))
        app.require(bool(journals),'ACTIVATION_JOURNAL_MISSING')
        path = max(journals,key=lambda p:p.stat().st_mtime_ns)
        journal = json.loads(app.s.read(path))
        app.require(journal['phase']=='complete_archive_pending','DEFERRED_RELEASE_REQUIRED')
        app.installed_files(journal)
        app.archive_inactive()
        runtime_path = Path(journal['runtime_journal'])
        app.require(app.s.sha(app.s.read(runtime_path))==journal['runtime_journal_sha256'],'RUNTIME_JOURNAL_CHANGED')
        rec = json.loads(app.s.read(runtime_path))
        edge = app.s.inspect(journal['edge_id'])
        app.require(edge['State']['Running'] and edge['Image']==rec['image'],'EDGE_CHANGED')
        sync = app.v.environment(edge).get('BOS_SYNC_KEY','')
        app.require(0<len(sync)<=4096,'SIGNING_KEY_MISSING')
        emit('CHECK_ONLY',True)
        addresses = candidate_addresses()
        emit('GOOGLE_ROUTE_CANDIDATES',len(addresses))
        app.require(bool(addresses),'GOOGLE_IPV4_UNAVAILABLE')
        address = next((ip for ip in addresses if probe(app,sync,ip)),None)
        app.require(address is not None,'SIGNED_GOOGLE_ROUTE_UNAVAILABLE')
        # Verify the same route from the running edge network namespace, without
        # changing the container, its processes or its mounts. Key goes via stdin.
        pid = edge['State']['Pid']
        app.require(isinstance(pid,int) and pid>1,'EDGE_PID_INVALID')
        emit('EDGE_NETWORK_ROUTE_CHECK_STARTED',True)
        result = subprocess.run(['nsenter','-t',str(pid),'-n',sys.executable,
                                str(Path(__file__).resolve()),'--network-probe',address],
                                input=sync.encode(),capture_output=True,timeout=85)
        # Only expose fixed diagnostic fields. Never print stderr or request data.
        for line in result.stdout.decode(errors='replace').splitlines():
            name,sep,value = line.partition('=')
            if sep and name in ('GAS_HTTP_STATUS','GAS_CHECK','GOOGLE_ROUTE_ERROR'):
                emit('EDGE_'+name,json.loads(value))
        passed = result.returncode==0 and b'GAS_ROUTE_SIGNED_CHECK=true' in result.stdout
        emit('EDGE_NETWORK_ROUTE_VERIFIED',passed)
        app.require(passed,'EDGE_GOOGLE_ROUTE_UNAVAILABLE')
        labels = edge['Config'].get('Labels') or {}
        emit('EDGE_COMPOSE_MANAGED',bool(labels.get('com.docker.compose.project')))
        emit('EDGE_EXISTING_EXTRA_HOSTS',bool(edge['HostConfig'].get('ExtraHosts')))
        emit('EDGE_HOSTS_PATH_AVAILABLE',bool(edge.get('HostsPath')))
        emit('VERIFIED_GOOGLE_IPV4',address)
        emit('GOOGLE_ROUTE_READY',True)
        emit('ARCHIVE_TIMER_ENABLED',False)
        emit('APPLICATION_CHANGED',False)


if __name__=='__main__':
    try:
        main()
    except (Exception,KeyboardInterrupt) as error:
        label = str(error)
        emit('GOOGLE_ROUTE_STOPPED',label if re.fullmatch(r'[A-Z_]{1,100}',label) else 'PROBE_UNAVAILABLE')
        raise SystemExit(1)
