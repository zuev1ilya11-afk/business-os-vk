#!/usr/bin/env python3
"""Safety/compatibility boundaries of the captured-extension runtime profile."""
import unittest

import drill_profile as profile


def build(*extensions):
    return profile.build_runtime_profile({'database': 'bos_restore_check',
                                          'extensions': list(extensions)})


class RuntimeProfileTest(unittest.TestCase):
    def assert_reason(self, reason, function, *args):
        with self.assertRaises(profile.ProfileError) as caught:
            function(*args)
        self.assertEqual(caught.exception.reason_code, reason)

    def test_cron_net_restore_require_preload_without_background_execution(self):
        value = build(['plpgsql', '1.0'], ['pg_cron', '1.6'], ['pg_net', '0.20.4'])
        self.assertEqual(value.preloads, ('pg_cron', 'pg_net'))
        settings = dict(item.split('=', 1) for item in value.startup_settings)
        self.assertEqual(settings['cron.database_name'], 'bos_restore_check')
        self.assertEqual(settings['pg_net.database_name'], 'bos_restore_check')
        self.assertEqual(settings['max_worker_processes'], '0')
        self.assertEqual(settings['cron.launch_active_jobs'], 'off')
        self.assertEqual(settings['cron.max_running_jobs'], '0')
        self.assertEqual(settings['cron.use_background_workers'], 'off')
        self.assertEqual(settings['pg_net.batch_size'], '0')

    def test_pgoptions_exclude_gucs_illegal_in_connection_startup(self):
        value = build(['pg_cron', '1.6'], ['pg_net', '0.20.4'], ['pg_tle', '1.4.0'])
        self.assertEqual(value.pgoptions,
                         ('session_preload_libraries=', 'local_preload_libraries='))

    def test_tle_hooks_disabled_before_any_roles_are_restored(self):
        value = build(['pg_tle', '1.4.0'])
        self.assertEqual(value.preloads, ('pg_tle',))
        self.assertIn('pgtle.enable_clientauth=off', value.startup_settings)
        self.assertIn('pgtle.enable_password_check=off', value.startup_settings)

    def test_restore_sessions_override_archived_audit_and_tracking_settings(self):
        value = build(['pgaudit', '17.0'], ['pg_stat_statements', '1.11'])
        for setting in ('pgaudit.log=none', 'pgaudit.log_client=off',
                        'pgaudit.role=', 'pg_stat_statements.track=none'):
            self.assertIn(setting, value.startup_settings)
            self.assertIn(setting, value.pgoptions)

    def test_never_preloads_vault_pgsodium_or_unlisted_libraries(self):
        value = build(['supabase_vault', '0.3.1'], ['pgsodium', '3.1.9'],
                      ['supautils', '1.0'], ['unknown_extension', '1.0'])
        self.assertEqual(value.preloads, ())
        self.assertIn('shared_preload_libraries=', value.startup_settings)
        self.assertFalse(any('getkey' in item for item in value.startup_settings))

    def test_no_irrelevant_custom_settings_when_extensions_absent(self):
        value = build(['plpgsql', '1.0'])
        self.assertFalse(any('.' in item.split('=', 1)[0]
                             for item in value.startup_settings))

    def test_deterministic_order(self):
        a = [['pg_net', '0.20.4'], ['pg_cron', '1.6'], ['uuid-ossp', '1.1']]
        self.assertEqual(build(*a), build(*reversed(a)))

    def test_rejects_duplicate_and_malformed_metadata(self):
        for extensions in ([['pg_net', '0.20.4'], ['pg_net', '0.20.4']],
                           [['pg_net', '1.0', 'extra']], [['/tmp/evil', '1.0']],
                           [['pg_cron,evil', '1.0']], [['pg_net', '1.0\n']],
                           [[True, '1.0']], [['pg_net', None]]):
            with self.subTest(extensions=extensions):
                self.assert_reason('DRILL_DATABASE_METADATA_INVALID', build, *extensions)

    def test_metadata_cannot_add_options_or_execute_shell_code(self):
        self.assert_reason('DRILL_DATABASE_METADATA_INVALID',
                           profile.build_runtime_profile,
                           {'database': 'db -c shared_preload_libraries=evil',
                            'extensions': []})
        value = profile.build_runtime_profile({
            'database': 'bos_restore_check', 'extensions': [['plpgsql', '1.0']],
            'shared_preload_libraries': '/tmp/evil', 'getkey_script': 'evil'})
        self.assertEqual(value.preloads, ())

    def test_available_version_and_default_must_both_match(self):
        value = build(['pg_net', '0.20.4'])
        self.assertTrue(profile.check_available_extensions(value,
                        [['pg_net', '0.19.5', '0.20.4'],
                         ['pg_net', '0.20.4', '0.20.4']]))
        self.assert_reason('DRILL_EXTENSION_DEFAULT_VERSION_MISMATCH',
                           profile.check_available_extensions, value,
                           [['pg_net', '0.20.4', '0.21.0']])

    def test_missing_archived_version_stops_before_restore(self):
        value = build(['pg_net', '0.20.4'])
        self.assert_reason('DRILL_EXTENSION_VERSION_UNAVAILABLE',
                           profile.check_available_extensions, value,
                           [['pg_net', '0.21.0', '0.21.0']])

    def test_invalid_preflight_rows_fail_closed(self):
        value = build(['pg_net', '0.20.4'])
        for rows in (None, [['pg_net', '0.20.4']],
                     [['pg_net', '0.20.4', '0.20.4']] * 2,
                     [['pg_net', '0.20.4', '0.20.4'], ['pg_net', '0.19.5', '0.19.5']]):
            with self.subTest(rows=rows):
                self.assert_reason('DRILL_EXTENSION_PREFLIGHT_INVALID',
                                   profile.check_available_extensions, value, rows)


if __name__ == '__main__':
    unittest.main()
