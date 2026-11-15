"""Regression tests for the host boundary of the isolated restore drill."""
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import drill
import drill_errors


class HostBoundaryTests(unittest.TestCase):
    def context(self):
        return {'private': {'containers': [{'Id': 'saved-container'}]}}

    def preflight_runner(self, name=None, identifier='local-container', os_type='linux'):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            if args[0] == 'info':
                return json.dumps({'ID': 'local-daemon', 'OSType': os_type,
                                   'Architecture': 'x86_64', 'MemTotal': 4 * 1024 ** 3}).encode()
            if args[:2] == ['container', 'ls']:
                return b'local-container\n' if name else b''
            if args[:2] == ['container', 'inspect']:
                return json.dumps([{'Id': identifier, 'Name': '/' + name}]).encode()
            self.fail('Unexpected mutation during preflight')
        return run, calls

    def test_production_names_and_saved_identity_refused_before_writes(self):
        for name, identifier in [('business-os-db', 'local-container'),
                                 ('bos-release-other-db', 'local-container'),
                                 ('renamed', 'saved-container')]:
            with self.subTest(name=name):
                runner, calls = self.preflight_runner(name, identifier)
                with self.assertRaisesRegex(drill.Stop, 'PRODUCTION_DAEMON_REFUSED'):
                    drill.local_preflight(runner, self.context())
                self.assertFalse(any(c[0] in ('exec', 'run', 'create') for c in calls))

    def test_windows_engine_refused(self):
        runner, _ = self.preflight_runner(os_type='windows')
        with self.assertRaisesRegex(drill.Stop, 'LINUX_AMD64_ENGINE_REQUIRED'):
            drill.local_preflight(runner, self.context())

    def test_remote_docker_endpoint_refused(self):
        with patch('drill.shutil.which', return_value='/usr/bin/docker'):
            for host in ('tcp://127.0.0.1:2375', 'ssh://production', 'tcp://example.com:2376'):
                with self.subTest(host=host), self.assertRaisesRegex(drill.Stop, 'LOCAL_DOCKER_REQUIRED'):
                    drill.DockerRunner(host)

    def image_archive(self, directory, tags, annotation=None):
        path = Path(directory) / 'images.tar'
        with tarfile.open(path, 'w') as output:
            values = {'manifest.json': [{'Config': 'id.json', 'Layers': [], 'RepoTags': tags}]}
            if annotation is not None:
                values['index.json'] = {'manifests': [{'annotations': {'org.opencontainers.image.ref.name': annotation}}]}
            for name, value in values.items():
                raw = json.dumps(value).encode()
                member = tarfile.TarInfo(name)
                member.size = len(raw)
                output.addfile(member, io.BytesIO(raw))
        return path

    def test_local_tags_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            for tags, annotation in [(['production:latest'], None), (None, 'production:latest')]:
                path = self.image_archive(directory, tags, annotation)
                with self.assertRaisesRegex(drill.Stop, 'TAGGED_IMAGE_ARCHIVE_REFUSED'):
                    drill.tagless_archive(path)
            drill.tagless_archive(self.image_archive(directory, None, 'sha256:' + 'a' * 64))

    def test_existing_volume_is_not_reused(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            return b'bos-drill-0123456789ab-data\n'
        with self.assertRaisesRegex(drill.Stop, 'VOLUME_ALREADY_EXISTS'):
            drill.volume_create(run, 'bos-drill-0123456789ab')
        self.assertEqual(len(calls), 1)

    def process_runner(self):
        runner = object.__new__(drill.DockerRunner)
        runner.binary, runner.host, runner.env = sys.executable, None, dict(drill.os.environ)
        return runner

    def test_sensitive_stderr_never_escapes(self):
        with self.assertRaises(drill.Stop) as result:
            self.process_runner()(['-c', 'import sys;sys.stderr.write("SECRET-CUSTOMER");sys.exit(7)'])
        self.assertEqual(str(result.exception), 'DOCKER_COMMAND_FAILED')

    def test_output_limit_and_timeout_are_bounded(self):
        with self.assertRaisesRegex(drill.Stop, 'DOCKER_OUTPUT_LIMIT'):
            self.process_runner()(['-c', 'print("X"*100000)'], limit=1024)
        with self.assertRaisesRegex(drill.Stop, 'DOCKER_COMMAND_TIMEOUT'):
            self.process_runner()(['-c', 'import time;time.sleep(30)'], timeout=0.1)

    def test_report_is_exclusive(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'report.json'
            drill.write_report(target, {'status': 'INCOMPLETE'})
            with self.assertRaises(FileExistsError):
                drill.write_report(target, {'status': 'DRILL_COMPLETED'})
            self.assertEqual(json.loads(target.read_text())['status'], 'INCOMPLETE')


class FailureReportTests(unittest.TestCase):
    def context(self, directory, mode=0o700):
        bundle = Path(directory)
        (bundle / 'globals.sql').write_bytes(b'CREATE ROLE postgres;\n')
        (bundle / 'manifest.json').write_bytes(b'{}')
        with tarfile.open(bundle / 'files.tar', 'w') as archive:
            member = tarfile.TarInfo('root-000')
            member.type, member.mode = tarfile.DIRTYPE, mode
            archive.addfile(member)
        return {'bundle': bundle, 'manifest': {'started_at': 'fixture-start',
                'finished_at': 'fixture-finish', 'payloads': {}},
                'private': {'database': {'bytes': 1}}, 'file_bytes': 0,
                'db_image': 'sha256:' + 'a' * 64}

    def run_failure(self, context, output, failure):
        with patch('drill.drill_files.validate_bundle', return_value=context), \
                patch('drill.drill_roles.source_bootstrap',
                      return_value={'role': 'postgres', 'create_span': [0, 21]}), \
                patch('drill.local_preflight', return_value='daemon'), \
                patch('drill.load_images'), patch('drill.volume_create', return_value='volume'), \
                patch('drill.drill_db.restore_database', side_effect=failure):
            with self.assertRaises(drill.Stop) as caught:
                drill.run_drill(context['bundle'], object(), output)
        self.assertIs(caught.exception, failure)

    def test_database_failure_writes_safe_report_and_printable_path(self):
        with tempfile.TemporaryDirectory() as directory:
            context = self.context(directory)
            output = Path(directory) / 'report.json'
            failure = drill.Stop('DRILL_PRELOAD_REQUIRED')
            failure.detail = drill_errors.classify(
                b'ERROR: pg_cron must be loaded via shared_preload_libraries\n'
                b'DETAIL: SECRET-CUSTOMER', 'DATABASE')
            self.run_failure(context, output, failure)
            report = json.loads(output.read_text())
            payload = drill.failure_payload(failure, output)
            self.assertEqual(report['status'], 'INCOMPLETE')
            self.assertEqual(report['diagnostics'], failure.detail)
            self.assertEqual(payload['report'], str(output))
            self.assertEqual(payload['diagnostics']['category'], 'PRELOAD_REQUIRED')
            self.assertNotIn('SECRET', json.dumps(report))
            self.assertNotIn('SECRET', json.dumps(payload))

    def test_untrusted_details_and_other_report_paths_are_omitted(self):
        failure = drill.Stop('DRILL_DATABASE_RESTORE_FAILED')
        failure.detail = {'stderr': 'SECRET-CUSTOMER'}
        failure.report_path = '/private/SECRET-CUSTOMER.json'
        payload = drill.failure_payload(failure, Path('/generated/report.json'))
        self.assertNotIn('diagnostics', payload)
        self.assertNotIn('report', payload)
        failure.reason_code = {'not': 'a reason code'}
        self.assertEqual(drill.failure_payload(failure)['reason'], 'RESTORE_DRILL_FAILED')

    def test_report_write_failure_preserves_original_restore_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            context = self.context(directory)
            output = Path(directory) / 'missing-directory' / 'report.json'
            failure = drill.Stop('DRILL_DATABASE_RESTORE_FAILED')
            self.run_failure(context, output, failure)
            payload = drill.failure_payload(failure, output)
            self.assertEqual(payload['reason'], 'DRILL_DATABASE_RESTORE_FAILED')
            self.assertEqual(payload['report_status'], 'WRITE_FAILED')
            self.assertNotIn('report', payload)

    def test_restrictive_directory_modes_stop_before_any_docker_call(self):
        for mode in (0o040, 0o500, 0o600, 0o000):
            with self.subTest(mode=oct(mode)), tempfile.TemporaryDirectory() as directory:
                context = self.context(directory, mode)
                with patch('drill.drill_files.validate_bundle', return_value=context), \
                        patch('drill.drill_roles.source_bootstrap', return_value={}), \
                        patch('drill.local_preflight') as docker_preflight, \
                        patch('drill.load_images') as image_load:
                    with self.assertRaisesRegex(drill.Stop, 'FILE_DIRECTORY_MODE_UNSUPPORTED'):
                        drill.run_drill(context['bundle'], object())
                docker_preflight.assert_not_called()
                image_load.assert_not_called()

    def test_main_prints_created_failure_report(self):
        with tempfile.TemporaryDirectory() as directory:
            def failed_run(bundle, runner, output):
                failure = drill.Stop('DRILL_DATABASE_RESTORE_FAILED')
                drill.write_report(output, {'status': 'INCOMPLETE'})
                failure.report_path = str(output)
                raise failure
            stream = io.StringIO()
            with patch('drill.DockerRunner'), patch('drill.run_drill', side_effect=failed_run), \
                    patch('sys.stdout', stream):
                self.assertEqual(drill.main(['--bundle', directory]), 1)
            payload = json.loads(stream.getvalue().splitlines()[-1])
            output = Path(payload['report'])
            try:
                self.assertTrue(output.is_file())
                self.assertEqual(payload['reason'], 'DRILL_DATABASE_RESTORE_FAILED')
            finally:
                output.unlink(missing_ok=True)


class FileCompletionTests(unittest.TestCase):
    def test_extraction_exit_during_readiness_check_has_specific_reason(self):
        identifier, calls = 'a' * 64, []
        def runner(args, **kwargs):
            calls.append(args)
            if args[:2] == ['container', 'create']:
                return identifier.encode()
            if args[0] == 'exec':
                raise drill.Stop('DOCKER_COMMAND_FAILED')
            return b''
        context = {'bundle': Path('/fixture'), 'db_image': 'sha256:' + 'b' * 64,
                   'db_image_meta': {'Config': {}}, 'inventory': {}}
        states = [{'State': {'Running': value}} for value in (False, True, False, False)]
        with patch('drill.helper_isolated', side_effect=states), \
                patch('drill.drill_db._tmpfs', return_value=['/tmp']):
            with self.assertRaisesRegex(drill.Stop, 'FILES_EXTRACTION_FAILED'):
                drill.restore_files(runner, context, 'bos-drill-fixture', 'fixture-volume')
        self.assertEqual(calls[-1], ['container', 'rm', '--force', identifier])


if __name__ == '__main__':
    unittest.main()
