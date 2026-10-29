import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from contextlib import redirect_stdout

spec = importlib.util.spec_from_file_location('check', Path(__file__).with_name('check.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class DiagnosticTests(unittest.TestCase):
    def test_origins_never_echo_credentials_query_or_invalid_input(self):
        for value in ('https://user:secret@example.com', 'https://example.com/?token=secret', 'https://example.com/#secret', 'not a url', 'https://example.com:bad'):
            self.assertNotIn('secret', c.origin(value))
        self.assertEqual(c.origin('https://139.100.237.167'), 'https://139.100.237.167')
        self.assertEqual(c.origin('http://edge-storage:5000'), 'http://edge-storage:5000')

    def test_disallowed_targets_and_business_actions_never_make_requests(self):
        with patch.object(c, 'build_opener') as opener:
            for address, action in (('https://example.com', 'archive'), (c.ORIGINS[0], 'reviewReport'), (c.ORIGINS[0], 'finalizeMasterReport')):
                with self.assertRaises(c.Stop):
                    c.probe(('test', address, action))
            opener.assert_not_called()

    def test_empty_archive_probe_exits_at_required_id_guard(self):
        def respond(req, timeout):
            self.assertEqual(req.data, b'{}')
            self.assertEqual(req.header_items(), [('Content-type', 'application/json')])
            self.assertTrue(req.full_url.endswith('/functions/v1/drive-archive-api'))
            raise HTTPError(req.full_url, 400, 'Bad request', {}, io.BytesIO(b'{"error":"ORDER_ID_REQUIRED"}'))
        with patch.object(c, 'build_opener') as opener:
            opener.return_value.open.side_effect = respond
            label, result = c.probe(('TEST', c.ORIGINS[0], 'archive'))
        self.assertTrue(result['expected_response'])
        self.assertEqual(result['http'], 400)

    def test_failures_never_print_url_or_exception_details(self):
        with patch.object(c, 'build_opener') as opener:
            opener.return_value.open.side_effect = ValueError('secret request token')
            result = c.probe(('TEST', c.ORIGINS[0], 'lifecycle'))
        self.assertNotIn('secret', json.dumps(result))
        self.assertEqual(result[1]['error_type'], 'ValueError')

    def test_full_diagnostic_does_not_execute_or_print_server_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / 'edge/sources'
            for name in ('order-lifecycle-api', 'drive-archive-api'):
                path = root / name / 'index.ts'
                path.parent.mkdir(parents=True)
                path.write_text("const base=Deno.env.get('SUPABASE_URL'); const secret='private-value';")
            container = {'Name':'/bos-release-test-edge', 'Config':{'Env':['SUPABASE_URL=https://139.100.237.167','VK_APP_SECRET=private-value']}, 'Mounts':[{'Type':'bind','Destination':'/bos-src','Source':str(root)}]}
            calls = []
            def docker(args):
                calls.append(args)
                if args == ['docker', 'ps', '-q']: return 'fixture-id'
                if args == ['docker', 'inspect', 'fixture-id']: return json.dumps([container])
                self.fail('Unexpected process: ' + repr(args))
            output = io.StringIO()
            with patch.object(c, 'BASE', base), patch.object(c, 'run', side_effect=docker), patch.object(c, 'probe', side_effect=lambda x:(x[0]+'_'+x[2], {'http':400})), redirect_stdout(output):
                c.main()
            self.assertEqual(len(calls), 2)
            self.assertNotIn('private-value', output.getvalue())
            self.assertIn('NO_JOURNAL', output.getvalue())

if __name__ == '__main__':
    unittest.main()
