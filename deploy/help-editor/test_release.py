"""Real file swap/rollback tests; Docker/HTTP/production SQL are explicit fakes."""
import copy
import importlib
import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
PACKAGE=tempfile.TemporaryDirectory(prefix='bos-help-package-test-')
with zipfile.ZipFile(HERE/'bos293.pyz') as z:z.extractall(PACKAGE.name)
sys.path.insert(0,PACKAGE.name)
import frontend as f
import backend as b
import database as db
import release as r
META=json.loads((Path(PACKAGE.name)/'release.json').read_text())
FILES={n:(Path(PACKAGE.name)/'payload'/n).read_bytes() for n in META['after']}
PATCHED=(Path(PACKAGE.name)/'master-memo-api.ts').read_bytes()
COMMAND=f.command
ZIPFILE=zipfile.ZipFile


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.parent=Path(self.temp.name)
        self.root=self.parent/'release-test/web';self.root.mkdir(parents=True)
        self.meta=copy.deepcopy(META)
        for n in self.meta['before']:
            data=('baseline fixture '+n).encode();(self.root/n).write_bytes(data);self.meta['before'][n]=f.sha(data)
        (self.root/'retain.txt').write_text('unrelated working production file')
        self.web=dict(Id='web',Name='/bos-release-test-https',Config={'Image':'caddy:2'},HostConfig={},Mounts=[dict(Type='bind',Source=str(self.root),Destination='/srv')],State={'Running':True})
        self.edge=dict(Id='edge',Name='/bos-release-test-edge',Image='sha256:fixture',Config={'Image':'fixture','Entrypoint':['edge-runtime'],'Cmd':['start','--main-service','/bos-main']},HostConfig={},Mounts=[],State={'Running':True,'Pid':123})
        self.roots={}
        for name,mount in b.MOUNTS.items():
            path=self.root.parent/'edge'/name;path.mkdir(parents=True);self.roots[name]=str(path)
            self.edge['Mounts'].append(dict(Type='bind',Source=str(path),Destination=mount))
        (Path(self.roots['sources'])/'master-memo-api').mkdir()
        (Path(self.roots['sources'])/'master-memo-api/index.ts').write_bytes(b'baseline memo')
        (Path(self.roots['sources'])/'other.ts').write_bytes(b'unchanged handler')
        (Path(self.roots['bundles'])/'master-memo-api.eszip').write_bytes(b'baseline bundle'*20)
        (Path(self.roots['bundles'])/'other.eszip').write_bytes(b'unchanged compiled handler')
        (Path(self.roots['main'])/'index.ts').write_bytes(b'unchanged gateway')
        self.before=f.snapshot(self.root);self.api_before={name:f.snapshot(Path(path)) for name,path in self.roots.items()}
        self.context={'db':'existing-db','name':'working-db','rest':'existing-rest'}
        self.info=dict(container='edge',fingerprint=f.fingerprint(self.edge),image=self.edge['Image'],config=self.edge['Config'],roots=self.roots,before=self.api_before,environment={},database=self.context)
        self.restarts=[];self.sql_writes=[];self.storage_exists=False;self.storage_marker=None;self.fail_restart=None;self.fail_http=False
        self.patches=[patch.object(f,'PARENT',self.parent),patch.object(f,'STAGE',self.parent/'help293-web'),patch.object(b,'STAGE',self.parent/'help293-api'),patch.object(r,'ROOT',self.parent/'help293'),patch.object(f,'command',self.command),patch.object(f,'http_get',self.http),patch.object(f,'emit',lambda x:None),patch.object(b,'compile_candidate',self.compile),patch.object(b,'probe_candidate',lambda rec:None),patch.object(b,'probe_live',lambda *a,**k:None),patch.object(db,'verify',lambda ctx:None),patch.object(db,'metadata',lambda ctx:self.metadata()),patch.object(db,'migrate',self.migrate)]
        for p in self.patches:p.start()

    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()

    def command(self,args,timeout=60):
        if args[0]!='docker':return COMMAND(args,timeout)
        if args[1:3]==['ps','-q']:return b'web edge'
        if args[1:3]==['ps','-aq']:return b''
        if args[1]=='inspect':return json.dumps([{'web':self.web,'edge':self.edge}[i] for i in args[2:]]).encode()
        if args[1]=='restart':
            self.restarts.append(args[-1])
            if self.fail_restart==args[-1]:self.fail_restart=None;raise f.Stop('simulated restart failure')
            return args[-1].encode()
        if args[-2:]==['cat','/srv/build-version.js']:return (self.root/'build-version.js').read_bytes()
        raise AssertionError(args)

    def http(self,origin,name):
        if self.fail_http and name=='master-help-store.js':self.fail_http=False;return b'wrong file'
        return (self.root/name).read_bytes()

    def compile(self,rec,patched):
        (b.STAGE/'sources/master-memo-api/index.ts').write_bytes(patched)
        (b.STAGE/'bundles/master-memo-api.eszip').write_bytes(b'compiled candidate'*20)

    def metadata(self):
        return {'exists':self.storage_exists,'marker':self.storage_marker,'columns':[list(c) for c in db.COLUMNS]}

    def migrate(self,context,marker,schema,seed):
        if self.storage_exists:
            self.assertEqual(self.storage_marker,marker)
            return
        self.sql_writes.append('create help table');self.storage_exists=True;self.storage_marker=marker

    def prepare(self):
        r.ROOT.mkdir();record=dict(main_sha=f.MAIN,state='preparing',marker='bos-help293:'+'a'*32,database=self.context);r.save(record)
        api=b.prepare(self.info,PATCHED);web=f.prepare(self.meta,FILES,{})
        record['state']='prepared';r.save(record)
        return record,api,web

    def test_prepare_copies_real_files_without_activating_or_writing_live_sql(self):
        rec,api,web=self.prepare()
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(v)) for k,v in self.roots.items()},self.api_before)
        self.assertEqual(self.restarts,[]);self.assertEqual(self.sql_writes,[])
        self.assertEqual(api['state'],'prepared');self.assertEqual(web['state'],'prepared')

    def test_apply_and_rollback_preserve_unrelated_files_and_new_help_data(self):
        rec,api,web=self.prepare();r.activate(self.meta,rec,'schema','seed')
        self.assertEqual(rec['state'],'active');self.assertTrue(self.storage_exists)
        self.assertEqual((self.root/'retain.txt').read_text(),'unrelated working production file')
        r.rollback(self.meta,rec)
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(v)) for k,v in self.roots.items()},self.api_before)
        self.assertTrue(self.storage_exists);self.assertEqual(self.sql_writes,['create help table'])
        self.assertEqual(self.restarts,['edge','web','web','edge'])

    def test_api_restart_failure_restores_files_and_retains_table(self):
        rec,_,_=self.prepare();self.fail_restart='edge'
        with self.assertRaisesRegex(f.Stop,'previous web/API restored'):r.activate(self.meta,rec,'schema','seed')
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(v)) for k,v in self.roots.items()},self.api_before)
        self.assertTrue(self.storage_exists)

    def test_http_verification_failure_rolls_back_both_components(self):
        rec,_,_=self.prepare();self.fail_http=True
        with self.assertRaises(f.Stop):r.activate(self.meta,rec,'schema','seed')
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(v)) for k,v in self.roots.items()},self.api_before)
        self.assertTrue(self.storage_exists)

    def test_table_created_by_someone_else_blocks_before_any_activation(self):
        rec,_,_=self.prepare();self.storage_exists=True
        with self.assertRaisesRegex(f.Stop,'Help table appeared'):r.activate(self.meta,rec,'schema','seed')
        self.assertEqual(self.sql_writes,[]);self.assertEqual(self.restarts,[])
        self.assertEqual(f.snapshot(self.root),self.before)

    def test_later_web_changes_block_rollback_before_touching_api(self):
        rec,_,_=self.prepare();r.activate(self.meta,rec,'schema','seed')
        (self.root/'retain.txt').write_text('newer published fix')
        with self.assertRaisesRegex(f.Stop,'Unrelated later changes'):r.rollback(self.meta,rec)
        self.assertEqual((self.root/'retain.txt').read_text(),'newer published fix')
        self.assertEqual(self.restarts,['edge','web'])

    def test_altered_candidate_blocks_database_creation(self):
        rec,_,_=self.prepare();(f.STAGE/'swap/master-help-store.js').write_text('unexpected code')
        with self.assertRaises(f.Stop):r.activate(self.meta,rec,'schema','seed')
        self.assertEqual(self.sql_writes,[]);self.assertEqual(self.restarts,[])

    def test_sql_failure_never_activates_candidate(self):
        rec,_,_=self.prepare()
        with patch.object(db,'migrate',side_effect=f.Stop('SQL failed')):
            with self.assertRaises(f.Stop):r.activate(self.meta,rec,'schema','seed')
        self.assertEqual(self.restarts,[]);self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(v)) for k,v in self.roots.items()},self.api_before)

    def test_reprepare_after_rollback_reuses_marker_and_never_reseeds(self):
        rec,_,_=self.prepare();r.activate(self.meta,rec,'schema','seed');r.rollback(self.meta,rec)
        marker=rec['marker']
        def archive(path,*a,**k):
            return ZIPFILE(HERE/'bos293.pyz' if Path(path)==Path(PACKAGE.name) else path,*a,**k)
        with patch.object(sys,'argv',['bos293.pyz','--prepare']),patch.object(f,'package',return_value=(self.meta,FILES,{})),patch.object(b,'discover',return_value=self.info),patch.object(db,'discover',side_effect=lambda:(self.context,self.metadata())),patch.object(r,'resources',lambda x:None),patch.object(zipfile,'ZipFile',archive):
            r.main()
        fresh=r.load(r.ROOT/'journal.json')
        self.assertEqual(fresh['marker'],marker);self.assertEqual(fresh['state'],'prepared')
        self.assertEqual(self.sql_writes,['create help table'])
        r.activate(self.meta,fresh,'schema','seed')
        self.assertEqual(fresh['state'],'active')
        self.assertEqual(self.sql_writes,['create help table'])

    def test_archive_keeps_marker_at_canonical_path_if_interrupted(self):
        rec,_,_=self.prepare();r.activate(self.meta,rec,'schema','seed');r.rollback(self.meta,rec)
        rename=r.os.rename
        def interrupted(source,dest):
            rename(source,dest)
            raise KeyboardInterrupt()
        with patch.object(b,'discover',return_value=self.info),patch.object(r.os,'rename',interrupted):
            with self.assertRaises(KeyboardInterrupt):r.archive_unactivated(self.meta)
        self.assertEqual(r.load(r.ROOT/'journal.json')['marker'],rec['marker'])
        self.assertTrue(self.storage_exists)

    def test_readonly_auth_probe_does_not_write_logs(self):
        import health
        import subprocess
        with patch.object(b,'private_command',side_effect=AssertionError('must not write logs')),patch.object(health.subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'true',b'')):
            self.assertTrue(health.probe_readonly({},public=True))
        self.assertFalse(b.STAGE.exists())

    def test_prepared_retry_never_reseeds_or_overwrites_content(self):
        rec,_,_=self.prepare();r.prepared_records(rec)
        self.assertEqual(self.sql_writes,[]);self.assertEqual(self.restarts,[])


if __name__=='__main__':unittest.main()
