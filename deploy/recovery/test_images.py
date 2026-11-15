"""Offline Docker/OCI save fixtures; no daemon, extraction, or registry access."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import types
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import image_archive as images


CONFIG = 'application/vnd.oci.image.config.v1+json'
MANIFEST = 'application/vnd.oci.image.manifest.v1+json'
INDEX = 'application/vnd.oci.image.index.v1+json'
LAYER = 'application/vnd.oci.image.layer.v1.tar'


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def digest(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def blob_path(value):
    return 'blobs/sha256/' + value.split(':')[1]


def tar_bytes(entries):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        for name, data in entries:
            item = tarfile.TarInfo(name)
            item.size, item.mode = len(data), 0o600
            archive.addfile(item, io.BytesIO(data))
    return stream.getvalue()


def fixture(kind='manifest', *, platform=('linux', 'amd64', ''), compressed=False,
            missing_other=False, config_change=None, manifest_change=None, index_change=None,
            docker_types=False, layer_count=2):
    """Hash every object independently; mutations happen before parent hashing."""
    os_name, architecture, variant = platform
    raw_layers = [tar_bytes([(f'fixture-{n}.txt', f'layer {n}'.encode())]) for n in range(layer_count)]
    diff_ids = [digest(data) for data in raw_layers]
    layers = [gzip.compress(data, mtime=0) if compressed else data for data in raw_layers]
    config = {'os': os_name, 'architecture': architecture,
              'rootfs': {'type': 'layers', 'diff_ids': diff_ids}}
    if variant:
        config['variant'] = variant
    if config_change:
        config_change(config)
    config_data = encoded(config)
    config_id = digest(config_data)
    inspected = {'Id': config_id, 'Os': os_name, 'Architecture': architecture,
                 'RootFS': {'Type': 'layers', 'Layers': diff_ids}}
    if variant:
        inspected['Variant'] = variant
    if kind == 'classic':
        config_name = config_id[7:] + '.json'
        layer_names = [f'layer-{n}/layer.tar' for n in range(len(layers))]
        entries = {config_name: config_data, **dict(zip(layer_names, layers))}
        root_id = config_id
        manifest_name = None
    else:
        config_type = 'application/vnd.docker.container.image.v1+json' if docker_types else CONFIG
        manifest_type = 'application/vnd.docker.distribution.manifest.v2+json' if docker_types else MANIFEST
        index_type = 'application/vnd.docker.distribution.manifest.list.v2+json' if docker_types else INDEX
        layer_type = 'application/vnd.docker.image.rootfs.diff.tar' if docker_types else LAYER
        def descriptor(data, media_type):
            return {'mediaType': media_type, 'digest': digest(data), 'size': len(data)}
        config_name = blob_path(config_id)
        layer_names = [blob_path(digest(data)) for data in layers]
        entries = {config_name: config_data, **dict(zip(layer_names, layers))}
        manifest = {'schemaVersion': 2, 'mediaType': manifest_type,
                    'config': descriptor(config_data, config_type),
                    'layers': [descriptor(data, layer_type + ('.gzip' if docker_types else '+gzip')
                                          if compressed else layer_type) for data in layers]}
        if manifest_change:
            manifest_change(manifest)
        manifest_data = encoded(manifest)
        manifest_name = blob_path(digest(manifest_data))
        entries[manifest_name] = manifest_data
        selected = descriptor(manifest_data, manifest_type)
        selected['platform'] = {'os': os_name, 'architecture': architecture}
        if variant:
            selected['platform']['variant'] = variant
        root = selected
        if kind == 'index':
            children = [selected]
            if missing_other:
                other = descriptor(b'absent unrelated platform manifest', manifest_type)
                other['platform'] = {'os': 'linux', 'architecture': 'arm64', 'variant': 'v8'}
                children.append(other)
            index = {'schemaVersion': 2, 'mediaType': index_type, 'manifests': children}
            if index_change:
                index_change(index)
            index_data = encoded(index)
            entries[blob_path(digest(index_data))] = index_data
            root = descriptor(index_data, index_type)
        root_id = root['digest']
        entries['oci-layout'] = encoded({'imageLayoutVersion': '1.0.0'})
        entries['index.json'] = encoded({'schemaVersion': 2, 'manifests': [root]})
    entries['manifest.json'] = encoded([{'Config': config_name, 'Layers': layer_names,
                                         'RepoTags': ['synthetic/recovery:fixture']}])
    inspected['Id'] = root_id
    return types.SimpleNamespace(entries=entries, expected=root_id, inspect=inspected,
                                 config=config_name, layers=layer_names, manifest=manifest_name)


class ImageArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='bos-image-archive-test-')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'images.tar'

    def verify(self, data, *, metadata=True, entries=None, expected=None):
        self.path.write_bytes(tar_bytes(list(data.entries.items()) if entries is None else entries))
        return images.verify_images(self.path, [expected or data.expected],
                                    [data.inspect] if metadata else None)

    def rejected(self, data, **kwargs):
        with self.assertRaises(images.ImageArchiveError) as caught:
            self.verify(data, **kwargs)
        self.assertRegex(caught.exception.reason_code, r'^IMAGE_[A-Z_]+$')
        self.assertEqual(str(caught.exception), caught.exception.reason_code)

    def test_classic_config_identity_with_and_without_inspect_metadata(self):
        data = fixture('classic')
        self.verify(data)
        self.verify(data, metadata=False)

    def test_containerd_manifest_identity_does_not_need_config_id_equality(self):
        data = fixture()
        self.assertNotEqual(data.expected, digest(data.entries[data.config]))
        self.verify(data)

    def test_containerd_index_identity_selects_complete_inspected_platform(self):
        data = fixture('index', missing_other=True)
        self.assertNotEqual(data.expected, digest(data.entries[data.config]))
        self.assertNotEqual(data.expected, digest(data.entries[data.manifest]))
        self.verify(data)

    def test_arm_variant_is_matched(self):
        data = fixture('index', platform=('linux', 'arm', 'v7'))
        self.verify(data)
        data.inspect['Variant'] = 'v6'
        self.rejected(data)

    def test_gzip_blob_digest_and_uncompressed_diff_id_are_distinct(self):
        data = fixture('index', compressed=True)
        self.assertNotEqual(digest(data.entries[data.layers[0]]), data.inspect['RootFS']['Layers'][0])
        self.verify(data)

    def test_docker_v2_manifest_and_manifest_list_aliases(self):
        self.verify(fixture('manifest', docker_types=True, compressed=True))
        self.verify(fixture('index', docker_types=True, compressed=True, missing_other=True))

    def test_scratch_image_has_consistent_empty_layers(self):
        for kind in ('classic', 'manifest', 'index'):
            with self.subTest(kind=kind):
                self.verify(fixture(kind, layer_count=0))

    def test_index_without_platform_metadata_fails_closed(self):
        self.rejected(fixture('index', missing_other=True), metadata=False)

    def test_missing_selected_manifest_config_or_layer_is_rejected(self):
        for part in ('manifest', 'config', 'layer'):
            with self.subTest(part=part):
                data = fixture('index', missing_other=True)
                path = data.layers[0] if part == 'layer' else getattr(data, part)
                del data.entries[path]
                self.rejected(data)

    def test_present_but_corrupt_selected_content_is_rejected(self):
        for part in ('root', 'manifest', 'config', 'layer'):
            with self.subTest(part=part):
                data = fixture('index')
                path = (blob_path(data.expected) if part == 'root' else
                        data.layers[0] if part == 'layer' else getattr(data, part))
                data.entries[path] += b' '
                self.rejected(data)

    def test_selected_descriptor_sizes_are_verified(self):
        for part in ('manifest', 'config', 'layer'):
            for delta in (-1, 1):
                with self.subTest(part=part, delta=delta):
                    if part == 'manifest':
                        def change(index):
                            index['manifests'][0]['size'] += delta
                        data = fixture('index', index_change=change)
                    else:
                        def change(manifest):
                            descriptor = manifest['config'] if part == 'config' else manifest['layers'][0]
                            descriptor['size'] += delta
                        data = fixture('index', manifest_change=change)
                    self.rejected(data)

    def test_descriptor_hash_cannot_be_satisfied_by_a_different_blob(self):
        for part in ('config', 'layer'):
            with self.subTest(part=part):
                def change(manifest):
                    descriptor = manifest['config'] if part == 'config' else manifest['layers'][0]
                    descriptor['digest'] = 'sha256:' + '0' * 64
                data = fixture('index', manifest_change=change)
                original = data.config if part == 'config' else data.layers[0]
                data.entries[blob_path('sha256:' + '0' * 64)] = data.entries[original]
                self.rejected(data)

    def test_matching_config_in_unrelated_blob_does_not_prove_expected_identity(self):
        data = fixture('index')
        arbitrary = encoded({'unrelated': 'not an image manifest or index'})
        arbitrary_id = digest(arbitrary)
        data.entries[blob_path(arbitrary_id)] = arbitrary
        data.inspect['Id'] = arbitrary_id
        self.rejected(data, expected=arbitrary_id)

    def test_valid_image_blob_must_be_exported_by_the_archive_root(self):
        for kind in ('manifest', 'index'):
            with self.subTest(kind=kind):
                data = fixture(kind)
                unrelated = fixture('index', platform=('linux', 'arm64', 'v8'))
                data.entries.update({name: value for name, value in unrelated.entries.items()
                                     if name.startswith('blobs/') or name == 'index.json'})
                self.rejected(data)

    def test_top_level_root_descriptor_size_and_layout_version_are_verified(self):
        for failure in ('short', 'long', 'missing-index', 'missing-layout', 'layout-version'):
            with self.subTest(failure=failure):
                data = fixture('index')
                if failure in ('short', 'long'):
                    index = json.loads(data.entries['index.json'])
                    index['manifests'][0]['size'] += -1 if failure == 'short' else 1
                    data.entries['index.json'] = encoded(index)
                elif failure == 'layout-version':
                    data.entries['oci-layout'] = encoded({'imageLayoutVersion': '99.0.0'})
                else:
                    del data.entries['index.json' if failure == 'missing-index' else 'oci-layout']
                self.rejected(data)

    def test_only_nonselected_platform_cannot_satisfy_expected_index(self):
        data = fixture('index', missing_other=True)
        del data.entries[data.manifest]
        other = fixture(platform=('linux', 'arm64', 'v8'))
        data.entries.update({name: value for name, value in other.entries.items() if name.startswith('blobs/')})
        self.rejected(data)

    def test_inspect_os_architecture_and_ordered_rootfs_must_match(self):
        cases = [('Os', 'windows'), ('Architecture', 'arm64'),
                 ('RootFS', {'Type': 'layers', 'Layers': ['sha256:' + '0' * 64]}),
                 ('RootFS', {'Type': 'layers', 'Layers': []})]
        for key, value in cases:
            with self.subTest(key=key, value=value):
                data = fixture('index')
                data.inspect[key] = value
                self.rejected(data)
        data = fixture('index')
        data.inspect['RootFS']['Layers'] = list(reversed(data.inspect['RootFS']['Layers']))
        self.rejected(data)

    def test_manifest_platform_claim_does_not_override_config_platform(self):
        data = fixture('index', config_change=lambda config: config.update(architecture='arm64'))
        self.rejected(data)

    def test_layer_content_must_match_config_diff_ids_even_when_descriptors_are_valid(self):
        data = fixture('index', config_change=lambda config: config['rootfs'].update(
            diff_ids=['sha256:' + '0' * 64, 'sha256:' + '1' * 64]))
        data.inspect['RootFS']['Layers'] = ['sha256:' + '0' * 64, 'sha256:' + '1' * 64]
        self.rejected(data)

    def test_classic_layer_bytes_are_checked_against_config_diff_ids(self):
        data = fixture('classic')
        data.entries[data.layers[0]] += b'corrupt'
        self.rejected(data)

    def test_duplicate_or_unsafe_archive_paths_are_rejected(self):
        for name in ('manifest.json', '../outside', '/absolute', 'blobs/../outside', 'bad\\path'):
            with self.subTest(name=name):
                data = fixture('index')
                entries = [*data.entries.items(), (name, b'unsafe fixture')]
                self.rejected(data, entries=entries)
        self.assertEqual(set(Path(self.temp.name).iterdir()), {self.path})

    def test_verification_never_extracts_or_loads_an_archive(self):
        with mock.patch.object(tarfile.TarFile, 'extract', side_effect=AssertionError('extraction forbidden')), \
                mock.patch.object(tarfile.TarFile, 'extractall', side_effect=AssertionError('extraction forbidden')):
            self.verify(fixture('index', missing_other=True))
        self.assertEqual(set(Path(self.temp.name).iterdir()), {self.path})


if __name__ == '__main__':
    unittest.main(verbosity=2)
