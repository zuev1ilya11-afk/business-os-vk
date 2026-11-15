import json
import unittest

import app_db_log_sanitize as parser


class RetainedLogSanitizerTests(unittest.TestCase):
    def test_startup_missing_stats_cannot_override_actual_sql_error(self):
        result = parser.summarize(b'''2026-11-15 17:38:03.123 UTC [42] LOG:  could not open file "pg_stat/pg_stat_statements.stat": No such file or directory
2026-11-15 17:38:04.123 UTC [43] ERROR:  column "SECRET_CUSTOMER_COLUMN" does not exist
2026-11-15 17:38:04.123 UTC [43] HINT:  SECRET_CUSTOMER_NAME
2026-11-15 17:38:04.123 UTC [43] STATEMENT:  SELECT secret FROM table;
''')
        self.assertEqual(result['primary_category'], 'COLUMN_MISSING')
        self.assertEqual(result['startup_messages'][0]['category'], 'FILE_MISSING')
        self.assertEqual(result['startup_messages'][0]['path_kinds'], ['PGDATA_STATISTICS'])
        self.assertNotIn('SECRET', json.dumps(result))
        self.assertNotIn('SELECT', json.dumps(result))

    def test_known_module_and_configuration_constants_survive(self):
        data = b'ERROR:  could not access file "$libdir/pg_net": No such file or directory\n'
        result = parser.summarize(data)
        self.assertEqual(result['primary_category'], 'SHARED_LIBRARY_UNAVAILABLE')
        self.assertEqual(result['errors'][0]['known_identifiers'], ['pg_net'])
        self.assertEqual(result['errors'][0]['path_kinds'], ['POSTGRES_LIBRARY'])
        result = parser.summarize(b'FATAL:  unrecognized configuration parameter "pgaudit.log"\n')
        self.assertEqual(result['primary_category'], 'CONFIGURATION_PARAMETER_UNKNOWN')
        self.assertEqual(result['errors'][0]['known_identifiers'], ['pgaudit.log'])

    def test_no_raw_quotes_numbers_urls_usernames_or_customer_values(self):
        data = b'''[42] ERROR:  XX000: unknown PRIVATETOKEN token "read only database password" 'user@example.org' https://secret.example/token /private/customer/123 77447744
DETAIL: ERROR: no space left on device
CONTEXT: FATAL: database "HIDDEN" does not exist
'''
        result = parser.summarize(data)
        rendered = json.dumps(result)
        for secret in ('PRIVATETOKEN', 'example', '77447744', 'HIDDEN', 'customer', 'read only database password'):
            self.assertNotIn(secret, rendered)
        self.assertEqual(result['severity_counts']['ERROR'], 1)
        self.assertEqual(result['severity_counts']['FATAL'], 0)
        self.assertEqual(result['errors'][0]['sqlstate'], 'XX000')
        self.assertEqual(result['primary_category'], 'UNCLASSIFIED_DATABASE_MESSAGE')

    def test_untrusted_sqlstate_not_returned(self):
        result = parser.summarize(b'ERROR: ABCDE: invalid parameter "TOPSECRET"\n')
        self.assertIsNone(result['errors'][0]['sqlstate'])
        self.assertNotIn('ABCDE', json.dumps(result))

    def test_bounded_events_bytes_and_fixed_log_names(self):
        raw = b'ERROR: undefined unknown PRIVATEVALUE\n' * 10000
        result = parser.collect_logs({'db': raw, 'secret_filename': raw})
        self.assertEqual(set(result), set(parser.LOG_NAMES))
        self.assertEqual(len(result['db']['errors']), parser.MAX_EVENTS)
        self.assertEqual(result['db']['evidence_bytes'], parser.MAX_BYTES)
        self.assertTrue(result['db']['truncated'])
        self.assertTrue(result['db']['events_truncated'])
        self.assertNotIn('PRIVATEVALUE', json.dumps(result))

    def test_datafile_path_classified_without_relation_identifier(self):
        result = parser.summarize(b'ERROR: could not open file "base/16384/991234": No such file or directory\n')
        self.assertEqual(result['primary_category'], 'FILE_MISSING')
        self.assertEqual(result['errors'][0]['path_kinds'], ['PGDATA_RELATION'])
        self.assertNotIn('991234', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
