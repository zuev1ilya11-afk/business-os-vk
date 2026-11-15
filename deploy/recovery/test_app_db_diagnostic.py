"""Retained-log collector: identity, isolation and private-data boundaries."""
import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import app_db_diagnostic as d
from test_app_diagnostic import make_bundle
from test_app_plan import SECRET


def reports():
    successful = {'status': 'DRILL_COMPLETED', 'run_id': 'bos-drill-' + 'a' * 12,
                  'volume': 'bos-drill-' + 'a' * 12 + '-data', 'source_manifest_sha256': 'b' * 64}
    launch = {'status': 'STOPPED', 'failed_stage': 'DATABASE', 'failed_service': 'db',
              'run_id': 'bos-app-' + 'c' * 12, 'volume': 'bos-app-' + 'c' * 12 + '-data',
              'baseline_volume': successful['volume'], 'source_manifest_sha256': 'b' * 64}
    return successful, launch


class FakeRunner:
    """Small inspect-compatible daemon; every attempted operation is retained."""
    def __init__(self, context, launch):
        self.context, self.launch = context, launch
        self.calls = []
        self.cid, self.container = 'd' * 64, None
        self.image = copy.deepcopy(context['db_image_meta'])
        self.volume_label = launch['run_id']
        self.other_refs = []
        self.logs = {path: b'P2026-11-15 17:38:03.000 UTC [99] ERROR: could not access file "'
                     + SECRET.encode() + b'": No such file or directory\n'
                     for path in d.LOG_PATHS.values()}
        self.exec_failure = False

    def __call__(self, args, **kwargs):
        self.calls.append(list(args))
        if args == ['info', '--format', '{{json .}}']:
            result = {'OSType': 'linux', 'Architecture': 'x86_64', 'ID': 'synthetic-daemon', 'MemTotal': 4 * 1024 * d.MIB}
        elif args[:2] == ['container', 'ls']:
            if '--filter' in args:
                return ('\n'.join(self.other_refs + ([self.cid] if self.container else []))).encode()
            return b''
        elif args[:2] == ['volume', 'inspect']:
            result = [{'Name': self.launch['volume'], 'Driver': 'local', 'Options': {},
                       'Labels': {d.APP_LABEL: self.volume_label}}]
        elif args[:2] == ['image', 'inspect']:
            result = [self.image]
        elif args[:2] == ['container', 'create']:
            take = lambda name: args[args.index(name) + 1]
            values = lambda name: [args[i + 1] for i, arg in enumerate(args) if arg == name]
            label = take('--label').split('=', 1)
            image_position = args.index(self.context['db_image'])
            self.container = {
                'Id': self.cid, 'Name': '/' + take('--name'), 'Image': self.context['db_image'],
                'Config': {'Labels': {label[0]: label[1]}, 'User': take('--user'), 'WorkingDir': take('--workdir'),
                           'Entrypoint': [take('--entrypoint')], 'Cmd': args[image_position + 1:],
                           'Healthcheck': {'Test': ['NONE']}, 'Env': values('--env')},
                'HostConfig': {'NetworkMode': take('--network'), 'ReadonlyRootfs': '--read-only' in args,
                               'Privileged': False, 'RestartPolicy': {'Name': 'no'},
                               'LogConfig': {'Type': take('--log-driver')}, 'CapDrop': values('--cap-drop'),
                               'CapAdd': values('--cap-add'), 'SecurityOpt': values('--security-opt'),
                               'Memory': int(take('--memory')), 'MemorySwap': int(take('--memory-swap')),
                               'NanoCpus': 1_000_000_000, 'PidsLimit': int(take('--pids-limit')),
                               'Mounts': [{'Type': 'volume', 'Source': self.launch['volume'], 'Target': '/bos',
                                           'ReadOnly': True, 'VolumeOptions': {'NoCopy': True}}],
                               'Tmpfs': {value.split(':', 1)[0]: value.split(':', 1)[1] for value in values('--tmpfs')}},
                'Mounts': [{'Destination': '/bos', 'Type': 'volume', 'Name': self.launch['volume'], 'RW': False}],
                'NetworkSettings': {'Networks': {'none': {}}}, 'State': {'Running': False},
            }
            return self.cid.encode()
        elif args[:2] == ['container', 'inspect']:
            result = [self.container]
        elif args[:2] == ['container', 'start']:
            self.container['State']['Running'] = True
            return self.cid.encode()
        elif args[:2] == ['container', 'rm']:
            if args != ['container', 'rm', '--force', self.cid]:
                raise AssertionError('Foreign cleanup')
            self.container = None
            return self.cid.encode()
        elif args[:1] == ['exec']:
            if self.exec_failure:
                raise RuntimeError(SECRET)
            if args[1:7] != [self.cid, '/bin/sh', '-ceu', d.READ_LOG, 'bos-read-retained-log', args[-1]]:
                raise AssertionError('Unexpected helper command')
            return self.logs[args[-1]]
        else:
            raise AssertionError('Unexpected Docker operation')
        return json.dumps(result).encode()


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='bos db diagnostic ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = make_bundle(self.root)
        self.successful, self.launch = reports()
        digest = hashlib.sha256((self.bundle / 'manifest.json').read_bytes()).hexdigest()
        self.successful['source_manifest_sha256'] = self.launch['source_manifest_sha256'] = digest
        (self.root / 'restore-report.json').write_text(json.dumps(self.successful))
        self.context = d.load_metadata(self.bundle, self.successful)
        self.runner = FakeRunner(self.context, self.launch)

    def save_failure(self, name='BOS-App-20261115T173803Z-753c7ec3.json', launch=None):
        (self.root / name).write_text(json.dumps({'status': 'STOPPED', 'launch': launch or self.launch}))

    def test_reads_only_retained_clone_and_sanitizes_private_bytes(self):
        self.context['db_image_meta']['Config']['Volumes'] = {'/var/lib/postgresql/data': {}}
        self.runner.image = copy.deepcopy(self.context['db_image_meta'])
        result = d.collect(self.context, self.successful, self.launch, self.runner)
        self.assertEqual(result['status'], 'DB_DIAGNOSTIC_COMPLETE')
        self.assertFalse(result['database_started'])
        self.assertFalse(result['baseline_mounted'])
        self.assertFalse(result['new_volume_created'])
        self.assertEqual(result['failed_clone_mount'], 'READ_ONLY')
        self.assertNotIn(SECRET, json.dumps(result))
        self.assertIsNone(self.runner.container)
        create = next(call for call in self.runner.calls if call[:2] == ['container', 'create'])
        self.assertIn('--pull', create)
        self.assertEqual(create[create.index('--pull') + 1], 'never')
        self.assertEqual(create.count('--mount'), 1)
        self.assertIn('source=' + self.launch['volume'] + ',target=/bos,readonly,volume-nocopy', create[create.index('--mount') + 1])
        self.assertTrue(any(value.startswith('/var/lib/postgresql/data:') for value in create))
        self.assertNotIn(SECRET, ' '.join(create))
        self.assertFalse(any(self.successful['volume'] in ' '.join(call) for call in self.runner.calls))
        self.assertFalse(any(call[:2] in (['volume', 'create'], ['volume', 'rm'], ['image', 'pull']) for call in self.runner.calls))

    def test_newest_matching_stage_selected_without_unrelated_diagnostic_files(self):
        self.save_failure('BOS-App-20261114T173803Z-11111111.json')
        newer = dict(self.launch, run_id='bos-app-' + 'e' * 12, volume='bos-app-' + 'e' * 12 + '-data')
        self.save_failure(launch=newer)
        (self.root / 'BOS-App-DB-Diagnostic-20261116T000000Z-ffffffff.json').write_text('invalid')
        self.assertEqual(d.select_failure(self.root, self.successful)['run_id'], newer['run_id'])

    def test_newest_database_failure_for_another_bundle_is_refused(self):
        self.save_failure('BOS-App-20261114T173803Z-11111111.json')
        self.save_failure(launch=dict(self.launch, source_manifest_sha256='f' * 64))
        with self.assertRaisesRegex(d.app_cli.Stop, 'DB_DIAGNOSTIC_FAILED_REPORT_MISMATCH'):
            d.select_failure(self.root, self.successful)

    def test_source_metadata_hash_checked_without_reading_large_archives(self):
        for name in ('files.tar', 'images.tar', 'database.dump', 'globals.sql', 'inventory.json'):
            (self.bundle / name).unlink()
        self.assertEqual(d.load_metadata(self.bundle, self.successful)['db_image'], self.context['db_image'])
        with (self.bundle / 'private-config.json').open('a') as stream:
            stream.write(SECRET)
        with self.assertRaisesRegex(Exception, 'PAYLOAD_HASH_MISMATCH'):
            d.load_metadata(self.bundle, self.successful)

    def test_wrong_volume_label_or_existing_reference_stops_before_creation(self):
        for field, value, code in (('volume_label', 'foreign', 'DB_DIAGNOSTIC_VOLUME_IDENTITY_INVALID'),
                                  ('other_refs', ['f' * 64], 'DB_DIAGNOSTIC_VOLUME_IN_USE')):
            runner = FakeRunner(self.context, self.launch)
            setattr(runner, field, value)
            with self.assertRaisesRegex(d.app_cli.Stop, code):
                d.collect(self.context, self.successful, self.launch, runner)
            self.assertFalse(any(call[:2] == ['container', 'create'] for call in runner.calls))

    def test_changed_local_image_refused_without_pull(self):
        self.runner.image['Config']['Env'].append('NEW_VALUE=private')
        with self.assertRaisesRegex(d.app_cli.Stop, 'DB_DIAGNOSTIC_LOCAL_IMAGE_CHANGED'):
            d.collect(self.context, self.successful, self.launch, self.runner)
        self.assertFalse(any(call[:2] == ['container', 'create'] for call in self.runner.calls))

    def test_helper_mount_capability_and_image_changes_are_refused(self):
        args, spec = d.helper_args(self.runner.image, self.launch, '1' * 12)
        cid = self.runner(args).decode()
        original = copy.deepcopy(self.runner.container)
        mutations = (
            lambda value: value.update(Image='sha256:' + 'f' * 64),
            lambda value: value['HostConfig'].update(CapAdd=['DAC_OVERRIDE']),
            lambda value: value['Mounts'][0].update(RW=True),
            lambda value: value['HostConfig']['Mounts'][0].update(Source=self.successful['volume']),
            lambda value: value['HostConfig'].update(NetworkMode='host'),
            lambda value: value['Config'].update(Entrypoint=['postgres']),
        )
        for mutate in mutations:
            self.runner.container = copy.deepcopy(original)
            mutate(self.runner.container)
            with self.assertRaises(d.app_cli.Stop):
                d.inspect_helper(self.runner, cid, spec)

    def test_missing_and_unsafe_logs_are_distinct_and_not_passed_to_parser(self):
        self.runner.logs[d.LOG_PATHS['init']] = b'M'
        self.runner.logs[d.LOG_PATHS['bootstrap']] = b'U'
        result = d.collect(self.context, self.successful, self.launch, self.runner)
        self.assertEqual(result['log_states']['init']['status'], 'MISSING')
        self.assertEqual(result['log_states']['bootstrap']['status'], 'UNSAFE_PATH_REFUSED')

    def test_helper_removed_on_read_failure_and_cli_does_not_print_exception(self):
        self.runner.exec_failure = True
        self.save_failure()
        output = io.StringIO()
        with patch.object(d.drill, 'DockerRunner', return_value=self.runner), contextlib.redirect_stdout(output):
            code = d.main(['--package-dir', str(self.root)])
        self.assertEqual(code, 1)
        self.assertNotIn(SECRET, output.getvalue())
        self.assertIsNone(self.runner.container)
        self.assertEqual(json.loads(output.getvalue())['status'], 'DB_DIAGNOSTIC_STOPPED')

    def test_cli_writes_only_safe_new_report(self):
        self.save_failure()
        before = {path.name: path.read_bytes() for path in self.bundle.iterdir()}
        output = io.StringIO()
        with patch.object(d.drill, 'DockerRunner', return_value=self.runner), contextlib.redirect_stdout(output):
            code = d.main(['--package-dir', str(self.root)])
        self.assertEqual(code, 0)
        document = Path(json.loads(output.getvalue())['report']).read_text()
        self.assertNotIn(SECRET, document)
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.bundle.iterdir()})

    @unittest.skipUnless(os.name == 'posix', 'Fixed helper shell executes in Linux Docker')
    def test_fixed_shell_refuses_symlink_ancestor_and_nonregular_file(self):
        with tempfile.TemporaryDirectory(prefix='bos-log-shell-') as directory:
            root = Path(directory)
            folder = root / 'app/diagnostics'
            folder.mkdir(parents=True)
            log = folder / 'db.log'
            log.write_bytes(b'hello\x00private')
            script = d.READ_LOG.replace('/bos', str(root))
            read = lambda: subprocess.run(['/bin/sh', '-ceu', script, 'test', str(log)], capture_output=True, check=True).stdout
            self.assertEqual(read(), b'Phello\x00private')
            log.unlink()
            self.assertEqual(read(), b'M')
            log.mkdir()
            self.assertEqual(read(), b'U')
            log.rmdir()
            folder.rmdir()
            folder.symlink_to(root)
            self.assertEqual(read(), b'U')


if __name__ == '__main__':
    unittest.main()
