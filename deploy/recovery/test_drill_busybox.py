#!/usr/bin/env python3
"""Run actual copy/extraction helpers against BusyBox, using synthetic bytes.

The normal PostgreSQL fixture covers GNU tools. This separate fixture matches
the BusyBox 1.37 utility family observed in the operator's captured DB image.
It requires the same explicitly selected disposable CI Docker daemon.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
import unittest
import uuid

REQUIRE = '--require' in sys.argv
if REQUIRE:
    sys.argv.remove('--require')

import drill
import drill_db
from test_docker import DisposableDocker

BUSYBOX_IMAGE = 'docker.io/library/busybox:1.37.0'
SYNTHETIC_BYTES = b'BusyBox recovery fixture\x00\xff\n'


class BusyBoxHelpers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        socket_value = os.environ.get('BOS_RECOVERY_DOCKER_SOCKET', '')
        if os.environ.get('BOS_RECOVERY_DOCKER_TEST') != '1' or not socket_value:
            if REQUIRE:
                raise RuntimeError('BusyBox helper tests need the explicit disposable daemon')
            raise unittest.SkipTest('BusyBox helper tests require explicit disposable Docker')
        cls.temp = tempfile.TemporaryDirectory(prefix='bos-busybox-test-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name).resolve()
        cls.docker = DisposableDocker(socket_value, cls.root)
        cls.runner = drill.DockerRunner(host=cls.docker.host)
        version = json.loads(cls.docker.run(['version', '--format', '{{json .Server.Version}}']))
        if version != os.environ.get('BOS_RECOVERY_DOCKER_VERSION', '').removeprefix('v'):
            raise RuntimeError('BusyBox test Docker version differs from the selected matrix')
        cls.docker.inspect([BUSYBOX_IMAGE])  # Pre-pulled; the build has no network.
        cls.tag = 'bos-synthetic-busybox:' + uuid.uuid4().hex
        dockerfile = (f'FROM {BUSYBOX_IMAGE}\n'
                      'RUN addgroup -g 999 postgres && '
                      'adduser -D -u 999 -G postgres postgres\n').encode()
        context = io.BytesIO()
        with tarfile.open(fileobj=context, mode='w') as archive:
            item = tarfile.TarInfo('Dockerfile')
            item.size = len(dockerfile)
            archive.addfile(item, io.BytesIO(dockerfile))
        cls.addClassCleanup(cls.docker.run, ['image', 'rm', cls.tag], check=False)
        cls.docker.run(['build', '--network=none', '--tag', cls.tag, '-'],
                       data=context.getvalue(), timeout=120)
        cls.image = cls.docker.inspect([cls.tag])[0]
        if cls.image.get('Os') != 'linux' or cls.image.get('Architecture') != 'amd64':
            raise RuntimeError('BusyBox test requires Linux amd64')

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='bundle-', dir=self.root)
        self.addCleanup(self.directory.cleanup)
        self.bundle = Path(self.directory.name)
        (self.bundle / 'database.dump').write_bytes(b'PGDMP\x00synthetic-only\xff\n')
        self.globals = b'CREATE ROLE postgres;\nCREATE ROLE fixture;\n'
        (self.bundle / 'globals.sql').write_bytes(self.globals)
        self.inventory = {'root-000': {'type': 'directory', 'bytes': 0},
                          'root-000/fixture.bin': {'type': 'file', 'bytes': len(SYNTHETIC_BYTES),
                          'sha256': hashlib.sha256(SYNTHETIC_BYTES).hexdigest()}}
        with tarfile.open(self.bundle / 'files.tar', 'w') as archive:
            directory = tarfile.TarInfo('root-000')
            directory.type, directory.mode = tarfile.DIRTYPE, 0o755
            archive.addfile(directory)
            item = tarfile.TarInfo('root-000/fixture.bin')
            item.size, item.mode = len(SYNTHETIC_BYTES), 0o644
            archive.addfile(item, io.BytesIO(SYNTHETIC_BYTES))
        self.original = {p.name: p.read_bytes() for p in self.bundle.iterdir()}
        self.hashes = [hashlib.sha256(self.original[name]).hexdigest()
                       for name in ('database.dump', 'globals.sql', 'files.tar')]

    def run_init(self):
        run_id = 'bos-drill-' + uuid.uuid4().hex[:12]
        volume = drill.volume_create(self.runner, run_id)
        self.addCleanup(self.remove_volume, volume, run_id)
        args = drill_db._base_args(run_id + '-init', run_id, volume, self.image,
                                   helper=True, bundle_mount=str(self.bundle))
        identifier = self.runner([*args, self.image['Id'], '-ceu', drill_db.INIT_SCRIPT,
                                  'bos-drill-init', '1', *self.hashes,
                                  '0', str(len(b'CREATE ROLE postgres;')), 'postgres']).decode().strip()
        self.assertRegex(identifier, r'^[0-9a-f]{64}$')
        try:
            drill_db._inspect(self.runner, identifier, run_id, volume,
                              drill_db._tmpfs(self.image), helper=True, running=False)
            self.runner(['start', identifier])
            code = self.runner(['wait', identifier], timeout=30).strip()
        finally:
            drill_db._cleanup(self.runner, identifier, run_id)
        return code, run_id, volume

    def remove_volume(self, volume, run_id):
        metadata = json.loads(self.runner(['volume', 'inspect', volume]))[0]
        self.assertEqual(metadata['Labels'].get(drill.LABEL), run_id)
        self.runner(['volume', 'rm', volume])

    def test_legacy_checker_options_fail_on_real_busybox(self):
        # The expected digest is correct; this fails only because BusyBox does
        # not implement GNU --check/--status. No customer data is involved.
        script = ('printf "%s  %s\\n" "$1" /bundle/database.dump '
                  '| sha256sum --check --status')
        process = subprocess.run([
            self.docker.binary, '--host=' + self.docker.host, 'run', '--rm',
            '--network=none', '--read-only', '--cap-drop=ALL',
            '--security-opt=no-new-privileges',
            '--mount', 'type=bind,source=' + str(self.bundle) + ',target=/bundle,readonly',
            '--entrypoint', '/bin/sh', self.image['Id'], '-c', script, 'legacy', self.hashes[0]],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=self.docker.env, timeout=30)
        self.assertNotEqual(process.returncode, 0)
        self.assertIn(b'BusyBox v1.37.0', process.stderr)
        self.assertRegex(process.stderr, rb'(unrecognized|invalid) option')

    def test_actual_init_and_file_restore_preserve_bytes_with_busybox(self):
        code, run_id, volume = self.run_init()
        self.assertEqual(code, b'0')
        normalized = self.runner([
            'run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL',
            '--security-opt=no-new-privileges', '--user=postgres',
            '--mount', 'type=volume,source=' + volume + ',target=/bos,readonly',
            '--entrypoint', '/bin/cat', self.image['Id'], '/bos/input/globals-restore.sql'])
        self.assertEqual(normalized, self.globals[len(b'CREATE ROLE postgres;'):])
        result = drill.restore_files(self.runner, {
            'bundle': self.bundle, 'db_image': self.image['Id'],
            'db_image_meta': self.image, 'inventory': self.inventory}, run_id, volume)
        self.assertEqual(result['integrity'], 'VERIFIED')
        self.assertEqual(result['bytes'], len(SYNTHETIC_BYTES))
        self.assertEqual(result['files'], 1)
        modes = self.runner([
            'run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL',
            '--security-opt=no-new-privileges', '--user=postgres',
            '--mount', 'type=volume,source=' + volume + ',target=/bos,readonly',
            '--entrypoint', '/bin/stat', self.image['Id'], '-c', '%a',
            '/bos/files', '/bos/files/root-000', '/bos/files/root-000/fixture.bin'])
        self.assertEqual(modes.splitlines(), [b'700', b'700', b'600'])
        self.assertEqual({p.name: p.read_bytes() for p in self.bundle.iterdir()}, self.original)

    def test_changed_source_bytes_are_rejected_by_real_busybox(self):
        with (self.bundle / 'database.dump').open('ab') as stream:
            stream.write(b'changed-after-verification')
        code, _, _ = self.run_init()
        self.assertEqual(code, b'43')

    def test_group_only_file_mode_is_normalized_in_private_nested_copy(self):
        directories = ['root-000', 'root-000/nested']
        name = 'root-000/nested/fixture.bin'
        self.inventory = {name: {'type': 'file', 'bytes': len(SYNTHETIC_BYTES),
                                'sha256': hashlib.sha256(SYNTHETIC_BYTES).hexdigest()}}
        self.inventory.update({path: {'type': 'directory', 'bytes': 0} for path in directories})
        with tarfile.open(self.bundle / 'files.tar', 'w') as archive:
            for path in directories:
                member = tarfile.TarInfo(path)
                member.type, member.mode = tarfile.DIRTYPE, 0o700
                archive.addfile(member)
            member = tarfile.TarInfo(name)
            member.size, member.mode = len(SYNTHETIC_BYTES), 0o040
            archive.addfile(member, io.BytesIO(SYNTHETIC_BYTES))
        original = {p.name: p.read_bytes() for p in self.bundle.iterdir()}
        self.hashes = [hashlib.sha256(original[name]).hexdigest()
                       for name in ('database.dump', 'globals.sql', 'files.tar')]
        drill.file_mode_preflight({'bundle': self.bundle})
        code, run_id, volume = self.run_init()
        self.assertEqual(code, b'0')
        result = drill.restore_files(self.runner, {
            'bundle': self.bundle, 'db_image': self.image['Id'],
            'db_image_meta': self.image, 'inventory': self.inventory}, run_id, volume)
        self.assertEqual(result['integrity'], 'VERIFIED')
        self.assertEqual(result['files'], 1)
        modes = self.runner([
            'run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL',
            '--security-opt=no-new-privileges', '--user=postgres',
            '--mount', 'type=volume,source=' + volume + ',target=/bos,readonly',
            '--entrypoint', '/bin/stat', self.image['Id'], '-c', '%a',
            '/bos/files', *['/bos/files/' + path for path in directories],
            '/bos/files/' + name])
        self.assertEqual(modes.splitlines(), [b'700', b'700', b'700', b'600'])
        self.assertEqual({p.name: p.read_bytes() for p in self.bundle.iterdir()}, original)


if __name__ == '__main__':
    unittest.main(verbosity=2)
