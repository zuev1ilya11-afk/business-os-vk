import importlib.util
import io
from pathlib import Path
import unittest
import remaining

path = Path(__file__).resolve().parents[1] / 'finance-export/check-claim.py'
spec = importlib.util.spec_from_file_location('codec', path)
codec = importlib.util.module_from_spec(spec); spec.loader.exec_module(codec)


class RemainingTests(unittest.TestCase):
    def test_archive_reads_only_unresolved_order_and_excludes_contacts(self):
        sql = ('COPY public.orders (id, order_number, status, is_claim, completed_at, master_payout, phone, work_items) FROM stdin;\n'
               '1769\t7395762\tВыполнена\tf\t2026-10-13 17:10:21.807+00\t3754.79\tFIXED_PHONE\t[]\n'
               '12\tTEST-12\tВыполнена\tf\t2026-10-01 12:00:00+00\t600.25\tPRIVATE_PHONE\t[{"quantity":2}]\n\\.\n')
        result = remaining.parse_copy(io.BytesIO(sql.encode()), {'12': {'id': 12, 'order_number': 'TEST-12'}}, codec)
        self.assertEqual(list(result), ['12'])
        self.assertEqual(result['12']['snapshot']['master_payout'], 600.25)
        self.assertEqual(result['12']['snapshot']['work_items'], [{'quantity': 2}])
        self.assertFalse(result['12']['is_claim'])
        self.assertNotIn('phone', result['12']['snapshot'])

    def test_missing_claim_flag_is_unknown_and_identity_mismatch_is_rejected(self):
        sql = 'COPY public.orders (id, order_number) FROM stdin;\n12\tTEST-12\n\\.\n'
        result = remaining.parse_copy(io.BytesIO(sql.encode()), {'12': {'order_number': 'TEST-12'}}, codec)
        self.assertIsNone(result['12']['is_claim'])
        with self.assertRaises(remaining.Stop):
            remaining.parse_copy(io.BytesIO(sql.encode()), {'12': {'order_number': 'DIFFERENT'}}, codec)


if __name__ == '__main__': unittest.main()
