import copy
import importlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


def ownership_regression_sql(query):
    """Read-only PostgreSQL regression: substitute owner names, not catalog rows.

    Execute through the authorized source catalog connector. This regression is
    not part of the mocked local suite; it requires a real PostgreSQL catalog.
    """
    body = query[query.index('WITH\n'):query.rindex('ROLLBACK;')].strip().rstrip(';')
    function_change = body.replace('pg_get_userbyid(p.proowner)', "'bos_test_function_owner'::name")
    relation_change = body.replace('pg_get_userbyid(r.relowner)', "'bos_test_relation_owner'::name")
    return ("BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog;\n"
            f'WITH original AS ({body}), changed_function AS ({function_change}), '
            f'changed_relation AS ({relation_change}) SELECT json_build_object('
            "'function_owner_change_detected', (o.access_inventory::jsonb #> '{categories,extension_member_owners}') "
            "IS DISTINCT FROM (f.access_inventory::jsonb #> '{categories,extension_member_owners}'),"
            "'relation_owner_change_detected', (o.access_inventory::jsonb #> '{categories,extension_member_owners}') "
            "IS DISTINCT FROM (r.access_inventory::jsonb #> '{categories,extension_member_owners}'),"
            "'function_effective_access_unchanged', (o.access_inventory::jsonb #> '{categories,extension_function_access}') = "
            "(f.access_inventory::jsonb #> '{categories,extension_function_access}'),"
            "'relation_effective_access_unchanged', (o.access_inventory::jsonb #> '{categories,extension_relation_access}') = "
            "(r.access_inventory::jsonb #> '{categories,extension_relation_access}')) AS regression "
            'FROM original o, changed_function f, changed_relation r; ROLLBACK;')


class AccessInventoryTests(unittest.TestCase):
    def setUp(self):
        self.v = importlib.import_module('verify_trial_access')
        self.inventory = {
            'categories': {k: {'objects': 1, 'fingerprint': 'a' * 32} for k in self.v.CATEGORIES},
            'database_grants': [['postgres', 'PUBLIC', 'CONNECT', False],
                                ['postgres', 'postgres', 'CREATE', False]],
            'database_owner': 'postgres', 'extension_owners': {'pg_net': 'supabase_admin'},
        }

    def test_refuses_incomplete_inventory_and_invalid_fingerprint(self):
        for mutate in (lambda x: x['categories'].pop('policies'),
                       lambda x: x['categories']['roles'].update(fingerprint='bad'),
                       lambda x: x['categories']['roles'].update(objects=-1),
                       lambda x: x.update(extension_owners={}),
                       lambda x: x['database_grants'].append(['x', 'x', 'SUPERUSER', False])):
            value = copy.deepcopy(self.inventory)
            mutate(value)
            with self.assertRaises(ValueError):
                self.v.compare(self.inventory, value)

    def test_exact_match_ignores_grant_order_but_not_privilege_change(self):
        actual = copy.deepcopy(self.inventory)
        actual['database_grants'].reverse()
        self.assertTrue(self.v.compare(self.inventory, actual)['all_match'])
        actual['database_grants'].pop()
        result = self.v.compare(self.inventory, actual)
        self.assertFalse(result['all_match'])
        self.assertEqual(len(result['missing_database_grants']), 1)

    def test_preserves_each_metadata_and_owner_difference(self):
        actual = copy.deepcopy(self.inventory)
        for item in actual['categories'].values():
            item['fingerprint'] = 'b' * 32
        actual['database_owner'] = 'someone_else'
        actual['extension_owners']['pg_net'] = 'postgres'
        result = self.v.compare(self.inventory, actual)
        self.assertFalse(result['all_match'])
        self.assertEqual(set(result['different_categories']), self.v.CATEGORIES)
        self.assertFalse(result['database_owner_match'])
        self.assertEqual(result['different_extension_owners'], ['pg_net'])

    def test_read_failure_still_stops_and_stop_failure_is_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(self.v, 'stop_trial', return_value=True) as stop:
                with patch.object(self.v, 'run_command', side_effect=RuntimeError('read failed')):
                    with self.assertRaises(RuntimeError):
                        self.v.collect('a' * 64, Path(folder), b'query')
                stop.assert_called_once_with('a' * 64)
            def run(command, stage, **kwargs):
                payload = json.dumps(self.inventory).encode() if kwargs.get('input') == b'query' else b'off'
                return subprocess.CompletedProcess(command, 0, payload, b'')
            with patch.object(self.v, 'stop_trial', return_value=False) as stop:
                with patch.object(self.v, 'run_command', side_effect=run):
                    with self.assertRaisesRegex(RuntimeError, 'stop'):
                        self.v.collect('a' * 64, Path(folder), b'query')
                stop.assert_called_once()

    def test_baseline_bound_to_project_and_exact_query(self):
        import hashlib
        baseline = {'project_id': 'obsropbslfwtanyspjbi', 'captured_at': '2026-10-07T00:00:00Z',
                    'query_sha256': hashlib.sha256(b'query').hexdigest(), 'inventory': self.inventory}
        self.v.validate_baseline(baseline, b'query')
        for field in ('project_id', 'query_sha256'):
            wrong = dict(baseline, **{field: 'wrong'})
            with self.assertRaises(ValueError):
                self.v.validate_baseline(wrong, b'query')

    def test_detail_comparison_preserves_object_changes_and_flags_definers(self):
        first = 'vault|function|vault.first()'
        second = 'vault|function|vault.second()'
        expected = {'schema_metadata': {'public': ['postgres', []]},
                    'extension_member_owners': {first: 'postgres', second: 'supabase_admin'},
                    'extension_security_definers': [first]}
        actual = copy.deepcopy(expected)
        actual['extension_member_owners'] = {first: 'supabase_admin', second: 'postgres'}
        actual['schema_metadata']['public'] = ['postgres', [['postgres', 'anon', 'USAGE', False]]]
        report = self.v.compare_details(expected, actual)
        self.assertEqual(set(report['schema_differences']), {'public'})
        self.assertEqual(set(report['member_owner_differences']), {first, second})
        self.assertEqual(report['changed_security_definers'], [first])
        self.assertFalse(report['all_match'])
        self.assertTrue(self.v.compare_details(expected, expected)['all_match'])

    def test_details_reject_missing_or_malformed_metadata(self):
        valid = {'schema_metadata': {'public': ['postgres', []]},
                 'extension_member_owners': {'x|function|public.x()': 'postgres'},
                 'extension_security_definers': []}
        for mutate in (lambda x: x.pop('schema_metadata'),
                       lambda x: x['schema_metadata'].update(public=['postgres', 'bad']),
                       lambda x: x.update(extension_security_definers=['missing']),
                       lambda x: x.update(extension_member_owners={})):
            actual = copy.deepcopy(valid)
            mutate(actual)
            with self.assertRaises(ValueError):
                self.v.compare_details(valid, actual)

    def test_custom_detail_validator_failure_still_stops(self):
        def run(command, stage, **kwargs):
            value = b'{}' if kwargs.get('input') == b'detail query' else b'off'
            return subprocess.CompletedProcess(command, 0, value, b'')
        with tempfile.TemporaryDirectory() as folder, patch.object(self.v, 'stop_trial', return_value=True) as stop:
            with patch.object(self.v, 'run_command', side_effect=run):
                with self.assertRaises(ValueError):
                    self.v.collect('a' * 64, Path(folder), b'detail query', self.v.validate_details)
            stop.assert_called_once_with('a' * 64)


if __name__ == '__main__':
    unittest.main()
