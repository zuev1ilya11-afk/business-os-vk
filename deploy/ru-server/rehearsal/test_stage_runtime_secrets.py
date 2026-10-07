import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import warnings
import getpass

import stage_runtime_secrets as stage


class RuntimeSecretTests(unittest.TestCase):
    def values(self):
        return {name: 'original-"-$`\\value' for name in stage.NAMES}

    def test_exact_values_are_preserved_in_private_new_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            first = stage.save_secrets(parent, self.values())
            second = stage.save_secrets(parent, self.values())
            self.assertNotEqual(first, second)
            self.assertEqual(stat.S_IMODE(first.stat().st_mode), 0o700)
            path = first / 'functions-secrets.json'
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(json.loads(path.read_text())['values'], self.values())
            self.assertEqual(json.loads(path.read_text())['source_verified'], False)

    def test_invalid_values_or_unprotected_parent_do_not_create_files(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            for value in ('', ' leading', 'trailing ', 'line\nbreak', 'zero\x00'):
                with self.assertRaises(ValueError):
                    stage.save_secrets(parent, dict(self.values(), VK_APP_SECRET=value))
            with self.assertRaises(ValueError):
                stage.save_secrets(parent, {'VK_APP_SECRET': 'incomplete'})
            parent.chmod(0o755)
            with self.assertRaises(ValueError):
                stage.save_secrets(parent, self.values())
            self.assertEqual(list(parent.iterdir()), [])

    def test_secret_input_refuses_fallback_echo(self):
        def echo_warning(prompt):
            warnings.warn('Password input may be echoed', getpass.GetPassWarning)
            self.fail('Should stop before fallback input')
        with patch.object(stage.getpass, 'getpass', side_effect=echo_warning):
            with self.assertRaises(getpass.GetPassWarning):
                stage.collect_secrets()

    def test_parent_directory_sync_failure_prevents_success(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            parent_inode = parent.stat().st_ino
            original_sync = os.fsync
            def fail_parent_sync(fd):
                if os.fstat(fd).st_ino == parent_inode:
                    raise OSError('Parent directory sync failed')
                return original_sync(fd)
            with patch.object(stage.os, 'fsync', side_effect=fail_parent_sync):
                with self.assertRaises(OSError):
                    stage.save_secrets(parent, self.values())


if __name__ == '__main__':
    unittest.main()
