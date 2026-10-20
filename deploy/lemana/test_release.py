"""Real filesystem swaps with explicit Docker/network/DB fakes; no live writes."""
import copy,importlib.util,json,os,shutil,sys,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'package'))
import frontend as f,backend as b,database as d,release as r
spec=importlib.util.spec_from_file_location('builder',HERE/'build_package.py');builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

class BackendTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.parent=Path(self.temp.name)
  self.stage=self.parent/'stage';self.stage.mkdir();self.roots={}
  for folder in b.MOUNTS:
   live=self.parent/'live'/folder;live.mkdir(parents=True);self.roots[folder]=str(live)
   (live/'untouched.txt').write_text('existing runtime')
   if folder in b.TARGETS:
    (live/'old.txt').write_text('before');os.chmod(live/'old.txt',0o640)
   f.copy_tree(live,self.stage/folder)
   f.copy_tree(live,self.stage/'backup'/folder) if (self.stage/'backup').exists() else None
  (self.stage/'backup').mkdir(exist_ok=True)
  for folder in b.MOUNTS:
   if not (self.stage/'backup'/folder).exists():f.copy_tree(Path(self.roots[folder]),self.stage/'backup'/folder)
  before={k:f.snapshot(Path(v)) for k,v in self.roots.items()}
  for folder in b.TARGETS:
   (self.stage/folder/'old.txt').write_text('after');(self.stage/folder/'new.txt').write_text('new')
  after={k:f.snapshot(self.stage/k) for k in b.MOUNTS}
  self.edge={'Id':'edge','Config':{},'HostConfig':{},'Mounts':[],'State':{'Running':True}}
  self.rec={'main_sha':f.MAIN,'state':'prepared','container':'edge','fingerprint':f.fingerprint(self.edge),'roots':self.roots,'before':before,'after':after,'nonce':'a'*32}
  self.events=[]
  for obj,name,value in [(b,'STAGE',self.stage),(f,'inspect',lambda x:self.edge),(f,'emit',lambda x:None),(b,'restart',lambda rec,phase:self.events.append('restart:'+phase)),(b,'probe_live',lambda *a,**k:None),(b,'cleanup',lambda *a:None)]:
   m=patch.object(obj,name,value);m.start();self.addCleanup(m.stop)
 def test_atomic_activation_and_restore_preserve_unrelated_bytes_and_modes(self):
  b.activate(self.rec);b.check(self.rec,'after');self.assertEqual(self.events,['restart:after'])
  b.restore(self.rec);b.check(self.rec,'before');self.assertEqual(self.events,['restart:after','restart:before'])
  self.assertEqual((Path(self.roots['sources'])/'old.txt').stat().st_mode&0o777,0o640)
 def test_interruption_between_exchanges_restores_both_independent_states(self):
  real=f.exchange;calls=[]
  def exchange(a,c):
   calls.append(str(a))
   if len(calls)==2:raise f.Stop('synthetic interruption')
   real(a,c)
  with patch.object(f,'exchange',exchange):
   with self.assertRaises(f.Stop):b.activate(self.rec)
  self.assertEqual(self.events,[]);b.check(self.rec);b.restore(self.rec);b.check(self.rec,'before')
 def test_drift_in_any_unrelated_file_blocks_activation_and_restore(self):
  for folder in b.MOUNTS:
   file=Path(self.roots[folder])/'untouched.txt';file.write_text('someone else edited')
   with self.assertRaises(f.Stop):b.activate(self.rec)
   with self.assertRaises(f.Stop):b.restore(self.rec)
   file.write_text('existing runtime')
  self.assertEqual(self.events,[])
 def test_changed_backup_blocks_all_mutation(self):
  (self.stage/'backup/sources/old.txt').write_text('changed')
  with self.assertRaises(f.Stop):b.activate(self.rec)
  self.assertEqual(f.snapshot(Path(self.roots['sources'])),self.rec['before']['sources'])
 def test_changed_container_blocks_all_mutation(self):
  self.edge['Config']['Image']='other-release'
  with self.assertRaises(f.Stop):b.activate(self.rec)
  self.assertEqual(self.events,[])
 def test_missing_after_file_not_accepted_as_partial_state(self):
  b.activate(self.rec);(Path(self.roots['sources'])/'new.txt').unlink()
  with self.assertRaises(f.Stop):b.restore(self.rec)

class CoordinatorTests(unittest.TestCase):
 def setup_rollback(self,dependent=False,offline=False):
  events=[];api={'state':'active'};web={'state':'active'};db={'state':'applied'}
  mapping={str(b.STAGE):api,str(f.STAGE):web,str(d.STAGE):db}
  def pause(_):
   events.append('barrier')
   if offline:raise f.Stop('DB unavailable')
   return dependent
  replacements=[(r,'load',lambda path,**kw:mapping[str(path)]),(f,'rollback_guard',lambda _:events.append('check-web')),(b,'check',lambda *a:events.append('check-api')),(b,'checked_payload',lambda _:None),(d,'pause',pause),(d,'retain',lambda _:events.append('retain-data')),(f,'restore',lambda *a:events.append('restore-web')),(b,'restore',lambda _:events.append('restore-api')),(f,'emit',lambda _:None)]
  for obj,name,value in replacements:
   m=patch.object(obj,name,value);m.start();self.addCleanup(m.stop)
  return events
 def test_positive_barrier_precedes_both_restores(self):
  events=self.setup_rollback();r.rollback_all({'before_build':'old'})
  self.assertLess(events.index('barrier'),events.index('restore-web'));self.assertLess(events.index('barrier'),events.index('restore-api'))
 def test_new_dependent_rows_keep_compatible_code_and_data(self):
  events=self.setup_rollback(dependent=True)
  with self.assertRaisesRegex(f.Stop,'ROLLBACK_BLOCKED_NEW_DATA'):r.rollback_all({})
  self.assertNotIn('restore-web',events);self.assertNotIn('restore-api',events)
 def test_database_outage_blocks_both_restores(self):
  events=self.setup_rollback(offline=True)
  with self.assertRaises(f.Stop):r.rollback_all({})
  self.assertNotIn('restore-web',events);self.assertNotIn('restore-api',events)
 def test_frontend_activation_failure_never_bypasses_barrier(self):
  source=(HERE/'package/frontend.py').read_text();body=source[source.index('def activate('):]
  self.assertNotIn('restore(',body)
 def test_resume_only_after_api_frontend_and_database_checks(self):
  source=(HERE/'package/release.py').read_text();section=source[source.index('        if args.resume:'):source.index('        api,web=load(',source.index('        if args.resume:'))]
  for gate in ["b.check(api,'after')","b.verify_mounts","f.public_verify","d.verify"]:self.assertLess(section.index(gate),section.index('d.resume'))

class BuildTests(unittest.TestCase):
 def test_routing_and_every_unrelated_module_retained(self):
  release,old,new,optional=builder.prepare(HERE/'bos296.pyz')
  for name in ['startup-shell.bundle.js','startup-eager.bundle.js']:
   head,old_modules=builder.parse_bundle(old[name]);new_head,new_modules=builder.parse_bundle(new[name]);self.assertEqual(head,new_head)
   for module,content in old_modules.items():
    if module not in optional:self.assertEqual(content,new_modules[module],module)
   for module in ['config.js','network-direct-v86.js','app-build-runtime.js']:
    if module in old_modules:self.assertEqual(old_modules[module],new_modules[module])
  self.assertEqual(new['sw.js'].replace(release['after_build'].encode(),release['before_build'].encode()),old['sw.js'])
 def test_all_non_mini_entrypoints_are_verified_and_unchanged(self):
  for handler in b.HANDLERS:
   name=handler+'/supabase/functions/'+handler+'/index.ts';self.assertIn(name,b.SPEC['before'])
   if handler!='mini-app-api':self.assertNotIn(name,b.SPEC['after'])
 def test_all_payload_hashes_and_no_customer_sample(self):
  spec,data=b.payload();self.assertEqual(set(data),set(spec['after']))
  with zipfile.ZipFile(HERE/'bos297.pyz') as z:
   self.assertFalse(any(n.endswith(('.xlsx','.dump','.log')) for n in z.namelist()))
   meta=json.loads(z.read('release.json'))
   for n,digest in meta['after'].items():self.assertEqual(f.sha(z.read('payload/'+n)),digest)
   for n,digest in spec['after'].items():self.assertEqual(f.sha(z.read('backend/'+n)),digest)
 def test_archive_contains_exact_reviewed_package_sources(self):
  with zipfile.ZipFile(HERE/'bos297.pyz') as z:
   for file in (HERE/'package').rglob('*'):
    if file.is_file() and '__pycache__' not in file.parts:
     self.assertEqual(z.read(str(file.relative_to(HERE/'package'))),file.read_bytes(),str(file))
 def test_build_is_offline_and_baselines_precede_source_changes(self):
  s=(HERE/'package/backend.py').read_text();section=s[s.index('def compile_candidate('):s.index('\nPROBE =')]
  self.assertIn("'--network','none'",section);self.assertIn('assert_isolated(cid)',section)
  self.assertLess(section.index("built=build(name,'baseline-build')"),section.index('install_sources(data)'))
  self.assertIn('Baseline bundle rebuild differs',section)

if __name__=='__main__':unittest.main(verbosity=2)
