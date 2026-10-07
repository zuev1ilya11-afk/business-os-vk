import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

import recover_runtime_secrets as recover
import stage_runtime_secrets as stage
import verify_runtime_secrets as verify


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.cleanup_root = Path(directory.name)

    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        cls.public = base64.b64encode(cls.key.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)).decode()

    def values(self):
        return {name: name + '-$`"\\-значение-' + 'я' * 1000 for name in stage.NAMES}

    def config(self):
        return {'project': stage.PROJECT, 'run_id': 'a' * 32, 'public_key': self.public,
                'token_hash': hashlib.sha256(b'b' * 64).hexdigest(),
                'expires_ms': int((time.time() + 900) * 1000)}

    def node_response(self, cfg=None, token='b' * 64, method='POST', body=None):
        cfg = cfg or self.config()
        source = recover.function_source(cfg)
        harness = '''
import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync(0, 'utf8'));
let handler; const reads = [];
globalThis.Deno = {serve: fn => {handler=fn;}, env:{get: name => {
  reads.push(name); return data.values[name];
}}};
eval(data.source);
const response = await handler(new Request('https://example.invalid/', {
  method:data.method, headers:{'X-BOS-Migration-Token':data.token},
  ...(data.method === 'POST' ? {body:JSON.stringify(data.body)} : {})
}));
process.stdout.write(JSON.stringify({status:response.status, reads,
  body:await response.text(), cache:response.headers.get('cache-control')}));
'''
        result = subprocess.run(['node', '--input-type=module', '-e', harness],
            input=json.dumps({'source': source.decode(), 'values': self.values(),
                              'token': token, 'method': method, 'body': body}).encode(),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15, check=True)
        return json.loads(result.stdout)

    def test_webcrypto_python_roundtrip_and_fixed_recipient(self):
        cfg = self.config()
        response = self.node_response(cfg, body={'public_key': 'attacker', 'names': ['SUPABASE_SERVICE_ROLE_KEY']})
        self.assertEqual(response['status'], 200)
        self.assertEqual(response['reads'], list(stage.NAMES))
        self.assertEqual(response['cache'], 'no-store')
        envelope = json.loads(response['body'])
        self.assertEqual(recover.decrypt(envelope, self.key, cfg), self.values())
        for value in self.values().values():
            self.assertNotIn(value, response['body'])

    def test_denied_requests_do_not_read_environment(self):
        expired = dict(self.config(), expires_ms=int((time.time() - 1) * 1000))
        for args, status in (({'token': 'bad'}, 401), ({'method': 'GET'}, 405), ({'cfg': expired}, 410)):
            with self.subTest(args=args):
                response = self.node_response(**args)
                self.assertEqual(response['status'], status)
                self.assertEqual(response['reads'], [])

    def test_envelope_tampering_wrong_context_and_extra_fields_fail(self):
        cfg = self.config()
        envelope = json.loads(self.node_response(cfg)['body'])
        for bad in (dict(envelope, run_id='c' * 32), dict(envelope, ciphertext='AA=='),
                    dict(envelope, extra='unexpected'), dict(envelope, wrapped_key='AA==')):
            with self.assertRaises(Exception):
                recover.decrypt(bad, self.key, cfg)
        with self.assertRaises(Exception):
            recover.decrypt(envelope, self.key, dict(cfg, run_id='d' * 32))

    def test_transport_routes_and_auth_do_not_cross_origins(self):
        api = recover.Client('sbp_fake_for_testing', 'bos-migration-export-' + 'a' * 32)
        mgmt = api.request('GET', '/secrets')
        self.assertEqual(mgmt.get_header('Authorization'), 'Bearer sbp_fake_for_testing')
        invoke = api.invoke_request('b' * 64)
        self.assertIsNone(invoke.get_header('Authorization'))
        self.assertEqual(invoke.get_header('X-bos-migration-token'), 'b' * 64)
        self.assertEqual(invoke.host, stage.PROJECT + '.supabase.co')
        for method, path in (('POST', '/secrets'), ('DELETE', '/functions/password-session-api'),
                             ('GET', 'https://evil.invalid'), ('POST', '/functions/deploy?slug=existing')):
            with self.assertRaises(ValueError):
                api.request(method, path)

    def state(self):
        return {'config': self.config(), 'slug': 'bos-migration-export-' + 'a' * 32,
                'function_id': 'our-id', 'acknowledged': True, 'attempted': True}

    def test_cleanup_requires_unchanged_identity_and_exact_source(self):
        from unittest.mock import Mock
        state = self.state()
        source = recover.function_source(state['config'])
        for metadata, files in (({'id': 'someone-else', 'slug': state['slug']}, [('index.ts', source)]),
                                ({'id': 'our-id', 'slug': state['slug']}, [('index.ts', b'changed')])):
            api = Mock()
            api.describe.return_value = metadata
            api.source_files.return_value = files
            with self.assertRaises(recover.CleanupRequired):
                recover.cleanup(api, state, source, self.cleanup_root)
            api.delete.assert_not_called()
        api = Mock()
        api.describe.side_effect = [{'id': 'our-id', 'slug': state['slug']}, None]
        api.source_files.return_value = [('index.ts', source)]
        recover.cleanup(api, state, source, self.cleanup_root)
        api.delete.assert_called_once_with()

    def test_ambiguous_deployment_absence_is_not_cleanup_success(self):
        from unittest.mock import Mock
        api = Mock()
        api.describe.return_value = None
        with self.assertRaises(recover.CleanupRequired):
            recover.cleanup(api, dict(self.state(), acknowledged=False, function_id=None), b'source', self.cleanup_root)
        api.delete.assert_not_called()

    def workflow(self, failure=None, cleanup_failure=False):
        from unittest.mock import Mock
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        parent = Path(directory.name)
        values = self.values()
        digests = {name: hashlib.sha256(v.encode()).hexdigest() for name, v in values.items()}
        cfg = self.config()
        baseline = [{'id': 'business', 'slug': 'business', 'version': 1, 'verify_jwt': True, 'status': 'ACTIVE'}]
        state = dict(self.state(), config=cfg, baseline=baseline, digests=digests,
                     attempted=False, acknowledged=False, function_id=None)
        root = parent / 'recovery'
        root.mkdir(mode=0o700)
        api = Mock()
        api.slug = state['slug']
        api.inventory.return_value = baseline
        api.describe.side_effect = [None, {'id': 'our-id', 'slug': state['slug']}, None]
        api.deploy.return_value = {'id': 'our-id', 'slug': state['slug'], 'verify_jwt': False}
        api.source_files.return_value = [('index.ts', recover.function_source(cfg))]
        api.invoke.return_value = json.loads(self.node_response(cfg)['body'])
        api.digests.return_value = digests
        if failure == 'export':
            api.invoke.side_effect = ValueError('synthetic private message')
        if failure == 'mismatch':
            api.digests.return_value = dict(digests, VK_APP_SECRET='0' * 64)
        if cleanup_failure:
            api.delete.side_effect = TimeoutError('synthetic private message')
        return api, state, root, parent

    def test_workflow_saves_verified_values_only_after_cleanup(self):
        api, state, root, parent = self.workflow()
        def checked_save(where, values):
            api.delete.assert_called_once_with()
            return stage.save_secrets(where, values)
        with patch.object(recover, 'save_secrets', side_effect=checked_save):
            destination = recover.execute(api, root, state, self.key, 'b' * 64)
        saved, digest = verify.load_secrets(destination)
        self.assertEqual(saved, self.values())
        receipt = json.loads(next(destination.glob('verification-*.json')).read_text())
        self.assertTrue(receipt['all_match'])
        self.assertEqual(receipt['secrets_file_sha256'], digest)
        self.assertTrue(json.loads((root / 'run.json').read_text())['cleaned'])
        self.assertEqual(os.stat(root / 'envelope.json').st_mode & 0o777, 0o600)

    def test_export_or_digest_failure_cleans_up_without_saving(self):
        for failure in ('export', 'mismatch'):
            api, state, root, parent = self.workflow(failure=failure)
            with self.assertRaises(ValueError):
                recover.execute(api, root, state, self.key, 'b' * 64)
            api.delete.assert_called_once_with()
            self.assertEqual(list(parent.glob('runtime-secrets-*')), [])

    def test_cleanup_failure_cannot_save_verified_values(self):
        api, state, root, parent = self.workflow(cleanup_failure=True)
        with self.assertRaises(recover.CleanupRequired):
            recover.execute(api, root, state, self.key, 'b' * 64)
        self.assertEqual(list(parent.glob('runtime-secrets-*')), [])

    def test_discovered_ownership_survives_lost_delete_response(self):
        from unittest.mock import Mock
        api, state, root, parent = self.workflow(cleanup_failure=True)
        api.deploy.side_effect = TimeoutError('deployment response lost')
        with self.assertRaises(recover.CleanupRequired):
            recover.execute(api, root, state, self.key, 'b' * 64)
        recovered_state = json.loads((root / 'run.json').read_text())
        self.assertTrue(recovered_state['acknowledged'])
        self.assertEqual(recovered_state['function_id'], 'our-id')
        resumed = Mock()
        resumed.describe.return_value = None
        recover.cleanup(resumed, recovered_state, recover.function_source(state['config']), root)
        resumed.delete.assert_not_called()
        self.assertEqual(list(parent.glob('runtime-secrets-*')), [])

    def test_failed_ownership_checkpoint_prevents_delete(self):
        api, state, root, parent = self.workflow()
        api.deploy.side_effect = TimeoutError('deployment response lost')
        real_journal = recover.journal
        def fail_discovery(where, current):
            if current['acknowledged']:
                raise OSError('synthetic disk failure')
            return real_journal(where, current)
        with patch.object(recover, 'journal', side_effect=fail_discovery):
            with self.assertRaises(recover.CleanupRequired):
                recover.execute(api, root, state, self.key, 'b' * 64)
        api.delete.assert_not_called()


if __name__ == '__main__':
    unittest.main()
