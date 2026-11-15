#!/usr/bin/env python3
"""Opt-in export compatibility against an explicitly selected disposable daemon.

CI supplies BOS_RECOVERY_DOCKER_TEST=1, BOS_RECOVERY_DOCKER_SOCKET,
BOS_RECOVERY_DOCKER_STORE (classic/containerd), and BOS_RECOVERY_DOCKER_VERSION.
The fixed public postgres:17.6 image must already be pulled. The only image this
test creates/removes is its uniquely tagged synthetic rootfs import. No container
is started, archive loaded, production image selected, or remote daemon used.
"""
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
import uuid

import backup


REQUIRE = '--require' in sys.argv
if REQUIRE:
    sys.argv.remove('--require')
PUBLIC_IMAGE = 'docker.io/library/postgres:17.6'
MIB = 1024 * 1024


class DisposableDocker:
    def __init__(self, socket_value, directory):
        self.binary = shutil.which('docker')
        if not self.binary:
            raise RuntimeError('Docker CLI is unavailable')
        path = socket_value.removeprefix('unix://')
        if not path.startswith('/') or '..' in Path(path).parts:
            raise RuntimeError('An explicit local Unix socket is required')
        if not stat.S_ISSOCK(Path(path).stat().st_mode):
            raise RuntimeError('The selected Docker endpoint is not a Unix socket')
        self.host = 'unix://' + path
        self.env = {k: v for k, v in os.environ.items() if not k.startswith('DOCKER_')}
        config = directory / 'docker-config'
        config.mkdir(mode=0o700)
        self.env['DOCKER_CONFIG'] = str(config)

    def run(self, args, *, data=None, timeout=60, check=True):
        result = subprocess.run([self.binary, '--host=' + self.host, *args],
                                input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=self.env, timeout=timeout)
        if check and result.returncode:
            # No full inspect/config, raw stderr, or image contents in CI logs.
            raise RuntimeError('Docker fixture command failed: ' + ' '.join(args[:2]))
        if len(result.stdout) > 16 * MIB or len(result.stderr) > MIB:
            raise RuntimeError('Docker fixture command output exceeded its limit')
        return result.stdout

    def inspect(self, references):
        images = json.loads(self.run(['image', 'inspect', *references]))
        if not isinstance(images, list) or len(images) != len(references):
            raise RuntimeError('Unexpected image inspect response')
        for image in images:
            if not re.fullmatch(r'sha256:[0-9a-f]{64}', image.get('Id', '')):
                raise RuntimeError('Unexpected image ID')
        return images

    def save(self, path, images):
        ids = sorted({image['Id'] for image in images})
        limit = sum(image['Size'] for image in images) * 2 + 128 * MIB
        if shutil.disk_usage(path.parent).free < limit + 512 * MIB:
            raise RuntimeError('Insufficient space for public fixture export')
        # Export exactly by inspect IDs, as capture() does. Do not substitute
        # config digests or constrain --platform to make an archive pass.
        with backup.exclusive(path) as output:
            result = subprocess.run([self.binary, '--host=' + self.host, 'image', 'save', *ids],
                                    stdin=subprocess.DEVNULL, stdout=output,
                                    stderr=subprocess.PIPE, env=self.env, timeout=180)
        if result.returncode:
            raise RuntimeError('Docker fixture image save failed')
        if path.stat().st_size > limit:
            raise RuntimeError('Docker fixture archive exceeded its limit')


def archive_summary(path, images):
    """Only public digests, sizes and envelope structure; no config contents."""
    listing, index, members = None, None, 0
    with tarfile.open(path, 'r|') as archive:
        for entry in archive:
            members += 1
            if entry.name in ('manifest.json', 'index.json'):
                if not entry.isfile() or entry.size > 16 * MIB:
                    raise AssertionError('Invalid Docker archive metadata')
                value = json.loads(archive.extractfile(entry).read())
                if entry.name == 'manifest.json':
                    listing = value
                else:
                    index = value
    records = listing if isinstance(listing, list) else []
    return {'bytes': path.stat().st_size, 'members': members,
            'inspect_ids': [image['Id'] for image in images],
            'docker_manifest_entries': len(records),
            'config_paths': [item.get('Config') for item in records[:8]],
            'layers_per_image': [len(item.get('Layers', [])) for item in records[:8]],
            'oci_index': isinstance(index, dict),
            'oci_targets': [item.get('digest') for item in (index or {}).get('manifests', [])[:8]]}


class DockerExportIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        enabled = os.environ.get('BOS_RECOVERY_DOCKER_TEST') == '1'
        socket_value = os.environ.get('BOS_RECOVERY_DOCKER_SOCKET', '')
        if not enabled or not socket_value:
            reason = 'Docker export tests require an explicitly selected disposable daemon'
            if REQUIRE:
                raise RuntimeError(reason)
            raise unittest.SkipTest(reason)
        cls.temp = tempfile.TemporaryDirectory(prefix='bos-docker-export-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name).resolve()
        cls.docker = DisposableDocker(socket_value, cls.root)
        version = json.loads(cls.docker.run(['version', '--format', '{{json .Server.Version}}']))
        driver_status = json.loads(cls.docker.run(['info', '--format', '{{json .DriverStatus}}']))
        containerd = any(row == ['driver-type', 'io.containerd.snapshotter.v1']
                         for row in (driver_status or []))
        cls.store = 'containerd' if containerd else 'classic'
        expected_store = os.environ.get('BOS_RECOVERY_DOCKER_STORE')
        if expected_store not in ('classic', 'containerd') or cls.store != expected_store:
            raise RuntimeError('Docker image store does not match the requested matrix case')
        if version != os.environ.get('BOS_RECOVERY_DOCKER_VERSION', '').removeprefix('v'):
            raise RuntimeError('Docker version does not match the pinned matrix case')
        print('\nDocker export environment: ' + json.dumps({'version': version, 'store': cls.store}), flush=True)
        cls.public = cls.docker.inspect([PUBLIC_IMAGE])[0]
        # Create a real tiny image without Buildx, base pulls, or executable RUN
        # instructions. Its contents are synthetic and it is never started.
        cls.fixture_tag = 'bos-recovery-export-fixture:' + uuid.uuid4().hex
        cls.addClassCleanup(cls.docker.run, ['image', 'rm', cls.fixture_tag], check=False)
        rootfs = io.BytesIO()
        with tarfile.open(fileobj=rootfs, mode='w') as archive:
            content = b'Synthetic export fixture; no application or production data.\n'
            entry = tarfile.TarInfo('FIXTURE_ONLY.txt')
            entry.size, entry.mode = len(content), 0o644
            archive.addfile(entry, io.BytesIO(content))
        cls.docker.run(['image', 'import', '--change',
                        'LABEL org.business-os.recovery.fixture=synthetic', '-', cls.fixture_tag],
                       data=rootfs.getvalue())
        cls.fixture = cls.docker.inspect([cls.fixture_tag])[0]

    def verify_export(self, name, images):
        path = self.root / (name + '.tar')
        ids = [image['Id'] for image in images]
        # Inspect each actual ID again; preserve this real metadata as the third
        # API argument, including RootFS and platform information when present.
        expected_images = self.docker.inspect(ids)
        self.assertEqual([image['Id'] for image in expected_images], ids)
        self.docker.save(path, expected_images)
        print('Docker export envelope: ' + json.dumps(
            {'case': name, 'store': self.store, **archive_summary(path, expected_images)},
            sort_keys=True), flush=True)
        backup.verify_images(path, ids, expected_images)
        return path, expected_images

    def test_public_postgres_export_uses_actual_inspect_ids(self):
        path, metadata = self.verify_export('postgres', [self.public])
        wrong_id = 'sha256:' + ('0' * 64)
        self.assertNotEqual(metadata[0]['Id'], wrong_id)
        with self.assertRaises(backup.Stop):
            backup.verify_images(path, [wrong_id], metadata)

    def test_synthetic_and_combined_exports_use_actual_inspect_ids(self):
        self.verify_export('synthetic', [self.fixture])
        self.verify_export('combined', [self.public, self.fixture])


if __name__ == '__main__':
    unittest.main(verbosity=2)
