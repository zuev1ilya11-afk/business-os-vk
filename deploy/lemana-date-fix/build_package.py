"""Reproduce the date-only RU patch from the immutable reviewed PR297 package."""
import hashlib,json,sys,zipfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parent.parent
BASE_SHA='3fa6b44e695441a8bda6446cbe6058394feedd9b51113f36d34c39386a8daec3'
def sha(data):return hashlib.sha256(data).hexdigest()
def build(base):
 assert sha(base.read_bytes())==BASE_SHA,'Wrong PR297 package'
 with zipfile.ZipFile(base) as z:
  old=json.loads(z.read('backend.json'));baseline=json.loads(z.read('release.json'))
  assert baseline['after_build']=='cc4fa850b12dadd27370'
  before={**old['before'],**old['after']}
  name='mini-app-api/lemana-import.js';parser=(ROOT/'lemana-import.js').read_bytes()
  spec={'handlers':['mini-app-api'],'before':{n:h for n,h in before.items() if n.startswith('mini-app-api/')},'after':{name:sha(parser)}}
  assert spec['before'][name]!=spec['after'][name]
  files={n:z.read(n) for n in ['frontend.py','backend.py','database.py','preflight.py','schema.sql','schema-expected.json','prerequisite.sql','prerequisite-expected.json','hands-schema.sql','pause-schema.sql','pause-expected.json']}
 files.update({'baseline.json':json.dumps(baseline,indent=2).encode()+b'\n',
  'backend.json':json.dumps(spec,indent=2).encode()+b'\n','backend/'+name:parser,
  'date_fix.py':(HERE/'date_fix.py').read_bytes(),
  '__main__.py':b'from date_fix import run\nrun()\n'})
 target=HERE/'bos-lemana-dates.pyz'
 with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED) as z:
  for name,data in sorted(files.items()):
   info=zipfile.ZipInfo(name,date_time=(2026,10,21,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,data)
 print('PACKAGE_SHA256='+sha(target.read_bytes()))
if __name__=='__main__':build(Path(sys.argv[1]))
