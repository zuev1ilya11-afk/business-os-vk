import importlib.util
import json
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('diagnose',Path(__file__).with_name('diagnose.py'))
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)

class DiagnosticTests(unittest.TestCase):
    def test_relevant_failure_survives_noise_and_cancellation(self):
        events=[{'ts':1,'logger':'tls.obtain','identifier':d.DOMAIN,'msg':'obtaining certificate'},
                {'ts':2,'logger':'http.log.access','request':{'host':d.DOMAIN,'uri':'/?token=PRIVATE'},'msg':'PRIVATE'},
                {'ts':3,'logger':'tls.obtain','identifier':d.DOMAIN,'level':'error','msg':'could not get certificate','error':'CAA lookup failed'},
                {'ts':4,'logger':'tls.obtain','identifier':d.DOMAIN,'level':'error','msg':'job failed','error':'context canceled'}]
        count,lines=d.certificate_events('\n'.join(map(json.dumps,events)))
        self.assertEqual(count,3)
        self.assertIn('CAA lookup failed','\n'.join(lines))
        self.assertNotIn('PRIVATE','\n'.join(lines))
        self.assertNotIn('context canceled','\n'.join(lines))
    def test_query_secrets_are_not_printed(self):
        text=d.safe('failed https://example.com/path?token=PRIVATE token=SECRET password=PASSWORD')
        for secret in ('PRIVATE','SECRET','PASSWORD'): self.assertNotIn(secret,text)
    def test_malformed_lines_are_ignored(self):
        self.assertEqual(d.certificate_events('not json\n[]\nnull'),(0,[]))

if __name__=='__main__':unittest.main()
