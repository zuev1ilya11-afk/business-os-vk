"""Backup transport regression: real child processes, no Docker or database.

The fixture is not a PostgreSQL archive. The child verifies that the entire
binary stream reaches the checker; PostgreSQL format validation stays on-host.
"""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'package'))
import database as d
import frontend as f

REAL_RUN = subprocess.run


class BackupTransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.parent = Path(self.temp.name)
        self.stage = self.parent / 'contact-295-db'
        self.fixture = b'PGDMP' + bytes(range(256)) * 128
        self.source = self.parent / 'fixture.bin'
        self.source.write_bytes(self.fixture)
        self.digest = hashlib.sha256(self.fixture).hexdigest()
        self.reject = False
        self.calls = []
        for target, name, value in [
            (f, 'PARENT', self.parent), (d, 'STAGE', self.stage),
            (f, 'emit', lambda message: None),
            (d, 'preflight', lambda info: {'size': 1, 'config': False}),
            (d, 'check_containers', lambda rec: None),
            (subprocess, 'run', self.run_child),
        ]:
            guard = patch.object(target, name, value)
            guard.start()
            self.addCleanup(guard.stop)

    def run_child(self, args, **kwargs):
        self.assertEqual(args[:6], ['docker', 'exec', '-i', '-u', 'postgres', 'db'])
        program = args[6:]
        self.calls.append(program[0])
        if program[0] == 'pg_dump':
            script = 'import pathlib,sys; sys.stdout.buffer.write(pathlib.Path(sys.argv[1]).read_bytes())'
            return REAL_RUN([sys.executable, '-c', script, str(self.source)], **kwargs)
        self.assertEqual(program, ['pg_restore', '--list'])
        script = (
            'import hashlib,sys\n'
            'data=sys.stdin.buffer.read()\n'
            'if hashlib.sha256(data).hexdigest()!=sys.argv[1] or sys.argv[2]=="reject":\n'
            ' sys.stderr.write("backup verifier rejected the received stream\\n")\n'
            ' sys.exit(1)\n'
            'sys.stdout.write("public orders\\nbos_control_private\\n")\n'
        )
        return REAL_RUN([sys.executable, '-c', script, self.digest,
                         'reject' if self.reject else 'accept'], **kwargs)

    def test_verifier_receives_entire_dump_from_byte_zero(self):
        rec = d.prepare({'container': 'db', 'dbname': 'postgres'})
        self.assertEqual(self.calls, ['pg_dump', 'pg_restore'])
        self.assertEqual(rec['state'], 'prepared')
        self.assertEqual(rec['backup_sha256'], self.digest)
        self.assertEqual((self.stage / 'database.dump').read_bytes(), self.fixture)
        self.assertEqual((self.stage / 'database.dump').stat().st_mode & 0o777, 0o600)
        d.backup_check(rec)

    def test_verifier_rejection_retains_backup_without_marking_prepared(self):
        self.reject = True
        with self.assertRaisesRegex(f.Stop, 'Database operation failed'):
            d.prepare({'container': 'db', 'dbname': 'postgres'})
        journal = json.loads((self.stage / 'journal.json').read_text())
        self.assertEqual(journal['state'], 'preparing')
        self.assertNotIn('backup_sha256', journal)
        self.assertEqual((self.stage / 'database.dump').read_bytes(), self.fixture)
        self.assertIn('rejected', (self.stage / 'backup-verify.log').read_text())


if __name__ == '__main__':
    unittest.main(verbosity=2)
