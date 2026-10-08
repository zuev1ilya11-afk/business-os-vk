#!/usr/bin/env python3
"""Repair only static asset publication in the already activated RU release."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from release_files import STATIC_NAME, frontend_manifest

ORIGIN='https://139.100.237.167'
OLD_STATIC=r'^/(?:[A-Za-z0-9_-]+\.(?:html|js|css|svg|webmanifest|png|jpg|jpeg|webp|ico|woff|woff2))?$'
NEW_STATIC='^/(?:'+STATIC_NAME+')?$'

def patch_config(text):
    pattern=r'(?m)^(\s*@static path_regexp static )([^\n]+)$'
    found=list(re.finditer(pattern,text))
    if len(found)!=1 or found[0].group(2) not in (OLD_STATIC,NEW_STATIC):
        raise ValueError('Unrecognized static route; configuration was not changed')
    return re.sub(pattern,lambda m:m.group(1)+NEW_STATIC,text)

def missing_assets(source,web,expected_manifest_hash):
    raw=(source/'build-version.js').read_bytes()
    if hashlib.sha256(raw).hexdigest()!=expected_manifest_hash or (web/'build-version.js').read_bytes()!=raw:
        raise ValueError('Running release and saved build differ')
    build=frontend_manifest(source)
    missing=[]
    for name,digest in {**build['assets'],'index.html':build['shell']}.items():
        path=web/name
        if path.is_symlink():raise ValueError('Symlink in published assets')
        if not path.exists():missing.append(name)
        elif hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
            raise ValueError('Published file differs from release: '+name)
    return build,missing

def main():
    os.umask(0o077)
    if os.geteuid()!=0:raise ValueError('Run as root on the application server')
    log=None
    def command(args):
        result=subprocess.run(args,capture_output=True,timeout=45)
        if log:
            with log.open('ab') as output:output.write(result.stderr)
        if result.returncode:raise RuntimeError('Command failed: '+args[0])
        return result.stdout

    ids=command(['docker','ps','--filter','label=bos.release','--format','{{.ID}}']).decode().split()
    if not ids:raise ValueError('No running release containers')
    infos=json.loads(command(['docker','inspect',*ids]))
    candidates=[info for info in infos if info['Name'].endswith('-https')]
    if len(candidates)!=1:raise ValueError('Expected exactly one active release HTTPS container')
    info=candidates[0];container=info['Name'].lstrip('/')
    prefix=info['Config'].get('Labels',{}).get('bos.release')
    if container!=str(prefix)+'-https':raise ValueError('Container label mismatch')
    mounts={m['Destination']:Path(m['Source']) for m in info['Mounts'] if m['Type']=='bind'}
    web=mounts.get('/srv');config=mounts.get('/etc/caddy')
    if web is None or config is None:raise ValueError('Release mounts missing')
    stage=web.parent
    if (stage.parent!=Path('/opt/business-os/deploy') or not re.fullmatch(r'release-[a-z0-9_]+',stage.name)
            or stage.resolve()!=stage or web!=stage/'web' or config!=stage/'caddy'):
        raise ValueError('Unexpected release directory')
    report=json.loads((stage/'report.json').read_bytes())
    if report.get('origin')!=ORIGIN or report.get('source_readonly') is not True:
        raise ValueError('Completed release report required')
    source=stage/'web-build'
    build,missing=missing_assets(source,web,report['build_sha256'])
    originals={name:(config/name).read_text() for name in ('Caddyfile','active.Caddyfile')}
    patched={name:patch_config(text) for name,text in originals.items()}
    backup=Path(tempfile.mkdtemp(prefix='frontend-repair-',dir=stage))
    log=backup/'commands.log'
    for name,text in originals.items():(backup/name).write_text(text)
    for name in missing:
        temporary=web/(name+'.repair-tmp')
        shutil.copyfile(source/name,temporary);os.chmod(temporary,0o644);os.replace(temporary,web/name)
    frontend_manifest(web)
    candidate=config/'frontend-repair.Caddyfile'
    candidate.write_text(patched['Caddyfile'])
    command(['docker','exec',container,'caddy','validate','--config','/etc/caddy/frontend-repair.Caddyfile','--adapter','caddyfile'])
    reload_args=['docker','exec',container,'caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile','--address','127.0.0.1:12019']
    try:
        os.replace(candidate,config/'Caddyfile')
        command(reload_args)
        expected={name:build['assets'][name] for name in ('startup-shell.bundle.js','startup-eager.bundle.js')}
        expected.update({'index.html':build['shell'],'build-version.js':report['build_sha256']})
        for name,digest in expected.items():
            body=command(['curl','--silent','--show-error','--fail','--noproxy','*','--max-time','30',
                '--resolve','139.100.237.167:443:127.0.0.1',ORIGIN+'/'+name+'?build='+build['id']])
            if hashlib.sha256(body).hexdigest()!=digest:raise ValueError('HTTPS asset hash mismatch: '+name)
        temporary=config/'active.Caddyfile.repair-tmp'
        temporary.write_text(patched['active.Caddyfile']);os.replace(temporary,config/'active.Caddyfile')
    except BaseException:
        for name,text in originals.items():
            temporary=config/(name+'.restore-tmp');temporary.write_text(text);os.replace(temporary,config/name)
        command(reload_args)
        raise
    proof={'build':build['id'],'added_assets':missing,'https_hashes_verified':list(expected)}
    (backup/'report.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
    print('BOS_FRONTEND_ASSETS_OK')
    print('Адрес:',ORIGIN)
    print('Добавлено файлов:',len(missing),'; HTTPS-проверок:',len(expected))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print('BOS_FRONTEND_ASSETS_FAILED category='+type(error).__name__)
        print(str(error))
        raise SystemExit(1)
