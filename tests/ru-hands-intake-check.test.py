import importlib.util
import io
import json
import pathlib
import stat
import tempfile
import unittest
import urllib.error
from unittest.mock import patch
from contextlib import redirect_stdout
import types

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts/ru-hands-intake-check.py'


class IntakeCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if SCRIPT.exists():
            spec = importlib.util.spec_from_file_location('intake_check', SCRIPT)
            cls.m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.m)
        else:
            cls.m = None

    def setUp(self):
        self.assertIsNotNone(self.m, 'read-only intake diagnostic has not been implemented')

    def page(self, n, total=2, pages=2, ids=None):
        return {'orders': [{'id': x} for x in (ids if ids is not None else [n])],
                'page': n, 'per_page': 1, 'pages': pages, 'total': total}

    def test_short_effective_pages_are_all_read(self):
        rows = self.m.collect_active(lambda p: self.page(p), 4)
        self.assertEqual([x['id'] for x in rows], [1, 2])

    def test_canonical_legacy_ids_and_duplicate_groups(self):
        rows = [{'id': 1}, {'id': 'hands:2'}, {'id': '3', 'creation_time': '2026-10-08T10:00:00Z', 'phone': 'private'}]
        result = self.m.compare_ids(rows, ['hands:1', '1', '2'])
        self.assertEqual(result['missing'], [{'external_id': 'hands:3', 'creation_time': '2026-10-08T10:00:00Z'}])
        self.assertEqual(result['target_duplicate_groups'], 1)
        self.assertNotIn('private', json.dumps(result))

    def test_invalid_identifier_fails_closed(self):
        for bad in [None, '', True, 1.5, '01', 'hands:', 'client@example.com', '1\nDROP', '1' * 30]:
            with self.subTest(bad=bad), self.assertRaises(self.m.Stop):
                self.m.compare_ids([{'id': bad}], [])

    def test_invalid_or_repeated_source_ids_are_not_silently_deduplicated(self):
        with self.assertRaises(self.m.Stop):
            self.m.collect_active(lambda p: self.page(p, ids=[1]), 4)

    def test_limit_and_inconsistent_metadata_do_not_claim_complete(self):
        with self.assertRaises(self.m.Stop):
            self.m.collect_active(lambda p: self.page(p), 1)
        for reply in [{}, {'orders': []}, self.page(2), self.page(1, total=5, pages=1),
                      self.page(1, total=0, pages=1, ids=[1]), self.page(1, total=2, pages=2, ids=[])]:
            with self.subTest(reply=reply), self.assertRaises(self.m.Stop):
                self.m.collect_active(lambda p: reply, 4)

    def test_feed_change_between_pages_fails_closed(self):
        with self.assertRaises(self.m.Stop):
            self.m.collect_active(lambda p: self.page(p, total=2 if p == 1 else 3, pages=2 if p == 1 else 3), 4)

    def test_empty_feed_is_valid_only_with_zero_total(self):
        self.assertEqual(self.m.collect_active(lambda p: self.page(1, 0, 0, []), 4), [])

    def test_retries_temporary_get_failure_and_never_returns_provider_error_body(self):
        class Response(io.BytesIO):
            status = 200
        class Opener:
            def __init__(self): self.calls = 0
            def open(self, req, timeout):
                self.calls += 1
                if self.calls == 1:
                    raise urllib.error.HTTPError(req.full_url, 503, 'secret private body', {}, io.BytesIO(b'private'))
                return Response(b'{"orders": []}')
        self.assertEqual(self.m.fetch_json(self.m.API_URL, {'X-Api-Key': 'secret'}, Opener(), lambda _: None), {'orders': []})
        class Denied:
            def open(self, req, timeout):
                raise urllib.error.HTTPError(req.full_url, 401, 'secret', {}, io.BytesIO(b'private'))
        with self.assertRaisesRegex(self.m.Stop, '^HANDS_HTTP_401$'):
            self.m.fetch_json(self.m.API_URL, {}, Denied(), lambda _: None)

    def test_redirects_do_not_forward_credentials(self):
        req = __import__('urllib.request', fromlist=['Request']).Request(self.m.API_URL)
        self.assertIsNone(self.m.NoRedirect().redirect_request(req, None, 302, 'Found', {}, 'https://elsewhere.invalid/'))

    def test_runtime_logs_emit_only_fixed_categories(self):
        text = 'DB_INSERT: client private name token=secret\nHANDS_401: secret\nORDER_CHANGED'
        signals = self.m.log_signals(text)
        self.assertEqual(signals['db_insert'], 1)
        self.assertEqual(signals['hands_auth'], 1)
        self.assertNotIn('secret', json.dumps(signals))
        self.assertNotIn('private', json.dumps(signals))

    def test_private_manifest_is_not_overwritten_and_permissions_are_private(self):
        with tempfile.TemporaryDirectory() as root:
            path = self.m.save_manifest(pathlib.Path(root), {'missing': [{'external_id': 'hands:1'}]})
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
            other = self.m.save_manifest(pathlib.Path(root), {'missing': []})
            self.assertNotEqual(path, other)
            self.assertEqual(json.loads(path.read_text())['missing'][0]['external_id'], 'hands:1')

    def runtime(self, foreign=False):
        def container(suffix):
            return {'Id': suffix, 'Name': '/bos-release-test-' + suffix,
                    'Config': {'Env': []}, 'NetworkSettings': {'Networks': {'release': {'Aliases': [suffix]}}},
                    'State': {'StartedAt': '2026-10-09T00:00:00Z'}, 'HostConfig': {'RestartPolicy': {'Name': 'unless-stopped'}}}
        edge, rest, db = (container(x) for x in ('edge', 'rest', 'db'))
        edge['Config']['Env'] = ['BOS_REST_ORIGIN=http://rest:3000', 'HANDS_API_KEY=fixture-secret']
        rest['Config']['Env'] = ['PGRST_DB_URI=postgres://auth@db:5432/postgres']
        if foreign: db['Name'] = '/legacy-db'
        records = [edge, rest, db]
        diag = types.SimpleNamespace(
            name=lambda c: c['Name'].lstrip('/'),
            env=lambda c: dict(x.split('=', 1) for x in c['Config']['Env']),
            run=lambda args: 'edge rest db' if args[:2] == ['docker', 'ps'] else json.dumps(records),
            find_db=lambda r, c: (db, 'postgres'), sources=lambda e: None,
            sql=lambda *args: {'jobs': 4, 'active': 4})
        return diag, records

    def test_context_rejects_the_healthy_legacy_database(self):
        diag, _ = self.runtime(foreign=True)
        with self.assertRaisesRegex(self.m.Stop, 'OTHER_DATABASE'):
            self.m.context(diag)

    def test_context_rejects_unknown_or_cross_release_route(self):
        diag, records = self.runtime()
        for route in ['http://legacy-rest:3000', 'http://user:secret@rest:3000', 'https://rest:3000?secret=x']:
            records[0]['Config']['Env'] = ['BOS_REST_ORIGIN=' + route]
            with self.subTest(route=route), self.assertRaises(self.m.Stop):
                self.m.context(diag)

    def test_context_rejects_ambiguous_dns_alias_on_any_edge_network(self):
        diag, records = self.runtime()
        legacy = dict(records[1], Id='legacy-rest', Name='/legacy-rest')
        records.append(legacy)
        with self.assertRaisesRegex(self.m.Stop, 'REST_ROUTE'):
            self.m.context(diag)

    def test_context_rejects_wrong_port_and_database_uri_overrides(self):
        diag, records = self.runtime()
        records[0]['Config']['Env'] = ['BOS_REST_ORIGIN=http://rest:65530']
        with self.assertRaisesRegex(self.m.Stop, 'PORT'):
            self.m.context(diag)
        records[0]['Config']['Env'] = ['BOS_REST_ORIGIN=http://rest:3000']
        for uri in ['postgres://auth@db:5432/postgres?host=legacy-db',
                    'postgres://auth@db:65530/postgres', 'postgres://auth@db:5432/postgres#override']:
            records[1]['Config']['Env'] = ['PGRST_DB_URI=' + uri]
            with self.subTest(uri=uri), self.assertRaises(self.m.Stop):
                self.m.context(diag)

    def test_main_rechecks_target_after_provider_scan_and_prints_no_ids_or_secrets(self):
        diag, _ = self.runtime()
        snapshots = [dict(checked_at='before', hands_ids=[], receipts=147, last_receipt_at=None),
                     dict(checked_at='after', hands_ids=['hands:7401234'], receipts=148, last_receipt_at='now')]
        with tempfile.TemporaryDirectory() as root, \
             patch.object(self.m, 'BASE', pathlib.Path(root)), \
             patch.object(self.m, 'load_diag', return_value=diag), \
             patch.object(self.m, 'target_snapshot', side_effect=snapshots), \
             patch.object(self.m, 'fetch_json', return_value=self.page(1, 2, 1, [7401234, 7405678]) | {'per_page': 2}), \
             patch.object(self.m.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0, stdout=b'private-client fixture-secret', stderr=b'')), \
             patch('sys.argv', ['intake-check']), redirect_stdout(io.StringIO()) as output:
            self.m.main()
            printed = output.getvalue()
            self.assertIn('"missing_active_candidates":1', printed)
            for private in ('fixture-secret', 'private-client', '7401234', '7405678'):
                self.assertNotIn(private, printed)
            manifest = json.loads(next(pathlib.Path(root).rglob('candidates.json')).read_text())
            self.assertEqual(manifest['missing'], [{'external_id': 'hands:7405678', 'creation_time': None}])
            self.assertFalse(manifest['apply_supported'])
            self.assertEqual(manifest['summary']['imported'], 0)


if __name__ == '__main__':
    unittest.main()
