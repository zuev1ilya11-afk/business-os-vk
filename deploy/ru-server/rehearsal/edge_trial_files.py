"""Validate private backups and assemble separately versioned Edge source trees."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat

from backup_functions import PROJECT, fingerprint, validate_inventory
from verify_runtime_secrets import load_secrets, private_bytes, NAMES


def relative(value):
    if (not isinstance(value,str) or not value or len(value)>8192 or
        any(ord(c)<32 or c in '\\:' for c in value) or
        any(p in ('','.','..') for p in value.split('/'))):
        raise ValueError('Unsafe relative path')
    return value


def source_relative(value,prefix):
    if not isinstance(value,str):raise ValueError('Invalid source path')
    # Management metadata uses file:// URLs; multipart may use absolute paths.
    value=value.removeprefix('file://')
    prefix=prefix.removeprefix('file://')
    if value.startswith('/'):
        if not value.startswith(prefix):raise ValueError('Source prefix mismatch')
        value=value[len(prefix):]
    else:
        # Deno 2 multipart filenames are relative to the deployment directory,
        # with a leading source/; Deno 1 paths above already consumed that part.
        value=value.removeprefix('source/')
    return relative(value)


def read_file(root,name):
    relative(name)
    path=root
    for component in name.split('/'):
        path=path/component
        if path.is_symlink():raise ValueError('Symlink refused')
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size>32*1024*1024:
        raise ValueError('Unexpected backup file')
    return path.read_bytes()


def read_snapshot(root,baseline):
    sums={}
    for line in read_file(root,'SHA256SUMS').decode('ascii').splitlines():
        match=re.fullmatch(r'([a-f0-9]{64})  (.+)',line)
        if not match or match[2] in sums:raise ValueError('Invalid checksums')
        data=read_file(root,match[2])
        if hashlib.sha256(data).hexdigest()!=match[1]:raise ValueError('Backup checksum mismatch')
        sums[match[2]]=data
    for name in ('manifest.json','inventory-before.json','inventory-after.json'):
        if name not in sums:raise ValueError('Incomplete backup')
    manifest=json.loads(sums['manifest.json'])
    if manifest.get('format')!=1 or manifest.get('project_ref')!=PROJECT:
        raise ValueError('Unexpected backup manifest')
    functions=manifest['functions']; rows=[f['function'] for f in functions]
    validate_inventory(rows,len(baseline['functions']))
    reference=fingerprint(baseline['functions'])
    if any(fingerprint(r)!=reference for r in (rows,json.loads(sums['inventory-before.json']),
                                               json.loads(sums['inventory-after.json']))):
        raise ValueError('Function inventory changed')
    result=[]
    for f in functions:
        row=f['function'];slug=row['slug'];entry=row['entrypoint_path']
        if not isinstance(entry,str) or '/source/' not in entry:raise ValueError('Unknown source root')
        prefix=entry.split('/source/',1)[0]+'/source/'
        mapped={}
        for part in f['files']:
            name=part['file']; data=sums.get(name)
            if (not re.fullmatch(re.escape('functions/'+slug+'/parts/')+r'\d{4}',name) or
                data is None or len(data)!=part['size'] or hashlib.sha256(data).hexdigest()!=part['sha256']):
                raise ValueError('Invalid source part')
            rel=source_relative(part['source_path'],prefix)
            if rel in mapped:raise ValueError('Source path collision')
            mapped[rel]=data
        metadata=f.get('body_metadata',{})
        if not isinstance(metadata,dict):raise ValueError('Invalid body metadata')
        # Deno 2 exports may rebase the source tree relative to its common root.
        # The checksummed multipart metadata names the entry in that exported tree.
        exported_entry=metadata.get('deno2_entrypoint_path')
        entry=source_relative(entry if exported_entry is None else exported_entry,prefix)
        imap=source_relative(row['import_map_path'],prefix) if row.get('import_map') else None
        if entry not in mapped or (imap and imap not in mapped):raise ValueError('Missing entrypoint or import map')
        expected=baseline.get('audited',{}).get(slug)
        if expected and hashlib.sha256(mapped[entry]).hexdigest()!=expected:
            raise ValueError('Audited handler differs')
        result.append({'slug':slug,'entrypoint':entry,'import_map':imap,
                       'verify_jwt':row['verify_jwt'],'files':mapped})
    return result


def assemble(functions,destination):
    destination.mkdir(mode=0o700)
    routes={}
    for f in functions:
        slug=relative(f['slug'])
        if '/' in slug or slug in routes:raise ValueError('Invalid function slug')
        for name,data in f['files'].items():
            path=destination/slug/relative(name)
            path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            with path.open('xb') as output:output.write(data)
        routes[slug]={k:f[k] for k in ('entrypoint','import_map','verify_jwt')}
        routes[slug]['source_sha256']={p:hashlib.sha256(b).hexdigest() for p,b in f['files'].items()}
    return routes


def find_snapshot(parent,baseline):
    candidates=[]
    for path in sorted(parent.glob('functions-snapshot-*')):
        info=path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.geteuid() or info.st_mode&0o077:continue
        try:functions=read_snapshot(path,baseline)
        except (ValueError,KeyError,OSError,TypeError):continue
        candidates.append((path,functions))
    if len(candidates)!=1:raise ValueError('Expected exactly one verified function snapshot')
    return candidates[0]


def read_verified_secrets(root):
    values,digest=load_secrets(root)
    valid=False
    for path in root.glob('verification-*.json'):
        receipt=json.loads(private_bytes(path))
        if (receipt.get('format')==1 and receipt.get('source_project')==PROJECT and
            receipt.get('secrets_file_sha256')==digest and receipt.get('all_match') is True and
            sorted(receipt.get('matched',[]))==sorted(NAMES) and
            all(receipt.get(k)==[] for k in ('missing','mismatched','unexpected'))):valid=True
    if not valid:raise ValueError('Matching secret verification receipt required')
    return values
