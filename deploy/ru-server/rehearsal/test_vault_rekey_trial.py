import hashlib
import tempfile
import unittest
from pathlib import Path

import vault_rekey_trial as vault


class VaultSafetyTests(unittest.TestCase):
    def fixture(self):
        folder = Path(tempfile.mkdtemp())
        rows = ['id,name,description,decrypted_secret,created_at,updated_at']
        for i, name in enumerate(sorted(vault.NAMES), 1):
            rows.append(f'00000000-0000-0000-0000-{i:012d},{name},description,secret,2026-10-07 10:00:00+00,2026-10-07 10:00:00+00')
        data = ('\n'.join(rows) + '\n').encode()
        (folder / 'vault.csv').write_bytes(data)
        (folder / 'SHA256SUMS').write_text(hashlib.sha256(data).hexdigest() + '  vault.csv\n')
        return folder, data

    def test_valid_export_and_modified_export(self):
        folder, data = self.fixture()
        self.assertEqual(vault.read_export(folder), data)
        (folder / 'vault.csv').write_bytes(data.replace(b'secret', b'changed'))
        with self.assertRaises(ValueError):
            vault.read_export(folder)

    def test_psql_copy_terminator_inside_secret_is_rejected(self):
        folder, data = self.fixture()
        data = data.replace(b',secret,', b',"a\n\\.\nb",', 1)
        (folder / 'vault.csv').write_bytes(data)
        (folder / 'SHA256SUMS').write_text(hashlib.sha256(data).hexdigest() + '  vault.csv\n')
        with self.assertRaises(ValueError):
            vault.read_export(folder)

    def test_wrong_secret_set_rejected(self):
        folder, data = self.fixture()
        data = data.replace(b'bos-push-vapid-v1', b'unexpected-secret')
        (folder / 'vault.csv').write_bytes(data)
        (folder / 'SHA256SUMS').write_text(hashlib.sha256(data).hexdigest() + '  vault.csv\n')
        with self.assertRaises(ValueError):
            vault.read_export(folder)

    def test_refuse_running_or_networked_or_unlabelled_container(self):
        info = {'Id': 'a' * 64, 'Name': '/bos-restore-trial-example',
                'Config': {'Labels': {'bos.restore-trial': 'true'},
                           'Cmd': ['postgres', '-c', 'cron.launch_active_jobs=off']},
                'State': {'Running': False},
                'HostConfig': {'NetworkMode': 'none', 'PortBindings': {},
                               'RestartPolicy': {'Name': 'no'}}}
        self.assertEqual(vault.validate_container(info, 'bos-restore-trial-example'), 'a' * 64)
        info['State']['Running'] = True
        with self.assertRaises(ValueError):
            vault.validate_container(info, 'bos-restore-trial-example')
        info['State']['Running'] = False
        info['HostConfig']['NetworkMode'] = 'host'
        with self.assertRaises(ValueError):
            vault.validate_container(info, 'bos-restore-trial-example')
        info['HostConfig']['NetworkMode'] = 'none'
        info['Config']['Labels'] = {}
        with self.assertRaises(ValueError):
            vault.validate_container(info, 'bos-restore-trial-example')


if __name__ == '__main__':
    unittest.main()
