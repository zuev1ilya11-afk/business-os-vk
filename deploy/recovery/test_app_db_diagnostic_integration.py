#!/usr/bin/env python3
"""Read synthetic retained logs on the explicitly selected disposable daemon.

No PostgreSQL process is started. The two fixture volumes contain only literal
test text; diagnostic calls may mount only the failed-app volume, read-only.
"""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import uuid

import app_db_diagnostic
import drill
import drill_db
from test_docker import DisposableDocker
from test_drill_supabase import PUBLIC_IMAGE

REQUIRE = '--require' in sys.argv
if REQUIRE:
    sys.argv.remove('--require')

APP_LABEL = 'io.business-os.local-app'
SECRET = 'PRIVATE_CLIENT_SECRET_DO_NOT_REPORT'
LOG = ('2026-11-15 17:38:03 UTC [41] LOG: could not open file '
       '"pg_stat/pg_stat_statements.stat": No such file or directory\n'
       '2026-11-15 17:38:03 UTC [42] ERROR: unrecognized configuration parameter '
       '"pgaudit.log"\nDETAIL: ' + SECRET + '\n')


class RecordingRunner(drill.DockerRunner):
    def __init__(self, host):
        super().__init__(host=host)
        self.calls = []

    def __call__(self, args, **kwargs):
        self.calls.append(list(args))
        return super().__call__(args, **kwargs)


class RetainedLogDockerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        socket = os.environ.get('BOS_RECOVERY_DOCKER_SOCKET', '')
        if os.environ.get('BOS_RECOVERY_DB_DIAGNOSTIC_TEST') != '1' or not socket:
            if REQUIRE:
                raise RuntimeError('Explicit disposable Docker daemon is required')
            raise unittest.SkipTest('Retained log test needs its disposable Docker daemon')
        cls.temp = tempfile.TemporaryDirectory(prefix='bos-db-diagnostic-fixture-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.docker = DisposableDocker(socket, Path(cls.temp.name))
        cls.runner = RecordingRunner(cls.docker.host)
        cls.image = cls.docker.inspect([PUBLIC_IMAGE])[0]
        version = json.loads(cls.docker.run(['version', '--format', '{{json .Server.Version}}']))
        status = json.loads(cls.docker.run(['info', '--format', '{{json .DriverStatus}}']))
        store = ('containerd' if any(row == ['driver-type', 'io.containerd.snapshotter.v1']
                                   for row in status or []) else 'classic')
        if version != os.environ['BOS_RECOVERY_DOCKER_VERSION'].removeprefix('v'):
            raise RuntimeError('Diagnostic fixture Docker version differs from matrix')
        if store != os.environ['BOS_RECOVERY_DOCKER_STORE']:
            raise RuntimeError('Diagnostic fixture image store differs from matrix')

    def fixture_call(self, volume, script, *args, readonly=False):
        command = ['run', '--rm', '--network', 'none', '--read-only', '--user', '0:0',
                   '--cap-drop', 'ALL', '--cap-add', 'DAC_READ_SEARCH',
                   '--security-opt', 'no-new-privileges', '--log-driver', 'none',
                   '--entrypoint', '/bin/sh', '--env', 'PATH=' + drill_db.PATH,
                   '--mount', 'type=volume,source=' + volume + ',target=/bos,volume-nocopy'
                   + (',readonly' if readonly else '')]
        for target in drill_db._tmpfs(self.image):
            command += ['--tmpfs', target + ':rw,noexec,nosuid,nodev,size=1m']
        command += [self.image['Id'], '-ceu', script, 'bos-fixture', *args]
        return self.docker.run(command)

    def remove_volume(self, volume, label, identity):
        current = json.loads(self.docker.run(['volume', 'inspect', volume]))[0]
        if current.get('Name') != volume or current.get('Labels', {}).get(label) != identity:
            raise RuntimeError('Refusing changed diagnostic fixture volume')
        self.docker.run(['volume', 'rm', volume])

    def test_real_logs_read_without_starting_database_or_changing_volumes(self):
        run = 'bos-app-' + uuid.uuid4().hex[:12]
        baseline_run = 'bos-drill-' + uuid.uuid4().hex[:12]
        volume, baseline = run + '-data', baseline_run + '-data'
        for name, label, identity in ((volume, APP_LABEL, run), (baseline, drill.LABEL, baseline_run)):
            self.docker.run(['volume', 'create', '--label', label + '=' + identity, name])
            self.addCleanup(self.remove_volume, name, label, identity)
        self.fixture_call(volume, r'''umask 077
mkdir -p /bos/app/diagnostics /bos/data
printf '%s' "$1" > /bos/app/diagnostics/db.log
printf '%s' "$2" > /bos/app/diagnostics/init.log
printf '%s' "$3" > /bos/data/app-bootstrap.stderr.log
''', LOG, 'helper started\n' + SECRET, 'bootstrap\n' + SECRET)
        self.fixture_call(baseline, 'printf "%s" "$1" > /bos/baseline-sentinel', SECRET)
        digest_script = 'find /bos -type f -exec sha256sum {} \\; | sort'
        before = self.fixture_call(volume, digest_script, readonly=True)
        baseline_before = self.fixture_call(baseline, digest_script, readonly=True)
        self.assertEqual(len(before.splitlines()), 3)
        self.assertEqual(len(baseline_before.splitlines()), 1)
        containers_before = self.docker.run(['container', 'ls', '--all', '--quiet', '--no-trunc'])
        image = self.image
        context = {'db_image': image['Id'], 'db_image_meta': image,
                   'private': {'images': [image], 'containers': [{'Id': 'f' * 64}]}}
        successful = {'format': 1, 'status': 'DRILL_COMPLETED', 'run_id': baseline_run,
                      'volume': baseline, 'source_manifest_sha256': 'a' * 64}
        launch = {'format': 1, 'status': 'STOPPED', 'run_id': run, 'volume': volume,
                  'failed_stage': 'DATABASE', 'failed_service': 'db',
                  'baseline_volume': baseline, 'source_manifest_sha256': 'a' * 64,
                  'reason': 'APP_DOCKER_COMMAND_FAILED'}
        self.runner.calls.clear()
        result = app_db_diagnostic.collect(context, successful, launch, self.runner)
        self.assertEqual(result['status'], 'DB_DIAGNOSTIC_COMPLETE')
        self.assertEqual(result['failed_clone_mount'], 'READ_ONLY')
        self.assertFalse(result['database_started'])
        self.assertFalse(result['baseline_mounted'])
        self.assertFalse(result['new_volume_created'])
        self.assertEqual(result['log_states']['db']['status'], 'READ')
        text = json.dumps(result)
        self.assertNotIn(SECRET, text)
        self.assertNotIn('unrecognized configuration parameter', text)
        self.assertIn('pgaudit.log', text)
        self.assertEqual(before, self.fixture_call(volume, digest_script, readonly=True))
        self.assertEqual(baseline_before, self.fixture_call(baseline, digest_script, readonly=True))
        self.assertEqual(containers_before,
                         self.docker.run(['container', 'ls', '--all', '--quiet', '--no-trunc']))
        creates = [args for args in self.runner.calls if args[:2] == ['container', 'create']]
        self.assertEqual(len(creates), 1)
        create = creates[0]
        self.assertEqual(create[create.index('--network') + 1], 'none')
        self.assertIn('--read-only', create)
        mounts = [create[index + 1] for index, value in enumerate(create) if value == '--mount']
        self.assertEqual(len(mounts), 1)
        self.assertIn('source=' + volume + ',', mounts[0])
        self.assertIn('readonly', mounts[0])
        self.assertNotIn(baseline, json.dumps(self.runner.calls))
        for args in self.runner.calls:
            self.assertNotIn(args[:2], [['volume', 'create'], ['image', 'pull'], ['image', 'load']])
            self.assertNotIn('postgres --single', ' '.join(args))
            self.assertNotIn('pg_ctl', args)
        print('Retained diagnostic: sanitized existing logs, unchanged clone and baseline, helper removed', flush=True)


if __name__ == '__main__':
    unittest.main()
