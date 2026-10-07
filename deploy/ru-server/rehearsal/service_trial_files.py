"""Validated local Storage fixtures and stopped-trial mount identities."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import stat
import time

from backup_storage import validate_manifest, PROJECT
from vault_rekey_trial import validate_container


def read_storage_snapshot(folder, source_sha):
    if folder.is_symlink() or not folder.is_dir() or (folder/'objects').is_symlink():
        raise ValueError('Invalid snapshot directory')
    sums_file, manifest_file = folder/'SHA256SUMS', folder/'manifest.json'
    if any(p.is_symlink() or not p.is_file() or p.stat().st_size > 4*1024*1024 for p in (sums_file, manifest_file)):
        raise ValueError('Invalid snapshot metadata')
    checksums = {}
    for line in sums_file.read_text().splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  (manifest\.json|objects/[a-f0-9-]{36})', line)
        if not match or match[2] in checksums:
            raise ValueError('Invalid snapshot checksum manifest')
        checksums[match[2]] = match[1]
    raw = manifest_file.read_bytes()
    if hashlib.sha256(raw).hexdigest() != checksums.get('manifest.json'):
        raise ValueError('Snapshot manifest checksum mismatch')
    manifest = json.loads(raw)
    if manifest.get('project') != PROJECT or manifest.get('source_dump_sha256') != source_sha:
        raise ValueError('Snapshot belongs to another source dump')
    rows = manifest['objects']
    validate_manifest(rows)
    if set(checksums) != {'manifest.json'} | {'objects/'+row['id'] for row in rows}:
        raise ValueError('Snapshot files do not match object inventory')
    verified = []
    for row in rows:
        file = folder/'objects'/row['id']
        info = file.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size != row['metadata']['size']:
            raise ValueError('Unexpected snapshot object file')
        sha, md5 = hashlib.sha256(), hashlib.md5(usedforsecurity=False)
        with file.open('rb') as stream:
            for part in iter(lambda: stream.read(65536), b''):
                sha.update(part)
                md5.update(part)
        if sha.hexdigest() != checksums['objects/'+row['id']] or md5.hexdigest() != row['metadata']['eTag'].strip('"'):
            raise ValueError('Snapshot object checksum mismatch')
        mime = row['metadata'].get('mimetype') or 'application/octet-stream'
        cache = row['metadata'].get('cacheControl') or 'no-cache'
        if any(not isinstance(x,str) or len(x)>1024 or any(ord(c)<32 or ord(c)==127 for c in x) for x in (mime,cache)):
            raise ValueError('Invalid file response metadata')
        verified.append({**row, 'source_file': str(file), 'sha256': sha.hexdigest(), 'mimetype': mime, 'cache_control': cache})
    return {'objects': verified, 'source_dump_sha256':source_sha,
            'bytes':sum(r['metadata']['size'] for r in rows)}


def materialize_storage(snapshot, destination):
    destination.mkdir(mode=0o700)
    for row in snapshot['objects']:
        target = destination/'stub'/'stub'/row['bucket_id']/row['name']/row['version']
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with open(row['source_file'],'rb') as source, target.open('xb') as output:
            shutil.copyfileobj(source,output,65536)
            output.flush()
            os.fsync(output.fileno())
        with target.open('rb') as source:
            if hashlib.file_digest(source,'sha256').hexdigest()!=row['sha256']:
                raise ValueError('Copied Storage object differs')
        os.setxattr(target, 'user.supabase.content-type', row['mimetype'].encode())
        os.setxattr(target, 'user.supabase.cache-control', row['cache_control'].encode())


def source_mounts(info, name):
    validate_container(info,name)
    mounts={m['Destination']:m for m in info['Mounts']}
    data=mounts.get('/var/lib/postgresql/data',{})
    config=mounts.get('/etc/postgresql-custom',{})
    expected=Path('/opt/business-os/deploy')/name.removeprefix('bos-')/'data'
    if (data.get('Type')!='bind' or data.get('Source')!=str(expected)
            or config.get('Type')!='volume' or config.get('Name')!=name+'-config'):
        raise ValueError('Unexpected source data/config mounts')
    return expected, config['Name']


def make_jwt(secret, role):
    if role not in ('anon','service_role'):
        raise ValueError('Unexpected API role')
    def enc(data):
        return base64.urlsafe_b64encode(data).rstrip(b'=')
    now=int(time.time())
    header=enc(json.dumps({'alg':'HS256','typ':'JWT'},separators=(',',':')).encode())
    payload=enc(json.dumps({'iss':'supabase','role':role,'iat':now,'exp':now+86400},separators=(',',':')).encode())
    body=header+b'.'+payload
    return (body+b'.'+enc(hmac.digest(secret.encode(),body,'sha256'))).decode()
