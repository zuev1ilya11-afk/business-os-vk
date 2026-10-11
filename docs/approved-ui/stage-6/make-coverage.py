import json,collections,subprocess
from pathlib import Path
root=Path.cwd();docs=root/'docs/approved-ui';contract=json.loads((docs/'screen-contract.json').read_text());accepted={};manifests=[]
valid={'restored','implemented','implemented-existing-safe-controls','reused-and-role-verified','reused-accepted-stage-4','complete','covered'}
def local(p):
 s=str(p);key='/business-os-vk/';return root/s.split(key,1)[1] if key in s else Path(s) if Path(s).is_absolute() else root/s
for stage in range(2,6):
 d=json.loads((docs/f'stage-{stage}/coverage.json').read_text())
 for r in (d if isinstance(d,list) else d['rows']):
  if r.get('status') in valid:accepted[(r['role'],r['screen'])]={**r,'acceptedStage':stage}
 manifests+=json.loads((docs/f'stage-{stage}/capture-manifest.json').read_text())
final=json.loads((docs/'stage-6/capture-manifest.json').read_text()) if (docs/'stage-6/capture-manifest.json').exists() else []
idx={str(local(e['path'])):e for e in manifests+final if e.get('path')}
if any(e.get('role')=='dispatcher' and e.get('screen')=='more' and e.get('path') and local(e['path']).exists() for e in final):accepted[('dispatcher','more')]={'acceptedStage':6,'renderer':'role-chrome-v83.js / original pages.more navigation guards','states':['native role destinations'],'tests':'approved-ui-final.spec.js: final role dispatcher; real More-to-team route at five widths','reason':'Existing More navigation is the supported native composition; original destination handlers and role capabilities preserved.'}
def normal(e):
 return {**e,'originalPath':e['path'],'path':str(local(e['path']).relative_to(root)),'runtimeBuild':e.get('runtimeBuild') or e.get('observedBuild') or e.get('buildId'),'versionStatus':'Recorded actual capture build' if e.get('runtimeBuild') or e.get('observedBuild') or e.get('buildId') else 'Accepted historical capture; runtime not recorded'}
accepted[('master','memo')]={**accepted[('master','memo')],'renderer':'master-profile-summary-v129.js guarded memo menu + original master-memo-runtime-v21.js / master-price-memo-v131.js handlers','tests':'approved-master-memo.spec.js: four original callbacks, original catalog and Close/Back reachability','reason':'Native modal category menu replaces unreachable redirected show(memo); original material API callbacks and role guard retained.','states':['original-categories-menu']}
rows=[]
for c in contract:
 key=(c['role'],c['screen']);a=accepted.get(key,{});ev=[]
 for e in ([] if key==('master','memo') else a.get('evidence',a.get('captures',[]))):
  if isinstance(e,str):e=idx.get(str(local(e)),{'path':e,'synthetic':True})
  elif e.get('path'):e=idx.get(str(local(e['path'])),e)
  if e.get('path') and local(e['path']).exists():ev.append(normal(e))
 for e in final:
  if (e.get('role'),e.get('screen'))==key and e.get('path') and local(e['path']).exists() and e.get('state')!='capture-gap':ev.append(normal(e))
 ev=list({e['path']:e for e in ev}.values());complete=bool(a and ev)
 rows.append({**c,'complete':complete,'status':'complete-accepted' if complete else 'pending-missing-accepted-evidence','renderer':a.get('renderer','Unverified'),'acceptedStage':a.get('acceptedStage'),'verifiedState':a.get('states') or sorted(set(e.get('state','accepted-fixture') for e in ev)),'tests':a.get('tests',a.get('verification','See accepted stage report and verification.md')),'evidence':ev,'supportedNativeEquivalence':a.get('dependency') or a.get('dependencies') or a.get('reason') or a.get('description') or 'Existing permitted handlers, native fields and original role guards retained.','roleDifferences':'Documentation, not a fifth application role' if c['role']=='system' else f'Original {c["role"]} capabilities and supported actions; accepted row remains authoritative','functionalGate':'Full baseline 622 pass/76 fail; exact per-case resolutions in stage-6/failure-dispositions.json. Composition completion is not a clean full-suite claim.'})
assert len(rows)==242 and len({(r['role'],r['screen']) for r in rows})==242
counts=dict(collections.Counter(r['role'] for r in rows));statuses=dict(collections.Counter(r['status'] for r in rows));head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();result={'schemaVersion':1,'contractRows':242,'roleTotals':counts,'statuses':statuses,'sourceCommit':head,'runtimeBuild':'cdd3ea4f917ba89765d0','rows':rows};(docs/'coverage.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
lines=['# Approved UI coverage','','Exactly 242 unique role/screen contracts. Completion means accepted renderer/state composition, actual fixture evidence and supported native equivalence; it does not certify pixel identity, a clean full suite, deployed server, live auth/integrations or real devices. System has two documentation rows; four app roles remain unchanged.','','| Role | Rows | Complete | Pending |','| --- | ---: | ---: | ---: |']
for role,n in counts.items():lines.append(f'| {role} | {n} | {sum(r["complete"] for r in rows if r["role"]==role)} | {sum(not r["complete"] for r in rows if r["role"]==role)} |')
lines+=['','Historical paths are rebased to restored identical Git PNG bytes; originalPath, commit and actual recorded runtime remain intact. Unknown historical build stays null. Later deferred placeholders cannot erase earlier accepted rows. Final major sections use fresh stage6 screenshots; image counts are not screen counts.','','| Role / screen | Complete / stage | Renderer / test | Evidence | Native equivalence |','| --- | --- | --- | --- | --- |']
for r in rows:
 ev=sorted(r['evidence'],key=lambda e:('stage-6' not in e['path'],e.get('width')!=390,e.get('width')!=1440));refs='; '.join(f'[{e.get("width","?")}px]({e["path"].removeprefix("docs/approved-ui/")})' for e in ev[:2]);note=str(r['supportedNativeEquivalence']).replace('|','/');lines.append(f'| {r["role"]}/{r["screen"]} | {r["complete"]} / {r["acceptedStage"]} | {r["renderer"]} · {str(r["tests"]).replace("|","/")} | {refs} | {note} |')
(docs/'coverage.md').write_text('\n'.join(lines)+'\n');print(len(rows),counts,statuses);print('Pending',[(r['role'],r['screen']) for r in rows if not r['complete']])
