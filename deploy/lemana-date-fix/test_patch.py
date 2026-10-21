"""Synthetic filesystem and coordinator checks, without Docker/DB/network access."""
import copy,hashlib,json,os,sys,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'bos-lemana-dates.pyz'))
import date_fix as x
f,b=x.f,x.b
DATABASE_CHECK=x.database_check

class PackageTests(unittest.TestCase):
 def test_exact_reviewed_helpers_and_single_changed_source(self):
  baseline=Path(os.environ.get('BOS_LEMANA_BASE_PACKAGE',HERE/'bos297.pyz'))
  self.assertEqual(hashlib.sha256(baseline.read_bytes()).hexdigest(),'3fa6b44e695441a8bda6446cbe6058394feedd9b51113f36d34c39386a8daec3')
  with zipfile.ZipFile(baseline) as old,zipfile.ZipFile(HERE/'bos-lemana-dates.pyz') as new:
   for name in ['frontend.py','backend.py','database.py','preflight.py','schema.sql','schema-expected.json','prerequisite.sql','prerequisite-expected.json','hands-schema.sql','pause-schema.sql','pause-expected.json']:
    self.assertEqual(new.read(name),old.read(name),name)
   self.assertEqual(new.read('date_fix.py'),(HERE/'date_fix.py').read_bytes())
   self.assertEqual(new.read('backend/'+x.PARSER),(HERE.parent.parent/'lemana-import.js').read_bytes())
   self.assertFalse(any(n.endswith(('.xlsx','.dump','.log')) for n in new.namelist()))
  self.assertEqual(set(b.SPEC['after']),{x.PARSER})
  self.assertEqual(b.TARGETS,{'sources':{x.PARSER},'bundles':{'mini-app-api.eszip'}})
  b.payload()

class CoordinatorTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.stage=Path(self.temp.name)/'stage';self.events=[]
  self.previous={'state':'active','container':'edge','fingerprint':'fp','image':'image','roots':{},'after':{'old':'snapshot'}}
  self.web={'state':'active'}
  self.rec={**self.previous,'state':'prepared','main_sha':f.MAIN,'fix_id':x.FIX,'parser_sha256':b.SPEC['after'][x.PARSER],'before':self.previous['after'],'after':{'new':'snapshot'}}
  def load(path):return self.rec if path==self.stage else self.previous if path==x.PREVIOUS else self.web
  info={**self.previous,'before':self.previous['after']}
  replacements=[(b,'STAGE',self.stage),(x,'load',load),(x,'web_check',lambda _:self.events.append('web') or Path('/synthetic/web')),
   (x,'database_check',lambda _:self.events.append('db-read-only')),(x,'resources',lambda _:None),(b,'discover',lambda _:info),
   (b,'check',lambda *a:self.events.append('check')),(b,'checked_payload',lambda _:self.events.append('backup-check')),
   (b,'verify_mounts',lambda *a:self.events.append('mount-check')),(b,'probe_live',lambda _:self.events.append('probe')),
   (b,'prepare',lambda _:self.events.append('prepare') or self.rec),(b,'activate',lambda _:self.events.append('activate')),
   (b,'restore',lambda _:self.events.append('restore')),(f,'emit',lambda _:None)]
  for obj,key,value in replacements:
   p=patch.object(obj,key,value);p.start();self.addCleanup(p.stop)
 def test_check_never_prepares_activates_or_creates_stage(self):
  x.execute('check');self.assertFalse(self.stage.exists());self.assertNotIn('prepare',self.events);self.assertNotIn('activate',self.events)
 def test_paused_or_unknown_schema_blocks_preparation(self):
  with patch.object(x,'database_check',side_effect=f.Stop('paused')):
   with self.assertRaises(f.Stop):x.execute('apply')
  self.assertNotIn('prepare',self.events);self.assertNotIn('activate',self.events)
 def test_activation_failure_restores_same_schema_api(self):
  with patch.object(b,'activate',side_effect=f.Stop('probe failed')):
   with self.assertRaisesRegex(f.Stop,'was rolled back'):x.execute('apply')
  self.assertEqual(self.events.count('restore'),1)
 def test_preparation_failure_never_changes_live_code(self):
  with patch.object(b,'prepare',side_effect=f.Stop('baseline differs')):
   with self.assertRaises(f.Stop):x.execute('apply')
  self.assertNotIn('activate',self.events);self.assertNotIn('restore',self.events)
 def test_already_active_verifies_without_reactivation(self):
  self.stage.mkdir();self.rec['state']='active';x.execute('apply')
  self.assertIn('mount-check',self.events);self.assertIn('probe',self.events);self.assertNotIn('activate',self.events)
 def test_interrupted_activation_requires_rollback(self):
  self.stage.mkdir();self.rec['state']='activating'
  with self.assertRaisesRegex(f.Stop,'--rollback'):x.execute('apply')
  self.assertNotIn('prepare',self.events)
 def test_rollback_does_not_need_database_or_revert_schema(self):
  self.stage.mkdir();x.execute('rollback');self.assertIn('restore',self.events);self.assertNotIn('db-read-only',self.events)
 def test_wrong_baseline_parser_or_container_journal_is_rejected(self):
  for field,value in [('fix_id','other'),('parser_sha256','other'),('before',{}),('container','other')]:
   rec={**self.rec,field:value}
   with self.assertRaises(f.Stop):x.anchor(rec,self.previous)
 def test_readonly_schema_check_rejects_pause_and_changed_routing(self):
  db={'container':'db','fingerprint':'dbfp','dbname':'postgres','rest':'rest','rest_fingerprint':'restfp'}
  with patch.object(x,'load',return_value=db),patch.object(x.d,'discover',return_value=db):
   for state in [{'schema':'baseline','paused':False},{'schema':'target','paused':True}]:
    with patch.object(x.d,'inspect_schema',return_value=state):
     with self.assertRaises(f.Stop):DATABASE_CHECK(self.previous)
   with patch.object(x.d,'inspect_schema',return_value={'schema':'target','paused':False}):DATABASE_CHECK(self.previous)
   with patch.object(x.d,'discover',return_value={**db,'container':'other'}):
    with self.assertRaises(f.Stop):DATABASE_CHECK(self.previous)

class FilesystemTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);parent=Path(self.temp.name)
  self.stage=parent/'stage';self.stage.mkdir();(self.stage/'backup').mkdir();self.roots={}
  for folder in b.MOUNTS:
   root=parent/'live'/folder;root.mkdir(parents=True);self.roots[folder]=str(root)
   (root/'untouched').write_text('retain')
   for name in b.TARGETS.get(folder,set()):
    target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text('before')
   f.copy_tree(root,self.stage/folder);f.copy_tree(root,self.stage/'backup'/folder)
  before={k:f.snapshot(Path(v)) for k,v in self.roots.items()}
  for folder,names in b.TARGETS.items():
   for name in names:(self.stage/folder/name).write_text('after')
  self.edge={'Id':'edge','Config':{},'HostConfig':{},'Mounts':[]}
  self.rec={'state':'prepared','main_sha':f.MAIN,'container':'edge','fingerprint':f.fingerprint(self.edge),'roots':self.roots,'before':before,'after':{k:f.snapshot(self.stage/k) for k in b.MOUNTS}}
  for obj,key,value in [(b,'STAGE',self.stage),(f,'inspect',lambda _:self.edge),(b,'restart',lambda *a:None),(b,'probe_live',lambda *a,**k:None),(b,'cleanup',lambda _:None),(x,'web_check',lambda _:None),(f,'emit',lambda _:None)]:
   p=patch.object(obj,key,value);p.start();self.addCleanup(p.stop)
 def test_actual_directory_exchange_and_compatible_rollback(self):
  b.activate(self.rec);b.check(self.rec,'after');x.rollback(self.rec,{})
  b.check(self.rec,'before');self.assertEqual(self.rec['state'],'rolled_back')
 def test_interruption_between_exchanges_recovers_both_directories(self):
  original=f.exchange;calls=[]
  def exchange(a,c):
   calls.append(a)
   if len(calls)==2:raise f.Stop('interrupted')
   original(a,c)
  with patch.object(f,'exchange',exchange):
   with self.assertRaises(f.Stop):b.activate(self.rec)
  x.rollback(self.rec,{});b.check(self.rec,'before')
 def test_later_unrelated_edit_blocks_rollback(self):
  b.activate(self.rec);(Path(self.roots['sources'])/'untouched').write_text('later change')
  with self.assertRaises(f.Stop):x.rollback(self.rec,{})
  self.assertEqual((Path(self.roots['sources'])/x.PARSER).read_text(),'after')

if __name__=='__main__':unittest.main(verbosity=2)
