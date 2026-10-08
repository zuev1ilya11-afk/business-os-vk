import contextlib
import getpass
import http.server
import importlib.util
import io
import json
import pathlib
import tempfile
import subprocess
import threading
import types
import unittest
import warnings
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('rotate', ROOT / 'scripts/ru-hands-token.py')
rotate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rotate)
spec = importlib.util.spec_from_file_location('activate', ROOT / 'scripts/ru-hands-activate.py')
activate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activate)

OLD = 'old-fixture-token-123456789'
NEW = 'new-fixture-token-987654321'


class TokenTests(unittest.TestCase):
    def test_changes_only_the_unique_webhook_literal(self):
        source = ("const WEBHOOK_TOKEN='" + OLD + "';\nconst other='" + OLD + "';\n// preserved sync and auth\n").encode()
        result = rotate.replace_token(source, NEW)
        self.assertEqual(rotate.token_value(result), NEW)
        self.assertEqual(rotate.mask_token(result), rotate.mask_token(source))
        self.assertIn(("const other='" + OLD + "'").encode(), result)

    def test_ambiguous_declaration_and_unreviewed_values_are_rejected(self):
        source = ("const WEBHOOK_TOKEN='" + OLD + "';").encode()
        for value in ('short', 'https://site/?token=value', 'x'*16+'\n', 'x'*16+"'", 'x'*513):
            with self.subTest(value=value[:8]), self.assertRaises(rotate.Stop):
                rotate.replace_token(source, value)
        with self.assertRaises(rotate.Stop):
            rotate.replace_token(source + source, NEW)
        with self.assertRaises(rotate.Stop):
            rotate.replace_token(source, OLD)

    def test_hidden_input_refuses_non_terminal(self):
        with patch.object(rotate.sys.stdin, 'isatty', return_value=False), patch.object(rotate.getpass, 'getpass') as prompt:
            with self.assertRaises(rotate.Stop):
                rotate.read_new_token()
        prompt.assert_not_called()

    def test_hidden_input_never_falls_back_to_echo_or_prints_value(self):
        def fallback(*args, **kwargs):
            warnings.warn('echo unavailable', getpass.GetPassWarning)
            return NEW
        output = io.StringIO()
        with patch.object(rotate.sys.stdin, 'isatty', return_value=True), patch.object(rotate.getpass, 'getpass', side_effect=fallback), contextlib.redirect_stdout(output):
            with self.assertRaises(rotate.Stop):
                rotate.read_new_token()
        self.assertNotIn(NEW, output.getvalue())

    def test_successful_hidden_input_does_not_print_token(self):
        output = io.StringIO()
        with patch.object(rotate.sys.stdin, 'isatty', return_value=True), patch.object(rotate.getpass, 'getpass', return_value=NEW), contextlib.redirect_stdout(output):
            self.assertEqual(rotate.read_new_token(), NEW)
        self.assertNotIn(NEW, output.getvalue())

    def test_rotation_journal_cannot_target_unrelated_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = pathlib.Path(tmp)
            manifest = {'source': '/release/sources/hands-api/index.ts', 'bundle': '/release/bundles/hands-api.eszip',
                        'source_before': 'old-src', 'source_after': 'new-src', 'bundle_before': 'old-bin', 'bundle_after': 'new-bin'}
            items = []
            for target, new, backup, before, after in rotate.expected_items(work, manifest):
                items.append({'target': str(target), 'new': str(new), 'backup': str(backup), 'before': before, 'after': after,
                              'mode': 0o644, 'uid': 0, 'gid': 0})
            rotate.validate_journal(work, manifest, {'items': items})
            items[1]['target'] = '/etc/passwd'
            with self.assertRaises(rotate.Stop):
                rotate.validate_journal(work, manifest, {'items': items})

    def test_rejection_probe_keeps_secret_out_of_process_arguments(self):
        captured = []
        def run(args, stage, label, **kwargs):
            captured.append((args, kwargs))
            return b'true'
        with tempfile.TemporaryDirectory() as tmp:
            helper = types.SimpleNamespace(command=run)
            self.assertTrue(rotate.private_probe(helper, pathlib.Path(tmp), 123, '/hands-api', OLD, 404, 'NOT_FOUND'))
        args, kwargs = captured[0]
        self.assertNotIn(OLD, ' '.join(args))
        payload = json.loads(kwargs['input_data'])
        self.assertEqual(payload['token'], OLD)
        self.assertEqual(payload['status'], 404)
        self.assertNotIn('delivery', payload)

    def test_public_rejection_errors_do_not_expose_old_token(self):
        def failed(*args, **kwargs):
            raise RuntimeError('secret URL ' + OLD)
        with patch.object(rotate.urllib.request, 'build_opener', return_value=types.SimpleNamespace(open=failed)):
            with self.assertRaises(rotate.Stop) as caught:
                rotate.reject_old(activate, OLD)
        self.assertNotIn(OLD, str(caught.exception))

    def test_baseline_build_preserves_existing_sync_helper_then_builds_offline(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = pathlib.Path(tmp)
            (work / 'sources/hands-api').mkdir(parents=True)
            (work / 'backup').mkdir()
            (work / 'bundles').mkdir()
            before = ("const WEBHOOK_TOKEN='" + OLD + "';\n").encode()
            after = rotate.replace_token(before, NEW)
            (work / 'backup/index.ts').write_bytes(before)
            (work / 'sources/hands-api/index.ts').write_bytes(before)
            (work / 'sources/hands-api/hands-sync.ts').write_bytes(b'unchanged helper')
            manifest = {'image': 'sha256:local', 'bundle_before': activate.sha(b'old bundle')}
            helper = types.SimpleNamespace(RESOURCE_LIMITS=['--memory', '512m'])
            calls = []
            def run(args, stage, label, **kwargs):
                calls.append(label)
                if label == 'token-build-start': return b'compiler'
                if label == 'token-baseline-build':
                    self.assertEqual((work / 'sources/hands-api/hands-sync.ts').read_bytes(), b'unchanged helper')
                    self.assertEqual((work / 'sources/hands-api/index.ts').read_bytes(), before)
                    (work / 'output/hands-api.eszip').write_bytes(b'old bundle')
                if label == 'token-offline-interfaces': return b'["lo"]'
                if label == 'token-patched-build':
                    self.assertIn('token-build-disconnect', calls)
                    self.assertEqual((work / 'sources/hands-api/index.ts').read_bytes(), after)
                    (work / 'output/hands-api.eszip').write_bytes(b'new bundle' * 10)
                return b''
            info = {'NetworkSettings': {'Networks': {}}, 'State': {'Running': True, 'Pid': 123}}
            with patch.object(activate, 'command', side_effect=run), patch.object(activate, 'inspect', return_value=info):
                rotate.build_bundle(activate, helper, work, manifest, after, 'nonce')
            self.assertEqual((work / 'bundles/hands-api.eszip').read_bytes(), b'new bundle' * 10)
            self.assertEqual(calls[-1], 'token-build-cleanup')

    def test_probe_requires_auth_error_body_and_encodes_token_without_delivery(self):
        observed = []
        token = 'fixture+secret/token=123456789'
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                parsed = rotate.urllib.parse.urlsplit(self.path)
                value = rotate.urllib.parse.parse_qs(parsed.query)['token'][0]
                observed.append((value, self.rfile.read(int(self.headers['Content-Length'])), self.headers.get('x-hands-delivery')))
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b'{"error":"NOT_FOUND"}' if value == token else b'{"error":"WRONG_ROUTE"}')
        server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            code = rotate.PROBE.replace('http://127.0.0.1:9000', 'http://127.0.0.1:' + str(server.server_port))
            for value, expected in ((token, True), ('unrecognized-fixture', False)):
                result = subprocess.run([rotate.sys.executable, '-c', code], input=json.dumps({
                    'path': '/hands-api', 'token': value, 'status': 404, 'error': 'NOT_FOUND'}),
                    text=True, capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 0)
                self.assertEqual(json.loads(result.stdout), expected)
                self.assertNotIn(value, result.stdout + result.stderr)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        self.assertEqual(observed[0], (token, b'{}', None))

    def test_tested_artifacts_cannot_change_before_install(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = pathlib.Path(tmp)
            contents = {'sources/hands-api/index.ts': b'new source', 'bundles/hands-api.eszip': b'new bundle',
                        'backup/index.ts': b'old source', 'backup/hands-api.eszip': b'old bundle',
                        'output/hands-api.eszip': b'new bundle'}
            for name, data in contents.items():
                path = work / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            manifest = {'source': '/release/index.ts', 'bundle': '/release/hands-api.eszip',
                        'source_before': activate.sha(b'old source'), 'source_after': activate.sha(b'new source'),
                        'bundle_before': activate.sha(b'old bundle'), 'bundle_after': activate.sha(b'new bundle')}
            rotate.verify_payload(activate, work, manifest)
            for name in ('sources/hands-api/index.ts', 'bundles/hands-api.eszip', 'output/hands-api.eszip'):
                with self.subTest(name=name):
                    path = work / name
                    path.write_bytes(b'changed after test')
                    with self.assertRaises(rotate.Stop):
                        rotate.verify_payload(activate, work, manifest)
                    path.write_bytes(contents[name])
            (work / 'output/hands-api.eszip').unlink()
            # Durable staged files/backups suffice to recover; compiler output is temporary.
            rotate.verify_payload(activate, work, manifest, compiler_output=False)


if __name__ == '__main__':
    unittest.main()
