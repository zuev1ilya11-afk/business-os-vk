"""Build the pinned RU zipapp; does not contact or change production.
Usage: python3 build_package.py /path/to/verified-05f9-RU-source
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE=Path(__file__).resolve().parent
REPO=HERE.parent.parent
BASE=REPO/'deploy/pr289/package'
PIN='f4f79636bdf5cfd7c65d15191d342dab2ae6da5f'
def sha(b):return hashlib.sha256(b).hexdigest()
def manifest(p):return json.loads(p.read_text().split('self.BOS_BUILD=',1)[1].rstrip(';\n'))
def exact(text,old,new):
    assert text.count(old)==1,old
    return text.replace(old,new)

def build(source):
    previous=json.loads((BASE/'release.json').read_text())
    before={k:v for k,v in {**previous['before'],**previous['after']}.items() if not k.endswith('.png')}
    for n,digest in before.items():assert sha((source/n).read_bytes())==digest,n
    old=manifest(source/'build-version.js')
    assert old['id']=='05f9f54b55a82dd2eff6'
    helpfiles=['master-help-data.js','master-help.js','master-help-entry.js','master-help.css','master-help-store.js','master-help-editor.js']
    with tempfile.TemporaryDirectory(prefix='bos-help-package-') as temporary:
        temp=Path(temporary);app=temp/'app';pkg=temp/'package'
        shutil.copytree(source,app);pkg.mkdir()
        for n in helpfiles:shutil.copy2(REPO/n,app/n)
        subprocess.run(['node','scripts/build-version.cjs'],cwd=app,check=True)
        subprocess.run(['node','scripts/build-version.cjs','--check'],cwd=app,check=True)
        new=manifest(app/'build-version.js')
        assert (app/'startup-eager.bundle.js').read_bytes()==(source/'startup-eager.bundle.js').read_bytes()
        for n in ['index.html','sw.js']:
            assert (app/n).read_bytes().replace(new['id'].encode(),old['id'].encode())==(source/n).read_bytes(),n
        changed=[n for n in old['assets'] if old['assets'][n]!=new['assets'].get(n)]
        assert set(changed)=={'startup-shell.bundle.js','master-help-data.js','master-help.js','master-help.css'},changed
        assert set(new['assets'])-set(old['assets'])=={'master-help-store.js','master-help-editor.js'}
        # Every changed bundle source except help-entry remains byte-identical.
        startup=json.loads((app/'scripts/startup-assets.json').read_text())
        for n in startup['shell']:
            if n!='master-help-entry.js':assert (app/n).read_bytes()==(source/n).read_bytes(),n
        names=helpfiles+['index.html','startup-shell.bundle.js','build-version.js','sw.js']
        meta=dict(format=1,main_sha=PIN,source_sha=PIN,before_build=old['id'],after_build=new['id'],
                  origin=previous['origin'],before=before,after={n:sha((app/n).read_bytes()) for n in names},
                  new_files=['master-help-store.js','master-help-editor.js'],new_dirs=[],optional={})
        (pkg/'payload').mkdir()
        for n in names:shutil.copy2(app/n,pkg/'payload'/n)
        (pkg/'release.json').write_text(json.dumps(meta,indent=2)+'\n')
        # Reuse the previously tested atomic web/edge rollout, with isolated names.
        front=(BASE/'frontend.py').read_text().replace(previous['main_sha'],PIN).replace('pr289-web','help293-web')
        (pkg/'frontend.py').write_text(front)
        api=(REPO/'supabase/functions/master-memo-api/index.ts').read_text()
        helper=(REPO/'supabase/functions/master-memo-api/help-content.ts').read_text().replace('export async function handleHelp','async function handleHelp')
        dispatch="if(action==='help_list'||action==='help_save'){const result=await handleHelp(db,actor,body);const response=json(result.body,result.status);response.headers.set('Cache-Control','no-store');return response}"
        api=exact(api,"import { handleHelp } from './help-content.ts';\n",'')
        api=exact(api,"}return json({ok:false,error:'UNKNOWN_ACTION'},404)","}\nreturn json({ok:false,error:'UNKNOWN_ACTION'},404)").rstrip('\n')
        original=exact(api,dispatch,'')
        assert sha(original.encode())=='5825b23c65e501bced7e7fe3bfe4bbc173e1bea3908365c39f43920acff0ec75'
        # Inline only our dependency: the existing ESZIP has one source target.
        patched=helper+'\n'+api
        (pkg/'master-memo-api.ts').write_text(patched)
        backend=(BASE/'backend.py').read_text().replace('pr289','help293').replace('push-api','master-memo-api').replace('PUSH_','HELP_').replace('CORS-only','help content').replace('CORS_DEPLOYED','API_DEPLOYED').replace('CORS_ROLLED_BACK','API_ROLLED_BACK')
        backend=backend.replace('6bd9d08bf8615854f5e5ce8c475869f9e6bb11f5b9c3fa2adcaa1cad33cb7113',sha(original.encode()))
        backend=backend.replace('974b7078e0448ed830ec28f82392ef4f3304687e631112983fd6bd400c076869',sha(patched.encode()))
        old_gate='f.require(f.sha(patched)==SOURCE_AFTER and\n              f.sha(patched.replace(b"\'https://139.100.237.167\',",b\'\'))==SOURCE_BEFORE,\n              \'Patch differs from approved help content change\')'
        backend=exact(backend,old_gate,"f.require(f.sha(patched)==SOURCE_AFTER,'Help API package changed')")
        (pkg/'backend.py').write_text(backend)
        for p in (HERE/'package').glob('*.py'):shutil.copy2(p,pkg/p.name)
        shutil.copy2(HERE/'check_server.py',pkg/'check_server.py')
        for n in ['schema.sql','seed.sql']:shutil.copy2(HERE/n,pkg/n)
        meta['api_source_sha256']=sha(patched.encode())
        meta['sql_sha256']={n:sha((pkg/n).read_bytes()) for n in ['schema.sql','seed.sql']}
        (pkg/'release.json').write_text(json.dumps(meta,indent=2)+'\n')
        with zipfile.ZipFile(HERE/'bos293.pyz','w',compression=zipfile.ZIP_DEFLATED) as archive:
            for p in sorted(pkg.rglob('*')):
                if p.is_file():
                    info=zipfile.ZipInfo(str(p.relative_to(pkg)),date_time=(2026,10,15,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
                    archive.writestr(info,p.read_bytes())
        (HERE/'release-manifest.json').write_text(json.dumps(meta,indent=2)+'\n')
        print('RU_BUILD='+new['id'])
        print('ZIP_SHA256='+sha((HERE/'bos293.pyz').read_bytes()))

if __name__=='__main__':build(Path(sys.argv[1]).resolve())
