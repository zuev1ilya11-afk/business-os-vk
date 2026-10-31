import importlib.util
import io
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('claim_check', Path(__file__).with_name('check-claim.py'))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class RecoveryTests(unittest.TestCase):
    def test_target_copy_preserves_types_and_excludes_contacts(self):
        sql = ('-- archive\nCOPY public.orders (id, order_number, status, is_claim, completed_at, master_payout, phone, work, work_items) FROM stdin;\n'
               '2\tOTHER\tВыполнена\tf\t2026-09-20\t99\tOTHER_PHONE\tOther\t[]\n'
               '1769\t7395762\tВыполнена\tf\t2026-09-25T12:00:00Z\t3754.79\tPRIVATE_PHONE\tМонтаж\\n2 шт.\t[{"qty":2}]\n'
               '\\.\n')
        result = check.target_from_copy(io.BytesIO(sql.encode()))
        self.assertFalse(result['is_claim'])
        self.assertEqual(result['snapshot']['master_payout'], 3754.79)
        self.assertEqual(result['snapshot']['work'], 'Монтаж\n2 шт.')
        self.assertEqual(result['snapshot']['work_items'], [{'qty': 2}])
        self.assertNotIn('phone', result['snapshot'])
        self.assertEqual(result['snapshot']['completed_at'], '2026-09-25T12:00:00Z')

    def test_null_and_postgres_escapes(self):
        self.assertIsNone(check.copy_value(r'\N'))
        self.assertEqual(check.copy_value(r'\t\r\n\\\141\x62'), '\t\r\n\\ab')
        self.assertEqual(check.copy_value(r'\\N'), r'\N')

    def test_id_collision_and_duplicate_fail_closed(self):
        row = '1769\t7395762\n'
        head = 'COPY public.orders (id, order_number) FROM stdin;\n'
        for text in [head + row + row + '\\.\n', head + row.replace('7395762', '123') + '\\.\n']:
            with self.assertRaises(check.Stop):
                check.target_from_copy(io.BytesIO(text.encode()))

    def test_other_tables_and_no_target_are_ignored(self):
        self.assertIsNone(check.target_from_copy(io.BytesIO(b'COPY public.clients (id, phone) FROM stdin;\n1769\tSECRET\n\\.\n')))


if __name__ == '__main__':
    unittest.main()
