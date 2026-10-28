import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from urllib.error import URLError

spec=importlib.util.spec_from_file_location('zero',Path(__file__).with_name('connect-zerossl.py'))
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
EMAIL='operator@example.com'
SOURCE=b'''{
 admin 127.0.0.1:12019
 default_sni 139.100.237.167
}
https://139.100.237.167, https://136.234.17.113 {
 tls {
  issuer acme https://acme-v02.api.letsencrypt.org/directory {
   profile shortlived
  }
 }
 @api path /functions/v1/* /auth/v1/* /storage/v1/*
 handle @api {
  reverse_proxy 127.0.0.1:19000
 }
 handle {
  root * /srv
  try_files {path} /index.html
  file_server
 }
}
'''

class ZeroTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.config=self.root/'Caddyfile';self.config.write_bytes(SOURCE)
        self.stage=self.root/'backup';self.after=c.prepare(SOURCE,EMAIL);self.reloads=[]
    def install(self,verify=lambda:None,validate=lambda _:None):
        return c.install(self.config,self.stage,SOURCE,self.after,verify,self.reloads.append,validate)
    def test_existing_ip_configuration_is_byte_identical(self):
        self.assertTrue(self.after.startswith(SOURCE))
        new=self.after[len(SOURCE):]
        self.assertIn(c.ZERO_CA.encode(),new)
        self.assertNotIn(b'profile shortlived',new)
        self.assertIn(b'reverse_proxy 127.0.0.1:19000',new)
    def test_rejects_email_config_injection_or_unknown_tls(self):
        for email in ['', 'a@example.com\n}', 'a@example.com {']:
            with self.assertRaises(c.Stop):c.prepare(SOURCE,email)
        with self.assertRaises(c.Stop):c.prepare(SOURCE.replace(b'shortlived',b'other'),EMAIL)
    def test_success_and_rollback_preserve_original_bytes(self):
        record=self.install();self.assertEqual(record['status'],'deployed')
        c.rollback(self.config,self.stage,record,self.reloads.append)
        self.assertEqual(self.config.read_bytes(),SOURCE)
        self.assertEqual(self.reloads,['Caddyfile.homemaster.zerossl.next','Caddyfile'])
    def test_failed_tls_verification_rolls_back(self):
        def fail():raise c.Stop('TLS failed')
        with self.assertRaises(c.Stop):self.install(verify=fail)
        self.assertEqual(self.config.read_bytes(),SOURCE)
        self.assertEqual(json.loads((self.stage/'journal.json').read_text())['status'],'rolled_back')
    def test_invalid_candidate_does_not_reload(self):
        def fail(_):raise c.Stop('unexpected route')
        with self.assertRaises(c.Stop):self.install(validate=fail)
        self.assertEqual(self.reloads,[]);self.assertEqual(self.config.read_bytes(),SOURCE)
    def test_unrelated_changes_block_rollback(self):
        record=self.install();self.config.write_bytes(b'other deployment')
        with self.assertRaises(c.Stop):c.rollback(self.config,self.stage,record,self.reloads.append)
        self.assertEqual(self.config.read_bytes(),b'other deployment')
    def test_waits_full_window_and_keeps_underlying_error(self):
        elapsed=[0.0]
        def sleep(n):elapsed[0]+=n
        with patch.object(c,'health',side_effect=URLError('TLS not ready')),redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(c.Stop,'TLS not ready'):
                c.verify_domain(window=30,clock=lambda:elapsed[0],sleep=sleep)
        self.assertEqual(elapsed[0],30)
    def test_transient_tls_failure_then_three_successful_api_checks(self):
        elapsed=[0.0]
        def sleep(n):elapsed[0]+=n
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,_):return b'self.BOS_BUILD={}'
        with patch.object(c,'health',side_effect=[URLError('pending'),None]) as health,patch.object(c,'get_json',return_value={'ok':True}) as get,patch.object(c,'urlopen',return_value=Response()),redirect_stdout(io.StringIO()):
            c.verify_domain(window=30,clock=lambda:elapsed[0],sleep=sleep)
        self.assertEqual(health.call_count,2);self.assertEqual(get.call_count,2)
    @unittest.skipUnless(os.environ.get('BOS_TEST_CADDY'),'Set BOS_TEST_CADDY to exact Caddy binary')
    def test_actual_caddy_adaptation_and_detection_of_unrelated_changes(self):
        def adapt(data,name):
            path=self.root/name;path.write_bytes(data)
            result=subprocess.run([os.environ['BOS_TEST_CADDY'],'adapt','--adapter','caddyfile','--config',str(path)],capture_output=True,text=True,check=True)
            return json.loads(result.stdout)
        before=adapt(SOURCE,'before');after=adapt(self.after,'after')
        c.verify_adaptation(before,after,EMAIL,str(self.root/'before'),str(self.root/'after'))
        for mode in ('route','issuer','admin'):
            bad=copy.deepcopy(after)
            if mode=='admin':bad['admin']['listen']=':9999'
            elif mode=='issuer':
                for policy in bad['apps']['tls']['automation']['policies']:
                    if policy.get('subjects')==[c.DOMAIN]:policy['issuers'][0]['ca']='https://invalid.example/'
            else:
                bad['apps']['http']['servers']['srv0']['routes'][0]['handle']=[]
            with self.assertRaises(c.Stop):c.verify_adaptation(before,bad,EMAIL,str(self.root/'before'),str(self.root/'after'))

if __name__=='__main__':unittest.main()
