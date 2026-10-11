from pathlib import Path
import subprocess,json,hashlib
out=Path('docs/approved-ui/stage-6');old=Path('docs/approved-ui/stage-5/verify-protected.py').read_text().replace('docs/approved-ui/stage-5/protected-handlers.json','docs/approved-ui/stage-6/protected-stage5.json')
try:exec(compile(old,'original-stage5-checker','exec'),{})
except SystemExit as e:
 if e.code:
  original=json.loads((out/'protected-stage5.json').read_text());badOriginal=[c for c in original['checks'] if not c['unchanged']]
  assert [(c['file'],c['label']) for c in badOriginal]==[('master-profile-summary-v129.js','entire unchanged source')]
  profile=Path('master-profile-summary-v129.js').read_text();start=profile.index('window.openMasterMemoMenuV129=function(){');end=profile.index('window.openMasterProfileDayV129=function(date){',start)
  inverse=(profile[:start]+profile[end:]).replace('onclick="openMasterMemoMenuV129()"','onclick="show(\'memo\')"')
  assert inverse==subprocess.check_output(['git','show','30e9373310f9e66bb63dd130378f53b86c0cc3f7:master-profile-summary-v129.js'],text=True)
  (out/'memo-presentation-boundary.json').write_text(json.dumps({'originalWholeSourceCheck':'One expected presentation difference retained in protected-stage5.json','inverseEntireSourceEqualsAccepted':True,'onlyDifferences':'Guarded four-category modal menu and profile entry onclick','unchangedOriginalCallbacks':['acts','measurements','price','tips'],'sourceCommit':'cfd6740'},indent=2)+'\n')
BASE='30e9373310f9e66bb63dd130378f53b86c0cc3f7';MAIN='736c819a388e3b973a81c55f53a2a4832d9c1054';checks=[]
files=subprocess.check_output(['git','ls-tree','-r','--name-only',BASE],text=True).splitlines()
for p in files:
 runtime='/' not in p and (p.endswith(('.js','.css')) or p=='index.html')
 protected=p.startswith(('supabase/','google-apps-script/','netlify/functions/'))
 if runtime or protected:
  base=BASE if runtime else MAIN;a=subprocess.check_output(['git','show',base+':'+p]);b=Path(p).read_bytes();checks.append({'file':p,'base':base,'label':'entire accepted runtime' if runtime else 'entire protected backend','unchanged':a==b,'sha256':hashlib.sha256(b).hexdigest()})
prior=[]
for stage in [2,3,4,5]:
 p=Path(f'docs/approved-ui/stage-{stage}/protected-handlers.json');j=json.loads(p.read_text());j={'checks':j} if isinstance(j,list) else j;prior.append({'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'comparisons':len(j['checks']),'changed':sum(not c['unchanged'] for c in j['checks'])})
allowed={'master-profile-summary-v129.js','build-version.js','index.html','sw.js'}
for c in checks:c['task6PresentationChange']=not c['unchanged'] and c['file'] in allowed
bad=[x for x in checks if not x['unchanged']];unexpected=[x for x in bad if not x['task6PresentationChange']];(out/'protected-functionality.json').write_text(json.dumps({'acceptedSource':BASE,'latestMain':MAIN,'earlierAcceptedProofs':prior,'checks':checks,'changed':len(bad),'unexpectedChanges':len(unexpected),'task6ChangeCommit':'cfd6740','task6Change':'Four original memo callbacks exposed in guarded presentation menu; generated version/shell/SW hashes only'},indent=2)+'\n')
changed=subprocess.check_output(['git','diff','--name-only',MAIN,'--'],text=True).splitlines();runtime=[p for p in changed if '/' not in p and (p.endswith(('.js','.css')) or p=='index.html')];rows=[{'path':p,'size':Path(p).stat().st_size,'sha256':hashlib.sha256(Path(p).read_bytes()).hexdigest()} for p in runtime];(out/'release-hashes.json').write_text(json.dumps({'sourceCommit':subprocess.check_output(['git','rev-parse','cfd6740'],text=True).strip(),'runtimeBuild':'cdd3ea4f917ba89765d0','latestMergedMain':MAIN,'files':rows},indent=2)+'\n');(out/'affected-runtime-files.json').write_text(json.dumps(runtime,indent=2)+'\n');print(f'{len(checks)} final comparisons; {len(bad)} changed; {len(runtime)} runtime files differ from main');assert not unexpected
assert {x['file'] for x in bad}==allowed
for p in allowed:assert Path(p).read_bytes()==subprocess.check_output(['git','show','cfd6740:'+p])
