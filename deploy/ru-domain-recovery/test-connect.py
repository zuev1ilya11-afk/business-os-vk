import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('connect',Path(__file__).with_name('connect.py'))
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
SOURCE=b'{\n admin 127.0.0.1:12019\n default_sni 139.100.237.167\n}\n'+c.BEFORE+b'\n respond "same application"\n}\n'

class ConnectTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.config=self.root/'Caddyfile';self.config.write_bytes(SOURCE)
        self.stage=self.root/'backup';self.after=c.prepare(SOURCE);self.reloads=[]
    def install(self,verify=lambda:None,validate=lambda _:None):
        return c.install(self.config,self.stage,SOURCE,self.after,verify,self.reloads.append,validate)
    def test_only_adds_domain_preserving_existing_hosts_and_routes(self):
        self.assertEqual(self.after.replace(c.AFTER,c.BEFORE),SOURCE)
        self.assertIn(b'default_sni 139.100.237.167',self.after)
    def test_rejects_unknown_or_already_modified_config(self):
        for data in [SOURCE.replace(b'12019',b'9999'),SOURCE.replace(c.BEFORE,b'other.example {'),self.after]:
            with self.assertRaises(c.Stop):c.prepare(data)
    def test_install_and_explicit_rollback(self):
        record=self.install();self.assertEqual(record['status'],'deployed')
        self.assertEqual(self.config.read_bytes(),self.after)
        self.assertEqual(self.stage.stat().st_mode&0o777,0o700)
        c.rollback(self.config,self.stage,record,self.reloads.append)
        self.assertEqual(self.config.read_bytes(),SOURCE)
        self.assertEqual(self.reloads,['Caddyfile.homemaster.next','Caddyfile'])
    def test_failed_https_verification_restores_original(self):
        def fail():raise c.Stop('simulated TLS failure')
        with self.assertRaisesRegex(c.Stop,'simulated'):self.install(verify=fail)
        self.assertEqual(self.config.read_bytes(),SOURCE)
        self.assertEqual(json.loads((self.stage/'journal.json').read_text())['status'],'rolled_back')
    def test_invalid_candidate_never_reloads_or_changes_active_file(self):
        def fail(_):raise c.Stop('invalid Caddyfile')
        with self.assertRaises(c.Stop):self.install(validate=fail)
        self.assertEqual(self.config.read_bytes(),SOURCE);self.assertEqual(self.reloads,[])
    def test_rollback_refuses_unrelated_changes(self):
        record=self.install();self.config.write_bytes(b'another deployment')
        with self.assertRaises(c.Stop):c.rollback(self.config,self.stage,record,self.reloads.append)
        self.assertEqual(self.config.read_bytes(),b'another deployment')
    def test_concurrent_edit_before_install_is_preserved(self):
        self.config.write_bytes(b'new config')
        with self.assertRaises(c.Stop):self.install()
        self.assertEqual(self.config.read_bytes(),b'new config');self.assertFalse(self.stage.exists())

if __name__=='__main__':unittest.main()
