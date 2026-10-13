import json,collections
from pathlib import Path
root=Path('docs/approved-ui');contract=json.loads((root/'screen-contract.json').read_text());captures=json.loads((root/'stage-5/capture-manifest.json').read_text());prior={};owned=set()
for stage in [2,3,4]:
 d=json.loads((root/f'stage-{stage}/coverage.json').read_text());rows=d if isinstance(d,list) else d['rows']
 for r in rows:
  k=(r['role'],r['screen']);prior[k]=r
  if r.get('status') in ['pending','deferred-owner','deferred-to-task-5']:owned.add(k)
owned.add(('dispatcher','reports'))
for r in contract:
 if r['role'] in ['owner','system']:owned.add((r['role'],r['screen']))
renderers={
 'profile':'owner-tools-v13.js; employee-profile-patch.js; role-chrome-v83.js; existing master/dispatcher profile renderers',
 'personal':'master-profile-edit-v15.js / employee-profile-patch.js', 'help':'employee-profile-patch.js','about':'employee-profile-patch.js',
 'push':'web-push-v211.js (unchanged); read-only state rows in employee-profile-patch.js','login-settings':'auth-ui-patch.js; presentation labels in employee-profile-patch.js',
 'notifications':'notification-center-v26.js','claims':'claims-patch.js; claims-runtime-patch.js; master-profile-summary-v129.js','claim-detail':'claims-patch.js','claim-create':'claims-patch.js; order-lifecycle-v106.js',
 'avito':'avito-messages-v25.js','avito-thread':'avito-messages-v25.js','avito-lead':'avito-messages-v25.js','avito-settings':'avito-messages-v25.js',
 'hands-settings':'hands-integration-v69.js','hands-sync':'hands-integration-v69.js','hands-order':'hands-integration-v69.js',
 'file-viewer':'master-report-patch.js; existing signed image/original link','photo-error':'master-report-patch.js; employee-profile-patch.js error presentation',
 'price':'master-price-memo-v131.js; service catalogues; employee-profile-patch.js tabs','reports':'dispatcher-attention-v123.js openBosOpsAttention(report)',
 'admin':'owner-tools-v13.js and existing extensions','settings-proposal':'existing owner tools (safe supported equivalent)','role-preview':'owner-tools-v13.js; manager-preview-v28.js / role-preview-patch.js',
 'api-integrations':'api-integrations-v26.js','api-create':'api-integrations-v26.js','api-mapping':'api-integrations-v26.js',
 'auth-login':'mandatory-auth-v29.js; approved CSS/labels only','auth-invite':'mandatory-auth-v29.js; approved CSS/labels only','auth-expired':'mandatory-auth-v29.js existing 401-to-login gate',
 'loading':'mandatory-auth-v29.js original pending gate','empty':'order-filters-v22.js real zero-result filter','error':'employee-live-refresh-v27.js; owner-dashboard-v9.js preserved-data notice','offline':'same failed-refresh preserved-data notice',
 'design-system':'approved-ui.css; approved-master-ui.css; approved-operations-ui.css','navigation':'role-chrome-v83.js and original guarded destination handlers'}
limits={
 'push':'Browser support, Notification.permission and device subscription are independently named. Subscription uses read-only getRegistration/getSubscription, with explicit unavailable/unknown state; it does not assert account binding from permission. Original connection message and enable/test/disable, transport and lifecycle remain unchanged. Six fixture states per role at390/1440; owner default/subscribed also at360/430/768.',
 'price':'Existing structured service catalogue, Avito from-price catalogue and materials are kept separate in accessible tabs. Original prices, categories, search handlers and original source data are unchanged.',
 'auth-expired':'The existing 401 path returns to the normal login gate. No new auth state/message or invitation fallback was added.',
 'settings-proposal':'Unimplemented backend settings in the concept have no save API. Existing owner tools expose only real team/access/material/integration actions; no fake save.',
 'file-viewer':'Existing image act/photo viewer and original signed file link retained. PDF zoom/page controls and sizes from the proposal are unsupported; no invented PDF metadata.',
 'hands-settings':'Original health/configuration and sync actions retained. No new configuration fields, webhook claims or credentials. Access/transport unchanged.',
 'hands-sync':'Original sync screen retained; the proposal read-only summary does not replace the existing permitted sync buttons.',
 'role-preview':'Existing live preview is retained, including return to owner. It is not a sandbox or a new permission grant; only isolated fixtures used here.',
 'notifications':'No invented event timestamp for generated live alerts. Existing read/open semantics retained; no server-backed grouping invented.',
 'api-mapping':'All 15 existing mappings and original JSON test/save are retained, rather than reducing fields to synthetic four-row mockup.',
 'loading':'Existing authentication/bootstrap pending gate is the safe supported loading view, not invented skeleton data.',
 'offline':'Last loaded values remain visible with original refresh error; no clearing data or automatic form dismissal.',
 'reports':'Existing operational attention report filter is the dispatcher report queue; review opens its original report-review entry.',
 'design-system':'Design reference page is documentation, not a new runtime destination. Current role captures plus foundation palette/control tests verify it.',
 'navigation':'Design navigation matrix is documentation, not a new user role. Current four-role shell captures and foundation guards verify it.'}
rows=[]
for r in contract:
 k=(r['role'],r['screen'])
 if k not in owned:continue
 evidence=[x for x in captures if (x['role'],x['screen'])==k and x.get('path') and x.get('state')!='capture-gap']
 if r['role']=='system':evidence=[x for x in captures if x.get('screen') in ['home-days','workspace','dashboard'] and x.get('path') and x.get('width') in [390,1440]]
 prev=prior.get(k,{})
 if evidence:status='implemented' if r['screen'] in renderers else 'reused-and-role-verified'
 elif prev.get('status') in ['implemented','reused-and-role-verified','complete','covered'] and prev.get('captures'):evidence=prev['captures'];status='reused-accepted-stage-4'
 else:status='missing-visual-evidence'
 if r['screen']=='push' and not {'synthetic-fixture-'+s for s in ['default','denied','subscribed','unsupported','denied-with-subscription','unknown']}.issubset({x.get('state') for x in evidence}):status='missing-push-state-evidence'
 rows.append({**r,'stage':5,'status':status,'renderer':renderers.get(r['screen'],prev.get('renderer','accepted prior-stage renderer')),'evidence':evidence,'tests':'approved-ui-owner + affected role/integration suites; see task-5-report.md','dependency':limits.get(r['screen'],'Original allowed actions, fields, role guards and data retained.')})
counts=dict(collections.Counter(r['status'] for r in rows));(root/'stage-5/coverage.json').write_text(json.dumps({'stage':5,'baseCommit':'264e1727de95bbb119eecf9ba9dec41dc0f7f770','statuses':counts,'rows':rows},ensure_ascii=False,indent=2)+'\n')
lines=['# Stage 5 owner and remaining shared contract coverage','','No PNG-count proxy: each row identifies renderer, evidence and supported equivalent. See visual-review.md and task-5-report.md for exact source/build/test provenance.','','| Role / screen | Status | Renderer | Evidence | Dependency / supported equivalent |','| --- | --- | --- | --- | --- |']
for r in rows:
 ev=r['evidence'];refs='; '.join(dict.fromkeys(str(x.get('path','')).split('stage-5/')[-1] for x in ev));lines.append('| '+r['role']+'/'+r['screen']+' | '+r['status']+' | '+str(r['renderer'])+' | '+refs+' | '+r['dependency']+' |')
(root/'stage-5/coverage.md').write_text('\n'.join(lines)+'\n');print(len(rows),counts)
