"""Backend-only date parser fix. Existing PR297 schema and all data stay intact."""
import argparse,fcntl,json,os,re,shutil,signal,sys,uuid
from pathlib import Path
import frontend as f
import backend as b
import database as d

FIX='lemana-local-date-fractions-v1'
PREVIOUS=f.PARENT/'lemana-297-api'
WEB=f.PARENT/'lemana-297-web'
b.STAGE=f.PARENT/'lemana-date-fix-api'
META=json.loads(b.resource('baseline.json'))
PARSER='mini-app-api/lemana-import.js'
SAVE=b.save
def save(rec):
 rec['fix_id']=FIX
 rec['parser_sha256']=b.SPEC['after'][PARSER]
 SAVE(rec)
b.save=save

def load(stage):
 f.require(stage.is_dir() and stage.resolve()==stage and stage.stat().st_uid==0,'Missing or unsafe release stage')
 path=stage/'journal.json'
 f.require(path.is_file() and not path.is_symlink() and path.stat().st_uid==0,'Missing or unsafe release journal')
 rec=json.loads(path.read_text())
 f.require(rec.get('main_sha')==f.MAIN,'Unexpected release journal')
 return rec

def web_check(web):
 f.require(web['state']=='active','PR297 frontend is not active')
 f.check_container(web)
 root=Path(web['root'])
 f.require(f.snapshot(root)==web['after_snapshot'],'Frontend changed since PR297')
 f.file_hashes(root,META['after'])
 f.public_verify(META,web['served_after'])
 return root

def anchor(rec,previous):
 f.require(rec.get('fix_id')==FIX,'Wrong date-fix journal')
 f.require(rec.get('parser_sha256')==b.SPEC['after'][PARSER],'Different date-parser patch in journal')
 f.require(rec['before']==previous['after'],'Date fix was prepared against a different API')
 for name in ['container','fingerprint','image','roots']:
  f.require(rec[name]==previous[name],'Date-fix runtime differs: '+name)

def build_cache(rec):
 previous=load(PREVIOUS)
 f.require(previous['state']=='active','PR297 compiler journal is not active')
 f.require(previous['image']==rec['image'] and previous['after']==rec['before'],'PR297 compiler baseline differs')
 cache=PREVIOUS/'cache'
 f.snapshot(cache)
 return cache
b.original_build_cache=build_cache

def database_check(previous):
 rec=load(d.STAGE)
 current=d.discover(previous['container'])
 f.require(all(rec.get(k)==v for k,v in current.items()),'PR297 database routing changed')
 state=d.inspect_schema(rec)
 f.require(state['schema']=='target' and not state['paused'],'PR297 schema is missing or import is paused; complete PR297 first')

def rollback(rec,web):
 web_check(web)
 if rec['state']=='preparing':
  # No live mutation is possible until preparation and isolated probes finish.
  b.check(rec,'before');b.cleanup(rec);rec['state']='rolled_back';b.save(rec)
 else:
  b.restore(rec)
 f.emit('LEMANA_DATE_ROLLBACK_OK; PR297 retained, database untouched')

def archive(rec):
 f.require(rec['state'] in ['preparing','prepared','rolled_back'],'Interrupted activation: run --rollback')
 b.check(rec,'before')
 if rec['state']!='preparing':b.checked_payload(rec)
 b.cleanup(rec)
 target=b.STAGE.with_name(b.STAGE.name+'-history-'+uuid.uuid4().hex[:12])
 f.require(not target.exists(),'Archive path exists')
 os.rename(b.STAGE,target);b.sync_dir(target.parent)
 f.emit('PREVIOUS_ATTEMPT_SAVED='+str(target))

def resources(info):
 mem=re.search(r'^MemAvailable:\s+(\d+)\s+kB$',Path('/proc/meminfo').read_text(),re.M)
 f.require(mem and int(mem[1])>=1024*1024,'At least 1 GiB available RAM required')
 size=sum(v.get('size',0) for tree in info['before'].values() for v in tree.values())
 f.require(size<=512*1024*1024 and shutil.disk_usage(f.PARENT).free>=size*4+512*1024*1024,'Insufficient staging space')
 f.require(shutil.which('nsenter') is not None,'nsenter is required for isolated probes')

def execute(mode):
 previous,web=load(PREVIOUS),load(WEB)
 f.require(previous['state']=='active','Complete PR297 before this date fix')
 root=web_check(web)
 if mode!='rollback':database_check(previous)
 rec=load(b.STAGE) if b.STAGE.exists() else None
 if rec:
  anchor(rec,previous)
  if mode=='rollback':rollback(rec,web);return
  if rec['state']=='active':
   b.checked_payload(rec);b.check(rec,'after');b.verify_mounts(rec['container'],rec['roots'],rec['after']);b.probe_live(rec)
   f.emit('LEMANA_DATE_FIX_ALREADY_INSTALLED');return
  f.require(rec['state'] in ['preparing','prepared','rolled_back'],'Interrupted activation: run --rollback')
  b.check(rec,'before')
  if mode=='apply':archive(rec)
 else:f.require(mode!='rollback','No date-fix journal found')
 b.check(previous,'after')
 info=b.discover(root)
 f.require(info['before']==previous['after'] and info['fingerprint']==previous['fingerprint'],'PR297 API baseline changed')
 resources(info)
 if mode=='check':f.emit('DATE_FIX_CHECK_OK; no files or services changed');return
 rec=b.prepare(info)
 try:
  b.activate(rec)
  web_check(web)
 except BaseException as error:
  try:rollback(rec,web)
  except BaseException as recovery:raise f.Stop('DATE_FIX_ROLLBACK_INCOMPLETE; retain backups and run --rollback. '+str(recovery)) from recovery
  raise f.Stop('Date fix was rolled back: '+(str(error) if isinstance(error,f.Stop) else type(error).__name__)) from error
 f.emit('LEMANA_DATE_FIX_OK; frontend build='+META['after_build'])
 f.emit('ROLLBACK: python3 /root/bos-lemana-dates.pyz --rollback')

def main():
 parser=argparse.ArgumentParser(description='Preserve milliseconds in Lemana XLSX dates')
 modes=parser.add_mutually_exclusive_group(required=True)
 for name in ['check','apply','rollback']:modes.add_argument('--'+name,action='store_true')
 args=parser.parse_args()
 f.require(os.geteuid()==0 and sys.platform=='linux','Run as root on the existing Linux server')
 f.require(f.PARENT.is_dir() and f.PARENT.resolve()==f.PARENT,'Existing deployment directory not found')
 os.umask(0o077)
 b.payload() # Validate every embedded source before looking at production files.
 lock=os.open(f.PARENT,os.O_RDONLY|os.O_DIRECTORY)
 try:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  execute('check' if args.check else 'apply' if args.apply else 'rollback')
 finally:os.close(lock)

def run():
 def interrupted(signum,frame):raise f.Stop('Interrupted by signal '+str(signum))
 signal.signal(signal.SIGTERM,interrupted)
 try:main()
 except (f.Stop,d.p.Stop,OSError,ValueError,KeyError,KeyboardInterrupt) as error:
  print('STOP: '+(str(error) if isinstance(error,(f.Stop,d.p.Stop)) else type(error).__name__),file=sys.stderr,flush=True)
  sys.exit(1)
