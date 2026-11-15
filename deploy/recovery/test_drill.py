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


if __name__ == '__main__':
    unittest.main()
