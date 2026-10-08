import importlib.util
import contextlib
import io
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('stage', ROOT / 'scripts/ru-hands-stage.py')
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)


class StageTests(unittest.TestCase):
    def setUp(self):
        self.fixture = (ROOT / 'tests/fixtures/hands-v11-sync.ts').read_bytes().rstrip(b'\n')

    def test_private_bytes_preserved(self):
        before = b"const WEBHOOK_TOKEN='private-do-not-log';\n"
        after = b'\n// private webhook and authorization code\n'
        patched = stage.patch_source(before + self.fixture + after, self.fixture)
        self.assertEqual(patched, stage.IMPORT + before + stage.REPLACEMENT + after)

    def test_unknown_duplicate_and_already_patched_refused(self):
        for source in (self.fixture.replace(b"'ACTIVE'", b"'ALL'"),
                       self.fixture + b'\n' + self.fixture,
                       stage.IMPORT + self.fixture, self.fixture + b';extra'):
            with self.subTest(source=source[:10]), self.assertRaises(stage.Stop):
                stage.patch_source(source, self.fixture)

    def test_symlink_copy_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / 'secret').symlink_to('/etc/passwd')
            with self.assertRaises(stage.Stop):
                stage.tree_size(root)

    def test_gateway_guard_requires_bundle_routing_and_no_background_calls(self):
        stage.check_gateway('Deno.serve(req => EdgeRuntime.userWorkers.create({eszip:"/bos-bundles/"+slug+".eszip"}))')
        for code in ('Deno.serve(handler)', 'setInterval(job, 1); /bos-bundles/ .eszip'):
            with self.assertRaises(stage.Stop):
                stage.check_gateway(code)

    def test_memory_preflight_retains_headroom_for_production(self):
        stage.require_memory('MemTotal: 2097152 kB\nMemAvailable: 1048576 kB\n')
        for text in ('MemAvailable: 1048575 kB\n', 'MemFree: 2097152 kB\n'):
            with self.subTest(text=text), self.assertRaises(stage.Stop):
                stage.require_memory(text)

    def test_probe_requires_container_namespace_and_keeps_token_out_of_arguments(self):
        token = 'private-token-only-in-stdin'
        with patch.object(stage, 'command', return_value=b'[]') as run:
            stage.probe(['/hands-api'], token, pathlib.Path('/private'), 'probe', pid=4321)
        args = run.call_args.args[0]
        self.assertEqual(args[:5], ['nsenter', '-t', '4321', '-n', stage.sys.executable])
        self.assertNotIn(token, ' '.join(args))
        data = json.loads(run.call_args.kwargs['input_data'])
        self.assertEqual(data['origin'], 'http://127.0.0.1:9000')
        self.assertEqual(data['token'], token)
        for pid in (None, 0, -1):
            with self.subTest(pid=pid), self.assertRaises(stage.Stop):
                stage.probe(['/hands-api'], token, pathlib.Path('/private'), 'probe', pid=pid)

    def test_failed_container_diagnostic_preserves_private_log_without_printing_it(self):
        secret = 'private-webhook-token-DO-NOT-PRINT'
        metadata = [{'State': {'Running': False, 'ExitCode': 1, 'OOMKilled': False,
                                'Error': secret},
                     'Config': {'Env': ['SUPABASE_URL=http://127.0.0.1:1', 'PRIVATE=' + secret]}}]
        log = ('error: Import failed; Network is unreachable\nconst WEBHOOK_TOKEN="' + secret + '";').encode()
        gateway = 'const jwt=Deno.env.get("JWT_SECRET"); Deno.env.get("SUPABASE_URL");'
        with tempfile.TemporaryDirectory() as tmp:
            folder = pathlib.Path(tmp)
            def run(args, target, label, **kwargs):
                content = json.dumps(metadata).encode() if args[1] == 'inspect' else log
                (target / (label + '.log')).write_bytes(content)
                return content
            captured = io.StringIO()
            with patch.object(stage, 'command', side_effect=run), contextlib.redirect_stdout(captured):
                stage.report_candidate_failure('candidate', folder, gateway)
            report = captured.getvalue()
            self.assertNotIn(secret, report)
            self.assertIn('dependency_network', report)
            self.assertIn('JWT_SECRET', report)
            self.assertIn('"exit_code": 1', report)
            self.assertEqual((folder / 'candidate-runtime.log').read_bytes(), log)

    def test_diagnostic_failure_does_not_mask_original_error_or_print_details(self):
        captured = io.StringIO()
        with patch.object(stage, 'command', side_effect=stage.Stop('private-detail')), contextlib.redirect_stdout(captured):
            stage.report_candidate_failure('candidate', pathlib.Path('/private'), '')
        self.assertEqual(captured.getvalue(), 'CANDIDATE_DIAGNOSTIC_UNAVAILABLE\n')

    def test_candidate_receives_all_gateway_settings_with_isolated_dummy_values(self):
        names = ['BOS_AUTH_ORIGIN', 'BOS_REST_ORIGIN', 'BOS_STORAGE_ORIGIN',
                 'JWT_SECRET', 'VK_APP_SECRET']
        gateway = '\n'.join('Deno.env.get("' + name + '")' for name in names)
        values = stage.candidate_environment(gateway)
        self.assertTrue(set(names).issubset(values))
        for name in names[:3]:
            self.assertEqual(values[name], 'http://127.0.0.1:1')
        self.assertGreaterEqual(len(values['JWT_SECRET']), 32)
        with self.assertRaises(stage.Stop):
            stage.candidate_environment('Deno.env.get("UNREVIEWED_NEW_SETTING")')

    def test_route_match_requires_shared_network_not_just_alias(self):
        edge = {'NetworkSettings': {'Networks': {'release-net': {}}}}
        rest = {'Name': '/release-rest', 'NetworkSettings': {'Networks': {
            'release-net': {'Aliases': ['rest'], 'IPAddress': '172.30.0.3'}}}}
        self.assertTrue(stage.route_matches(edge, rest, 'http://rest:3000'))
        self.assertFalse(stage.route_matches(edge, rest, 'https://old-source.example'))
        rest['NetworkSettings']['Networks'] = {'legacy-net': {'Aliases': ['rest']}}
        self.assertFalse(stage.route_matches(edge, rest, 'http://rest:3000'))

    def test_runtime_log_redaction_preserves_error_but_removes_credentials(self):
        secret = 'private-webhook-credential-123'
        password = 'private password with spaces'
        source = 'const WEBHOOK_TOKEN="' + secret + '"; const API_KEY="' + password + '";'
        metadata = [{'Config': {'Env': ['PRIVATE_KEY=private-env-credential-456']}}]
        log = ('worker startup error: invalid startup setting\n' + secret + '\n' + password +
               '\nprivate-env-credential-456\nhttps://example.invalid/?token=' + secret)
        result = stage.redact_runtime_log(log, source, metadata)
        self.assertIn('worker startup error: invalid startup setting', result)
        for value in (secret, password, 'private-env-credential-456'):
            self.assertNotIn(value, result)

    def test_runtime_log_redaction_removes_opaque_tokens_and_terminal_controls(self):
        opaque = 'a' * 44
        result = stage.redact_runtime_log('\x1b[31mError: ' + opaque + '\x1b[0m\n', '', [])
        self.assertNotIn(opaque, result)
        self.assertNotIn('\x1b', result)
        self.assertIn('Error:', result)

    def test_runtime_log_redacts_short_environment_password(self):
        result = stage.redact_runtime_log('password=p4sswd', '', [{'Config': {'Env': ['PASSWORD=p4sswd']}}])
        self.assertNotIn('p4sswd', result)

    def test_runtime_log_redacts_json_escaped_password(self):
        secret = 'pass"word\\private'
        log = json.dumps({'password': secret})
        result = stage.redact_runtime_log(log, '', [{'Config': {'Env': ['PASSWORD=' + secret]}}])
        self.assertNotIn(json.dumps(secret)[1:-1], result)
        self.assertNotIn(secret, result)

    def test_runtime_log_normalizes_ansi_before_hiding_secret(self):
        secret = 'shortSecret123'
        log = 'short\x1b[31mSecret123\x1b[0m'
        result = stage.redact_runtime_log(log, '', [{'Config': {'Env': ['TOKEN=' + secret]}}])
        self.assertNotIn(secret, result)


if __name__ == '__main__':
    unittest.main()
