import json
import unittest

import app_db_log_sanitize as parser


class RetainedLogSanitizerTests(unittest.TestCase):
    def test_reviewed_gateway_report_error_code_is_recognized_without_unknown_codes(self):
        for raw in (
            b'Error: REPORT_ENV_INVALID',
            b'event loop error: Error: REPORT_ENV_INVALID',
            b'runtime has escaped from the event loop unexpectedly: event loop error: Error: REPORT_ENV_INVALID',
        ):
            with self.subTest(raw=raw):
                result = parser.summarize(raw)
                self.assertEqual(result['primary_category'], 'GATEWAY_REPORT_CONFIG_INVALID')
                self.assertEqual(result['errors'][0]['known_identifiers'], ['REPORT_ENV_INVALID'])
        for code in ('PRIVATE_SECRET_ERROR', 'REPORT_ENV_INVALID_PRIVATE', 'PRIVATE_REPORT_ENV_INVALID'):
            result = parser.summarize(('Error: ' + code).encode())
            self.assertNotEqual(result['primary_category'], 'GATEWAY_REPORT_CONFIG_INVALID')
            self.assertNotIn(code, json.dumps(result))
        self.assertNotEqual(parser.summarize(b'Error: "REPORT_ENV_INVALID"')['primary_category'],
                            'GATEWAY_REPORT_CONFIG_INVALID')

    def test_edge_plain_ansi_titlecase_and_rust_tracing_formats(self):
        cases = (
            (b'error: Module not found "file:///bos-src/SECRET/index.ts"', 'MODULE_NOT_FOUND'),
            (b'\x1b[31mError\x1b[0m: worker boot error: could not find an appropriate entrypoint', 'MAIN_ENTRYPOINT_UNAVAILABLE'),
            (b'2026-11-15T18:48:17.123Z ERROR edge_runtime::workers: failed to determine entrypoint', 'MAIN_ENTRYPOINT_UNAVAILABLE'),
            (b'[2026-11-15T18:48:17Z ERROR edge_runtime::workers] worker boot error: Module not found "SECRET"', 'MODULE_NOT_FOUND'),
            (b'worker boot error: Uncaught SyntaxError: Unexpected token "SECRET"', 'JAVASCRIPT_SYNTAX_ERROR'),
            (b'runtime has escaped from the event loop unexpectedly: SECRET', 'RUNTIME_EVENT_LOOP_EXITED'),
            (b'event loop error: SECRET', 'RUNTIME_EVENT_LOOP_EXITED'),
        )
        for raw, category in cases:
            with self.subTest(category=category, format=raw[:20]):
                result = parser.summarize(raw)
                self.assertEqual(result['primary_category'], category)
                self.assertEqual(result['severity_counts']['ERROR'], 1)
                self.assertNotIn('SECRET', json.dumps(result))

    def test_anyhow_deep_specific_cause_survives_final_generic_boot_error(self):
        raw = b'''Error: main worker boot error

Caused by:
    0: worker boot error: failed to create the graph
    1: Import "https://private.example/SECRET" failed: error sending request for url
    2: dns error: failed to lookup address information
Error: main worker boot error
'''
        result = parser.summarize(raw)
        self.assertEqual(result['primary_category'], 'DNS_LOOKUP_FAILED')
        self.assertEqual(result['errors'][-1]['category'], 'WORKER_BOOT_FAILED')
        self.assertIn('REMOTE_MODULE', result['errors'][2]['path_kinds'])
        for private in ('SECRET', 'private.example', 'https://'):
            self.assertNotIn(private, json.dumps(result))

    def test_cause_lines_require_an_active_error_and_reset_on_info(self):
        standalone = b'Caused by:\n    0: dns error: failed to lookup address information\n'
        result = parser.summarize(standalone)
        self.assertFalse(result['errors'])
        self.assertEqual(result['unparsed_nonempty_lines'], 2)
        self.assertEqual(result['primary_category'], 'UNPARSED_LOG_RECORDS')
        result = parser.summarize(b'Error: main worker boot error\nINFO started\n' + standalone)
        self.assertEqual(len(result['errors']), 1)
        self.assertEqual(result['primary_category'], 'WORKER_BOOT_FAILED')

    def test_independent_errors_keep_first_specific_primary(self):
        cases = (
            b'ERROR: permission denied for schema public\nERROR: no such file or directory\n',
            b'{"level":"fatal","msg":"permission denied for schema public"}\n'
            b'{"level":"error","msg":"no such file or directory"}\n',
            b'ERROR: permission denied for schema public\nError: main worker boot error\n'
            b'Caused by:\n    0: Import "SECRET" failed\n    1: dns error: failed to lookup address\n',
        )
        for raw in cases:
            with self.subTest(raw=raw[:35]):
                self.assertEqual(parser.summarize(raw)['primary_category'], 'DATABASE_PRIVILEGE_DENIED')

    def test_invalid_json_clears_runtime_cause_context(self):
        for raw in (b'{bad json}', b'{"msg":"SECRET"}', b'{"level":null,"msg":"SECRET"}',
                    b'{"level":"unknown","msg":"SECRET"}', b'{"level":"error"}'):
            with self.subTest(raw=raw):
                result = parser.summarize(b'Error: main worker boot error\nCaused by:\n' + raw
                    + b'\n    0: dns error: failed to lookup address\n')
                self.assertEqual(len(result['errors']), 1)
                self.assertEqual(result['primary_category'], 'WORKER_BOOT_FAILED')
                self.assertEqual(result['unparsed_nonempty_lines'], 2)

    def test_known_errno_and_readonly_cache_resource_categories(self):
        cases = (
            ('failed to open cache /root/.cache/deno/SECRET (os error 30)', 'READ_ONLY_FILESYSTEM', 'EROFS'),
            ('cache unavailable (os error 13)', 'PERMISSION_DENIED', 'EACCES'),
            ('failed to create runtime (os error 24)', 'RESOURCE_LIMIT', 'EMFILE'),
            ('failed to read file (os error 21)', 'FILE_TYPE_MISMATCH', 'EISDIR'),
            ('failed to connect (os error 111)', 'NETWORK_CONNECTION_REFUSED', 'ECONNREFUSED'),
            ('could not create deno cache', 'RUNTIME_CACHE_UNAVAILABLE', None),
        )
        for message, category, errno in cases:
            with self.subTest(errno=errno):
                event = parser.summarize(('Error: ' + message).encode())['errors'][0]
                self.assertEqual(event['category'], category)
                self.assertEqual(event['os_errno'], errno)
                self.assertNotIn('SECRET', json.dumps(event))
        event = parser.summarize(b'Error: unknown (os error 999) "(os error 13)"')['errors'][0]
        self.assertIsNone(event['os_errno'])

    def test_javascript_exception_and_only_fixed_main_entry_location_are_exposed(self):
        event = parser.summarize(b'Uncaught TypeError: failed at file:///bos-main/index.ts:42:7')['errors'][0]
        self.assertEqual(event['javascript_error'], 'TypeError')
        self.assertEqual(event['main_location'], {'line': 42, 'column': 7})
        self.assertEqual(event['path_kinds'], ['EDGE_MAIN_SERVICE'])
        for path in ('/bos-main/SECRET/index.ts:42:7', '/private/index.ts:42:7',
                     '/bos-main/index.ts:0:7', '/bos-main/index.ts:1000000:7'):
            event = parser.summarize(('Error: failed at ' + path).encode())['errors'][0]
            self.assertIsNone(event['main_location'])
            self.assertNotIn(path, json.dumps(event))
        event = parser.summarize(b'Error: "TypeError" SECRET')['errors'][0]
        self.assertIsNone(event['javascript_error'])

    def test_nested_tracing_json_and_rust_panic_remain_sanitized(self):
        raw = json.dumps({'level': 'ERROR', 'fields': {'message':
            'worker boot error: failed to determine entrypoint "PRIVATE_VALUE"',
            'customer': 'SECRET'}, 'target': 'SECRET_MODULE'}).encode()
        result = parser.summarize(raw)
        self.assertEqual(result['primary_category'], 'MAIN_ENTRYPOINT_UNAVAILABLE')
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertNotIn('SECRET', json.dumps(result))
        result = parser.summarize(b"thread 'SECRET' panicked at /private/SECRET: permission denied (os error 13)")
        self.assertEqual(result['errors'][0]['severity'], 'PANIC')
        self.assertEqual(result['primary_category'], 'PERMISSION_DENIED')
        self.assertNotIn('SECRET', json.dumps(result))

    def test_osc_links_and_unparsed_lines_never_leak_raw_values(self):
        result = parser.summarize(b'\x1b]8;;https://private.example/SECRET\x07Error:\x1b]8;;\x07 module not found "SECRET"\nPRIVATE_LINE\n')
        self.assertTrue(result['ansi_sequences_removed'])
        self.assertEqual(result['primary_category'], 'MODULE_NOT_FOUND')
        self.assertEqual(result['unparsed_nonempty_lines'], 1)
        for value in ('SECRET', 'PRIVATE_LINE', 'private.example', '\\u001b'):
            self.assertNotIn(value, json.dumps(result))

    def test_import_map_export_and_specifier_failures_have_fixed_categories(self):
        for message, category in (
            ('failed to parse import map "SECRET"', 'IMPORT_MAP_INVALID'),
            ('Relative import path "SECRET" not prefixed with / or ./ or ../', 'MODULE_SPECIFIER_INVALID'),
            ('Uncaught SyntaxError: requested module "SECRET" does not provide an export named "PASSWORD"', 'MODULE_EXPORT_MISSING'),
        ):
            result = parser.summarize(('worker boot error: ' + message).encode())
            self.assertEqual(result['primary_category'], category)
            self.assertNotIn('SECRET', json.dumps(result))
            self.assertNotIn('PASSWORD', json.dumps(result))

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
