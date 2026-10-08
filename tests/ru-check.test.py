"""Regression coverage for identifying Hands orders without false absence."""
import importlib.util
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ru_check', ROOT / 'scripts/ru-check.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class IncidentLookupTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE orders(external_source TEXT, external_id TEXT)')

    def count(self, incident):
        return self.db.execute('SELECT count(*) FROM orders WHERE ' + check.incident_predicate(incident)).fetchone()[0]

    def test_canonical_prefixed_order_is_found(self):
        self.db.execute("INSERT INTO orders VALUES ('hands', 'hands:123456')")
        self.assertEqual(self.count('123456'), 1)

    def test_legacy_numeric_order_remains_supported(self):
        self.db.execute("INSERT INTO orders VALUES ('hands', '123456')")
        self.assertEqual(self.count('123456'), 1)

    def test_other_sources_and_partial_ids_do_not_match(self):
        self.db.executemany('INSERT INTO orders VALUES (?,?)', [
            ('manual', 'hands:123456'), ('hands', 'hands:1234567'), ('hands', '1123456')])
        self.assertEqual(self.count('123456'), 0)

    def test_both_formats_are_counted_so_duplicates_are_visible(self):
        self.db.executemany('INSERT INTO orders VALUES (?,?)', [('hands', '123456'), ('hands', 'hands:123456')])
        self.assertEqual(self.count('123456'), 2)

    def test_non_numeric_input_is_rejected_before_query(self):
        for value in ('123 OR 1=1', "123'", '', 'hands:123'):
            with self.subTest(value=value), self.assertRaises(check.CheckError):
                self.count(value)


if __name__ == '__main__':
    unittest.main()
