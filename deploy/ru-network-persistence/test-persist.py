import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('persist',Path(__file__).with_name('persist.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
OLD=b'''network:
  version: 2
  ethernets:
    eth0:
      match:
        macaddress: fa:16:3e:0a:78:f2
      set-name: eth0
      addresses: [139.100.237.167/24]
      routes:
        - to: default
          via: 139.100.237.1
'''
GENERATED='''[Match]
Name=eth1
[Network]
Address=136.234.17.113/24
[Route]
Destination=136.234.17.0/24
Scope=link
Table=42113
[Route]
Destination=0.0.0.0/0
Gateway=136.234.17.1
Table=42113
[RoutingPolicyRule]
From=136.234.17.113/32
Table=42113
Priority=12113
'''
class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)/'root';self.stage=Path(self.tmp.name)/'backup'
        p.write_new(self.root/'etc/netplan/50-cloud-init.yaml',OLD)
        self.snapshot=p.files(self.root)
    def test_save_and_rollback_only_add_or_remove_new_file(self):
        p.save(self.root,self.stage,self.snapshot)
        self.assertEqual((self.root/p.TARGET).read_bytes(),p.CONTENT)
        self.assertEqual((self.root/'etc/netplan/50-cloud-init.yaml').read_bytes(),OLD)
        self.assertEqual((self.stage/'before/etc/netplan/50-cloud-init.yaml').read_bytes(),OLD)
        self.assertEqual(self.stage.stat().st_mode&0o777,0o700)
        p.rollback(self.root,self.stage)
        self.assertEqual(p.files(self.root),self.snapshot)
    def test_failed_verification_removes_new_file(self):
        def fail():raise p.Stop('API unhealthy')
        with self.assertRaisesRegex(p.Stop,'API unhealthy'):p.save(self.root,self.stage,self.snapshot,fail)
        self.assertEqual(p.files(self.root),self.snapshot)
        self.assertEqual(json.loads((self.stage/'journal.json').read_text())['status'],'rolled_back')
    def test_concurrent_existing_file_edit_is_preserved(self):
        (self.root/'etc/netplan/50-cloud-init.yaml').write_bytes(b'new operator change')
        with self.assertRaises(p.Stop):p.save(self.root,self.stage,self.snapshot)
        self.assertEqual((self.root/'etc/netplan/50-cloud-init.yaml').read_bytes(),b'new operator change')
        self.assertFalse((self.root/p.TARGET).exists())
    def test_rollback_refuses_later_changes(self):
        p.save(self.root,self.stage,self.snapshot)
        (self.root/p.TARGET).write_bytes(b'new operator change')
        with self.assertRaises(p.Stop):p.rollback(self.root,self.stage)
        self.assertEqual((self.root/p.TARGET).read_bytes(),b'new operator change')
    def test_refuses_conflicting_interface_or_route_definitions(self):
        p.conflicts(self.snapshot)
        for value in [p.CONTENT,OLD.replace(b'eth0',b'eth1'),b'network: {ethernets: {any: {match: {name: "eth*"}}}}']:
            with self.assertRaises(p.Stop):p.conflicts({'etc/netplan/test.yaml':value})
    def test_generated_main_table_or_wrong_rule_is_rejected(self):
        p.validate_generated(GENERATED)
        for value in [GENERATED.replace('Table=42113','Table=254',1),GENERATED.replace('Priority=12113','Priority=999'),GENERATED.replace('Gateway=136.234.17.1','Gateway=139.100.237.1')]:
            with self.assertRaises(p.Stop):p.validate_generated(value)
    def test_runtime_identity_and_source_policy_must_match(self):
        addresses=[{'address':p.MAC,'mtu':1500,'addr_info':[{'family':'inet','local':p.IP,'prefixlen':24}]}]
        routes=[{'dev':'eth1','gateway':p.GATEWAY,'table':p.TABLE}]
        rules=[{'priority':p.PRIORITY,'src':p.IP,'table':p.TABLE}]
        main=[{'dev':'eth0','gateway':'139.100.237.1'}]
        p.validate_runtime(addresses,routes,rules,main)
        for bad in [[{'dev':'eth0','gateway':'139.100.237.1','table':p.TABLE}],[{'dev':'eth1','gateway':p.GATEWAY,'table':254}]]:
            with self.assertRaises(p.Stop):p.validate_runtime(addresses,bad,rules,main)
    def test_generator_runs_only_under_temporary_roots_and_keeps_old_interface(self):
        calls=[]
        def generate(args):
            calls.append(args)
            self.assertEqual(args[:3],['netplan','generate','--root-dir'])
            root=Path(args[3]);self.assertTrue(str(root).startswith('/tmp/bos-netplan-'))
            directory=root/'run/systemd/network';directory.mkdir(parents=True)
            (directory/'10-netplan-eth0.network').write_text('unchanged old interface')
            if (root/p.TARGET).exists():
                (directory/'10-netplan-bos-public2.network').write_text(GENERATED)
                (directory/'10-netplan-bos-public2.link').write_text('[Match]\nMACAddress='+p.MAC+'\n[Link]\nName=eth1\n')
        with patch.object(p,'run',side_effect=generate):p.generate_safely(self.snapshot)
        self.assertEqual(len(calls),2)
        self.assertEqual(p.files(self.root),self.snapshot)
    def test_atomic_creation_refuses_existing_file(self):
        file=self.root/'existing';file.write_bytes(b'original')
        with self.assertRaises(FileExistsError):p.write_new(file,b'replacement')
        self.assertEqual(file.read_bytes(),b'original')

if __name__=='__main__':unittest.main()
