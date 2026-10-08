import importlib.util
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


if __name__ == '__main__':
    unittest.main()
