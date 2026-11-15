"""Failure classification must help operators without exposing backup contents."""
import json
import unittest

import drill_errors


class ErrorClassificationTests(unittest.TestCase):
    def test_representative_postgres_failures(self):
        cases = (
            ('pg_cron can only be loaded via shared_preload_libraries', 'PRELOAD_REQUIRED'),
            ('pg_stat_statements must be loaded via shared_preload_libraries', 'PRELOAD_REQUIRED'),
            ('pg_net is not in shared_preload_libraries', 'PRELOAD_REQUIRED'),
            ('unrecognized configuration parameter "cron.database_name"', 'PRELOAD_REQUIRED'),
            ('can only create extension in database postgres', 'CRON_DATABASE_MISMATCH'),
            ('extension "private_extension" is not available', 'EXTENSION_UNAVAILABLE'),
            ('could not open extension control file "/private/path.control": No such file or directory', 'EXTENSION_UNAVAILABLE'),
            ('could not access file "$libdir/private_extension": No such file or directory', 'SHARED_LIBRARY_MISSING'),
            ('could not load library "/private/path.so": dependency.so: cannot open shared object file: No such file or directory', 'SHARED_LIBRARY_MISSING'),
            ('invalid locale name: "private_locale"', 'DB_COLLATION_UNAVAILABLE'),
            ('invalid LC_COLLATE locale name: "private_locale"', 'DB_COLLATION_UNAVAILABLE'),
            ('collation "private_collation" for encoding "UTF8" does not exist', 'DB_COLLATION_UNAVAILABLE'),
            ('role "private_role" does not exist', 'ROLE_MISSING'),
            ('must be owner of extension private_extension', 'OWNER_PRIVILEGE_DENIED'),
            ('permission denied for schema private_schema', 'OWNER_PRIVILEGE_DENIED'),
            ('database "private_database" already exists', 'OBJECT_ALREADY_EXISTS'),
            ('could not extend file "private_path": No space left on device', 'DISK_FULL'),
            ('out of memory', 'OUT_OF_MEMORY'),
            ('private_unknown_error', 'SQL_RESTORE_FAILED'),
        )
        for message, expected in cases:
            with self.subTest(message=message):
                result = drill_errors.classify(
                    'pg_restore: error: could not execute query: ERROR:  ' + message,
                    'DATABASE')
                self.assertEqual(result['category'], expected)
                self.assertNotIn('private_', json.dumps(result))
                self.assertIsNone(result['sqlstate'])

    def test_error_context_and_sql_are_not_evidence(self):
        raw = (b'pg_restore: error: could not execute query: ERROR:  unknown failure\n'
               b'DETAIL: role "private_role" does not exist\n'
               b'HINT: No space left on device\n'
               b'CONTEXT: out of memory\n'
               b'Command was: SELECT \'out of memory\';\n')
        self.assertEqual(drill_errors.classify(raw, 'DATABASE')['category'], 'SQL_RESTORE_FAILED')
        for raw in (b'ERROR: unknown failure\nDETAIL: SQL text follows\nERROR: out of memory',
                    b'pg_restore: error: unknown failure\nCommand was: SELECT $$\nERROR: out of memory\n$$;'):
            self.assertEqual(drill_errors.classify(raw, 'DATABASE')['category'], 'SQL_RESTORE_FAILED')

    def test_sqlstate_is_structural_and_allowlisted(self):
        detail = drill_errors.classify(b'ERROR:  53100: private_error\n', 'DATABASE')
        self.assertEqual(detail['category'], 'DISK_FULL')
        self.assertEqual(detail['sqlstate'], '53100')
        for raw in (b'ERROR:  HELLO: private_error', b'ERROR: private_error SQLSTATE=53100',
                    b'DETAIL: SQLSTATE 53100', b'Command was: SELECT \'53100\';'):
            self.assertIsNone(drill_errors.classify(raw, 'DATABASE')['sqlstate'])

    def test_private_source_bound_and_invalid_utf8(self):
        raw = b'\xff' * drill_errors.MAX_EVIDENCE_BYTES + b'\nERROR: out of memory'
        result = drill_errors.classify(raw, 'DATABASE')
        self.assertEqual(result['category'], 'SQL_RESTORE_FAILED')
        self.assertEqual(result['evidence_bytes'], drill_errors.MAX_EVIDENCE_BYTES)
        self.assertIs(result['truncated'], True)
        wide = drill_errors.classify('\u044f' * drill_errors.MAX_EVIDENCE_BYTES, 'DATABASE')
        self.assertEqual(wide['evidence_bytes'], drill_errors.MAX_EVIDENCE_BYTES)
        self.assertIs(wide['truncated'], True)

    def test_prefixes_and_nested_connection_failure(self):
        for raw in (b'FATAL: out of memory',
                    b'psql:/bos/input/globals-restore.sql:123: ERROR: out of memory',
                    b'pg_restore: error: connection to server on socket "/private/socket" failed: FATAL: out of memory'):
            self.assertEqual(drill_errors.classify(raw, 'GLOBALS')['category'], 'OUT_OF_MEMORY')

    def test_ambiguous_library_error_and_exit_status_are_not_overclassified(self):
        for raw in (b'pg_restore: error: could not load library "private_library": undefined symbol: private_symbol',
                    b'Killed', b'137', b'exit code 137', b'ERROR: extension private_error'):
            self.assertEqual(drill_errors.classify(raw, 'DATABASE')['category'], 'SQL_RESTORE_FAILED')

    def test_safe_detail_accepts_copy_and_rejects_foreign_values(self):
        detail = drill_errors.classify(None, 'DATABASE')
        self.assertEqual(drill_errors.safe_detail(detail), detail)
        self.assertIsNot(drill_errors.safe_detail(detail), detail)
        invalid = [None, 'private_error', {**detail, 'stderr': 'private_error'}]
        for key, value in (('phase', 'private_phase'), ('category', 'private_category'),
                           ('sqlstate', 'HELLO'), ('evidence_bytes', True),
                           ('evidence_bytes', -1), ('evidence_bytes', 16385),
                           ('truncated', 1)):
            invalid.append({**detail, key: value})
        invalid.append({key: value for key, value in detail.items() if key != 'sqlstate'})
        for value in invalid:
            with self.subTest(value=value):
                self.assertIsNone(drill_errors.safe_detail(value))

    def test_unknown_input_and_phase_never_echo_object_text(self):
        result = drill_errors.classify(object(), 'secret-phase')
        self.assertEqual(result, {'phase': 'UNKNOWN', 'category': 'SQL_RESTORE_FAILED',
                                 'sqlstate': None, 'evidence_bytes': 0, 'truncated': False})


if __name__ == '__main__':
    unittest.main()
