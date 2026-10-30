#!/usr/bin/env python3
"""Read-only host inventory. No credentials or report contents are printed."""
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.parse import urlsplit

def run(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=30, check=True).stdout

def safe_url(value):
    try:
        u = urlsplit(value)
        return {'scheme': u.scheme, 'host': u.hostname, 'port': u.port, 'path': u.path}
    except Exception:
        return {'invalid': True}

def main():
    ids = run(['docker', 'ps', '-q']).split()
    data = json.loads(run(['docker', 'inspect', *ids])) if ids else []
    result = {'read_only': True, 'containers': [], 'web_builds': []}
    keys = ['SUPABASE_URL','SUPABASE_PUBLIC_URL','API_EXTERNAL_URL','SITE_URL','GOTRUE_SITE_URL','BOS_PUBLIC_URL','BOS_DRIVE_GAS_URL','BOS_DRIVE_WORKER_URL']
    for c in data:
        env = dict(x.split('=',1) for x in c.get('Config',{}).get('Env',[]) if '=' in x)
        mounts = c.get('Mounts', [])
        item = {'name': c.get('Name'), 'image': c.get('Config',{}).get('Image'),
                'urls': {k:safe_url(env[k]) for k in keys if env.get(k)},
                'worker_key_present': len(env.get('BOS_DRIVE_WORKER_KEY','')) >= 32,
                'legacy_storage_origins': [safe_url(x.strip()) for x in env.get('BOS_LEGACY_STORAGE_ORIGINS','').split(',') if x.strip()],
                'ports': c.get('NetworkSettings',{}).get('Ports'),
                'mounts': [{'source':x.get('Source'), 'target':x.get('Destination'), 'type':x.get('Type')} for x in mounts]}
        result['containers'].append(item)
        for m in mounts:
            if m.get('Type') != 'bind' or m.get('Destination') != '/srv':
                continue
            root = Path(m['Source'])
            for child in ('','public','frontend','www','app'):
                p = root / child / 'build-version.js'
                if p.is_file():
                    result['web_builds'].append({'root': str(p.parent), 'manifest_sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    for unit in ('bos-drive-archive.timer','business-os-contact-control.timer'):
        r = subprocess.run(['systemctl','is-active',unit], capture_output=True,text=True,timeout=10)
        result[unit] = r.stdout.strip()
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Read-only inventory failed. Check Docker/systemd availability. No changes made.')
