"""Produce contract-row evidence; captures are fixture diagnostics, not business data."""
import json
from pathlib import Path
root=Path.cwd(); base=root/'docs/approved-ui/stage-4'
contract=json.loads((root/'docs/approved-ui/screen-contract.json').read_text()); manifest=json.loads((base/'capture-manifest.json').read_text())
core={'dashboard','team','team-member','profile','more','admin','invite','employee-edit','staff-invite','staff-access','memo-edit','manual-complete','order-delete','reports','review','review-reject','control','control-task'}
reused={'orders','orders-new','orders-active','orders-reports','orders-archive','workspace','attention','order-detail','order-create','order-edit','assign','reschedule','schedule','schedule-month','day-detail','free-slots','slot-assign','order-cancel','filters'}
finance={x['screen'] for x in contract if x['screen'].startswith('finance-') or x['screen'].startswith('expense-')}
def renderer(s):
 if s in finance:return 'finance-page.js; unchanged finance-data.js / finance-expenses.js'
 if s in {'dashboard','workspace'}:return 'owner-dashboard-v9.js; order-control.js'
 if s in {'team','team-member'}:return 'team-roles-fix-v31.js; employee-profile-patch.js; staff-permissions-calendar-v43.js'
 if s in {'profile','admin','invite','employee-edit','staff-invite','staff-access','memo-edit'}:return 'existing employee/profile/access/memo renderers; employee-profile-patch.js; role-chrome-v83.js; scoped approved-operations-ui.css'
 if s in {'review','review-reject'}:return 'report-review-patch.js; report-review-runtime-v30.js'
 if s in {'reports','orders-reports'}:return 'owner-dashboard-v9.js; original report review queue'
 if s in {'control','control-task'}:return 'order-control.js; unchanged order-control-tasks.js'
 if s in {'schedule','schedule-month','day-detail'}:return 'unchanged unified-schedule-v102.js / dispatcher-mobile-dispatch-v107.js; Stage 3 composition'
 return 'unchanged Stage 3 shared operational renderer; approved-operations-ui.css'
rows=[]
for x in contract:
 if x['role'] not in ['owner','manager'] and not (x['role']=='dispatcher' and x['screen'] in {'review','review-reject','control','control-task'}):continue
 role,s=x['role'],x['screen'];owned=s in core|reused|finance
 caps=[c for c in manifest if c['role']==role and c['screen']==s and c['state']!='capture-gap']
 entry={k:x[k] for k in ['role','screen','title','sourceSurfaceIds']}
 entry.update(status=('reused-and-role-verified' if s in reused else 'implemented') if owned else 'deferred-to-task-5',renderer=renderer(s) if owned else 'existing renderer retained; Task 5 integration/shared-state work',stage=4 if owned else 5,captures=[{'width':c['width'],'path':str(Path(c['path']).relative_to(root)),'runtimeBuild':c['runtimeBuild'],'commit':c['commit'],'synthetic':True} for c in caps],tests=['tests/approved-ui-management.spec.js','role-scoped suites in task-4-report.md'] if owned else [],dependencies=[])
 if s in finance:entry['dependencies'].append('No bank transfer ledger: actual paid remains —. Existing financial formulas, period scope and source semantics remain authoritative.')
 if s=='finance-expenses':entry['dependencies'].append('The selected period expenses are loaded; separate week spending is not inferred. Summary shows selected-period total and saved record count.')
 if s in {'workspace'}:entry['dependencies'].append('Existing role guard routes manager/owner Home to management dashboard. No separate dispatcher-only workspace destination is invented; their Orders, Schedule and Detail are captured separately.')
 if s in {'order-delete'}:entry['dependencies'].append('Original native confirmation is retained. Capture shows existing leadership delete entry/context; no unsupported deletion-reason form is added.')
 if s in {'review','review-reject'}:entry['dependencies'].append('Existing signed act/photo URLs and review snapshot remain. Fixture media is deliberately unavailable; no invented filenames/sizes or external file fetch. Reject uses original required comment validation.')
 if s in {'staff-invite'}:entry['dependencies'].append('Capture only uses synthetic read-only isolation and an explicitly DEMO-ONLY issue response; no real invitation issued.')
 if not owned:entry['dependencies'].append('Shared auth, notifications, help/personal, integration/claims and system/file states are controller-owned Task 5. Entry points preserved.')
 if owned and not caps:entry['status']='missing-evidence'
 rows.append(entry)
counts={s:len([r for r in rows if r['status']==s]) for s in sorted(set(r['status'] for r in rows))}
(base/'coverage.json').write_text(json.dumps({'stage':4,'baseCommit':'12f4472962c342e64ada480b855e50bfe052cad5','statuses':counts,'rows':rows},ensure_ascii=False,indent=2)+'\n')
md=['# Task 4 contract coverage','', 'Each row is a role/screen contract, not a PNG count. Finance fields retain the existing financial model. Synthetic captures use only local fixtures.','', '| Role | Screen | Status | Renderer | Capture widths |','|---|---|---|---|---|']
for r in rows:md.append('| '+ ' | '.join([r['role'],r['screen'],r['status'],r['renderer'],', '.join(map(str,sorted(set(c['width'] for c in r['captures'])))) or 'Task 5'])+' |')
(base/'coverage.md').write_text('\n'.join(md)+'\n');print(counts)
