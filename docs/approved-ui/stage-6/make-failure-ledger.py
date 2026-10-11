import json,hashlib
from pathlib import Path
out=Path('docs/approved-ui/stage-6');base=json.loads((out/'full-browser-summary.json').read_text());names=['recovered-focused','recovered-close4','main-comparison'];runs={n:json.loads((out/(n+'-summary.json')).read_text()) for n in names if (out/(n+'-summary.json')).exists()}
causes={
'dark-business-os.spec.js':'Mobile More navigation; original reschedule moved to visit section; explicit departure/start confirmation task.',
'dispatcher-mobile-v97.spec.js':'Original unassigned filter replaces hidden legacy metrics control; card secondary disclosure.',
'dispatcher-order-priority-v105.spec.js':'Secondary disclosure and visible-button touch geometry; hidden duplicate Open excluded, original primary preserved.',
'dispatcher-quick-actions-v159.spec.js':'Secondary disclosure, approved visible primary Open and actual original assignment heading.',
'dispatcher-responsive-workbench-v157.spec.js':'Original quick-edit action requires approved secondary disclosure.',
'full-stack-audit.spec.js':'Native filter modal, approved profile identity and month/edit/bulk schedule route; exact writes and reload retained.',
'master-agreement-v109.spec.js':'Original confirmed reschedule action and context now in native visit section.',
'master-cabinet-final.spec.js':'Repeated city label scoped to personal profile details.',
'master-compact-card.spec.js':'Approved complete work list preserves all titles/quantities; apartment scoped to address; current comment heading and original stage confirmation.',
'master-cost-visibility.spec.js':'Original money values moved to approved money block; calculation and forbidden amount assertions retained.',
'master-home-tabs.spec.js':'Approved current step display title; original action unchanged.',
'master-mobile.spec.js':'Visit section reschedule; timeline/month/edit schedule path; approved profile identity.',
'master-order-focus-v126.spec.js':'Approved current-step display title, original report action unchanged.',
'master-workflow-loading.spec.js':'Original reschedule action now in visit section.',
'master-workflow-v115.spec.js':'Original departure/start writes follow explicit confirmation tasks.',
'master-workflow-v25.spec.js':'Visit section reschedule and explicit original stage confirmations.',
'order-lifecycle-v106.spec.js':'Approved workspace All orders / Completed queue is native equivalent of superseded home done cards; original Hands identity and claim action preserved.',
'orders-today-filter.spec.js':'Original hidden status filter accessed through native filter modal; await original lazy select before cloning. Exact date/status/search membership remains.',
'report-attachment-links.spec.js':'Original viewer Close scoped separately from Retry; unsafe URL and original link assertions remain.',
'report-correction-cycle.spec.js':'Dispatcher original report review via report-attention queue; await reloadData before opening modal; terminal business actions checked separately from modal close. Tokens, correction, payout, single archive retained.',
'role-ui-sweep.spec.js':'Approved dispatcher workspace heading.',
'schedule-contract.spec.js':'Original smart assignment through secondary disclosure; job duration, slot and payload assertions retained.',
'shared-service-catalog.spec.js':'Current Save changes label and native catalog/material tab navigation; loading/error/retry/empty assertions retained.',
'smoke.spec.js':'Approved overview/review headings, More navigation and Save changes label; full action/report smoke preserved.',
'ui-polish.spec.js':'Master default schedule is visit timeline; native month/editor separate.',
'owner-dashboard.spec.js':'Direct refresh invoked while original manual button disabled by an in-flight refresh. Wait enabled and click original button once; empty-data assertion retained.'}
transient={'calendar-master-details.spec.js','finance-page.spec.js','master-home-simplification.spec.js'};rows=[]
for i,c in enumerate(base['failures']):
 h=[]
 for n,r in runs.items():
  for t in r['allCases']:
   if (c['file'],c['title'])==(t['file'],t['title']):h.append({'run':n,'reportPath':r['reportPath'],'reportSha256':r['reportSha256'],'outcome':t['status'],'resultStatuses':t['resultStatuses'],'errors':t['errors']})
 final=[x for x in h if x['run']!='main-comparison'][-1];assert final['outcome']=='expected',(c['file'],c['title'])
 date=c['title']=='home result and agreement move an undated order to its saved day without reload';tr=c['file'] in transient
 cause='Fixed Oct10 became past server date Oct11; original main case independently rejects it. Future 2099 fixture preserves original agreement/save/regrouping semantics.' if date else 'Baseline transient failure; unchanged exact case passed in recovered focused run. Root cause not conclusively attributed or claimed pre-existing.' if tr else causes[c['file']]
 rows.append({'id':i+1,'file':c['file'],'title':c['title'],'baseline':c,'cause':cause,'classification':'deterministic-date-fixture' if date else 'unchanged-transient-pass' if tr else 'approved-native-test-adaptation','sourceChange':False,'testChange':not tr,'testFiles':[] if tr else ['tests/'+c['file']],'reruns':h,'finalCoveringRun':final,'resolution':'passed-exact-original-title'})
assert len(rows)==76 and len({(r['file'],r['title']) for r in rows})==76
j={'baselineCount':76,'resolvedExactTitles':76,'runtimeChanges':0,'runtimeChangesScope':'Changes required to close these76 baseline cases only. Separate memo navigation fix cfd6740 is documented in verification.md, not a baseline-case runtime repair.','semanticOrReadinessAdaptations':72,'unchangedTransientPasses':3,'dateFixtureRepairs':1,'baselineReport':base['reportPath'],'baselineSha256':base['reportSha256'],'historicalEvidenceLoss':'Platform scratch cleanup destroyed historical 2ab0f8e and narrow raw logs. Those outcomes are narrative history only; current regenerated raw reports are authoritative. Full baseline survived controller durability.','runs':{n:{k:r[k] for k in ['reportPath','reportSha256','stats','cases','outcomes']} for n,r in runs.items()},'rows':rows};(out/'failure-dispositions.json').write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
lines=['# Original failure dispositions','','The original full baseline remains 622 passed / 76 failed. Every original file/title is retained and mapped to a passing exact-title narrow result. No rename/drop. Lost pre-cleanup narrow JSON is not reconstructed or claimed preserved. Three unchanged cases passed transiently; no claim of proven pre-existing defect.','','| # | Original case | Cause / test change | Exact covering result |','| --- | --- | --- | --- |']
for r in rows:lines.append(f'| {r["id"]} | {r["file"]} — {r["title"]} | {r["cause"]} Source change: false; test change: {r["testChange"]}. | {r["finalCoveringRun"]["run"]}: expected / {r["finalCoveringRun"]["resultStatuses"]} |')
(out/'failure-dispositions.md').write_text('\n'.join(lines)+'\n');print('All76 exact original titles resolved; no runtime edits needed for those76 closures')
