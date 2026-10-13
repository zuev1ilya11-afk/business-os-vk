import json,hashlib
from pathlib import Path
from PIL import Image,ImageDraw
root=Path.cwd();out=root/'docs/approved-ui/stage-6';canonical=root.parent/'audit-ui/proposed';entries=json.loads((out/'capture-manifest.json').read_text());pairs=[]
sections={'master':['home-days','orders-active','order-detail','report-form','schedule','schedule-month','payouts','memo','profile','price','push','auth-login'],'dispatcher':['workspace','orders','order-detail','order-create','schedule','more','profile','push','auth-login'],'manager':['dashboard','orders','team','review','finance-overview','finance-masters','profile','push','auth-login'],'owner':['dashboard','orders-active','team','review','finance-overview','finance-expenses','profile','push','auth-login']}
for role,screens in sections.items():
 for width in [390,1440]:
  tile=260 if width==390 else 430;h=540 if width==390 else 285;canvas=Image.new('RGB',(tile*2+25,(h+45)*len(screens)),'#0e141c');d=ImageDraw.Draw(canvas)
  for i,screen in enumerate(screens):
   candidates=[e for e in entries if e.get('role')==role and e.get('screen')==screen and e.get('width')==width and e.get('path') and e.get('state')!='capture-gap']
   candidates.sort(key=lambda e:('profile-menu' in e['path'] or 'profile-personal-data' in e['path'],'scrolled' in e['state'] or 'menu' in e['state'],'subscribed' not in e['state'] if screen=='push' else False))
   if not candidates:raise ValueError('Missing final '+role+'/'+screen+'/'+str(width))
   e=candidates[0];a=canonical/role/f'{screen}-{width}.png';referenceWidth=width
   if not a.exists() and role=='master' and width==1440:a=canonical/role/f'{screen}-390.png';referenceWidth=390
   b=Path(e['path']);y=i*(h+45);d.text((8,y+3),f'{role}/{screen} APPROVED {referenceWidth}px / ACTUAL {width}px',fill='#edf2f8')
   for side,p in enumerate([a,b]):
    if not p.exists():raise ValueError('Missing '+str(p))
    im=Image.open(p).convert('RGB');im.thumbnail((tile,h));canvas.paste(im,(side*(tile+15),y+28))
   pairs.append({'role':role,'screen':screen,'width':width,'approvedWidth':referenceWidth,'approved':str(a),'approvedSha256':hashlib.sha256(a.read_bytes()).hexdigest(),'implementation':e['path'],'implementationSha256':hashlib.sha256(b.read_bytes()).hexdigest(),'commit':e['commit'],'runtimeBuild':e.get('runtimeBuild') or e.get('buildId'),'state':e['state'],'equivalence':'Master canonical has mobile widths only; desktop uses same accepted composition, referenced against390 without inventing approved desktop PNG.' if referenceWidth!=width else 'Matching approved viewport; fixture data and documented native equivalents may differ.'})
  canvas.save(out/f'{role}-comparison-{width}.jpg',quality=90)
(out/'visual-pairs.json').write_text(json.dumps(pairs,ensure_ascii=False,indent=2)+'\n');print(len(pairs),'fresh major-section pairs')
# Additional responsive comparison references use accepted historical evidence with true capture provenance.
responsive=[]
for r in json.loads((root/'docs/approved-ui/coverage.json').read_text())['rows']:
 if r['role'] not in sections or r['screen'] not in sections[r['role']]:continue
 for width in [360,430,768]:
  a=canonical/r['role']/f'{r["screen"]}-{width}.png'
  if not a.exists():continue
  candidates=[e for e in r['evidence'] if e.get('width')==width and (root/e['path']).exists()]
  if candidates:
   e=sorted(candidates,key=lambda e:('stage-6' not in e['path'],'scrolled' in e.get('state','')))[0];responsive.append({'role':r['role'],'screen':r['screen'],'width':width,'approved':str(a),'implementation':e['path'],'commit':e.get('commit'),'runtimeBuild':e.get('runtimeBuild'),'state':e.get('state'),'source':'Accepted earlier evidence; no final-runtime recapture claim'})
(out/'responsive-visual-pairs.json').write_text(json.dumps(responsive,ensure_ascii=False,indent=2)+'\n');print(len(responsive),'accepted responsive pairs')
