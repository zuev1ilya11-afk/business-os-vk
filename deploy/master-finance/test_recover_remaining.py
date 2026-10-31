import copy
from pathlib import Path
import sys
import unittest
sys.path.append(str(Path(__file__).resolve().parents[1] / 'finance-export'))
import database
import common
import recover_remaining as r
r.db = database


def fixture():
    original = {'id': 1688, 'external_id': 'hands:7337869', 'status': 'Выполнена',
                'completed_at': '2026-09-30 15:45:51.605+00', 'master_payout': 4506.19,
                'master_staff_id': 'original-master', 'amount': 8000,
                'extra_work_amount': 0, 'work_items': [{'quantity': 2}]}
    current = {**original, 'status': 'В работе', 'is_claim': True, 'completed_at': None}
    evidence = {'current': [{**current, 'first_claim': r.FIRST_CLAIM}], 'candidates': [
        {'snapshot': original, 'is_claim': False, 'backup': 7, 'mtime': 1, 'sha256': 'a' * 64},
        {'snapshot': current, 'is_claim': True, 'backup': 0, 'mtime': 2, 'sha256': 'b' * 64}]}
    live = {'current': current, 'first_claim': r.FIRST_CLAIM, 'claims': [], 'saved': None,
            'rls': True, 'grants': ['service_role:SELECT'], 'triggers': 0}
    return original, evidence, live


class RecoveryTests(unittest.TestCase):
    def test_original_selected_and_normalized_without_borrowing_new_visit_fields(self):
        original, evidence, live = fixture()
        snapshot, candidates = r.choose_snapshot(evidence)
        self.assertEqual(snapshot['completed_at'], r.ORIGINAL_DATE)
        self.assertEqual(snapshot['master_payout'], 4506.19)
        self.assertEqual(snapshot['master_staff_id'], 'original-master')
        self.assertNotIn('is_claim', snapshot)
        self.assertEqual(len(candidates), 1)
        r.validate_live(live, snapshot, evidence)

    def test_unknown_claim_flag_wrong_identity_or_conflicting_archives_stop(self):
        _, evidence, _ = fixture()
        for key, value in [('completed_at', '2026-10-31T12:00:00Z'), ('master_payout', 4500),
                           ('external_id', 'hands:other')]:
            changed = copy.deepcopy(evidence); changed['candidates'][0]['snapshot'][key] = value
            with self.assertRaises((r.Stop, common.Stop)): r.choose_snapshot(changed)
        changed = copy.deepcopy(evidence); changed['candidates'][0]['is_claim'] = None
        with self.assertRaises(r.Stop): r.choose_snapshot(changed)
        for key, value in [('master_staff_id', 'different-master'), ('extra_work_amount', 100)]:
            changed = copy.deepcopy(evidence)
            second = copy.deepcopy(changed['candidates'][0]); second['snapshot'][key] = value
            changed['candidates'].append(second)
            with self.assertRaises(r.Stop): r.choose_snapshot(changed)

    def test_original_snapshot_excludes_contacts_and_other_orders(self):
        _, evidence, _ = fixture()
        evidence['candidates'][0]['snapshot'].update(phone='SECRET', report_photos=['SECRET'])
        other = copy.deepcopy(evidence['candidates'][0]); other['snapshot']['id'] = 1819
        evidence['candidates'].append(other)
        snapshot, _ = r.choose_snapshot(evidence)
        self.assertNotIn('SECRET', str(snapshot))
        self.assertEqual(snapshot['id'], 1688)

    def test_changed_live_state_permissions_and_different_existing_history_stop(self):
        _, evidence, live = fixture(); snapshot, _ = r.choose_snapshot(evidence)
        for key, value in [('master_payout', 1), ('is_claim', False), ('status', 'Выполнена')]:
            changed = copy.deepcopy(live); changed['current'][key] = value
            with self.assertRaises((r.Stop, common.Stop)): r.validate_live(changed, snapshot, evidence)
        for key, value in [('rls', False), ('grants', ['authenticated:SELECT']), ('triggers', 1)]:
            with self.assertRaises(r.Stop): r.validate_live({**live, key: value}, snapshot, evidence)
        with self.assertRaises(r.Stop): r.validate_live({**live, 'saved': {'basis': 'different', 'financial_data': snapshot}}, snapshot, evidence)
        r.validate_live({**live, 'saved': {'basis': r.BASIS, 'financial_data': snapshot}}, snapshot, evidence)


if __name__ == '__main__': unittest.main()
