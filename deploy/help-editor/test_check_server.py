import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('check_server', Path(__file__).with_name('check_server.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def runtime():
    def row(part, env, aliases):
        return {'Id': part, 'Name': '/bos-release-test-' + part,
                'Image': 'sha256:' + 'a' * 64,
                'Config': {'Image': 'sha256:' + 'a' * 64, 'Env': env},
                'Mounts': [],
                'NetworkSettings': {'Networks': {'release': {'Aliases': aliases}}}}
    edge = row('edge', ['BOS_REST_ORIGIN=http://rest:3000', 'SECRET=do-not-print'], ['edge'])
    edge['Mounts'] = [{'Destination': '/bos-src', 'Source': '/opt/business-os/deploy/release-test/edge/sources', 'Type': 'bind'}]
    rest = row('rest', ['PGRST_DB_URI=postgres://user:private-password@db:5432/business_os'], ['rest'])
    db = row('db', ['POSTGRES_DB=postgres', 'POSTGRES_USER=postgres', 'POSTGRES_PASSWORD=private-password'], ['db'])
    web = row('https', [], ['https'])
    web['Mounts'] = [{'Destination': '/srv', 'Source': '/opt/business-os/deploy/release-test/web', 'Type': 'bind'}]
    return [edge, rest, db, web]


class CheckServerTests(unittest.TestCase):
    def test_resolves_pinned_ru_images_through_the_active_release_route(self):
        calls = []
        def command(args):
            calls.append(args)
            self.assertEqual(args[-2], 'business_os')
            self.assertEqual(args[2], 'db')
            return '{"version":"17","help_table_exists":false}'
        result = m.database_report(runtime(), command)
        self.assertEqual(result.get('status'), 'OK')
        self.assertEqual(result.get('target_source'), 'verified active release')
        self.assertEqual(len(calls), 1)
        self.assertNotIn('private-password', json.dumps(result) + str(calls))

    def test_read_only_and_no_secrets_in_output(self):
        calls = []
        def command(args):
            calls.append(args)
            if 'help-metadata' in args:
                return '{"help_table_exists":false}'
            if args[-1].endswith('build-version.js'):
                return 'self.BOS_BUILD={"id":"01234567890123456789"}'
            if 'sha256sum' in args:
                return 'a' * 64 + '  filename'
            return 'dummy source with PRIVATE TOKEN not for printing'
        output = m.report(runtime(), command)
        self.assertFalse(output['production_changed'])
        self.assertFalse(output['memo_matches_repository_base'])
        self.assertEqual(output['web_build'], '01234567890123456789')
        self.assertEqual(output['database']['status'], 'OK')
        for secret in ('do-not-print', 'private-password', 'PRIVATE TOKEN'):
            self.assertNotIn(secret, json.dumps(output) + str(calls))
        self.assertTrue(all(a[:2] == ['docker', 'exec'] and a[3] in ['cat', 'sha256sum', 'sh'] for a in calls))
        query = next(a for a in calls if 'help-metadata' in a)
        self.assertEqual(query[-1], m.SQL)
        self.assertIn('POSTGRES_USER', query[-4])
        self.assertTrue(m.SQL.startswith('BEGIN READ ONLY;'))
        self.assertTrue(m.SQL.rstrip().endswith('ROLLBACK;'))
        self.assertIn("SET LOCAL statement_timeout='5s'", m.SQL)

    def refused(self, rows, status):
        result = m.database_report(rows, lambda a: self.fail('Must not query an unverified database'))
        self.assertEqual(result['status'], status)

    def test_missing_rest_never_falls_back_to_bootstrap_database(self):
        rows = runtime()
        rows[2]['Config']['Image'] = 'postgres:17'
        self.refused([rows[0], rows[2], rows[3]], 'ACTIVE_REST_NOT_UNIQUE')

    def test_foreign_postgrest_host_is_not_queried(self):
        rows = runtime()
        rows[1]['Config']['Env'] = ['PGRST_DB_URI=postgres://user:secret@other-server/business_os']
        self.refused(rows, 'POSTGREST_DATABASE_HOST_NOT_MAPPED')

    def test_foreign_edge_route_is_not_queried(self):
        rows = runtime()
        rows[0]['Config']['Env'] = ['BOS_REST_ORIGIN=https://other-server']
        self.refused(rows, 'EDGE_REST_ROUTE_NOT_MAPPED')

    def test_alias_on_an_unshared_network_is_not_a_match(self):
        rows = runtime()
        rows[2]['NetworkSettings']['Networks'] = {'elsewhere': {'Aliases': ['db']}}
        self.refused(rows, 'POSTGREST_DATABASE_HOST_NOT_MAPPED')

    def test_ambiguous_database_alias_is_not_queried(self):
        rows = runtime()
        other = copy.deepcopy(rows[2])
        other['Id'] = 'other-db'
        other['Name'] = '/other-db'
        rows.append(other)
        self.refused(rows, 'POSTGREST_DATABASE_HOST_NOT_MAPPED')

    def test_uri_override_or_nonstandard_port_is_not_queried(self):
        for uri in ('postgres://user:secret@db/business_os?host=elsewhere',
                    'postgres://user:secret@db:9999/business_os',
                    'postgres://user:secret@db/business_os#fragment'):
            with self.subTest(uri=uri):
                rows = runtime()
                rows[1]['Config']['Env'] = ['PGRST_DB_URI=' + uri]
                self.refused(rows, 'POSTGREST_URI_UNAVAILABLE')

    def test_edge_port_mismatch_is_not_queried(self):
        rows = runtime()
        rows[0]['Config']['Env'] = ['BOS_REST_ORIGIN=http://rest:9999']
        self.refused(rows, 'EDGE_REST_PORT_MISMATCH')

    def test_query_failure_is_safely_reported_with_verified_target(self):
        def command(args):
            raise m.ReadFailure('do-not-print', 'SQLSTATE_42P01')
        result = m.database_report(runtime(), command)
        self.assertEqual(result, {'status': 'SQLSTATE_42P01', 'target_source': 'verified active release'})

    def test_missing_edge_stops_without_commands(self):
        output = m.report([], lambda args: self.fail('Unexpected command'))
        self.assertIn('stop', output)

    def test_command_failure_does_not_leak_stderr(self):
        from unittest.mock import patch
        import subprocess
        with patch.object(m.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, ['docker'], stderr='SECRET')):
            with self.assertRaisesRegex(RuntimeError, 'Read-only command failed: docker exec') as error:
                m.run(['docker', 'exec', 'sensitive'])
        self.assertNotIn('SECRET', str(error.exception))
        with patch.object(m.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, ['docker'], stderr=b'ERROR: 42P01\nSECRET')):
            with self.assertRaises(m.ReadFailure) as error:
                m.run(['docker', 'exec', 'db'])
        self.assertEqual(error.exception.code, 'SQLSTATE_42P01')
        self.assertNotIn('SECRET', str(error.exception))


if __name__ == '__main__':
    unittest.main()
