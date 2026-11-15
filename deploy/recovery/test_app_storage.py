"""Synthetic path and response checks; no Docker, network or private fixtures."""
import copy
import hashlib
import json
from pathlib import PurePosixPath
import unittest

import app_storage as s


PRIVATE = 'PRIVATE_OBJECT_MUST_NEVER_APPEAR'


def fixture(*, name='folder/' + PRIVATE + '.pdf', version='version-1', separator='/'):
    content = b'%PDF synthetic attachment\x00\xff'
    env = ['STORAGE_BACKEND=file', 'GLOBAL_S3_BUCKET=internal', 'TENANT_ID=tenant']
    if separator == '-$v-':
        env.append('TUS_USE_FILE_VERSION_SEPARATOR=true')
    path = 'root-001/storage/internal/tenant/docs/' + name
    if version is not None:
        path += separator + version
    inventory = {path: {'type': 'file', 'bytes': len(content),
                        'sha256': hashlib.sha256(content).hexdigest()}}
    for parent in PurePosixPath(path).parents:
        if str(parent) != '.':
            inventory[str(parent)] = {'type': 'directory', 'bytes': 0}
    context = {'containers_by_role': {'storage': {'Config': {'Env': env}}},
               'storage_archive_prefix': 'root-001/storage', 'archive_roots': ['root-001'],
               'inventory': inventory}
    row = {'id': 'object-id', 'bucket_id': 'docs', 'name': name, 'version': version,
           'metadata': {'size': len(content), 'mimetype': 'application/pdf',
                        'cacheControl': 'max-age=3600'}}
    return context, [row], content, path


class ObjectMappingTests(unittest.TestCase):
    def fails(self, context, rows, code):
        with self.assertRaises(s.Stop) as raised:
            s.map_objects(context, rows)
        self.assertEqual(raised.exception.reason_code, code)
        self.assertNotIn(PRIVATE, str(raised.exception))

    def test_exact_known_path_and_private_repr(self):
        context, rows, content, path = fixture()
        original = copy.deepcopy((context, rows))
        result = s.map_objects(context, rows)
        self.assertEqual(result[0].archive_path, path)
        self.assertEqual(result[0].expected_sha256, hashlib.sha256(content).hexdigest())
        self.assertNotIn(PRIVATE, repr(result))
        self.assertEqual((context, rows), original)

    def test_version_separator_and_unversioned_objects(self):
        for version, separator in [('revision', '-$v-'), (None, '/')]:
            with self.subTest(version=version):
                context, rows, _, path = fixture(version=version, separator=separator)
                self.assertEqual(s.map_objects(context, rows)[0].archive_path, path)

    def test_no_other_layout_is_tried(self):
        context, rows, _, path = fixture()
        alternate = path.replace('/version-1', '-$v-version-1')
        context['inventory'][alternate] = context['inventory'].pop(path)
        self.fails(context, rows, 'APP_STORAGE_OBJECT_FILE_MISSING')

    def test_precise_url_quoting_without_decoding_names(self):
        name = 'folder/space + %2e%2e #?.pdf'
        context, rows, _, _ = fixture(name=name)
        obj = s.map_objects(context, rows)[0]
        self.assertEqual(obj.http_path,
                         '/object/authenticated/docs/folder/space%20%2B%20%252e%252e%20%23%3F.pdf')
        self.assertIn('%2e%2e', obj.archive_path)

    def test_unicode_is_preserved_in_path_and_encoded_in_url(self):
        context, rows, _, path = fixture(name='папка/файл.pdf')
        obj = s.map_objects(context, rows)[0]
        self.assertEqual(obj.archive_path, path)
        self.assertIn('%D0', obj.http_path)

    def test_malicious_and_noncanonical_paths_rejected(self):
        for field in ['name', 'bucket_id', 'version']:
            for value in ['../escape', '/absolute', 'x/../y', 'x//y', 'x/', '.', '..',
                          'x\\y', 'x\x00y', 'x\ny', '']:
                with self.subTest(field=field, value=value):
                    context, rows, _, _ = fixture()
                    rows[0][field] = value
                    self.fails(context, rows, 'APP_STORAGE_PATH_INVALID')

    def test_missing_config_is_not_guessed(self):
        for key, code in [('GLOBAL_S3_BUCKET', 'APP_STORAGE_GLOBAL_BUCKET_UNKNOWN'),
                          ('TENANT_ID', 'APP_STORAGE_TENANT_UNKNOWN')]:
            context, rows, _, _ = fixture()
            env = context['containers_by_role']['storage']['Config']['Env']
            env[:] = [entry for entry in env if not entry.startswith(key + '=')]
            self.fails(context, rows, code)

    def test_matching_aliases_accepted_and_conflicting_aliases_rejected(self):
        for alias in ['PROJECT_REF=tenant', 'STORAGE_S3_BUCKET=internal']:
            context, rows, _, _ = fixture()
            env = context['containers_by_role']['storage']['Config']['Env']
            env.append(alias)
            self.assertEqual(len(s.map_objects(context, rows)), 1)
            env[-1] += '-other'
            self.fails(context, rows, 'APP_STORAGE_CONFIG_AMBIGUOUS')

    def test_duplicate_env_and_non_boolean_separator_rejected(self):
        for extra, code in [('TENANT_ID=tenant', 'APP_STORAGE_CONFIG_AMBIGUOUS'),
                            ('TUS_USE_FILE_VERSION_SEPARATOR=1', 'APP_STORAGE_CONFIG_INVALID'),
                            ('IS_MULTITENANT=true', 'APP_STORAGE_BACKEND_UNSUPPORTED')]:
            context, rows, _, _ = fixture()
            context['containers_by_role']['storage']['Config']['Env'].append(extra)
            self.fails(context, rows, code)

    def test_duplicate_object_or_file_mapping_rejected(self):
        context, rows, _, _ = fixture()
        rows.append(copy.deepcopy(rows[0]))
        self.fails(context, rows, 'APP_STORAGE_OBJECT_AMBIGUOUS')
        rows[1]['id'] = 'other-id'
        self.fails(context, rows, 'APP_STORAGE_OBJECT_AMBIGUOUS')

    def test_missing_parent_or_non_directory_rejected(self):
        for value in [None, {'type': 'file', 'bytes': 0}]:
            context, rows, _, _ = fixture()
            context['inventory']['root-001/storage/internal'] = value
            self.fails(context, rows, 'APP_STORAGE_PARENT_INVALID')

    def test_root_mismatch_rejected(self):
        context, rows, _, _ = fixture()
        context['archive_roots'] = ['root-000']
        self.fails(context, rows, 'APP_STORAGE_ARCHIVE_ROOT_INVALID')

    def test_metadata_size_is_checked_without_float_coercion(self):
        for value, code in [(999, 'APP_STORAGE_METADATA_SIZE_MISMATCH'),
                            (True, 'APP_STORAGE_METADATA_INVALID'),
                            (1.0, 'APP_STORAGE_METADATA_INVALID'),
                            ('1e2', 'APP_STORAGE_METADATA_INVALID')]:
            context, rows, _, _ = fixture()
            rows[0]['metadata']['size'] = value
            self.fails(context, rows, code)
        context, rows, content, _ = fixture()
        rows[0]['metadata']['size'] = str(len(content))
        self.assertEqual(s.map_objects(context, rows)[0].expected_bytes, len(content))

    def test_header_injection_and_bad_mime_rejected(self):
        for key, value in [('mimetype', 'text/html\r\nLocation: evil'),
                           ('mimetype', 'not-a-media-type'),
                           ('cacheControl', 'max-age=1\nX: value'),
                           ('contentEncoding', 'gzip\x00')]:
            context, rows, _, _ = fixture()
            rows[0]['metadata'][key] = value
            self.fails(context, rows, 'APP_STORAGE_METADATA_INVALID')

    def test_missing_optional_metadata_is_distinct(self):
        context, rows, _, _ = fixture()
        rows[0]['metadata'] = None
        obj = s.map_objects(context, rows)[0]
        self.assertIsNone(obj.mimetype)
        self.assertIsNone(obj.content_encoding)

    def test_per_object_byte_limit_precedes_fetch(self):
        context, rows, _, _ = fixture()
        with self.assertRaises(s.Stop) as raised:
            s.map_objects(context, rows, max_object_bytes=1)
        self.assertEqual(raised.exception.reason_code, 'APP_STORAGE_OBJECT_TOO_LARGE')


class ObjectHttpTests(unittest.TestCase):
    def setUp(self):
        context, rows, self.content, _ = fixture()
        self.mapped = s.map_objects(context, rows)

    def verify(self, response):
        result = s.verify_objects(self.mapped, lambda obj: response)
        self.assertNotIn(PRIVATE, json.dumps(result))
        return result

    def test_exact_content_and_semantic_mime_match(self):
        result = self.verify((200, {'Content-Type': 'Application/PDF; charset=binary'}, self.content))
        self.assertEqual(result['status'], 'VERIFIED')
        self.assertEqual(result['verified_objects'], 1)
        self.assertEqual(result['verified_bytes'], len(self.content))
        self.assertEqual(result['method'], 'CAPTURED_CONFIG_PLUS_HTTP_VERIFIED')
        self.assertEqual(result['filesystem_metadata'], 'NOT_PROVEN')
        self.assertEqual(result['xattrs'], 'NOT_CAPTURED')

    def test_missing_xattrs_can_require_gateway_mime_override(self):
        for headers, field in [({'content-type': 'application/octet-stream'}, 'mime_mismatch'),
                               ({}, 'mime_missing')]:
            result = self.verify((200, headers, self.content))
            self.assertEqual(result['status'], 'FAILED')
            self.assertEqual(result['bytes_status'], 'VERIFIED')
            self.assertEqual(result['content_type'], 'OVERRIDE_REQUIRED')
            self.assertEqual(result[field], 1)

    def test_size_hash_and_status_failures_are_distinct(self):
        for response, field in [((200, {}, b'short'), 'size_mismatch'),
                                ((200, {}, b'X' * len(self.content)), 'sha256_mismatch'),
                                ((404, {}, PRIVATE.encode()), 'http_failures'),
                                ((302, {'Location': 'https://external/'}, b''), 'http_failures')]:
            result = self.verify(response)
            self.assertEqual(result['bytes_status'], 'FAILED')
            self.assertEqual(result[field], 1)
            self.assertEqual(result['verified_objects'], 0)

    def test_exception_and_invalid_body_do_not_leak(self):
        def fetch(obj):
            raise RuntimeError(PRIVATE)
        result = s.verify_objects(self.mapped, fetch)
        self.assertEqual(result['fetch_failures'], 1)
        self.assertNotIn(PRIVATE, json.dumps(result))
        result = self.verify((200, {}, PRIVATE))
        self.assertEqual(result['invalid_responses'], 1)

    def test_all_objects_checked_after_failure(self):
        result = s.verify_objects(self.mapped * 3, lambda obj: (404, {}, b''))
        self.assertEqual(result['checked'], 3)
        self.assertEqual(result['http_failures'], 3)

    def test_duplicate_case_header_is_not_accepted(self):
        result = self.verify((200, {'Content-Type': 'application/pdf',
                                    'content-type': 'text/html'}, self.content))
        self.assertEqual(result['mime_mismatch'], 1)

    def test_empty_set_has_no_fake_mime_proof(self):
        result = s.verify_objects([], lambda obj: self.fail('must not fetch'))
        self.assertEqual(result['objects'], 0)
        self.assertEqual(result['content_type'], 'NOT_PROVIDED')


if __name__ == '__main__':
    unittest.main()
