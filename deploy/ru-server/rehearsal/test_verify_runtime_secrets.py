import hashlib
import json
from pathlib import Path
import stat
import tempfile
import unittest

import stage_runtime_secrets as stage
import verify_runtime_secrets as verify


class RuntimeVerificationTests(unittest.TestCase):
    def values(self):
        return {name: 'exact-$`"\\-значение-' + name for name in stage.NAMES}

    def remote_rows(self):
        return [{'name': name, 'value': hashlib.sha256(value.encode('utf-8')).hexdigest()}
                for name, value in self.values().items()]

    def test_exact_matches_and_reserved_keys(self):
        remote = verify.parse_digests(self.remote_rows() + [{'name': 'SUPABASE_URL', 'value': 'a' * 64}])
        result = verify.compare(self.values(), remote)
        self.assertTrue(result['all_match'])
        self.assertEqual(set(result['matched']), set(stage.NAMES))

    def test_missing_changed_and_unstaged_custom_keys_fail(self):
        rows = self.remote_rows()[1:]
        rows[0]['value'] = '0' * 64
        rows.append({'name': 'OTHER_KEY', 'value': 'a' * 64})
        result = verify.compare(self.values(), verify.parse_digests(rows))
        self.assertFalse(result['all_match'])
        self.assertEqual(result['missing'], ['VK_APP_SECRET'])
        self.assertEqual(result['mismatched'], ['BOS_SYNC_KEY'])
        self.assertEqual(result['unexpected'], ['OTHER_KEY'])

    def test_non_digest_duplicate_or_unsafe_names_are_rejected(self):
        for rows in ([{'name': 'VK_APP_SECRET', 'value': 'plaintext-secret'}],
                     self.remote_rows() + self.remote_rows(),
                     [{'name': 'bad\nname', 'value': 'a' * 64}]):
            with self.assertRaises(ValueError):
                verify.parse_digests(rows)

    def test_saved_file_hash_and_permissions_are_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = stage.save_secrets(Path(directory), self.values())
            values, digest = verify.load_secrets(root)
            self.assertEqual(values, self.values())
            self.assertEqual(len(digest), 64)
            path = root / 'functions-secrets.json'
            original = path.read_bytes()
            path.write_bytes(original + b' ')
            with self.assertRaises(ValueError):
                verify.load_secrets(root)
            path.write_bytes(original)
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                verify.load_secrets(root)

    def test_symlink_input_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = stage.save_secrets(parent, self.values())
            link = parent / 'linked'
            link.symlink_to(root, target_is_directory=True)
            with self.assertRaises(ValueError):
                verify.load_secrets(link)

    def test_receipt_has_private_permissions_and_no_original_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = stage.save_secrets(Path(directory), self.values())
            _, digest = verify.load_secrets(root)
            result = verify.compare(self.values(), verify.parse_digests(self.remote_rows()))
            path = verify.save_receipt(root, digest, result)
            receipt = json.loads(path.read_text())
            self.assertEqual(receipt['secrets_file_sha256'], digest)
            self.assertTrue(receipt['all_match'])
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            for value in self.values().values():
                self.assertNotIn(value, path.read_text())


if __name__ == '__main__':
    unittest.main()
