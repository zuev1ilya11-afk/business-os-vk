"""Portable bundle checks and Linux-volume re-export verification, offline."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

import discovery
import drill_files as d


SECRET = 'PRIVATE_FIXTURE_SECRET_MUST_NOT_APPEAR'


def make_tar(entries):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w') as archive:
        for name, content, *options in entries:
            item = tarfile.TarInfo(name)
            item.mode = 0o700 if content is None else 0o600
            item.type = tarfile.DIRTYPE if content is None else tarfile.REGTYPE
            if options:
                item.type = options[0]
            if len(options) > 1:
                item.linkname = options[1]
            item.size = len(content) if item.isfile() and content is not None else 0
            archive.addfile(item, io.BytesIO(content) if item.size else None)
    return out.getvalue()


def image_fixture():
    layer = make_tar([('fixture', b'public synthetic image bytes')])
    diff_id = 'sha256:' + hashlib.sha256(layer).hexdigest()
    config = json.dumps({'architecture': 'amd64', 'os': 'linux',
                         'rootfs': {'type': 'layers', 'diff_ids': [diff_id]}}).encode()
    image_id = 'sha256:' + hashlib.sha256(config).hexdigest()
    manifest = json.dumps([{'Config': image_id[7:] + '.json',
                            'RepoTags': [], 'Layers': ['layer.tar']}]).encode()
    archive = make_tar([('manifest.json', manifest), (image_id[7:] + '.json', config),
                        ('layer.tar', layer)])
    return archive, {'Id': image_id, 'Size': len(archive), 'Os': 'linux',
                     'Architecture': 'amd64', 'RootFS': {'Type': 'layers', 'Layers': [diff_id]}}


class PortableBundleTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='bos-drill-files-')
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.bundle = self.base / 'bundle'
        self.bundle.mkdir()
        image_bytes, image_meta = image_fixture()
        self.entries = [('root-000', None), ('root-000/empty', None),
                        ('root-000/object.bin', b'\x00fixture storage bytes\xff')]
        self.inventory = {}
        for name, content in self.entries:
            self.inventory[name] = ({'type': 'directory', 'bytes': 0} if content is None else
                                    {'type': 'file', 'bytes': len(content),
                                     'sha256': hashlib.sha256(content).hexdigest()})
        containers = []
        for index, role in enumerate(discovery.ROLES, 1):
            containers.append({'Name': '/' + discovery.PREFIX + '-' + role,
                'Id': f'{index:064x}', 'Image': image_meta['Id'],
                'Config': {'Env': ['PRIVATE_VALUE=' + SECRET]}, 'Mounts': []})
        self.storage = next(c for c in containers if c['Name'].endswith('-storage'))
        self.storage['Config']['Env'] += ['STORAGE_BACKEND=file',
                                         'FILE_STORAGE_BACKEND_PATH=/var/lib/storage']
        self.storage['Mounts'] = [{'Type': 'bind', 'Source': '/fixture/storage',
                                   'Destination': '/var/lib/storage'}]
        self.private = {'containers': containers, 'database': {
            'database': discovery.DATABASE, 'version': 170011, 'bytes': 2048,
            'extensions': [['plpgsql', '1.0']]}, 'database_user': 'supabase_admin',
            'images': [image_meta], 'roots': ['/fixture/storage'], 'contains_secrets': True}
        (self.bundle / 'images.tar').write_bytes(image_bytes)
        (self.bundle / 'files.tar').write_bytes(make_tar(self.entries))
        (self.bundle / 'database.dump').write_bytes(b'PGDMP synthetic fixture')
        (self.bundle / 'globals.sql').write_text('-- ' + SECRET)
        self.persist()

    def persist(self):
        (self.bundle / 'private-config.json').write_text(json.dumps(self.private))
        (self.bundle / 'inventory.json').write_text(json.dumps(self.inventory))
        self.manifest = {'format': 1, 'capture': 'COMPLETE', 'build': discovery.BUILD,
            'payloads': {name: {'bytes': (self.bundle / name).stat().st_size,
                'sha256': hashlib.sha256((self.bundle / name).read_bytes()).hexdigest()}
                for name in d.PAYLOADS}}
        (self.bundle / 'manifest.json').write_text(json.dumps(self.manifest))

    def fails(self, code=None):
        with self.assertRaises(d.Stop) as raised:
            d.validate_bundle(self.bundle)
        if code:
            self.assertEqual(raised.exception.reason_code, code)
        self.assertNotIn(SECRET, str(raised.exception))

    def test_valid_bundle_is_read_only_and_does_not_claim_object_layout(self):
        before = {p.name: p.read_bytes() for p in self.bundle.iterdir()}
        result = d.validate_bundle(self.bundle)
        self.assertEqual(result['storage_archive_prefix'], 'root-000')
        self.assertEqual(result['archive_roots'], ['root-000'])
        self.assertEqual(result['db_image'], self.private['images'][0]['Id'])
        self.assertEqual(result['storage_layout_status'],
                         'ARCHIVE_ROOT_VERIFIED_OBJECT_LAYOUT_UNVERIFIED')
        self.assertEqual({p.name: p.read_bytes() for p in self.bundle.iterdir()}, before)

    def test_windows_copy_modes_are_not_unix_private_mode_requirements(self):
        self.bundle.chmod(0o755)
        for path in self.bundle.iterdir():
            path.chmod(0o644)
        self.assertEqual(d.validate_bundle(self.bundle)['file_count'], 1)

    def test_payload_change_is_rejected(self):
        with (self.bundle / 'database.dump').open('ab') as output:
            output.write(b'changed')
        self.fails('PAYLOAD_HASH_MISMATCH')

    def test_exact_files_missing_or_extra(self):
        (self.bundle / 'extra.log').write_text(SECRET)
        self.fails('BUNDLE_CONTENTS_INVALID')
        (self.bundle / 'extra.log').unlink()
        (self.bundle / 'database.dump').unlink()
        self.fails('BUNDLE_CONTENTS_INVALID')

    def test_duplicate_json_keys_rejected(self):
        (self.bundle / 'manifest.json').write_text('{"format":1,"format":1}')
        self.fails('BUNDLE_JSON_INVALID')

    def test_build_and_boolean_format_rejected(self):
        for key, value in [('build', 'different'), ('format', True)]:
            changed = dict(self.manifest, **{key: value})
            (self.bundle / 'manifest.json').write_text(json.dumps(changed))
            self.fails('MANIFEST_INVALID')

    def test_payload_hash_metadata_shape_rejected(self):
        self.manifest['payloads']['files.tar']['sha256'] = SECRET
        (self.bundle / 'manifest.json').write_text(json.dumps(self.manifest))
        self.fails('MANIFEST_INVALID')

    def test_symlink_payload_rejected(self):
        saved = self.base / 'saved'
        (self.bundle / 'database.dump').replace(saved)
        try:
            (self.bundle / 'database.dump').symlink_to(saved)
        except OSError:
            self.skipTest('symlinks unavailable on this host')
        self.fails('BUNDLE_LINK_UNSUPPORTED')

    def test_hardlinked_payload_rejected(self):
        try:
            os.link(self.bundle / 'database.dump', self.base / 'linked')
        except OSError:
            self.skipTest('hardlinks unavailable on this host')
        self.fails('BUNDLE_HARDLINK_UNSUPPORTED')

    def test_windows_reparse_bit_detected(self):
        self.assertTrue(d._reparse(types.SimpleNamespace(st_file_attributes=0x410)))
        self.assertFalse(d._reparse(types.SimpleNamespace(st_file_attributes=0x20)))

    def test_source_paths_are_linux_lexical_and_cannot_traverse(self):
        for source in ['/fixture/../storage', '/fixture/storage/', r'C:\\data', '/', '//host/path']:
            self.private['roots'] = [source]
            self.persist()
            self.fails('SOURCE_PATH_INVALID')

    def test_containing_archive_root_and_storage_subdirectory(self):
        self.private['roots'] = ['/fixture']
        self.inventory = {'root-000': {'type': 'directory', 'bytes': 0},
            'root-000/storage': {'type': 'directory', 'bytes': 0}}
        (self.bundle / 'files.tar').write_bytes(make_tar([(x, None) for x in self.inventory]))
        self.persist()
        self.assertEqual(d.validate_bundle(self.bundle)['storage_archive_prefix'], 'root-000/storage')

    def test_subdirectory_of_storage_mount(self):
        self.storage['Config']['Env'][-1] = 'FILE_STORAGE_BACKEND_PATH=/var/lib/storage/inner'
        self.inventory['root-000/inner'] = {'type': 'directory', 'bytes': 0}
        (self.bundle / 'files.tar').write_bytes(make_tar(self.entries + [('root-000/inner', None)]))
        self.persist()
        self.assertEqual(d.validate_bundle(self.bundle)['storage_archive_prefix'], 'root-000/inner')

    def test_ambiguous_storage_mount_rejected(self):
        self.storage['Mounts'].append(copy.deepcopy(self.storage['Mounts'][0]))
        self.persist()
        self.fails('STORAGE_MOUNT_NOT_UNIQUE')

    def test_storage_directory_missing_rejected(self):
        self.storage['Config']['Env'][-1] = 'FILE_STORAGE_BACKEND_PATH=/var/lib/storage/absent'
        self.persist()
        self.fails('STORAGE_ARCHIVE_DIRECTORY_MISSING')

    def test_storage_backend_and_duplicate_environment_rejected(self):
        self.storage['Config']['Env'][1] = 'STORAGE_BACKEND=s3'
        self.persist()
        self.fails('STORAGE_BACKEND_UNSUPPORTED')
        self.storage['Config']['Env'][1] = 'STORAGE_BACKEND=file'
        self.storage['Config']['Env'].append('STORAGE_BACKEND=file')
        self.persist()
        self.fails('CONTAINER_CONFIG_INVALID')

    def test_exact_saved_containers_rejected(self):
        self.private['containers'].append(copy.deepcopy(self.private['containers'][0]))
        self.persist()
        self.fails('CONTAINER_SET_INVALID')

    def test_duplicate_container_id_rejected(self):
        self.private['containers'][1]['Id'] = self.private['containers'][0]['Id']
        self.persist()
        self.fails('CONTAINER_SET_INVALID')

    def test_unknown_database_and_major_rejected(self):
        self.private['database']['database'] = 'other'
        self.persist()
        self.fails('DATABASE_METADATA_INVALID')
        self.private['database']['database'] = discovery.DATABASE
        self.private['database']['version'] = 160001
        self.persist()
        self.fails('DATABASE_METADATA_INVALID')

    def test_inventory_parent_and_path_rejected(self):
        self.inventory['root-000/object.bin/child'] = {'type': 'directory', 'bytes': 0}
        self.persist()
        self.fails('INVENTORY_PARENT_INVALID')
        self.inventory.pop('root-000/object.bin/child')
        self.inventory['root-000/../outside'] = {'type': 'directory', 'bytes': 0}
        self.persist()
        self.fails('INVENTORY_PATH_INVALID')

    def test_bad_tar_link_even_if_payload_hash_updated(self):
        (self.bundle / 'files.tar').write_bytes(make_tar(
            [('root-000', None), ('root-000/empty', None),
             ('root-000/object.bin', b'', tarfile.SYMTYPE, '/outside')]))
        self.persist()
        self.fails('ARCHIVE_MEMBER_INVALID')

    def test_bad_image_even_if_payload_hash_updated(self):
        (self.bundle / 'images.tar').write_bytes(make_tar([('bad', b'bad')]))
        self.persist()
        self.fails()

    def test_case_distinct_filenames_are_kept_for_linux_volume(self):
        self.entries += [('root-000/Case', b'one'), ('root-000/case', b'two')]
        for name, content in self.entries[-2:]:
            self.inventory[name] = {'type': 'file', 'bytes': len(content),
                                    'sha256': hashlib.sha256(content).hexdigest()}
        (self.bundle / 'files.tar').write_bytes(make_tar(self.entries))
        self.persist()
        self.assertEqual(d.validate_bundle(self.bundle)['file_count'], 3)


class ReexportTests(unittest.TestCase):
    def setUp(self):
        self.entries = [('root-000', None), ('root-000/sub', None),
                        ('root-000/sub/data', b'\x00private fixture\xff')]
        self.inventory = {name: ({'type': 'directory', 'bytes': 0} if content is None else
            {'type': 'file', 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
            for name, content in self.entries}

    def check(self, entries):
        return d.verify_reexport(io.BytesIO(make_tar(entries)), self.inventory)

    def test_stream_reexport_with_single_dot_prefix(self):
        result = self.check([('./', None), *[('./' + n, c) for n, c in self.entries]])
        self.assertEqual(result['files'], 1)
        self.assertEqual(result['directories'], 2)
        self.assertEqual(result['integrity'], 'VERIFIED')
        self.assertEqual(result['filesystem_metadata'], 'NOT_PROVEN')

    def test_path_reexport(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'export.tar'
            path.write_bytes(make_tar(self.entries))
            self.assertEqual(d.verify_reexport(path, self.inventory)['files'], 1)

    def test_missing_and_duplicate_members_rejected(self):
        for entries in [self.entries[:-1], self.entries + [self.entries[-1]]]:
            with self.assertRaises(d.Stop):
                self.check(entries)

    def test_path_traversal_and_double_dot_prefix_rejected(self):
        for name in ['../root-000', '/root-000', '././root-000', 'root-000/../out']:
            with self.assertRaises(d.Stop):
                self.check([(name, None), *self.entries])

    def test_changed_bytes_and_links_rejected(self):
        for entry in [('root-000/sub/data', b'changed'),
                      ('root-000/sub/data', b'', tarfile.LNKTYPE, 'root-000')]:
            with self.assertRaises(d.Stop):
                self.check([*self.entries[:-1], entry])

    def test_directory_file_confusion_rejected(self):
        with self.assertRaises(d.Stop):
            self.check([('root-000', b''), *self.entries[1:]])


if __name__ == '__main__':
    unittest.main()
