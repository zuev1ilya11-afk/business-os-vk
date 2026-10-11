import json,hashlib,collections,re
from pathlib import Path
out=Path('docs/approved-ui/stage-6');root=Path.cwd();m=json.loads((out/'capture-manifest.json').read_text());
for e in m:e['runtimeBuild']=e.get('runtimeBuild') or e.get('observedBuild') or e.get('buildId')
(out/'capture-manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
assert all(e.get('path') and Path(e['path']).exists() for e in m);assert len({e['path'] for e in m})==len(m)
flags=[{'role':e['role'],'screen':e['screen'],'width':e['width'],'state':e['state'],'action':a} for e in m for a in e.get('health',{}).get('visibleOccludedActions',[])]
probes=[]
for line in (root.parent/'recovery/task6-occlusion-4.log').read_text().splitlines():
 if line.startswith('DOMPROBE '):probes.append(json.loads(line[len('DOMPROBE '):]))
assert len(probes)==12
for row in flags:
 if row['screen'].startswith('finance-'):
  p=next(p for p in probes if (p['role'],p['screen'],p['width'])==(row['role'],row['screen'],row['width']));closed=[d for d in p['dom'] if 'data-fin-period="month"' in d['html']];assert len(closed)==1 and not closed[0]['visible'];row['disposition']='Harness false positive: nonzero rect of month button inside closed details; checkVisibility false';row['probe']=closed[0]
 else:
  assert row['role']=='dispatcher' and row['screen']=='master-report';assert 'PDF_REACHABLE 390' in (root.parent/'recovery/task6-occlusion-3.log').read_text();row['disposition']='Initial native PDF export overlaps bottom nav; explicit scrollIntoViewIfNeeded then actual button trial-click succeeded. No export triggered.';row['scrolledCapture']=next(e['path'] for e in m if e['screen']=='master-report-action');row['limit']='Initial overlap remains recorded; this is reachability after scrolling, not a claim of initial unobstructed usability.'
(out/'diagnostic-dispositions.json').write_text(json.dumps({'initialFlags':len(flags),'financeFalsePositives':12,'actualInitialOverlaps':1,'rawObservationsPreserved':True,'scrolledTrialClickPasses':1,'rows':flags},ensure_ascii=False,indent=2)+'\n')
health=[e for e in m if e.get('health')];summary={'captures':len(m),'roleTotals':dict(collections.Counter(e['role'] for e in m)),'widths':sorted(set(e['width'] for e in m)),'commitCounts':dict(collections.Counter(e['commit'] for e in m)),'runtimeCounts':dict(collections.Counter(e['runtimeBuild'] for e in m)),'captureGaps':0,'healthMeasurements':len(health),'pageErrors':sum(len(e.get('pageErrors',[]))+len(e.get('health',{}).get('pageErrors',[])) for e in m),'local404':sum(len(e['health']['local404']) for e in health),'overflows':sum(e['health']['documentOverflow']>1 or e['health']['bodyOverflow']>1 for e in health),'initialOcclusionFlags':len(flags),'longReviewStates':sum('long-' in e['state'] and e['screen']=='review' for e in m),'longFormsEndStates':sum('scrolled-end' in e['state'] and e['screen'] in ['order-create','order-edit'] for e in m),'proofs':'Independent five-width role health; initial/scrolled probes; native callback tests. Counts do not certify universal usability.','toolingProvenance':'Source commit refers to application source/runtime. Capture wrapper instrumentation was developed in working tree across batches; original per-batch logs retained. No unrecorded exact historical tooling hash is invented. Current reproducible tools hashed below.','toolHashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.glob('*.cjs')}}
assert summary['pageErrors']==summary['local404']==summary['overflows']==0
(out/'capture-health-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
rows=[{'path':str(Path(e['path']).relative_to(root)),'sha256':hashlib.sha256(Path(e['path']).read_bytes()).hexdigest(),'role':e['role'],'screen':e['screen'],'width':e['width'],'state':e['state'],'commit':e['commit'],'runtimeBuild':e['runtimeBuild']} for e in m];(out/'capture-file-hashes.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(summary,ensure_ascii=False))
