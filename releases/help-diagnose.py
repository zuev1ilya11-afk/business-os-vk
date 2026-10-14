#!/usr/bin/env python3
"""Read-only diagnosis of the rolled-back master help frontend release."""
import json
import hashlib
from pathlib import Path
import stat
import subprocess
import zipfile
from urllib.parse import urlsplit

STAGE = Path('/opt/business-os/deploy/ui-help-e28488f5c403')
MAIN = 'e28488f5c403c6a8078785cc742c7d1f4413af7f'

def run(args):
    p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
    if p.returncode:
        raise RuntimeError('command_failed_' + args[1])
    return p.stdout

def show(name, value):
    print(name + '=' + json.dumps(value, ensure_ascii=False, separators=(',', ':')), flush=True)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def file_info(path):
    if not path.exists():
        return {'exists': False}
    s = path.stat()
    return {'mode': oct(stat.S_IMODE(s.st_mode)), 'uid': s.st_uid, 'gid': s.st_gid,
            'bytes': s.st_size, 'symlink': path.is_symlink()}

def route_summary(config):
    rows = []
    def walk(node):
        if isinstance(node, list):
            for v in node: walk(v)
        elif isinstance(node, dict):
            if 'handler' in node:
                rows.append({'handler': node['handler'], **{k:node[k] for k in
                            ('root','hide','index_names','pass_thru') if k in node}})
            for match in node.get('match', []):
                if isinstance(match, dict):
                    safe = {k:match[k] for k in ('path','path_regexp','file','method') if k in match}
                    if safe: rows.append({'match': safe})
            for k, v in node.items():
                if k != 'match': walk(v)
    walk(config.get('apps', {}).get('http', {}))
    return rows[:60]

def main():
    record = json.loads((STAGE/'journal.json').read_text())
    if record.get('main_sha') != MAIN:
        raise RuntimeError('unexpected_release_journal')
    show('RELEASE_STATE', record.get('state'))
    root = Path(record['root'])
    for label, directory in [('LIVE',root), ('CANDIDATE',STAGE/'swap'), ('BACKUP',STAGE/'backup')]:
        manifest = directory/'build-version.js'
        if manifest.exists():
            data = json.loads(manifest.read_text().split('self.BOS_BUILD=',1)[1].rstrip(';\n'))
            show(label+'_BUILD', data['id'])
        for name in ['.', 'master-help-images', 'master-help-images/master-help-money.png',
                     'master-help-entry.js', 'master-help-data.js']:
            if label != 'BACKUP': show(label+'_'+name, file_info(directory/name))
    container = record['container']
    info = json.loads(run(['docker','inspect',container]))[0]
    show('WEB_RUNNING', info['State']['Running'])
    show('WEB_USER', info['Config'].get('User') or '(default)')
    fingerprint = hashlib.sha256(json.dumps({n:info[n] for n in ('Id','Config','HostConfig','Mounts')},sort_keys=True).encode()).hexdigest()
    show('CONTAINER_CONFIG_UNCHANGED', fingerprint == record['container_fingerprint'])
    show('MOUNT_MATCHES_LIVE', run(['docker','exec',container,'cat','/srv/build-version.js']) == (root/'build-version.js').read_bytes())
    # Read only the rolled-back candidate; no container changes or new requests to business APIs.
    with zipfile.ZipFile('/root/bos-help.pyz') as archive:
        meta = json.loads(archive.read('release.json'))
    if meta.get('main_sha') != MAIN:
        raise RuntimeError('unexpected_installer')
    differences = [n for n,h in meta['after'].items() if not (STAGE/'swap'/n).is_file() or digest(STAGE/'swap'/n) != h]
    show('CANDIDATE_HASH_ERRORS', differences)
    # Filter Docker logs before printing: never print request headers, query values, or raw messages.
    p = subprocess.run(['docker','logs','--since','30m','--tail','600',container],
                       stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
    rows = []
    for line in (p.stdout+b'\n'+p.stderr).decode(errors='replace').splitlines():
        try: item = json.loads(line)
        except ValueError: continue
        request = item.get('request') or {}
        uri = request.get('uri','')
        status = item.get('status')
        if isinstance(status,int) and status >= 400 and isinstance(uri,str):
            path = urlsplit(uri).path
            if 'bos_release=e28488f5c403' in uri or path.startswith('/master-help'):
                rows.append({'time':item.get('ts'),'status':status,'path':path,
                             'error_id':item.get('err_id'),'error_trace':item.get('err_trace')})
    show('RELEASE_HTTP_ERRORS', rows[-30:])
    cmd = info['Config'].get('Cmd') or []
    config = '/etc/caddy/Caddyfile'
    if '--config' in cmd and cmd.index('--config')+1 < len(cmd):
        config = cmd[cmd.index('--config')+1]
    try:
        adapted = run(['docker','exec',container,'caddy','adapt','--config',config])
        show('WEB_FILE_ROUTES', route_summary(json.loads(adapted)))
    except (RuntimeError,ValueError,subprocess.TimeoutExpired):
        show('WEB_FILE_ROUTES', 'not_available')
    show('DIAGNOSIS', 'READ_ONLY_COMPLETE')

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('DIAGNOSIS_STOP='+type(error).__name__+':'+str(error), flush=True)
        raise SystemExit(1)
