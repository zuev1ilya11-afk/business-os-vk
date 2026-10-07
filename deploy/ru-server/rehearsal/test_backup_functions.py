import unittest
import backup_functions as functions


class FunctionsBackupTests(unittest.TestCase):
    def body(self):
        return (b'--boundary\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n'
                b'{"deno2_entrypoint_path":"/src/index.ts"}\r\n'
                b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="index.ts"\r\n'
                b'Supabase-Path: /src/index.ts\r\nContent-Type: application/typescript\r\n\r\n'
                b'import "./shared.ts";\nDeno.env.get("VK_APP_SECRET");\n\r\n'
                b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="shared.ts"\r\n\r\n'
                b'export const x = 1;\n\r\n--boundary--\r\n')

    def test_multipart_preserves_source_bytes_paths_and_metadata(self):
        metadata, files = functions.decode_multipart('multipart/form-data; boundary=boundary', self.body())
        self.assertEqual(metadata['deno2_entrypoint_path'], '/src/index.ts')
        self.assertEqual([p for p, _ in files], ['/src/index.ts', 'shared.ts'])
        self.assertEqual(files[1][1], b'export const x = 1;\n')
        self.assertEqual(functions.env_names(files), ['VK_APP_SECRET'])

    def test_truncated_or_wrong_content_type_is_rejected(self):
        with self.assertRaises(ValueError):
            functions.decode_multipart('application/json', self.body())
        with self.assertRaises(Exception):
            functions.decode_multipart('multipart/form-data; boundary=boundary', self.body()[:-16])

    def test_duplicate_paths_and_no_source_are_rejected(self):
        duplicate = self.body().replace(b'filename="shared.ts"', b'filename="/src/index.ts"')
        with self.assertRaises(ValueError):
            functions.decode_multipart('multipart/form-data; boundary=boundary', duplicate)
        with self.assertRaises(ValueError):
            functions.decode_multipart('multipart/form-data; boundary=x', b'--x\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{}\r\n--x--\r\n')

    def test_inventory_rejects_path_slugs_and_duplicate_slugs(self):
        row = {'slug': 'fn', 'version': 1, 'verify_jwt': False, 'status': 'ACTIVE'}
        functions.validate_inventory([row], 1)
        with self.assertRaises(ValueError):
            functions.validate_inventory([dict(row, slug='../escape')], 1)
        with self.assertRaises(ValueError):
            functions.validate_inventory([row, row], 2)

    def test_drift_detects_versions_and_auth_changes(self):
        row = {'slug': 'fn', 'version': 1, 'verify_jwt': False, 'status': 'ACTIVE'}
        before = functions.fingerprint([row])
        self.assertNotEqual(before, functions.fingerprint([dict(row, version=2)]))
        self.assertNotEqual(before, functions.fingerprint([dict(row, verify_jwt=True)]))


if __name__ == '__main__':
    unittest.main()
