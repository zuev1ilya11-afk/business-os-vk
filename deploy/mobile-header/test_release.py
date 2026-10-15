"""Real filesystem/atomic exchange tests; only Docker and HTTPS are simulated."""
import copy
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile

HERE=Path(__file__).resolve().parent
ARCHIVE=HERE/'bosheader.pyz'
with zipfile.ZipFile(ARCHIVE) as archive:
    HELPER=archive.read('frontend.py')
    META=json.loads(archive.read('release.json'))
    FILES={n:archive.read('payload/'+n) for n in META['after']}
    BASELINE={n:archive.read('baseline/'+n) for n in META['after']}

def module():
    result=types.ModuleType('frontend_test')
    result.__file__=str(ARCHIVE)+'/frontend.py'
    exec(compile(HELPER,result.__file__,'exec'),result.__dict__)
    return result

class HeaderRelease(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.parent=Path(self.temp.name)
        self.root=self.parent/'release-current'/'web'
        self.root.mkdir(parents=True)
        self.f=module();self.f.PARENT=self.parent;self.f.STAGE=self.parent/'mobile-header-294'
        self.meta=copy.deepcopy(META)
        for name in self.meta['before']:
            data=BASELINE.get(name,('unchanged fixture '+name).encode())
            (self.root/name).write_bytes(data)
            self.meta['before'][name]=self.f.sha(data)
        (self.root/'runtime-local.txt').write_text('preserve server-specific runtime')
        self.container={'Id':'existing-web','Name':'/existing-caddy','State':{'Running':True},
                        'Config':{'Image':'caddy:2','Env':['LOCAL_SETTING=preserve']},'HostConfig':{},
                        'Mounts':[{'Type':'bind','Source':str(self.root),'Destination':'/srv'}]}
        self.restarts=[];self.fail_http=False;self.fail_restart=False
        self.real_command=self.f.command
        self.patches=[patch.object(self.f,'command',self.command),patch.object(self.f,'http_get',self.http),patch.object(self.f,'emit',lambda _:None)]
        for p in self.patches:p.start()
        self.before=self.f.snapshot(self.root)

    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()

    def command(self,args,timeout=60):
        if args[0]!='docker':return self.real_command(args,timeout)
        if args[1:3]==['ps','-q']:return b'existing-web\n'
        if args[1]=='inspect':
            self.assertEqual(args[2:],['existing-web'])
            return json.dumps([self.container]).encode()
        if args[1]=='exec':
            self.assertEqual(args[2:],['existing-web','cat','/srv/build-version.js'])
            return (self.root/'build-version.js').read_bytes()
        if args[1]=='restart':
            self.assertEqual(args[-1],'existing-web');self.restarts.append(args[-1])
            if self.fail_restart:
                self.fail_restart=False
                raise self.f.Stop('simulated restart failure')
            return b'existing-web'
        raise AssertionError('Unexpected command: '+repr(args))

    def http(self,origin,name):
        self.assertEqual(origin,'https://139.100.237.167')
        if self.fail_http and name=='approved-ui.css':
            self.fail_http=False
            return b'unexpected response'
        return (self.root/name).read_bytes()

    def test_payload_preserves_existing_ru_scripts_routes_and_worker_logic(self):
        meta,files,optional=self.f.package()
        self.assertEqual(optional,{})
        self.assertEqual(set(files),{'approved-ui.css','index.html','sw.js','build-version.js'})
        old=json.loads(BASELINE['build-version.js'].split(b'self.BOS_BUILD=')[1][:-2])
        new=json.loads(files['build-version.js'].split(b'self.BOS_BUILD=')[1][:-2])
        self.assertEqual({n for n in old['assets'] if old['assets'][n]!=new['assets'][n]},{'approved-ui.css'})
        self.assertEqual(set(old['assets']),set(new['assets']))
        self.assertEqual(new['assetBundles'],old['assetBundles'])
        for name in ['index.html','sw.js']:
            self.assertEqual(files[name].replace(meta['after_build'].encode(),meta['before_build'].encode()),BASELINE[name])
        self.assertEqual(new['shell'],self.f.sha(files['index.html']))
        self.assertEqual(new['assets']['approved-ui.css'],self.f.sha(files['approved-ui.css']))
        self.assertEqual(files['approved-ui.css'],(HERE.parent.parent/'approved-ui.css').read_bytes())

    def test_check_is_readonly_and_refuses_a_different_live_stylesheet(self):
        self.f.preflight(self.meta,{})
        self.assertEqual(self.f.snapshot(self.root),self.before)
        self.assertFalse(self.f.STAGE.exists());self.assertEqual(self.restarts,[])
        (self.root/'approved-ui.css').write_text('a later unrelated fix')
        with self.assertRaises(self.f.Stop):self.f.preflight(self.meta,{})
        self.assertFalse(self.f.STAGE.exists());self.assertEqual(self.restarts,[])

    def test_apply_preserves_unrelated_files_and_rollback_restores_exact_tree(self):
        self.f.apply(self.meta,FILES,{})
        for name,data in FILES.items():self.assertEqual((self.root/name).read_bytes(),data)
        current=self.f.snapshot(self.root)
        for name,entry in self.before.items():
            if name not in FILES:self.assertEqual(current[name],entry)
        self.assertEqual(self.restarts,['existing-web'])
        rec=json.loads((self.f.STAGE/'journal.json').read_text())
        self.assertEqual(rec['state'],'active')
        self.f.restore(self.meta,rec)
        self.assertEqual(self.f.snapshot(self.root),self.before)

    def test_http_failure_automatically_restores_previous_tree(self):
        self.fail_http=True
        with self.assertRaisesRegex(self.f.Stop,'rolled back'):self.f.apply(self.meta,FILES,{})
        self.assertEqual(self.f.snapshot(self.root),self.before)

    def test_restart_failure_automatically_restores_previous_tree(self):
        self.fail_restart=True
        with self.assertRaisesRegex(self.f.Stop,'rolled back'):self.f.apply(self.meta,FILES,{})
        self.assertEqual(self.f.snapshot(self.root),self.before)

    def test_later_unrelated_changes_prevent_rollback(self):
        self.f.apply(self.meta,FILES,{})
        (self.root/'runtime-local.txt').write_text('new deployment')
        rec=json.loads((self.f.STAGE/'journal.json').read_text())
        with self.assertRaisesRegex(self.f.Stop,'Unrelated later changes'):self.f.restore(self.meta,rec)
        self.assertEqual((self.root/'runtime-local.txt').read_text(),'new deployment')

if __name__=='__main__':unittest.main()
