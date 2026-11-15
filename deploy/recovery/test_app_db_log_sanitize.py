import json
import unittest

import app_db_log_sanitize as parser


class RetainedLogSanitizerTests(unittest.TestCase):
    def test_auth_json_preserves_sqlstate_and_known_schema_without_sql_or_values(self):
        raw = json.dumps({'level': 'fatal', 'msg': 'running db migrations: ERROR: permission denied for schema public (SQLSTATE 42501)',
                          'error': 'CREATE TABLE "auth"."schema_migrations" ("password" text); PRIVATE_SECRET https://production.invalid/key',
                          'password': 'NEVER_EXPORT', 'user': 'CUSTOMER_NAME'}).encode()
        result = parser.collect_logs({'auth': raw})
        event = result['auth']['errors'][0]
        self.assertEqual(event['category'], 'DATABASE_PRIVILEGE_DENIED')
        self.assertEqual(event['sqlstate'], '42501')
        self.assertIn('public', event['known_identifiers'])
        self.assertNotIn('schema_migrations', event['known_identifiers'])
        for secret in ('PRIVATE_SECRET', 'production.invalid', 'NEVER_EXPORT', 'CUSTOMER_NAME', 'CREATE TABLE'):
            self.assertNotIn(secret, json.dumps(result))

    def test_sql_literal_cannot_override_final_postgres_error(self):
        raw = json.dumps({'level': 'fatal', 'msg':
            'running db migrations: could not execute CREATE TABLE "schema_migrations" '
            '(version text DEFAULT \'ERROR: no space left on device SQLSTATE 53100\'); '
            'ERROR: permission denied for schema public (SQLSTATE 42501)'}).encode()
        event = parser.summarize(raw)['errors'][0]
        self.assertEqual(event['category'], 'DATABASE_PRIVILEGE_DENIED')
        self.assertEqual(event['sqlstate'], '42501')
        self.assertEqual(event['known_identifiers'], ['public'])
        self.assertNotIn('disk', event['message_terms'])
        self.assertNotIn('create', event['message_terms'])

    def test_final_error_beyond_old_per_field_prefix_is_retained(self):
        raw = json.dumps({'level': 'fatal', 'msg': 'running migrations: ' + 'x' * 8500
            + ': ERROR: permission denied for schema auth (SQLSTATE 42501)'}).encode()
        event = parser.summarize(raw)['errors'][0]
        self.assertEqual(event['category'], 'DATABASE_PRIVILEGE_DENIED')
        self.assertEqual(event['sqlstate'], '42501')
        self.assertEqual(event['known_identifiers'], ['auth'])

    def test_quoted_error_marker_does_not_become_a_server_error(self):
        raw = json.dumps({'level': 'fatal', 'msg':
            'ERROR: permission denied for table "ERROR: no space left on device" (SQLSTATE 42501)'}).encode()
        event = parser.summarize(raw)['errors'][0]
        self.assertEqual(event['sqlstate'], '42501')
        self.assertEqual(event['category'], 'DATABASE_PRIVILEGE_DENIED')
        self.assertEqual(event['message_terms'][:5], ['permission', 'denied', 'for', 'table', '[REDACTED]'])

    def test_structured_unknown_level_fields_and_oversized_lines_are_ignored(self):
        for raw in (b'{bad json}', b'{"level":{},"msg":"secret"}',
                    b'{"level":"unknown","msg":"secret"}',
                    json.dumps({'level': 'fatal', 'msg': 'x' * 20000}).encode()):
            self.assertFalse(parser.summarize(raw)['errors'])

    def test_sqlstate_only_structured_error_is_bounded_and_does_not_raise(self):
        event = parser.summarize(b'{"level":"fatal","msg":"(SQLSTATE 42501)"}')['errors'][0]
        self.assertEqual(event['category'], 'DATABASE_PRIVILEGE_DENIED')
        self.assertEqual(event['message_terms'], [])

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
