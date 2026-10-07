import hashlib
import io
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError
import backup_storage as storage


class StorageBackupTests(unittest.TestCase):
    def row(self, name='orders/a file.pdf'):
        return {'id': '00000000-0000-0000-0000-000000000001',
                'bucket_id': 'business-os-vk-files', 'name': name,
                'version': '00000000-0000-0000-0000-000000000002',
                'metadata': {'size': 3, 'eTag': '"' + hashlib.md5(b'abc').hexdigest() + '"'}}

    def test_validate_and_encode_object_without_changing_local_filename(self):
        rows = [self.row()]
        storage.validate_manifest(rows)
        url = storage.object_url(rows[0])
        self.assertTrue(url.endswith('/business-os-vk-files/orders/a%20file.pdf'))
        self.assertNotIn('orders', storage.local_name(rows[0]))

    def test_invalid_names_checksums_and_duplicate_ids_fail(self):
        for name in ('../secret', '/absolute', 'a/../b'):
            with self.assertRaises(ValueError):
                storage.validate_manifest([self.row(name)])
        row = self.row()
        row['metadata']['eTag'] = 'multipart-2'
        with self.assertRaises(ValueError):
            storage.validate_manifest([row])
        with self.assertRaises(ValueError):
            storage.validate_manifest([self.row(), self.row()])

    def test_download_verifies_bytes_not_just_size(self):
        folder = Path(tempfile.mkdtemp())
        result = storage.save_stream(io.BytesIO(b'abc'), folder / 'object', self.row())
        self.assertEqual(result['sha256'], hashlib.sha256(b'abc').hexdigest())
        self.assertEqual((folder / 'object').read_bytes(), b'abc')
        with self.assertRaises(ValueError):
            storage.save_stream(io.BytesIO(b'bad'), folder / 'wrong', self.row())
        self.assertFalse((folder / 'wrong').exists())
        self.assertFalse((folder / 'wrong.partial').exists())

    def test_download_size_limit_rejects_extra_bytes(self):
        folder = Path(tempfile.mkdtemp())
        with self.assertRaises(ValueError):
            storage.save_stream(io.BytesIO(b'abcd'), folder / 'object', self.row())
        self.assertFalse((folder / 'object').exists())

    def test_redirect_never_forwards_key(self):
        with self.assertRaises(HTTPError):
            storage.NoRedirect().redirect_request(None, None, 302, 'redirect', {}, 'https://other.example/')

    def test_secret_and_legacy_headers(self):
        headers = storage.auth_headers('sb_secret_example')
        self.assertNotIn('Authorization', headers)
        with self.assertRaises(ValueError):
            storage.auth_headers('sb_publishable_example')
        with self.assertRaises(ValueError):
            storage.auth_headers('sb_secret_bad\r\ninjected')


if __name__ == '__main__':
    unittest.main()
