import copy
from pathlib import Path
import sys
import unittest
sys.path.append(str(Path(__file__).resolve().parents[1] / 'finance-export'))
import common
import database as d


def fixture():
    original = {'id': 1769, 'order_number': '7395762', 'status': 'Выполнена', 'completed_at': d.ORIGINAL_DATE,
                'amount': 6796, 'master_payout': 3754.79, 'extra_work_amount': 0, 'uncompleted_work_amount': 0}
    current = {**original, 'is_claim': True, 'completed_at': d.REPEAT_DATE, 'report_reviewed_at': d.REPEAT_DATE,
               'claim_closed_at': None, 'claim_revisit_payment': 0}
    claim = {'id': 4, 'order_id': 1769, 'status': 'open', 'pay_revisit': False, 'revisit_payment': 0, 'opened_at': '2026-10-29T09:25:47Z'}
    evidence = {'candidates': [{'snapshot': original, 'is_claim': False, 'mtime': 1},
                               {'snapshot': current, 'is_claim': True, 'mtime': 2}]}
    return original, current, claim, evidence


class DatabaseTests(unittest.TestCase):
    def test_recovery_selects_original_not_newer_open_claim(self):
        original, current, claim, evidence = fixture()
        result, _ = d.choose_snapshot(evidence)
        self.assertEqual(result, original)
        d.validate_current(current, claim, result)

    def test_conflicting_history_or_changed_live_values_rejected(self):
        original, current, claim, evidence = fixture()
        for key, value in [('completed_at', d.REPEAT_DATE), ('master_payout', 900), ('id', 999)]:
            changed = copy.deepcopy(evidence); changed['candidates'][0]['snapshot'][key] = value
            with self.assertRaises(common.Stop): d.choose_snapshot(changed)
        with self.assertRaises(common.Stop): d.validate_current({**current, 'master_payout': 1}, claim, original)
        with self.assertRaises(common.Stop): d.validate_current(current, {**claim, 'pay_revisit': True}, original)

    def test_copy_timestamp_is_normalized_for_mobile_date_parsing(self):
        _, _, _, evidence = fixture()
        evidence['candidates'][0]['snapshot']['completed_at'] = '2026-10-13 17:10:21.807+00'
        result, _ = d.choose_snapshot(evidence)
        self.assertEqual(result['completed_at'], d.ORIGINAL_DATE)

    def test_sql_never_interpolates_untrusted_text(self):
        source = "'; DROP TABLE orders; --"
        encoded = d.json_sql({'work': source})
        self.assertNotIn(source, encoded)
        self.assertTrue(encoded.startswith("convert_from(decode('"))


if __name__ == '__main__': unittest.main()
