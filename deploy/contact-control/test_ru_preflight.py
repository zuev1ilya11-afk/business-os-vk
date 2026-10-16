"""Offline checks for production discovery and secret-free read-only diagnostics."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('preflight', HERE / 'ru-preflight.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def container(name, network='production', aliases=None):
    return {'Id': name, 'Name': '/' + name, 'Config': {'Env': []},
            'NetworkSettings': {'Networks': {network: {'Aliases': aliases or [], 'IPAddress': '172.20.0.2'}}}}


class PreflightTests(unittest.TestCase):
    def test_selects_rest_database_not_unrelated_running_database(self):
        rest = container('release-rest')
        rest['Config']['Env'] = ['PGRST_DB_URI=postgres://api:PRIVATE_PASSWORD@local-db/app']
        actual = container('production-db', aliases=['local-db'])
        unrelated = container('other-db', network='another', aliases=['local-db'])
        selected, name = p.find_db(rest, [unrelated, actual])
        self.assertIs(selected, actual)
        self.assertEqual(name, 'app')
        with self.assertRaisesRegex(p.Stop, 'AMBIGUOUS'):
            p.find_db(rest, [actual, container('second-db', aliases=['local-db'])])

    def test_connection_errors_cannot_expose_credentials(self):
        rest = container('rest')
        rest['Config']['Env'] = ['PGRST_DB_URI=postgres://user:PRIVATE_PASSWORD@host/app%27;DROP']
        with self.assertRaises(p.Stop) as error:
            p.find_db(rest, [])
        self.assertNotIn('PRIVATE_PASSWORD', str(error.exception))
        result = subprocess.CompletedProcess([], 2, '', 'PRIVATE_PASSWORD server connection failed')
        with patch.object(p.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(p.Stop, '^COMMAND_FAILED_EXIT_2$'):
                p.run(['docker', 'ps', '-q'])

    def test_psql_uses_explicit_read_only_transaction_and_timeouts(self):
        with patch.object(p, 'run', return_value='{"ok":true}\n') as run:
            self.assertEqual(p.sql({'Id': 'db'}, 'app', "SELECT json_build_object('ok',true)"), {'ok': True})
        args = run.call_args.args[0]
        self.assertEqual(args[:5], ['docker', 'exec', '-u', 'postgres', 'db'])
        self.assertIn('-X', args)
        self.assertIn('ON_ERROR_STOP=1', args)
        self.assertTrue(args[-1].startswith("BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='2s'; SELECT "))
        self.assertTrue(args[-1].endswith('; COMMIT;'))
        with self.assertRaisesRegex(p.Stop, 'SELECT_REQUIRED'):
            p.sql({'Id': 'db'}, 'app', 'UPDATE public.orders SET status=NULL')

    def test_file_discovery_refuses_symlinks_and_parent_traversal(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'good.js').write_bytes(b'fixture')
            (root / 'linked.js').symlink_to(root / 'good.js')
            self.assertEqual(p.read(root, 'good.js'), b'fixture')
            for name in ['linked.js', '../good.js', '/etc/passwd']:
                with self.subTest(name=name), self.assertRaises(p.Stop):
                    p.read(root, name)

    def test_bundle_extraction_matches_pinned_baseline_and_target(self):
        repo = HERE.parent.parent
        for state, revision in [('baseline', p.SOURCE_BASE), ('target', p.SOURCE_TARGET)]:
            def get(name):
                return subprocess.check_output(['git', 'show', revision + ':' + name], cwd=repo)
            manifest = json.loads(get('build-version.js').split(b'self.BOS_BUILD=', 1)[1][:-2])
            for name, expected in p.EXPECTED['modules'].items():
                bundle = manifest.get('assetBundles', {}).get(name)
                data = p.module(get(bundle), name) if bundle else get(name).rstrip()
                data = data.replace(b'https://obsropbslfwtanyspjbi.supabase.co', b'https://139.100.237.167')
                data = data.replace(b'https://business-os-api-gateway.netlify.app', b'https://139.100.237.167')
                self.assertEqual(p.sha(data), expected[state], (state, name))

    def test_file_diagnostics_distinguish_missing_symlink_and_large_bundle(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with self.assertRaisesRegex(p.Stop, '^MISSING_RELEASE_FILE:api.ts$'):
                p.read(root, 'api.ts')
            (root / 'api.eszip').write_bytes(b'fixture-bundle')
            with self.assertRaisesRegex(p.Stop, '^OVERSIZED_RELEASE_FILE:api.eszip$'):
                p.read(root, 'api.eszip', limit=4)
            self.assertEqual(p.read(root, 'api.eszip', limit=32), b'fixture-bundle')
            (root / 'api.ts').symlink_to(root / 'api.eszip')
            self.assertEqual(p.file_metadata(root, 'api.ts'),
                             {'name': 'api.ts', 'canonical': False, 'file': False, 'bytes': None})
            with self.assertRaisesRegex(p.Stop, '^SYMLINKED_RELEASE_FILE:api.ts$'):
                p.read(root, 'api.ts')

    def test_unknown_or_duplicated_module_is_rejected(self):
        marker = b'// Source: x.js\n'
        for bundle in [b'unknown', marker + b'incomplete', marker + marker]:
            with self.assertRaises(p.Stop):
                p.module(bundle, 'x.js')

    def test_backend_accepts_observed_exported_source_layout(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            src=root/'sources'; bundles=root/'bundles'; bundles.mkdir()
            entry=src/'master-workflow-api/supabase/functions/master-workflow-api/index.ts'
            entry.parent.mkdir(parents=True)
            entry.write_bytes(subprocess.check_output(['git','show',p.SOURCE_BASE+':supabase/functions/master-workflow-api/index.ts'],cwd=HERE.parent.parent))
            (bundles/'master-workflow-api.eszip').write_bytes(b'compiled-fixture')
            with patch.object(p,'mount_root',return_value=bundles), patch.object(p,'emit') as emit:
                p.backend({},src)
            api=next(call.args[1] for call in emit.call_args_list if call.args[0]=='API')
            self.assertEqual(api['state'],'baseline')
            self.assertTrue(api['imports_known'])


if __name__ == '__main__':
    unittest.main()
