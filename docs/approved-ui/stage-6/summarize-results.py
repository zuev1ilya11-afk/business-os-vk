import json,sys,hashlib,collections
from pathlib import Path
p=Path(sys.argv[1]);j=json.loads(p.read_text());cases=[]
def walk(suite):
 for spec in suite.get('specs',[]):
  for test in spec.get('tests',[]):
   cases.append({'file':spec['file'],'line':spec.get('line'),'title':spec['title'],'status':test['status'],'expectedStatus':test.get('expectedStatus'),'resultStatuses':[r['status'] for r in test.get('results',[])],'errors':[e.get('message',str(e)) for r in test.get('results',[]) for e in r.get('errors',[])],'durationMs':sum(r.get('duration',0) for r in test.get('results',[]))})
 for s in suite.get('suites',[]):walk(s)
for s in j['suites']:walk(s)
out={'reportPath':str(p.resolve()),'reportSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'stats':j['stats'],'cases':len(cases),'outcomes':dict(collections.Counter(c['status'] for c in cases)),'globalErrors':j.get('errors',[]),'failures':[c for c in cases if c['status']=='unexpected'],'skipped':[c for c in cases if c['status']=='skipped'],'allCases':cases}
Path(sys.argv[2]).write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(out['stats'],out['outcomes'])
