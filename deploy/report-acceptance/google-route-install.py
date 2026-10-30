#!/usr/bin/env python3
"""Install the verified Google route and enable the existing durable archive.

The installed --ensure mode needs no /tmp helpers or signing keys. It maintains
only the owned hosts line before each archive worker invocation. No container
restart, application replacement, database restore, or historical backfill.
"""
import fcntl
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

ROUTE_SHA = '6ac01dcff33250e022cd3179743b8df9f09d0e676e1818473c90889ebc13bf87'
ADDRESS = '142.251.143.142'
TARGET = 'script.googleusercontent.com'
MARKER = 'BOS_GOOGLE_ROUTE_V1'
SCRIPT = Path('/opt/business-os/report-acceptance/google-route.py')
CONFIG = Path('/etc/business-os/google-route.json')
UNIT = Path('/etc/systemd/system/bos-google-route.service')
DROPIN = Path('/etc/systemd/system/bos-drive-archive.service.d/google-route.conf')
MOUNTS = (('sources','/bos-src'),('bundles','/bos-bundles'),('main','/bos-main'))
MAX_HOSTS = 1048576
UNIT_DATA = b'''# BOS_GOOGLE_ROUTE_V1
[Unit]
Description=Maintain verified Google route for Business OS archives
After=docker.service network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
ExecStart=/usr/bin/python3 /opt/business-os/report-acceptance/google-route.py --ensure
TimeoutStartSec=45
UMask=0077
NoNewPrivileges=yes
ProtectHome=yes
'''
DROPIN_DATA = b'''# BOS_GOOGLE_ROUTE_V1
[Unit]
Requires=bos-google-route.service
After=bos-google-route.service
'''


def require(condition, label):
    if not condition:
        raise RuntimeError(label)


def emit(label, value):
    print(label+'='+json.dumps(value,separators=(',',':')),flush=True)


def command(args):
    result = subprocess.run(args,capture_output=True,timeout=20)
    require(result.returncode==0,'ROUTE_COMMAND_FAILED')
    return result.stdout


def hosts_content(before, address):
    ip = ipaddress.ip_address(address)
    require(ip.version==4 and ip.is_global,'PUBLIC_IPV4_REQUIRED')
    lines = []
    for line in before.decode('utf-8').splitlines(keepends=True):
        body,_,comment = line.partition('#')
        fields = body.split()
        target = any(f.lower().rstrip('.')==TARGET for f in fields[1:])
        if comment.strip()==MARKER:
            require(target and len(fields)==2,'MANAGED_HOST_LINE_CHANGED')
            continue
        require(not target,'UNMANAGED_GOOGLE_HOST')
        lines.append(line)
    text = ''.join(lines)
    if text and not text.endswith('\n'):
        text += '\n'
    return (text+str(ip)+' '+TARGET+' # '+MARKER+'\n').encode()


def write_all(fd, data):
    os.lseek(fd,0,os.SEEK_SET)
    remaining = memoryview(data)
    while remaining:
        written = os.write(fd,remaining)
        require(written>0,'HOSTS_WRITE_FAILED')
        remaining = remaining[written:]
    os.ftruncate(fd,len(data))
    os.fsync(fd)


def replace_hosts(path, before, after):
    # Docker bind mounts this inode: os.replace would not update the live view.
    require(path.is_absolute() and path.resolve()==path,'HOSTS_PATH_UNSAFE')
    fd = os.open(path,os.O_RDWR|os.O_NOFOLLOW)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX)
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_size<=MAX_HOSTS,'HOSTS_PATH_UNSAFE')
        require(os.read(fd,MAX_HOSTS+1)==before,'HOSTS_CHANGED')
        if before!=after:
            try:
                write_all(fd,after)
            except (Exception,KeyboardInterrupt):
                write_all(fd,before)
                raise
    finally:
        os.close(fd)


def edge_hosts(config, edge, docker_root):
    require(edge['State']['Running'] and edge['Image']==config['image'] and
            edge['Name'].lstrip('/')==config['edge_name'],'EDGE_CHANGED')
    require(re.fullmatch('[0-9a-f]{64}',edge['Id']) is not None,'EDGE_ID_INVALID')
    for folder,target in MOUNTS:
        mounts = [m for m in edge['Mounts'] if m['Destination']==target and m['Type']=='bind']
        require(len(mounts)==1 and mounts[0]['Source']==config['live']+'/edge/'+folder,
                'EDGE_MOUNT_CHANGED')
        require(not any(m['Destination'].startswith(target+'/') for m in edge['Mounts']),
                'EDGE_MOUNT_CHANGED')
    path = Path(edge['HostsPath'])
    expected = docker_root/'containers'/edge['Id']/'hosts'
    require(docker_root.is_absolute() and path==expected and path.resolve()==path and path.is_file(),
            'DOCKER_HOSTS_PATH_UNSAFE')
    return path


def route_paths(config):
    edge = json.loads(command(['docker','inspect',config['edge_name']]))[0]
    root = Path(command(['docker','info','--format','{{.DockerRootDir}}']).decode().strip())
    return [Path('/etc/hosts'),edge_hosts(config,edge,root)]


def hosts_plan(paths, address):
    result = []
    for path in paths:
        require(path.resolve()==path and path.is_file() and path.stat().st_size<=MAX_HOSTS,
                'HOSTS_PATH_UNSAFE')
        before = path.read_bytes()
        result.append((path,before,hosts_content(before,address)))
    return result


def apply_hosts(plan):
    changed = []
    try:
        for path,before,after in plan:
            replace_hosts(path,before,after)
            changed.append((path,before,after))
    except (Exception,KeyboardInterrupt):
        for path,before,after in reversed(changed):
            replace_hosts(path,after,before)
        raise


def ensure():
    require(CONFIG.resolve()==CONFIG and CONFIG.is_file(),'ROUTE_CONFIG_MISSING')
    info = CONFIG.stat()
    require(info.st_uid==0 and stat.S_IMODE(info.st_mode)==0o600,'ROUTE_CONFIG_UNSAFE')
    config = json.loads(CONFIG.read_bytes())
    require(config.get('version')==1,'ROUTE_CONFIG_VERSION')
    with open('/run/lock/bos-google-route.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        apply_hosts(hosts_plan(route_paths(config),config['address']))
    emit('GOOGLE_ROUTE_MAINTAINED',True)


def load_route():
    path = Path('/tmp/bos-route.py')
    require(path.resolve()==path and hashlib.sha256(path.read_bytes()).hexdigest()==ROUTE_SHA,
            'ROUTE_HELPER_CHANGED')
    spec = importlib.util.spec_from_file_location('bos_google_route_probe',path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def queue_status(app, journal, work, label):
    sql = """select json_build_object(
      'pending',count(*) filter(where j.state='pending'),
      'processing',count(*) filter(where j.state='processing'),
      'completed',count(*) filter(where j.state='completed'),
      'failed',count(*) filter(where j.state='failed'),
      'with_link',count(*) filter(where j.state='completed' and o.drive_archive_status='archived'
        and o.drive_archive_url like 'https://%' and o.report_upload_token=j.report_token
        and o.report_uploaded_at=j.report_uploaded_at))
      from bos_drive_private.jobs j join public.orders o on o.id=j.order_id;
      select coalesce(json_agg(x),'[]'::json) from (
        select case when error ~ '^[A-Z][A-Z0-9_]{0,79}$' then error
          else 'ARCHIVE_ERROR_REDACTED' end as code,count(*) as jobs
        from bos_drive_private.jobs where state='failed' group by 1) x;"""
    output = app.v.sql(journal['database_id'],journal['database'],sql,work,label)
    lines = [line for line in output.decode().splitlines() if line.startswith(('{','['))]
    require(len(lines)==2,'QUEUE_STATUS_UNAVAILABLE')
    counts,errors = (json.loads(line) for line in lines)
    return counts,errors


def delivery_result(before, after):
    completed = max(0,after['completed']-before['completed'])
    return {'ARCHIVE_QUEUE':after,'REPORTS_SENT_THIS_RUN':completed,
            'REAL_ARCHIVE_DELIVERY_VERIFIED':completed>0}


def install():
    route = load_route()
    app = route.load_app()
    app.s,app.v,app.r = app.load_helpers()
    with (app.s.PARENT/'.report-acceptance-stage.lock').open('r') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        paths = list(app.s.PARENT.glob('report-acceptance-stage-*/locked-*/runtime-*/activate-*/activation.json'))
        require(bool(paths),'ACTIVATION_JOURNAL_MISSING')
        path = max(paths,key=lambda p:p.stat().st_mtime_ns)
        journal = json.loads(app.s.read(path))
        require(journal['phase'] in ('complete_archive_pending','enabling_archive','complete'),
                'DEFERRED_RELEASE_REQUIRED')
        app.installed_files(journal)
        runtime = Path(journal['runtime_journal'])
        require(app.s.sha(app.s.read(runtime))==journal['runtime_journal_sha256'],'RUNTIME_JOURNAL_CHANGED')
        rec = json.loads(app.s.read(runtime))
        edge = app.s.inspect(journal['edge_id'])
        config = {'version':1,'address':ADDRESS,'edge_name':edge['Name'].lstrip('/'),
                  'image':rec['image'],'live':journal['live']}
        host_paths = route_paths(config)
        config_data = (json.dumps(config,indent=2,sort_keys=True)+'\n').encode()
        files = [(SCRIPT,Path(__file__).resolve().read_bytes(),0o755),
                 (CONFIG,config_data,0o600),(UNIT,UNIT_DATA,0o644),(DROPIN,DROPIN_DATA,0o644)]
        # Existing unrelated unit/configuration files are never overwritten.
        for dest,data,mode in files:
            require(not dest.exists() or (app.s.read(dest)==data and dest.stat().st_uid==0 and
                    stat.S_IMODE(dest.stat().st_mode)==mode),'ROUTE_INSTALL_FILE_CONFLICT')
        if journal['phase']=='complete':
            require(all(dest.exists() for dest,_,_ in files),'ROUTE_INSTALL_INCOMPLETE')
            ensure()
            timer = app.unit_state(app.UNITS[1])
            require(timer.get('ActiveState')=='active' and timer.get('UnitFileState')=='enabled',
                    'ARCHIVE_TIMER_NOT_ACTIVE')
            app.report_result(journal)
            return
        # Recover only archive state after an interrupted activation; acceptance stays installed.
        work = Path(tempfile.mkdtemp(prefix='google-route-',dir=path.parent))
        if journal['phase']=='enabling_archive':
            app.pause_archive(work)
            app.save(path.parent,journal,'complete_archive_pending')
        app.archive_inactive()
        sync = app.v.environment(edge).get('BOS_SYNC_KEY','')
        require(0<len(sync)<=4096,'SIGNING_KEY_MISSING')
        require(route.probe(app,sync,ADDRESS),'SIGNED_GOOGLE_ROUTE_UNAVAILABLE')
        plan = hosts_plan(host_paths,ADDRESS)
        records = [app.capture_file(work,dest,data,mode,(0,0)) for dest,data,mode in files]
        host_records = []
        for index,(host,before,after) in enumerate(plan):
            backup = work/('hosts-before-'+str(index))
            app.s.write(backup,before)
            host_records.append({'path':str(host),'backup':str(backup),
                                 'before_sha256':app.s.sha(before),'after_sha256':app.s.sha(after)})
        state = {'files':records,'hosts':host_records,'phase':'prepared'}
        def save_state(phase):
            state['phase'] = phase
            app.atomic_file(work/'route-install.json',json.dumps(state,indent=2).encode(),0o600)
        save_state('prepared')
        hosts_applied = False
        try:
            for dest,data,mode in files:
                app.atomic_file(dest,data,mode)
            apply_hosts(plan)
            hosts_applied = True
            app.v.run(['systemctl','daemon-reload'],work,'route-reload')
            app.v.run(['systemctl','start',UNIT.name],work,'route-ensure',timeout=50)
            # Check the actual running Deno function, not just the host Python client.
            status,raw,_ = app.api(journal['loopback'],'gas-bridge-health',method='GET')
            outer = json.loads(raw)
            inner = json.loads(outer.get('body','{}'))
            require(status==200 and outer.get('ok') is True and inner.get('error')=='ACT_REQUIRED',
                    'LIVE_GAS_BRIDGE_FAILED')
            save_state('route_verified')
        except (Exception,KeyboardInterrupt):
            if hosts_applied:
                for host,before,after in reversed(plan):
                    replace_hosts(host,after,before)
            app.restore_files(records)
            app.v.run(['systemctl','daemon-reload'],work,'route-rollback-reload')
            save_state('route_reverted')
            emit('REPORT_ACCEPTANCE_REMAINS_INSTALLED',True)
            raise
        emit('GOOGLE_ROUTE_INSTALLED',True)
        emit('LIVE_GAS_BRIDGE_VERIFIED',True)
        before,_ = queue_status(app,journal,work,'queue-before')
        # This verifies the complete live release before starting the first job.
        # From here a delivery may have begun: keep the verified route for retries.
        app.enable_archive(path.parent,journal)
        after,errors = queue_status(app,journal,work,'queue-after')
        for key,value in delivery_result(before,after).items():
            emit(key,value)
        emit('ARCHIVE_ERRORS',errors)
        save_state('complete')


def main():
    sys.dont_write_bytecode = True
    require(os.geteuid()==0,'ROOT_REQUIRED')
    if sys.argv[1:]==['--ensure']:
        ensure()
    else:
        require(len(sys.argv)==1,'UNSUPPORTED_ARGUMENTS')
        install()


if __name__=='__main__':
    try:
        main()
    except (Exception,KeyboardInterrupt) as error:
        label = str(error)
        emit('GOOGLE_ROUTE_STOPPED',label if re.fullmatch(r'[A-Z_]{1,100}',label) else 'INSTALL_UNAVAILABLE')
        emit('REPORT_ACCEPTANCE_REMAINS_INSTALLED',True)
        raise SystemExit(1)
