"""Adversarial offline recovery tests; no Docker daemon, network, or live paths.

The capture runner is synthetic. LocalDocker stream tests launch only a tiny
Python child, so timeout/exit/stderr behavior is exercised without Docker.
The real PostgreSQL dump/restore acceptance test is deliberately separate.
"""
import contextlib
import copy
import errno
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location('recovery_backup_under_test', HERE / 'backup.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
SECRET = 'PRIVATE_TEST_SECRET_DO_NOT_PRINT'
SPACE = types.SimpleNamespace(total=10**12, used=0, free=10**12)


def tar_bytes(entries):
    """entries: (name, bytes, optional tar type/linkname)."""
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        for name, data, *options in entries:
            item = tarfile.TarInfo(name)
            item.mode = 0o600
            item.type = options[0] if options else tarfile.REGTYPE
            if len(options) > 1:
                item.linkname = options[1]
            item.size = len(data) if item.isfile() else 0
            archive.addfile(item, io.BytesIO(data) if item.isfile() else None)
    return stream.getvalue()


IMAGE_LAYER = tar_bytes([('synthetic-file', b'image fixture')])
IMAGE_CONFIG = json.dumps({'architecture': 'amd64', 'os': 'linux',
                          'rootfs': {'type': 'layers', 'diff_ids': [
                              'sha256:' + hashlib.sha256(IMAGE_LAYER).hexdigest()]}}).encode()
IMAGE_ID = 'sha256:' + hashlib.sha256(IMAGE_CONFIG).hexdigest()


def image_archive():
    config = IMAGE_ID[7:] + '.json'
    manifest = json.dumps([{'Config': config, 'RepoTags': ['synthetic/recovery:1'],
                            'Layers': ['layer.tar']}]).encode()
    return tar_bytes([('manifest.json', manifest), (config, IMAGE_CONFIG),
                      ('layer.tar', IMAGE_LAYER)])


class FakeRunner:
    def __init__(self, layout):
        self.layout = layout
        self.calls = []
        self.meta = {'version': 170011, 'database': layout['database'],
                     'bytes': 2048, 'extensions': [['plpgsql', '1.0']]}
        self.image_meta = [{'Id': value, 'Size': 1024}
                           for value in sorted(set(layout['images'].values()))]
        self.fail_program = None
        self.failure = None
        self.hook = None

    def __call__(self, args, **options):
        self.calls.append(('read', list(args), dict(options)))
        if 'psql' in args:
            return json.dumps(self.meta).encode()
        if args[:2] == ['image', 'inspect']:
            return json.dumps(self.image_meta).encode()
        raise AssertionError('Unexpected synthetic read command')

    def write(self, args, path, **options):
        self.calls.append(('write', list(args), dict(options)))
        program = next((p for p in ('pg_dump', 'pg_dumpall', 'pg_restore') if p in args), 'image-save')
        if program == 'pg_dump':
            data = b'PGDMP\x01synthetic archive ' + SECRET.encode()
        elif program == 'pg_dumpall':
            data = ('-- synthetic role credentials ' + SECRET).encode()
        elif program == 'pg_restore':
            self.assert_dump_input(options['input_path'])
            data = ('synthetic private TOC ' + SECRET).encode()
        else:
            if args[:2] != ['image', 'save']:
                raise AssertionError('Unexpected synthetic write command')
            data = image_archive()
        with b.exclusive(path) as out:
            out.write(data)
        if self.hook:
            self.hook(program, path)
        if program == self.fail_program:
            raise self.failure

    @staticmethod
    def assert_dump_input(path):
        if not path.read_bytes().startswith(b'PGDMP'):
            raise AssertionError('TOC did not receive synthetic dump')


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='bos-recovery-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.release = self.root / 'release'
        self.release.mkdir(mode=0o700)
        (self.release / '.env').write_text('TOKEN=' + SECRET)
        (self.release / 'web').mkdir()
        (self.release / 'web' / 'index.html').write_text('<p>synthetic</p>')
        (self.release / 'empty').mkdir()
        self.storage = self.root / 'storage'
        self.storage.mkdir(mode=0o700)
        (self.storage / 'object.bin').write_bytes(b'fixture object\x00')
        self.pgdata = self.root / 'pgdata'
        self.pgdata.mkdir(mode=0o700)
        self.output = self.root / 'output'
        image = IMAGE_ID
        containers = [{'Id': 'b' * 64, 'Image': image,
                       'Mounts': [{'Source': str(self.release), 'Destination': '/release'}],
                       'Config': {'Env': ['TOKEN=' + SECRET]},
                       'State': {'StartedAt': '2026-11-14T00:00:00Z'}, 'RestartCount': 0}]
        self.layout = {'release': str(self.release), 'roots': [str(self.release), str(self.storage)],
                       'protected': [str(self.release), str(self.storage), str(self.pgdata)],
                       'database_container': 'b' * 64, 'database': 'fixture_database',
                       'build': 'f' * 20, 'images': {'db': image, 'edge': image},
                       'containers': containers}
        self.runner = FakeRunner(self.layout)
        self.addCleanup(mock.patch.stopall)
        mock.patch.object(b.shutil, 'disk_usage', return_value=SPACE).start()
        self.discovery = mock.patch.object(b.discovery, 'discover',
                                           side_effect=lambda runner: copy.deepcopy(self.layout)).start()

    def capture(self):
        return b.capture(self.layout, self.output, self.runner)

    def manifest_hashes(self, bundle):
        manifest = json.loads((bundle / 'manifest.json').read_text())
        manifest['payloads'] = {name: b.hash_file(bundle / name) for name in b.PAYLOADS}
        (bundle / 'manifest.json').write_text(json.dumps(manifest))

    def assert_no_final(self):
        if self.output.exists():
            self.assertFalse(any(p.name.startswith('capture-') for p in self.output.iterdir()))
            for p in self.output.iterdir():
                self.assertTrue(p.name.endswith('.partial'))
                self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o700)

    def cli(self, argv):
        output = io.StringIO()
        before_umask = os.umask(0o077)
        try:
            with mock.patch.object(b, 'LocalDocker', return_value=self.runner), \
                    contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                code = b.main(argv)
        finally:
            os.umask(before_umask)
        self.assertNotIn(SECRET, output.getvalue())
        return code, json.loads(output.getvalue())

    def test_capture_complete_payload_private_secrets_and_no_readiness_overclaim(self):
        source_before = {p: p.read_bytes() for root in (self.release, self.storage)
                         for p in root.rglob('*') if p.is_file()}
        code, result = self.cli(['capture', '--output', str(self.output)])
        self.assertEqual(code, 0)
        bundle = Path(result['bundle'])
        self.assertEqual(set(p.name for p in bundle.iterdir()), b.PAYLOADS | {'manifest.json'})
        self.assertEqual(result['integrity'], 'VERIFIED')
        self.assertEqual(result['database_storage_consistency'], 'NOT_PROVEN')
        self.assertEqual(result['independent_copy'], 'NOT_VERIFIED')
        self.assertEqual(result['restore'], 'NOT_RUN')
        self.assertIs(result['disaster_recovery_ready'], False)
        self.assertEqual(stat.S_IMODE(bundle.stat().st_mode), 0o700)
        for item in bundle.iterdir():
            self.assertEqual(stat.S_IMODE(item.stat().st_mode), 0o600)
        with tarfile.open(bundle / 'files.tar') as archive:
            self.assertIn(SECRET.encode(), archive.extractfile('root-000/.env').read())
            self.assertTrue(archive.getmember('root-000/empty').isdir())
            self.assertEqual(archive.extractfile('root-001/object.bin').read(), b'fixture object\x00')
        self.assertIn(SECRET, (bundle / 'private-config.json').read_text())
        self.assertEqual(source_before, {p: p.read_bytes() for p in source_before})
        for kind, args, options in self.runner.calls:
            self.assertNotIn(SECRET, str(args))
            if 'pg_dump' in args or 'pg_dumpall' in args:
                self.assertIn('timeout', args)
                self.assertIn('-w', args)
                self.assertEqual(args[args.index('-h') + 1], '/var/run/postgresql')
                self.assertIn('PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=600000', args)
            if 'pg_restore' in args:
                self.assertIn('--list', args)
                self.assertNotIn('-d', args)

    def test_failure_exit_timeout_warning_diskfull_and_interrupt_never_promote(self):
        cases = [('exit', b.Stop('COMMAND_FAILED')), ('timeout', b.Stop('COMMAND_TIMEOUT')),
                 ('warning', b.Stop('COMMAND_WARNINGS')), ('disk', OSError(errno.ENOSPC, SECRET)),
                 ('interrupt', KeyboardInterrupt())]
        for label, failure in cases:
            with self.subTest(label=label):
                self.output = self.root / ('output-' + label)
                self.runner.fail_program, self.runner.failure = 'pg_dump', failure
                code, result = self.cli(['capture', '--output', str(self.output)])
                self.assertEqual(code, 1)
                self.assertEqual(result['capture'], 'STOPPED')
                self.assertIs(result['disaster_recovery_ready'], False)
                self.assert_no_final()
                self.assertFalse(any('pg_dumpall' in args for _, args, _ in self.runner.calls))

    def test_late_failures_never_promote_or_remove_unrelated_output(self):
        for program in ('pg_dumpall', 'pg_restore', 'image-save'):
            with self.subTest(program=program):
                self.output = self.root / ('late-' + program)
                self.output.mkdir(mode=0o700)
                sentinel = self.output / 'unrelated'
                sentinel.write_text('keep me')
                self.runner.fail_program, self.runner.failure = program, b.Stop('COMMAND_FAILED')
                with self.assertRaisesRegex(b.Stop, 'COMMAND_FAILED'):
                    self.capture()
                self.assertEqual(sentinel.read_text(), 'keep me')
                self.assertFalse(any(p.name.startswith('capture-') for p in self.output.iterdir()))

    def test_disk_preflight_prevents_any_payload_write(self):
        with mock.patch.object(b.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=0)):
            with self.assertRaisesRegex(b.Stop, 'INSUFFICIENT_SPACE'):
                self.capture()
        self.assertFalse(any(kind == 'write' for kind, _, _ in self.runner.calls))
        self.assert_no_final()

    def test_inventory_rejects_symlink_hardlink_and_fifo(self):
        for kind in ('symlink', 'hardlink', 'fifo'):
            with self.subTest(kind=kind):
                entry = self.storage / ('bad-' + kind)
                if kind == 'symlink':
                    entry.symlink_to(self.release / '.env')
                elif kind == 'hardlink':
                    os.link(self.release / '.env', entry)
                else:
                    os.mkfifo(entry)
                try:
                    with self.assertRaises(b.Stop):
                        self.capture()
                    self.assertFalse(self.runner.calls)
                    self.assert_no_final()
                finally:
                    entry.unlink()

    def test_inventory_rejects_nested_filesystem_without_reading_it(self):
        target = self.storage / 'object.bin'
        original = Path.lstat
        def lstat(path):
            value = original(path)
            if path == target:
                return types.SimpleNamespace(**{key: getattr(value, key) for key in
                    ('st_ino', 'st_mode', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink')},
                    st_dev=value.st_dev + 1)
            return value
        with mock.patch.object(Path, 'lstat', lstat):
            with self.assertRaisesRegex(b.Stop, 'NESTED_FILESYSTEM_UNSUPPORTED'):
                self.capture()
        self.assertFalse(self.runner.calls)

    def test_same_device_nested_bind_mount_is_rejected_from_mountinfo(self):
        nested = self.storage / 'same device bind'
        nested.mkdir()
        self.assertEqual(nested.stat().st_dev, self.storage.stat().st_dev)
        device = nested.stat().st_dev
        escaped = str(nested).replace(' ', r'\040')
        mountinfo = (f'50 1 {os.major(device)}:{os.minor(device)} / {escaped} '
                     'rw,relatime - ext4 /dev/synthetic rw\n')
        original = Path.read_text
        def read_text(path, *args, **kwargs):
            if path == Path('/proc/self/mountinfo'):
                return mountinfo
            return original(path, *args, **kwargs)
        with mock.patch.object(Path, 'read_text', read_text):
            with self.assertRaisesRegex(b.Stop, 'NESTED_HOST_MOUNT_UNSUPPORTED'):
                self.capture()
        self.assertFalse(self.runner.calls)
        self.assert_no_final()

    def test_safe_path_rejects_relative_dotdot_and_existing_or_dangling_links(self):
        link = self.root / 'linked'
        link.symlink_to(self.storage, target_is_directory=True)
        dangling = self.root / 'dangling'
        dangling.symlink_to(self.root / 'missing')
        for path in (Path('relative'), self.root / '..' / 'outside', link / 'child', dangling):
            with self.subTest(path=path):
                with self.assertRaisesRegex(b.Stop, 'PATH_UNSAFE'):
                    b.safe_path(path)

    def test_output_overlap_both_directions_release_storage_and_pgdata(self):
        for path in (self.release, self.release / 'backup', self.storage / 'backup',
                     self.pgdata / 'backup', self.root):
            with self.subTest(path=path):
                with self.assertRaisesRegex(b.Stop, 'OUTPUT_OVERLAPS_SOURCE'):
                    b.capture(self.layout, path, self.runner)
        self.assertFalse(self.runner.calls)
        self.assertFalse((self.release / 'backup').exists())

    def test_output_must_be_private_and_parent_must_already_exist(self):
        self.output.mkdir(mode=0o755)
        self.output.chmod(0o755)
        with self.assertRaisesRegex(b.Stop, 'PRIVATE_DIRECTORY_REQUIRED'):
            self.capture()
        with self.assertRaisesRegex(b.Stop, 'OUTPUT_PARENT_MISSING'):
            b.capture(self.layout, self.root / 'absent' / 'child', self.runner)
        self.assertFalse(self.runner.calls)

    def test_bad_database_and_image_metadata_stop_before_dump(self):
        cases = [('database', 'another_database'), ('version', 160011), ('version', 180000),
                 ('bytes', 0), ('bytes', '2048')]
        original = dict(self.runner.meta)
        for key, value in cases:
            with self.subTest(key=key, value=value):
                self.runner.meta = {**original, key: value}
                with self.assertRaisesRegex(b.Stop, 'DATABASE_METADATA_MISMATCH'):
                    self.capture()
        self.runner.meta = original
        self.runner.image_meta[0]['Id'] = 'sha256:' + 'c' * 64
        with self.assertRaisesRegex(b.Stop, 'IMAGE_METADATA_MISMATCH'):
            self.capture()
        self.assertFalse(any(kind == 'write' for kind, _, _ in self.runner.calls))

    def test_changed_source_during_capture_is_not_promoted(self):
        def mutate(program, path):
            if program == 'pg_dump':
                (self.storage / 'object.bin').write_bytes(b'changed')
        self.runner.hook = mutate
        with self.assertRaisesRegex(b.Stop, 'SOURCE_CHANGED'):
            self.capture()
        self.assert_no_final()

    def test_recreated_container_or_changed_configuration_is_not_promoted(self):
        for key, value in [('Id', 'new-container'), ('Image', 'new-image'),
                           ('Mounts', []), ('Config', {'Env': ['NEW=private']}),
                           ('State', {'StartedAt': '2026-11-14T00:01:00Z'}), ('RestartCount', 1)]:
            with self.subTest(key=key):
                self.output = self.root / ('changed-' + key)
                after = copy.deepcopy(self.layout)
                after['containers'][0][key] = value
                self.discovery.side_effect = lambda runner, value=after: value
                with self.assertRaisesRegex(b.Stop, 'SOURCE_CHANGED'):
                    self.capture()
                self.assert_no_final()

    def test_changed_source_after_image_export_is_not_promoted(self):
        def mutate(program, path):
            if program == 'image-save':
                (self.storage / 'new-object').write_bytes(b'new')
        self.runner.hook = mutate
        with self.assertRaisesRegex(b.Stop, 'SOURCE_CHANGED'):
            self.capture()
        self.assert_no_final()

    def test_corruption_missing_extra_and_symlink_bundle_payloads_are_rejected(self):
        bundle = self.capture()
        target = bundle / 'database.dump'
        original = target.read_bytes()
        target.write_bytes(original + b'corrupt')
        with self.assertRaisesRegex(b.Stop, 'PAYLOAD_HASH_MISMATCH'):
            b.verify(bundle)
        target.write_bytes(original)
        target.unlink()
        with self.assertRaisesRegex(b.Stop, 'BUNDLE_CONTENTS_INVALID'):
            b.verify(bundle)
        target.symlink_to(self.release / '.env')
        with self.assertRaises(b.Stop):
            b.verify(bundle)
        target.unlink()
        with b.exclusive(target) as f:
            f.write(original)
        (bundle / 'extra').write_bytes(b'extra')
        with self.assertRaisesRegex(b.Stop, 'BUNDLE_CONTENTS_INVALID'):
            b.verify(bundle)

    def test_world_readable_payload_rejected_and_manifest_cannot_claim_restore(self):
        bundle = self.capture()
        for name in ('globals.sql', 'manifest.json'):
            with self.subTest(name=name):
                target = bundle / name
                target.chmod(0o644)
                with self.assertRaisesRegex(b.Stop, 'PRIVATE_FILE_REQUIRED'):
                    b.verify(bundle)
                target.chmod(0o600)
        manifest = json.loads((bundle / 'manifest.json').read_text())
        manifest.update(restore='PASSED', independent_copy='VERIFIED',
                        database_storage_consistency='CONSISTENT', disaster_recovery_ready=True)
        (bundle / 'manifest.json').write_text(json.dumps(manifest))
        result = b.verify(bundle)
        self.assertEqual(result['restore'], 'NOT_RUN')
        self.assertEqual(result['independent_copy'], 'NOT_VERIFIED')
        self.assertEqual(result['database_storage_consistency'], 'NOT_PROVEN')
        self.assertFalse(result['disaster_recovery_ready'])

    def test_manifest_permissions_changed_before_promotion_leave_partial(self):
        original = b.write_json
        def changed_mode(path, data):
            original(path, data)
            if path.name == 'manifest.json':
                path.chmod(0o644)
        with mock.patch.object(b, 'write_json', side_effect=changed_mode):
            with self.assertRaisesRegex(b.Stop, 'PRIVATE_FILE_REQUIRED'):
                self.capture()
        self.assert_no_final()

    def test_complete_looking_partial_is_rejected_by_external_verify(self):
        bundle = self.capture()
        partial = bundle.with_name('.' + bundle.name + '.partial')
        bundle.rename(partial)
        with self.assertRaisesRegex(b.Stop, '^PARTIAL_BUNDLE$'):
            b.verify(partial)
        code, report = self.cli(['verify', str(partial)])
        self.assertEqual(code, 1)
        self.assertEqual(report['reason'], 'PARTIAL_BUNDLE')
        self.assertFalse(report['disaster_recovery_ready'])
        self.assertEqual(b.verify(partial, allow_partial=True)['integrity'], 'VERIFIED')
        self.assert_no_final()

    def test_partial_directory_fsync_failure_never_promotes(self):
        original = os.fsync
        attempted = []
        def fail_directory(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):
                attempted.append(fd)
                raise OSError(errno.EIO, SECRET)
            return original(fd)
        with mock.patch.object(b.os, 'fsync', side_effect=fail_directory):
            code, report = self.cli(['capture', '--output', str(self.output)])
        self.assertEqual(code, 1)
        self.assertEqual(report['capture'], 'STOPPED')
        self.assertEqual(len(attempted), 1)
        self.assert_no_final()
        partial = next(self.output.iterdir())
        self.assertTrue((partial / 'manifest.json').is_file())
        with self.assertRaisesRegex(b.Stop, 'PARTIAL_BUNDLE'):
            b.verify(partial)

    def test_final_directory_fsync_failure_renames_our_bundle_back_to_partial(self):
        original = os.fsync
        parent_attempts = []
        def fail_first_parent_sync(fd):
            descriptor = os.fstat(fd)
            if (stat.S_ISDIR(descriptor.st_mode) and
                    descriptor.st_ino == self.output.stat().st_ino and
                    descriptor.st_dev == self.output.stat().st_dev):
                parent_attempts.append([p.name for p in self.output.iterdir()])
                if len(parent_attempts) == 1:
                    self.assertTrue(any(name.startswith('capture-') for name in parent_attempts[-1]))
                    raise OSError(errno.EIO, SECRET)
            return original(fd)
        with mock.patch.object(b.os, 'fsync', side_effect=fail_first_parent_sync):
            code, report = self.cli(['capture', '--output', str(self.output)])
        self.assertEqual(code, 1)
        self.assertEqual(report['reason'], 'FINALIZE_DURABILITY_UNCONFIRMED')
        self.assertEqual(len(parent_attempts), 2)
        self.assertTrue(all(name.endswith('.partial') for name in parent_attempts[-1]))
        self.assert_no_final()
        with self.assertRaisesRegex(b.Stop, 'PARTIAL_BUNDLE'):
            b.verify(next(self.output.iterdir()))

    def test_malicious_tar_paths_rejected_even_with_matching_payload_hashes(self):
        bundle = self.capture()
        for name in ('../escaped', '/absolute', 'root-000/../../escaped', 'root-000\\escaped'):
            with self.subTest(name=name):
                data = b'attack'
                (bundle / 'files.tar').write_bytes(tar_bytes([(name, data)]))
                (bundle / 'inventory.json').write_text(json.dumps({name: {
                    'type': 'file', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}}))
                self.manifest_hashes(bundle)
                with self.assertRaisesRegex(b.Stop, 'ARCHIVE_MEMBER_INVALID'):
                    b.verify(bundle)
        self.assertFalse((self.root / 'escaped').exists())

    def test_invalid_dump_magic_rejected_after_rehashed_manifest(self):
        bundle = self.capture()
        (bundle / 'database.dump').write_bytes(b'plain SQL is not a custom archive')
        self.manifest_hashes(bundle)
        with self.assertRaisesRegex(b.Stop, 'DUMP_FORMAT_INVALID'):
            b.verify(bundle)

    def test_invalid_image_envelope_rejected_after_rehashed_manifest(self):
        bundle = self.capture()
        config = IMAGE_ID[7:] + '.json'
        manifest = json.dumps([{'Config': config, 'Layers': ['layer.tar']}]).encode()
        cases = [('missing-manifest', [(config, IMAGE_CONFIG), ('layer.tar', IMAGE_LAYER)]),
                 ('missing-layer', [('manifest.json', manifest), (config, IMAGE_CONFIG)]),
                 ('wrong-config-hash', [('manifest.json', manifest), (config, b'{}'),
                                        ('layer.tar', IMAGE_LAYER)]),
                 ('symlink', [('manifest.json', manifest), (config, IMAGE_CONFIG),
                              ('layer.tar', b'', tarfile.SYMTYPE, '/outside')]),
                 ('escape', [('manifest.json', manifest), (config, IMAGE_CONFIG),
                             ('layer.tar', IMAGE_LAYER), ('../escaped', b'bad')])]
        for label, entries in cases:
            with self.subTest(label=label):
                (bundle / 'images.tar').write_bytes(tar_bytes(entries))
                self.manifest_hashes(bundle)
                with self.assertRaises(b.Stop):
                    b.verify(bundle)

    def test_archive_refuses_source_replaced_after_inventory(self):
        entries = b.inventory([self.storage])
        target = self.storage / 'object.bin'
        target.unlink()
        target.symlink_to(self.release / '.env')
        archive = self.root / 'partial.tar'
        with self.assertRaisesRegex(b.Stop, 'SOURCE_CHANGED|PATH_UNSAFE'):
            b.archive_roots(archive, entries)
        self.assertNotIn(SECRET.encode(), archive.read_bytes())


class ArchiveTests(unittest.TestCase):
    def test_duplicate_link_special_missing_and_wrong_hash_members(self):
        data = b'fixture'
        expected = {'root/file': {'type': 'file', 'bytes': len(data),
                                  'sha256': hashlib.sha256(data).hexdigest()}}
        cases = [([( 'root/file', data), ('root/file', data)], 'ARCHIVE_MEMBER_INVALID'),
                 ([('root/file', b'', tarfile.SYMTYPE, '/etc/passwd')], 'ARCHIVE_MEMBER_INVALID'),
                 ([('root/file', b'', tarfile.LNKTYPE, '../outside')], 'ARCHIVE_MEMBER_INVALID'),
                 ([('root/file', b'', tarfile.FIFOTYPE)], 'ARCHIVE_MEMBER_INVALID'),
                 ([], 'ARCHIVE_INCOMPLETE'),
                 ([('root/file', b'changed')], 'ARCHIVE_CONTENT_MISMATCH')]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'archive.tar'
            for entries, error in cases:
                with self.subTest(error=error, entries=entries):
                    path.write_bytes(tar_bytes(entries))
                    with self.assertRaisesRegex(b.Stop, error):
                        b.verify_tar(path, expected)


class DockerStreamTests(unittest.TestCase):
    """Exercise real pipes/process lifecycle; replace Docker with local Python."""
    def setUp(self):
        self.runner = object.__new__(b.LocalDocker)
        self.runner.binary = '/synthetic/docker-not-executed'
        self.processes = []
        self.commands = []
        self.original_popen = subprocess.Popen

    def python_child(self, source):
        def spawn(command, **kwargs):
            self.commands.append((command, kwargs))
            process = self.original_popen([sys.executable, '-c', source], **kwargs)
            self.processes.append(process)
            return process
        return mock.patch.object(b.subprocess, 'Popen', side_effect=spawn)

    def tearDown(self):
        for process in self.processes:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)

    def test_local_socket_pinned_remote_context_removed_and_clean_output(self):
        with self.python_child('import os; os.write(1,b"fixture")'), \
                mock.patch.dict(os.environ, {'DOCKER_HOST': 'tcp://private.invalid:2375',
                                             'DOCKER_CONTEXT': 'private-remote'}):
            self.assertEqual(self.runner(['ps', '-q']), b'fixture')
        command, kwargs = self.commands[0]
        self.assertEqual(command[:2], [self.runner.binary, '--host=unix:///var/run/docker.sock'])
        self.assertFalse(any(k.startswith('DOCKER_') for k in kwargs['env']))
        self.assertTrue(kwargs['start_new_session'])
        self.assertNotIn('shell', kwargs)

    def test_real_child_nonzero_warning_output_limit_and_timeout_are_not_success(self):
        cases = [('import sys; sys.stderr.write("' + SECRET + '"); sys.exit(7)',
                  'COMMAND_FAILED', 2, 1024),
                 ('import sys; sys.stderr.write("' + SECRET + '")', 'COMMAND_WARNINGS', 2, 1024),
                 ('import os; os.write(1,b"x"*2048)', 'COMMAND_OUTPUT_LIMIT', 2, 1024),
                 ('import os; os.write(2,b"x"*1100000)', 'COMMAND_ERROR_OUTPUT_LIMIT', 2, 1024),
                 ('import time; time.sleep(10)', 'COMMAND_TIMEOUT', 0.05, 1024)]
        for source, code, timeout, limit in cases:
            with self.subTest(code=code), self.python_child(source):
                with self.assertRaisesRegex(b.Stop, '^' + code + '$'):
                    self.runner(['synthetic'], timeout=timeout, limit=limit)
            self.assertIsNotNone(self.processes[-1].poll())

    def test_database_stderr_categories_reach_cli_without_private_text(self):
        args = b.db_command({'database_container': 'b' * 64}, 'psql',
                            ['-X', '-d', 'fixture_database', '-c', 'SELECT 1'], 15)
        cases = [
            ('psql: error: fe_sendauth: no password supplied', 2, 'DATABASE_PASSWORD_REQUIRED'),
            ('psql: error: FATAL: password authentication failed for user "postgres"',
             2, 'DATABASE_PASSWORD_REJECTED'),
            ('ERROR: 42501: permission denied for view pg_file_settings',
             3, 'DATABASE_METADATA_PERMISSION_DENIED'),
            ('ERROR: 42501: permission denied to examine "data_directory"',
             3, 'DATABASE_METADATA_PERMISSION_DENIED'),
            ('ERROR: permission denied for function pg_show_all_file_settings',
             3, 'DATABASE_METADATA_PERMISSION_DENIED'),
            ('OCI runtime exec failed: exec: "timeout": executable file not found in $PATH',
             127, 'DATABASE_TIMEOUT_UNAVAILABLE'),
            ("env: 'psql': No such file or directory", 127, 'DATABASE_CLIENT_UNAVAILABLE'),
            ('unrecognized failure', 1, 'COMMAND_FAILED'),
            ('неизвестная ошибка подключения', 2, 'COMMAND_FAILED'),
            ('', 124, 'COMMAND_TIMEOUT'),
        ]
        source = 'import os,sys; os.write(2,os.environ["BOS_SYNTHETIC_STDERR"].encode()); sys.exit(int(os.environ["BOS_SYNTHETIC_EXIT"]))'
        for message, status, expected in cases:
            with self.subTest(expected=expected, status=status):
                output = io.StringIO()
                before_umask = os.umask(0o077)
                try:
                    with self.python_child(source), \
                            mock.patch.dict(os.environ, {'BOS_SYNTHETIC_STDERR': message + '\n' + SECRET,
                                                         'BOS_SYNTHETIC_EXIT': str(status)}), \
                            mock.patch.object(b, 'LocalDocker', return_value=self.runner), \
                            mock.patch.object(b.discovery, 'discover', side_effect=lambda run: run(args)), \
                            contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                        code = b.main(['capture'])
                finally:
                    os.umask(before_umask)
                self.assertEqual(code, 1)
                report = json.loads(output.getvalue())
                self.assertEqual(report['reason'], expected)
                self.assertEqual(report['capture'], 'STOPPED')
                self.assertFalse(report['disaster_recovery_ready'])
                self.assertNotIn(SECRET, output.getvalue())
                self.assertNotIn(SECRET, str(self.commands[-1][0]))
                self.assertIsNotNone(self.processes[-1].poll())

    def test_ordinary_image_error_is_not_misclassified_as_database_error(self):
        source = 'import os; os.write(2,os.environ["BOS_SYNTHETIC_STDERR"].encode()); raise SystemExit(2)'
        with self.python_child(source), mock.patch.dict(os.environ, {
                'BOS_SYNTHETIC_STDERR': 'fe_sendauth: no password supplied\n' + SECRET}):
            with self.assertRaisesRegex(b.Stop, '^COMMAND_FAILED$'):
                self.runner(['image', 'save', IMAGE_ID])

    def test_stderr_classifier_receives_only_bounded_prefix(self):
        source = 'import os; os.write(2,os.environ["BOS_SYNTHETIC_STDERR"].encode()); raise SystemExit(2)'
        args = b.db_command({'database_container': 'b' * 64}, 'psql', ['-d', 'fixture_database'])
        message = 'x' * 8192 + 'fe_sendauth: no password supplied\n' + SECRET
        with self.python_child(source), mock.patch.dict(os.environ, {'BOS_SYNTHETIC_STDERR': message}), \
                mock.patch.object(b, 'command_failure', wraps=b.command_failure) as classify:
            with self.assertRaisesRegex(b.Stop, '^COMMAND_FAILED$'):
                self.runner(args)
        classify.assert_called_once()
        sample = classify.call_args.args[2]
        self.assertIsInstance(sample, bytes)
        self.assertLessEqual(len(sample), 8192)
        self.assertNotIn(SECRET.encode(), sample)

    def test_database_credentials_survive_only_in_environment_with_pinned_route(self):
        args = b.db_command({'database_container': 'b' * 64}, 'psql',
                            ['-X', '-d', 'fixture_database', '-c', 'SELECT 1'], 15)
        environment_args = args[args.index('env') + 1:args.index('psql')]
        self.assertNotIn('PGPASSWORD', environment_args)
        self.assertNotIn('PGPASSFILE', environment_args)
        self.assertNotIn('-e', args)
        self.assertIn('-w', args)
        for flag, value in [('-h', '/var/run/postgresql'), ('-p', '5432'),
                            ('-U', 'postgres'), ('-d', 'fixture_database')]:
            self.assertEqual(args[args.index(flag) + 1], value)
        for key in ('PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGHOST', 'PGPORT',
                    'PGDATABASE', 'PGUSER', 'PGOPTIONS'):
            self.assertIn(['-u', key], [environment_args[i:i + 2] for i in range(len(environment_args) - 1)])
        environment = dict(os.environ)
        environment.update(PGPASSWORD=SECRET, PGPASSFILE='/synthetic/private/passfile',
                           BOS_EXPECTED_PASSWORD=SECRET, BOS_EXPECTED_PASSFILE='/synthetic/private/passfile',
                           PGHOSTADDR='192.0.2.1', PGSERVICE='unwanted')
        probe = ('import json,os; print(json.dumps({'
                 '"password":os.environ.get("PGPASSWORD")==os.environ["BOS_EXPECTED_PASSWORD"],'
                 '"passfile":os.environ.get("PGPASSFILE")==os.environ["BOS_EXPECTED_PASSFILE"],'
                 '"redirect":any(k in os.environ for k in ("PGHOSTADDR","PGSERVICE"))}))')
        command = ['env', *environment_args, sys.executable, '-c', probe]
        result = subprocess.run(command, env=environment, capture_output=True, timeout=5, check=True)
        self.assertEqual(json.loads(result.stdout), {'password': True, 'passfile': True, 'redirect': False})
        self.assertNotIn(SECRET, str(args) + str(command))
        self.assertNotIn(SECRET.encode(), result.stdout + result.stderr)

    def test_streamed_private_file_checks_disk_space_before_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'partial.dump'
            with self.python_child('import os; os.write(1,b"PGDMP fixture")'), \
                    mock.patch.object(b.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=0)):
                with self.assertRaisesRegex(b.Stop, 'INSUFFICIENT_SPACE'):
                    self.runner.write(['synthetic'], path, timeout=2, limit=1024)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(path.stat().st_size, 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
