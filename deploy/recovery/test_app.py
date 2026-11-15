"""Safety boundaries for reusing a restore; full-stack exercise lives in CI."""
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
import tarfile

import app
import app_storage
import drill
import drill_profile

CID = 'a' * 64
IMAGE = 'sha256:' + 'b' * 64
RUN = 'bos-app-0123456789ab'
VOLUME = RUN + '-data'
SOURCE_RUN = 'bos-drill-abcdef012345'
SOURCE = SOURCE_RUN + '-data'


def report_fixture():
    return {'format': 1, 'run_id': SOURCE_RUN, 'volume': SOURCE, 'status': 'DRILL_COMPLETED',
            'restore': {'database': 'RESTORED', 'globals': 'RESTORED', 'extensions': 'MATCH',
                'source_version': 170011, 'report_guard': 'PRESENT_AND_ENABLED',
                'counts': {'orders': 3, 'staff': 2, 'storage_objects': 1}},
            'files': {'integrity': 'VERIFIED', 'files': 5, 'bytes': 1024}}


def inspect_fixture():
    spec = {'image': IMAGE, 'network': 'none', 'mounts': {'/bos': app.mount_record(VOLUME, '/bos')},
            'tmpfs': {'/tmp'}, 'user': 'postgres', 'entrypoint': '/bin/sh', 'cmd': [],
            'memory': 512 * app.MIB, 'caps': set()}
    obj = {'Id': CID, 'Image': IMAGE, 'State': {'Running': True},
           'Config': {'Labels': {app.LABEL: RUN}, 'User': 'postgres', 'Entrypoint': ['/bin/sh'],
                      'Cmd': None, 'Healthcheck': {'Test': ['NONE']}},
           'HostConfig': {'NetworkMode': 'none', 'ReadonlyRootfs': True,
               'CapDrop': ['ALL'], 'CapAdd': [], 'SecurityOpt': ['no-new-privileges'],
               'Memory': 512 * app.MIB, 'MemorySwap': 512 * app.MIB, 'NanoCpus': 2_000_000_000,
               'PidsLimit': 256, 'RestartPolicy': {'Name': 'no'}, 'Tmpfs': {'/tmp': 'options'},
               'Mounts': [{'Type': 'volume', 'Source': VOLUME, 'Target': '/bos',
                           'ReadOnly': False, 'VolumeOptions': {'NoCopy': True}}]},
           'NetworkSettings': {'Networks': {'none': {'IPAddress': ''}}},
           'Mounts': [{'Type': 'volume', 'Name': VOLUME, 'Destination': '/bos', 'RW': True},
                      {'Type': 'tmpfs', 'Destination': '/tmp'}]}
    return obj, spec


class ReportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.bundle = Path(temp.name)
        (self.bundle / 'manifest.json').write_bytes(b'{"synthetic":true}\n')
        self.context = {'bundle': self.bundle, 'private': {'database': {'version': 170011}},
                        'file_count': 5, 'file_bytes': 1024}
        self.report = report_fixture()
        self.report['source_manifest_sha256'] = hashlib.sha256((self.bundle / 'manifest.json').read_bytes()).hexdigest()

    def test_successful_report_bound_to_exact_bundle(self):
        self.assertEqual(app.validate_report(self.context, self.report), SOURCE)
        (self.bundle / 'manifest.json').write_bytes(b'{"different":true}\n')
        with self.assertRaisesRegex(app.Stop, 'APP_REPORT_BUNDLE_MISMATCH'):
            app.validate_report(self.context, self.report)

    def test_failed_restore_rejected_before_docker(self):
        self.report['status'] = 'STOPPED'
        runner = Mock()
        with patch.object(app.drill_files, 'validate_bundle', return_value=self.context):
            with self.assertRaisesRegex(app.Stop, 'APP_SUCCESSFUL_RESTORE_REPORT_REQUIRED'):
                app.start_app(self.bundle, self.report, runner)
        runner.assert_not_called()

    def test_arbitrary_baseline_volume_not_accepted(self):
        self.report['volume'] = 'production-database'
        with self.assertRaisesRegex(app.Stop, 'APP_BASELINE_IDENTITY_INVALID'):
            app.validate_report(self.context, self.report)

    def test_report_file_count_must_match_archive(self):
        self.report['files']['files'] += 1
        with self.assertRaisesRegex(app.Stop, 'APP_BASELINE_FILES_INCOMPLETE'):
            app.validate_report(self.context, self.report)

    def test_unlabelled_or_referenced_baseline_is_refused(self):
        baseline = {'Name': SOURCE, 'Driver': 'local', 'Options': None, 'Labels': {drill.LABEL: SOURCE_RUN}}
        runner = Mock(side_effect=[json.dumps([baseline]).encode(), (CID + '\n').encode()])
        with self.assertRaisesRegex(app.Stop, 'APP_BASELINE_VOLUME_IN_USE'):
            app.baseline_available(runner, self.report)
        baseline['Labels'] = {}
        with self.assertRaisesRegex(app.Stop, 'APP_BASELINE_VOLUME_UNCONFIRMED'):
            app.baseline_available(Mock(return_value=json.dumps([baseline]).encode()), self.report)

    def test_only_own_readonly_clone_helper_may_reference_baseline(self):
        baseline = {'Name': SOURCE, 'Driver': 'local', 'Options': None, 'Labels': {drill.LABEL: SOURCE_RUN}}
        runner = Mock(side_effect=[json.dumps([baseline]).encode(), (CID + '\n').encode()])
        app.baseline_available(runner, self.report, own_helper=CID)


class IsolationTests(unittest.TestCase):
    def test_safe_inspect_accepts_docker_null_cmd(self):
        obj, spec = inspect_fixture()
        session = types.SimpleNamespace(run_id=RUN, runner=Mock(return_value=json.dumps([obj]).encode()))
        app.verify_container(session, CID, spec, running=True)

    def test_inspect_rejects_ports_capabilities_networks_and_changed_mounts(self):
        mutations = [lambda obj: obj['HostConfig'].update(PortBindings={'80/tcp': [{}]}),
                     lambda obj: obj['HostConfig'].update(CapAdd=['NET_ADMIN']),
                     lambda obj: obj['NetworkSettings']['Networks'].update(bridge={'IPAddress': '172.18.0.2'}),
                     lambda obj: obj['HostConfig']['Mounts'][0]['VolumeOptions'].update(Subpath='data'),
                     lambda obj: obj['Mounts'][0].update(Name=SOURCE),
                     lambda obj: obj['HostConfig'].update(Memory=0)]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                obj, spec = inspect_fixture()
                mutate(obj)
                session = types.SimpleNamespace(run_id=RUN, runner=Mock(return_value=json.dumps([obj]).encode()))
                with self.assertRaises(app.Stop):
                    app.verify_container(session, CID, spec)

    def test_mount_selector_cannot_inject_options_or_escape_subpath(self):
        for path in ('files/../data', '/data', 'files/root-000,readonly', 'files//root-000', 'files/root-000\n'):
            with self.subTest(path=path), self.assertRaises(app.Stop):
                app.mount_arg(VOLUME, '/srv', path)
        self.assertIn('volume-subpath=files/root-000,readonly', app.mount_arg(VOLUME, '/srv', 'files/root-000', True))

    def test_parent_image_volume_cannot_expose_database(self):
        image = {'Config': {'Volumes': {'/bos': {}}}}
        with self.assertRaisesRegex(app.Stop, 'APP_IMAGE_VOLUME_OVERLAP'):
            app.tmpfs_targets(image, {'/bos/data': {}})

    def test_only_caddy_receives_its_required_file_capability(self):
        image = {'Config': {}}
        for role in ('db', 'rest', 'auth', 'storage', 'edge', 'https'):
            args, _ = app.base_args(RUN, role, image, {}, {}, 'none')
            self.assertEqual(args[args.index('--cap-drop') + 1], 'ALL')
            added = [args[index + 1] for index, value in enumerate(args) if value == '--cap-add']
            self.assertEqual(added, ['NET_BIND_SERVICE'] if role == 'https' else [])

    def test_pg_configuration_replaces_hooks_and_only_authenticates_localhost(self):
        profile = drill_profile.build_runtime_profile({'database': 'bos_restore_check', 'extensions': [['plpgsql', '1.0']]})
        files = app.postgres_files(profile)
        self.assertIn(b"listen_addresses = '127.0.0.1'", files['data/postgresql.conf'])
        self.assertIn(b"max_worker_processes = '0'", files['data/postgresql.conf'])
        self.assertIn(b"shared_preload_libraries = ''", files['data/postgresql.conf'])
        self.assertIn(b'127.0.0.1/32 scram-sha-256', files['data/pg_hba.conf'])
        self.assertNotIn(b'host all all trust', files['data/pg_hba.conf'])

    def test_generated_tar_does_not_escape_volume(self):
        with self.assertRaises(app.Stop):
            app.tar_bytes({'../outside': b'x'})
        with tarfile.open(fileobj=io.BytesIO(app.tar_bytes({'app/gateway/routes.json': b'{}'}))) as archive:
            member = archive.getmembers()[0]
            self.assertEqual(member.mode, 0o600)
            self.assertEqual(member.name, 'app/gateway/routes.json')

    def test_clone_bootstrap_is_sql_lines_and_never_restores_dump(self):
        runner = Mock()
        runner.side_effect = lambda args, **kw: b'9999999 1024 2048\n' if args[0] == 'exec' and 'df -Pk' in str(args) else b''
        runner.verify_stream = Mock(return_value={'integrity': 'VERIFIED'})
        profile = drill_profile.build_runtime_profile({'database': 'bos_restore_check', 'extensions': []})
        session = types.SimpleNamespace(run_id=RUN, volume=VOLUME, runner=runner, _owned={CID: {}},
            _profile=profile, _plan={'gateway_archive_prefix': 'root-001/main', 'generated_files': {},
                                    'db_roles': {'authenticator': 'fresh_local_secret'}}, _remove=Mock())
        context = {'inventory': {}}
        with patch.object(app, 'create_container', return_value=CID), patch.object(app, 'baseline_available'), \
             patch.object(app, 'verify_container'), patch.object(app.app_transport, 'input_call') as send:
            app.clone_baseline(session, context, report_fixture(), {'Id': IMAGE, 'Config': {'Env': []}})
        self.assertEqual(send.call_count, 2)
        sql = send.call_args.args[2]
        self.assertIn(b'\nDELETE FROM pg_db_role_setting;\n', sql)
        self.assertNotIn(b'\\n', sql)
        self.assertIn(b'ALTER ROLE "authenticator" WITH LOGIN PASSWORD', sql)
        self.assertNotIn('pg_restore', str(runner.call_args_list))
        self.assertNotIn('initdb', str(runner.call_args_list))
        runner.verify_stream.assert_called_once()


class DiagnosticsTests(unittest.TestCase):
    def test_diagnostics_are_bounded_constant_values(self):
        secret = b'PRIVATE_CUSTOMER_SECRET'
        result = app.classify_failure(b'fatal: password authentication failed ' + secret)
        self.assertEqual(result['category'], 'DATABASE_AUTHENTICATION_FAILED')
        self.assertNotIn('PRIVATE', repr(result))
        self.assertTrue(app.classify_failure(b'x' * 20000)['truncated'])

    def test_container_stderr_is_kept_only_in_private_journal(self):
        runner = Mock(return_value=b'')
        runner.last_error = b'read-only file system PRIVATE_CUSTOMER_SECRET'
        session = types.SimpleNamespace(runner=runner, _owned={CID: {'role': 'storage'}},
            containers={'db': CID}, _current_role='storage', report={})
        with patch.object(app, 'verify_container'), patch.object(app.app_transport, 'input_call') as save:
            app.AppSession._private_logs(session)
        self.assertEqual(session.report['diagnostics']['category'], 'READ_ONLY_FILESYSTEM')
        self.assertNotIn('PRIVATE_CUSTOMER_SECRET', repr(session.report))
        raw = save.call_args.args[2]
        with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
            self.assertIn(b'PRIVATE_CUSTOMER_SECRET', archive.extractfile('diagnostics/storage.log').read())

    def test_docker_oom_flag_has_explicit_reason(self):
        obj, spec = inspect_fixture()
        obj['State'].update(Running=False, OOMKilled=True)
        session = types.SimpleNamespace(run_id=RUN, runner=Mock(return_value=json.dumps([obj]).encode()))
        with self.assertRaisesRegex(app.Stop, 'APP_SERVICE_OUT_OF_MEMORY'):
            app.verify_container(session, CID, spec, running=True)


class EdgeReadinessTests(unittest.TestCase):
    def test_actual_health_and_empty_login_rejection_are_probed(self):
        session = types.SimpleNamespace(containers={'db': CID, 'edge': 'c' * 64},
            _owned={'c' * 64: {}}, runner=Mock())
        with patch.object(app, 'verify_container'), patch.object(app.app_transport, 'http_call',
                side_effect=[(200, {}, b'{"ok":true}'), (400, {}, b'{"ok":false,"error":"missing credentials"}')]) as call:
            app.wait_edge(session)
        self.assertEqual(json.loads(call.call_args_list[0].args[5]), {'action': 'health'})
        self.assertEqual(json.loads(call.call_args_list[1].args[5]), {'action': 'login', 'login': '', 'password': ''})

    def test_generic_gateway_json_does_not_prove_function_started(self):
        session = types.SimpleNamespace(containers={'db': CID, 'edge': 'c' * 64},
            _owned={'c' * 64: {}}, runner=Mock())
        with patch.object(app, 'verify_container'), patch.object(app.time, 'monotonic', side_effect=[0, 91]), \
             patch.object(app.app_transport, 'http_call', return_value=(404, {}, b'{"error":"route absent"}')):
            with self.assertRaisesRegex(app.Stop, 'APP_EDGE_FUNCTION_START_TIMEOUT'):
                app.wait_edge(session)


class BrowserMetadataTests(unittest.TestCase):
    def test_metadata_override_requires_exact_verified_body(self):
        payload = b'photo fixture'
        obj = app_storage.MappedObject('id', 'bucket', 'photo', None, 'root-000/photo', '/object/photo',
            len(payload), hashlib.sha256(payload).hexdigest(), 'image/jpeg', 'max-age=60', 'gzip')
        session = types.SimpleNamespace(_stopped=False, containers={'db': CID}, _owned={CID: {}},
            runner=Mock(), _mapped={'bucket/photo': obj}, _signed_urls=None)
        with patch.object(app, 'verify_container'), patch.object(app.app_transport, 'http_call',
             return_value=(200, {'content-type': 'application/octet-stream'}, payload)):
            _, headers, _ = app.AppSession._transport(session, 'GET', '/storage/v1/object/public/bucket/photo', {}, b'')
        self.assertEqual(headers['content-type'], 'image/jpeg')
        self.assertEqual(headers['content-encoding'], 'gzip')
        with patch.object(app, 'verify_container'), patch.object(app.app_transport, 'http_call',
             return_value=(200, {'content-type': 'application/octet-stream'}, b'different')):
            _, headers, _ = app.AppSession._transport(session, 'GET', '/storage/v1/object/public/bucket/photo', {}, b'')
        self.assertEqual(headers['content-type'], 'application/octet-stream')
        self.assertNotIn('content-encoding', headers)


if __name__ == '__main__':
    unittest.main()
