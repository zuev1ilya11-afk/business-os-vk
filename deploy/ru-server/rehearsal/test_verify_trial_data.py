import unittest
import verify_trial_data as verify


class ArchiveComparisonTests(unittest.TestCase):
    def test_copy_parser_ignores_sql_looking_data(self):
        sql = (b'-- preamble\nCOPY public.orders (id, note) FROM stdin;\n'
               b'1\tCOPY public.fake (id) FROM stdin;\n'
               b'2\tline\\nnext\n\\.\n'
               b"SELECT pg_catalog.setval('public.orders_id_seq', 42, true);\n")
        tables, sequences = verify.parse_data(sql)
        self.assertEqual(len(tables), 1)
        self.assertEqual(tables[0]['rows'], 2)
        self.assertEqual(sequences, [('public.orders_id_seq', 42, True)])

    def test_multiset_detects_changed_values_and_duplicate_rows(self):
        self.assertEqual(verify.digest_rows([b'1\ta\n', b'2\tb\n']),
                         verify.digest_rows([b'2\tb\n', b'1\ta\n']))
        self.assertNotEqual(verify.digest_rows([b'1\ta\n']),
                            verify.digest_rows([b'1\tb\n']))
        self.assertNotEqual(verify.digest_rows([b'1\ta\n']),
                            verify.digest_rows([b'1\ta\n', b'1\ta\n']))

    def test_only_vault_ciphertext_is_excluded(self):
        one = verify.digest_rows([b'id\tone\tname\n'], skip_column=1)
        two = verify.digest_rows([b'id\ttwo\tname\n'], skip_column=1)
        self.assertEqual(one, two)
        self.assertNotEqual(one, verify.digest_rows([b'id\ttwo\tchanged\n'], skip_column=1))

    def test_rejects_truncated_or_duplicate_copy_blocks(self):
        with self.assertRaises(ValueError):
            verify.parse_data(b'COPY public.t (id) FROM stdin;\n1\n')
        with self.assertRaises(ValueError):
            verify.parse_data(b'COPY public.t (id) FROM stdin;\n\\.\n' * 2)

    def test_identifier_injection_rejected(self):
        with self.assertRaises(ValueError):
            verify.parse_data(b'COPY public.t; DROP TABLE public.t (id) FROM stdin;\n\\.\n')
        with self.assertRaises(ValueError):
            verify.parse_data(b"SELECT pg_catalog.setval('public.s;select 1', 42, true);\n")


if __name__ == '__main__':
    unittest.main()
