import copy
import importlib
import json
from pathlib import Path
import unittest


class GrantRepairTests(unittest.TestCase):
    def setUp(self):
        self.r = importlib.import_module('repair_trial_grants')
        folder = Path(__file__).resolve().parent
        self.inv = json.loads((folder / 'source_access_inventory.json').read_text())['inventory']
        self.details = json.loads((folder / 'source_access_details.json').read_text())['inventory']

    def test_expected_states_preserve_exact_known_changes_and_allow_rerun(self):
        before, after = self.r.expected_states(self.inv, self.details)
        self.r.check_state(before, before, after)
        self.r.check_state(after, before, after)
        self.r.check_state(after, before, after, repaired=True)
        with self.assertRaises(ValueError):
            self.r.check_state(before, before, after, repaired=True)
        self.assertEqual(len(after['inventory']['database_grants']) - len(before['inventory']['database_grants']), 5)
        for schema in ('graphql', 'graphql_public'):
            self.assertEqual(len(before['details']['schema_metadata'][schema][1]), 2)
            self.assertEqual(len(after['details']['schema_metadata'][schema][1]), 6)

    def test_unexpected_permissions_policy_role_and_definer_changes_rejected(self):
        before, after = self.r.expected_states(self.inv, self.details)
        first = next(iter(before['details']['extension_member_owners']))
        for mutate in (
            lambda x: x['inventory']['database_grants'].append(['postgres', 'anon', 'CREATE', False]),
            lambda x: x['inventory']['categories']['policies'].update(fingerprint='f' * 32),
            lambda x: x['inventory']['categories']['roles'].update(objects=99),
            lambda x: x['details']['extension_member_owners'].update({first: 'unknown'}),
            lambda x: x['details']['extension_security_definers'].clear(),
            lambda x: x['details']['schema_metadata']['graphql'][1].append(['supabase_admin', 'PUBLIC', 'CREATE', False]),
        ):
            actual = copy.deepcopy(before)
            mutate(actual)
            with self.assertRaises(ValueError):
                self.r.check_state(actual, before, after)

    def test_unexpected_source_baseline_refused_before_building_grants(self):
        changed = copy.deepcopy(self.details)
        changed['schema_metadata']['graphql'][1].append(['supabase_admin', 'PUBLIC', 'CREATE', False])
        with self.assertRaises(ValueError):
            self.r.expected_states(self.inv, changed)

    def test_projection_keeps_detailed_schema_and_owner_checks(self):
        projected = self.r.project_state({'inventory': self.inv, 'details': self.details})
        self.assertEqual(len(projected['inventory']['categories']), 10)
        self.assertEqual(projected['details'], self.details)
        changed = copy.deepcopy(projected)
        changed['details']['schema_metadata']['public'][0] = 'anon'
        with self.assertRaises(ValueError):
            self.r.check_state(changed, projected, projected, repaired=True)

    def test_transaction_guards_surround_fixed_grants_and_postcommit_read(self):
        folder = Path(__file__).resolve().parent
        before, after = self.r.expected_states(self.inv, self.details)
        sql = self.r.build_sql((folder / 'access_inventory.sql').read_text(),
                               (folder / 'access_details.sql').read_text(), before, after)
        guard_before = sql.index('SELECT pg_temp.bos_grant_guard(false);')
        grant = sql.index('GRANT CREATE ON DATABASE bos_restore_check')
        guard_after = sql.index('SELECT pg_temp.bos_grant_guard(true);')
        commit = sql.index('COMMIT;')
        self.assertLess(guard_before, grant)
        self.assertLess(grant, guard_after)
        self.assertLess(guard_after, commit)
        self.assertIn('BEGIN READ ONLY;', sql[commit:])
        self.assertIn("current_database() <> 'bos_restore_check'", sql[:guard_before])
        self.assertNotIn('REASSIGN OWNED', sql)
        self.assertNotIn('ALTER EXTENSION', sql)


if __name__ == '__main__':
    unittest.main()
