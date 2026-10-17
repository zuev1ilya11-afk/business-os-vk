"""Exercise activation on temporary files; never contact Docker or production."""
import importlib.util
import io
import json
import pathlib
import types
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('activate', ROOT / 'scripts/ru-hands-activate.py')
activate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activate)


class ActivationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.stage = self.root / 'hands-stage-test'
        self.stage.mkdir(mode=0o700)
        self.live = self.root / 'release-test'
        self.live.mkdir()
        self.old = self.stage / 'old'
        self.old.write_bytes(b'original')
        self.new = self.stage / 'new'
        self.new.write_bytes(b'patched')
        self.target = self.live / 'index.ts'
        self.target.write_bytes(b'original')
        self.target.chmod(0o640)
        self.item = activate.file_item(self.target, self.new, self.old)

    def test_success_is_durable_preserves_mode_and_checks_installed_bytes(self):
        def check():
            self.assertEqual(self.target.read_bytes(), b'patched')
        activate.install(self.stage, [self.item], check, lambda: None)
        receipt = json.loads((self.stage / 'activation.json').read_text())
        self.assertEqual(receipt['state'], 'activated')
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o640)

    def test_failed_health_check_restores_original_and_verifies_rollback(self):
        observed = []
        def failed():
            raise activate.Stop('probe failed')
        def restored():
            observed.append(self.target.read_bytes())
        with self.assertRaises(activate.Stop):
            activate.install(self.stage, [self.item], failed, restored)
        self.assertEqual(observed, [b'original'])
        self.assertEqual(self.target.read_bytes(), b'original')
        self.assertEqual(json.loads((self.stage / 'activation.json').read_text())['state'], 'rolled_back')

    def test_failed_rollback_retains_recovery_journal_and_backup(self):
        def failed():
            raise activate.Stop('unhealthy')
        with self.assertRaisesRegex(activate.Stop, 'ROLLBACK_REQUIRES_ATTENTION'):
            activate.install(self.stage, [self.item], failed, failed)
        self.assertEqual(self.old.read_bytes(), b'original')
        self.assertEqual(json.loads((self.stage / 'activation.json').read_text())['state'], 'rollback_failed')

    def test_stale_target_is_rejected_without_overwriting_new_work(self):
        self.target.write_bytes(b'other deployment')
        with self.assertRaises(activate.Stop):
            activate.install(self.stage, [self.item], lambda: None, lambda: None)
        self.assertEqual(self.target.read_bytes(), b'other deployment')
        self.assertFalse((self.stage / 'activation.json').exists())

    def test_helper_created_by_failed_attempt_is_removed_on_rollback(self):
        helper = self.live / 'helper.ts'
        item = activate.file_item(helper, self.new, None, reference=self.target)
        def failed():
            self.assertEqual(helper.read_bytes(), b'patched')
            raise activate.Stop('failed')
        with self.assertRaises(activate.Stop):
            activate.install(self.stage, [self.item, item], failed, lambda: None)
        self.assertFalse(helper.exists())
        self.assertEqual(self.target.read_bytes(), b'original')

    def test_partial_swap_failure_restores_already_replaced_files(self):
        helper = self.live / 'helper.ts'
        item = activate.file_item(helper, self.new, None, reference=self.target)
        original = activate.atomic_replace
        def fail_second(path, data, metadata):
            if path == helper and data == b'patched':
                raise OSError('disk failure')
            return original(path, data, metadata)
        with patch.object(activate, 'atomic_replace', side_effect=fail_second):
            with self.assertRaises(activate.Stop):
                activate.install(self.stage, [self.item, item], lambda: None, lambda: None)
        self.assertEqual(self.target.read_bytes(), b'original')
        self.assertFalse(helper.exists())

    def test_interrupted_swap_can_be_rolled_back_from_saved_journal(self):
        activate.write_json(self.stage / 'activation.json', {'state': 'installing', 'items': [self.item]})
        self.target.write_bytes(b'patched')
        activate.recover(self.stage, lambda: None)
        self.assertEqual(self.target.read_bytes(), b'original')

    def test_rollback_refuses_to_overwrite_unrelated_deployment(self):
        activate.write_json(self.stage / 'activation.json', {'state': 'installing', 'items': [self.item]})
        self.target.write_bytes(b'another deployment')
        with self.assertRaises(activate.Stop):
            activate.recover(self.stage, lambda: None)
        self.assertEqual(self.target.read_bytes(), b'another deployment')

    def test_symlink_target_or_parent_is_refused(self):
        self.target.unlink()
        self.target.symlink_to(self.old)
        with self.assertRaises(activate.Stop):
            activate.file_item(self.target, self.new, self.old)
        link = self.root / 'linked'
        link.symlink_to(self.live, target_is_directory=True)
        with self.assertRaises(activate.Stop):
            activate.safe_path(link / 'whatever')

    def test_docker_identity_ignores_runtime_pid_but_rejects_config_changes(self):
        before = {'Id': 'a', 'Image': 'sha256:one', 'Config': {'Env': ['A=secret']},
                  'HostConfig': {'NetworkMode': 'release'}, 'Mounts': [], 'State': {'Pid': 1}}
        after = json.loads(json.dumps(before))
        after['State']['Pid'] = 2
        self.assertEqual(activate.identity(before), activate.identity(after))
        after['Config']['Env'] = ['A=other']
        self.assertNotEqual(activate.identity(before), activate.identity(after))

    def test_stage_selection_rejects_ambiguity(self):
        (self.stage / 'manifest.json').write_text('{"prepared":true,"activated":false}')
        self.assertEqual(activate.choose_stage(self.root), self.stage)
        other = self.root / 'hands-stage-other'
        other.mkdir()
        (other / 'manifest.json').write_text('{"prepared":true,"activated":false}')
        with self.assertRaises(activate.Stop):
            activate.choose_stage(self.root)

    def test_recovery_journal_must_use_exact_manifest_paths_and_hashes(self):
        manifest = {'source': str(self.target), 'bundle': str(self.live / 'hands.eszip'),
                    'source_before': 'a', 'source_after': 'b', 'bundle_before': 'c',
                    'bundle_after': 'd', 'helper_after': 'e'}
        items = [
            {'target': str(self.target.with_name('hands-sync.ts')), 'new': str(self.stage / 'sources/hands-api/hands-sync.ts'),
             'backup': None, 'before': None, 'after': 'e'},
            {'target': str(self.target), 'new': str(self.stage / 'sources/hands-api/index.ts'),
             'backup': str(self.stage / 'backup/index.ts'), 'before': 'a', 'after': 'b'},
            {'target': str(self.live / 'hands.eszip'), 'new': str(self.stage / 'bundles/hands-api.eszip'),
             'backup': str(self.stage / 'backup/hands-api.eszip'), 'before': 'c', 'after': 'd'},
        ]
        for item in items:
            item.update(uid=0, gid=0, mode=0o644)
        activate.validate_journal(self.stage, manifest, {'items': items})
        items[1]['target'] = '/etc/passwd'
        with self.assertRaises(activate.Stop):
            activate.validate_journal(self.stage, manifest, {'items': items})

    def dependency_setup(self):
        (self.stage / 'sources/hands-api').mkdir(parents=True)
        (self.stage / 'sources/hands-api/index.ts').write_bytes(b'patched source')
        (self.stage / 'sources/hands-api/hands-sync.ts').write_bytes(b'helper')
        (self.stage / 'backup').mkdir()
        (self.stage / 'backup/index.ts').write_bytes(b'original source')
        helper = types.SimpleNamespace(require_memory=lambda _: None, RESOURCE_LIMITS=['--memory', '512m'])
        manifest = {'image': 'sha256:local-image', 'bundle_before': activate.sha(b'old bundle'),
                    'bundle_after': activate.sha(b'new bundle')}
        calls = []
        def run(args, stage, label, **kwargs):
            calls.append(label)
            proof = next(stage.glob('dependency-proof-*'))
            output = proof / 'output/hands-api.eszip'
            if label == 'dependency-container':
                self.assertEqual(args[args.index('--pull=never')], '--pull=never')
                return b'test-container'
            if label == 'dependency-baseline-build':
                self.assertEqual((proof / 'sources/hands-api/index.ts').read_bytes(), b'original source')
                output.write_bytes(b'old bundle')
            if label == 'dependency-patched-build':
                self.assertIn('dependency-disconnect', calls)
                self.assertIn('dependency-interfaces', calls)
                self.assertEqual((proof / 'sources/hands-api/index.ts').read_bytes(), b'patched source')
                output.write_bytes(b'new bundle')
            if label == 'activation-inspect':
                return json.dumps([{'NetworkSettings': {'Networks': {}}, 'State': {'Running': True, 'Pid': 123}}]).encode()
            if label == 'dependency-interfaces':
                return b'["lo"]'
            return b''
        return helper, manifest, calls, run

    def test_dependency_gate_compares_original_then_builds_patch_offline(self):
        helper, manifest, calls, run = self.dependency_setup()
        with patch.object(activate, 'command', side_effect=run):
            activate.dependency_proof(self.stage, manifest, helper)
        self.assertLess(calls.index('dependency-baseline-build'), calls.index('dependency-disconnect'))
        self.assertLess(calls.index('dependency-interfaces'), calls.index('dependency-patched-build'))
        self.assertEqual(calls[-1], 'dependency-cleanup')

    def test_dependency_mismatch_stops_before_patch_build_and_cleans_container(self):
        helper, manifest, calls, run = self.dependency_setup()
        manifest['bundle_before'] = 'non-reproducible'
        with patch.object(activate, 'command', side_effect=run):
            with self.assertRaisesRegex(activate.Stop, 'DEPENDENCY_PROOF_UNKNOWN'):
                activate.dependency_proof(self.stage, manifest, helper)
        self.assertNotIn('dependency-patched-build', calls)
        self.assertEqual(calls[-1], 'dependency-cleanup')
        self.assertEqual(self.target.read_bytes(), b'original')

    def test_external_network_interface_blocks_offline_proof(self):
        helper, manifest, calls, run = self.dependency_setup()
        def attached(args, stage, label, **kwargs):
            return b'["lo","eth0"]' if label == 'dependency-interfaces' else run(args, stage, label, **kwargs)
        with patch.object(activate, 'command', side_effect=attached):
            with self.assertRaises(activate.Stop):
                activate.dependency_proof(self.stage, manifest, helper)
        self.assertNotIn('dependency-patched-build', calls)
        self.assertEqual(calls[-1], 'dependency-cleanup')

    def test_rollback_rechecks_each_target_after_restoring_another_file(self):
        second = self.live / 'bundle'
        second.write_bytes(b'original')
        second_item = activate.file_item(second, self.new, self.old)
        self.target.write_bytes(b'patched')
        second.write_bytes(b'patched')
        journal = {'items': [self.item, second_item], 'state': 'installing'}
        original = activate.atomic_replace
        def change_later_target(path, data, metadata):
            original(path, data, metadata)
            if path == second:
                self.target.write_bytes(b'concurrent deployment')
        with patch.object(activate, 'atomic_replace', side_effect=change_later_target):
            with self.assertRaisesRegex(activate.Stop, 'ROLLBACK_REQUIRES_ATTENTION'):
                activate.rollback(self.stage, journal, lambda: None)
        self.assertEqual(self.target.read_bytes(), b'concurrent deployment')

    def test_restart_refuses_superseded_release_before_docker_restart(self):
        saved = {'Id': 'old', 'Name': '/bos-release-old-edge', 'Image': 'img', 'Config': {}, 'HostConfig': {}, 'Mounts': [], 'State': {'Running': False}}
        commands = []
        def run(args, stage, label, **kwargs):
            commands.append(args)
            if args[:2] == ['docker', 'ps']:
                return b'new'
            if args[:2] == ['docker', 'inspect']:
                return json.dumps([dict(saved, Id='new', Name='/bos-release-new-edge')]).encode()
            return b''
        with patch.object(activate, 'inspect', return_value=saved), patch.object(activate, 'command', side_effect=run), patch.object(activate.time, 'sleep'):
            with self.assertRaises(activate.Stop):
                activate.restart_and_check(self.stage, saved)
        self.assertFalse(any(args[:2] == ['docker', 'restart'] for args in commands))

    def payload_setup(self):
        spec = importlib.util.spec_from_file_location('stage_helpers', ROOT / 'scripts/ru-hands-stage.py')
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        original = b"const WEBHOOK_TOKEN='fixture-private-value';\n" + (ROOT / 'tests/fixtures/hands-v11-sync.ts').read_bytes()
        details = b'local dependency'
        fixture = (ROOT / 'tests/fixtures/hands-v11-sync.ts').read_bytes().rstrip(b'\n')
        source = self.live / 'sources/hands-api/index.ts'
        bundle = self.live / 'bundles/hands-api.eszip'
        files = {'sources/hands-api/index.ts': original, 'sources/hands-api/hands-details.ts': details,
                 'bundles/hands-api.eszip': b'old bundle', 'main/index.ts': b'gateway',
                 'sources/unrelated/index.ts': b'other handler'}
        for name, content in files.items():
            for base in (self.live, self.stage):
                path = base / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
        (self.stage / 'backup').mkdir()
        (self.stage / 'backup/index.ts').write_bytes(original)
        (self.stage / 'backup/hands-api.eszip').write_bytes(b'old bundle')
        (self.stage / 'sources/hands-api/index.ts').write_bytes(helper.patch_source(original, fixture))
        (self.stage / 'sources/hands-api/hands-sync.ts').write_bytes((ROOT / 'supabase/functions/_shared/hands-sync.ts').read_bytes())
        (self.stage / 'bundles/hands-api.eszip').write_bytes(b'new bundle')
        (self.stage / 'output').mkdir()
        (self.stage / 'output/hands-api.eszip').write_bytes(b'new bundle')
        manifest = {'prepared': True, 'activated': False, 'isolated_webhook_validation': True,
                    'patch_commit': helper.PIN, 'source': str(source), 'bundle': str(bundle),
                    'edge_id': 'edge', 'image': 'image'}
        for key, name in {'source_before': 'backup/index.ts', 'bundle_before': 'backup/hands-api.eszip',
                          'source_after': 'sources/hands-api/index.ts', 'bundle_after': 'bundles/hands-api.eszip',
                          'helper_after': 'sources/hands-api/hands-sync.ts'}.items():
            manifest[key] = activate.digest(self.stage / name)
        helper.mount_path = lambda edge, destination: self.live / {'/bos-src': 'sources', '/bos-bundles': 'bundles', '/bos-main': 'main'}[destination]
        helper.download = lambda _: fixture
        self.addCleanup(patch.stopall)
        patch.object(activate, 'SOURCE_REVIEWED', activate.sha(original + b'\n')).start()
        patch.object(activate, 'DETAILS_REVIEWED', activate.sha(details + b'\n')).start()
        return helper, manifest, {'Id': 'edge', 'Image': 'image'}

    def test_payload_guards_exact_patch_local_dependencies_and_original_backups(self):
        helper, manifest, edge = self.payload_setup()
        items = activate.validate_payload(self.stage, manifest, helper, edge)
        self.assertEqual([pathlib.Path(x['target']).name for x in items], ['hands-sync.ts', 'index.ts', 'hands-api.eszip'])
        unrelated = self.live / 'sources/unrelated/index.ts'
        unrelated.write_bytes(b'changed independently')
        with self.assertRaisesRegex(activate.Stop, 'tree changed'):
            activate.validate_payload(self.stage, manifest, helper, edge)
        self.assertEqual(unrelated.read_bytes(), b'changed independently')

    def test_payload_rejects_forged_source_even_with_updated_manifest_digest(self):
        helper, manifest, edge = self.payload_setup()
        source = self.stage / 'sources/hands-api/index.ts'
        source.write_bytes(source.read_bytes() + b'\nextraBehavior();')
        manifest['source_after'] = activate.digest(source)
        with self.assertRaisesRegex(activate.Stop, 'exact reviewed minimal patch'):
            activate.validate_payload(self.stage, manifest, helper, edge)

    def test_payload_rejects_changed_production_before_creating_transaction(self):
        helper, manifest, edge = self.payload_setup()
        pathlib.Path(manifest['source']).write_bytes(b'new independent source')
        with self.assertRaisesRegex(activate.Stop, 'production source or bundle changed'):
            activate.validate_payload(self.stage, manifest, helper, edge)
        self.assertFalse((self.stage / 'activation.json').exists())

    def test_public_probe_sends_only_empty_payload_without_delivery_header(self):
        requests = []
        class Response(io.BytesIO):
            def __init__(self, status, data):
                super().__init__(data)
                self.status = status
        def open_request(request, **kwargs):
            requests.append(request)
            if request.data is not None:
                return Response(400, b'{"error":"MISSING_DELIVERY"}')
            if request.full_url.endswith('hands-api'):
                return Response(405, b'{"error":"METHOD_NOT_ALLOWED"}')
            return Response(200, b'<html>ok</html>')
        opener = types.SimpleNamespace(open=open_request)
        with patch.object(activate.urllib.request, 'build_opener', return_value=opener):
            activate.public_check('test-private-token')
        post = requests[-1]
        self.assertEqual(post.get_method(), 'POST')
        self.assertEqual(post.data, b'{}')
        self.assertFalse(any('delivery' in key.lower() for key, _ in post.header_items()))

    def test_public_probe_never_reveals_url_token_in_error(self):
        def failed(*args, **kwargs):
            raise RuntimeError('private-token-in-url')
        with patch.object(activate.urllib.request, 'build_opener', return_value=types.SimpleNamespace(open=failed)):
            with self.assertRaises(activate.Stop) as caught:
                activate.public_check('private-token-in-url')
        self.assertNotIn('private-token', str(caught.exception))

    def test_client_target_requires_gateway_http_port_or_exact_public_https(self):
        helper = types.SimpleNamespace(route_matches=lambda *args: True)
        for origin in ('ftp://localhost:9000', 'http://edge:3000', 'https://edge:9000',
                       'http://user:secret@edge:9000', 'http://edge:9000/rest/v1', 'http://edge:9000/?token=secret'):
            with self.subTest(origin=origin):
                self.assertFalse(activate.client_target_ok({}, origin, helper))
        self.assertTrue(activate.client_target_ok({}, 'http://edge:9000', helper))
        self.assertTrue(activate.client_target_ok({}, activate.PUBLIC, helper))

    def test_mount_order_does_not_change_container_identity(self):
        first = {'Mounts': [{'Destination': '/b'}, {'Destination': '/a'}]}
        second = {'Mounts': [{'Destination': '/a'}, {'Destination': '/b'}]}
        self.assertEqual(activate.identity(first), activate.identity(second))


if __name__ == '__main__':
    unittest.main()
