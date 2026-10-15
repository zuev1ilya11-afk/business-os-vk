import importlib.util
from pathlib import Path
import unittest
import zipfile

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('diagnose_pg',HERE/'diagnose_pg.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class DiagnosticTests(unittest.TestCase):
    def test_pinned_archive_and_fixture_match_the_existing_candidate(self):
        import hashlib
        self.assertEqual(hashlib.sha256((HERE/'bos293.pyz').read_bytes()).hexdigest(),m.ZIP_SHA)
        with zipfile.ZipFile(HERE/'bos293.pyz') as z:sql=m.fixture(z)
        self.assertIn('CREATE TABLE business_staff',sql)
        self.assertIn('CREATE TABLE IF NOT EXISTS public.master_help_materials',sql)
        self.assertIn('ON CONFLICT (id) DO NOTHING',sql)

    def test_test_password_uri_and_terminal_controls_are_not_printed(self):
        raw='ignored startup line\nFATAL: password abc-secret postgres://user:pw@db/test\nERROR: bad\x1b\r\n'
        result='\n'.join(m.safe_lines(raw,'abc-secret'))
        for forbidden in ('abc-secret','user:pw','\x1b','ignored startup'):self.assertNotIn(forbidden,result)
        self.assertIn('FATAL:',result);self.assertIn('ERROR:',result)

    def test_diagnostic_output_is_bounded(self):
        lines=m.safe_lines(('ERROR: '+'x'*1000+'\n')*100,'secret')
        self.assertEqual(len(lines),8)
        self.assertTrue(all(len(s)<=350 for s in lines))

    def test_sql_targets_only_explicit_synthetic_database_without_exporting_credentials(self):
        from unittest.mock import patch
        import subprocess
        with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'',b'')) as run:
            m.test_sql('test-only-id','BEGIN READ ONLY; SELECT 1; ROLLBACK;','psql -v VERBOSITY=sqlstate')
        args=run.call_args.args[0]
        self.assertEqual(args[:6],['docker','exec','-i','-e','PGHOST=127.0.0.1','test-only-id'])
        self.assertEqual(args[-1],'help_preview')
        self.assertIn('psql -v VERBOSITY=default',args)
        self.assertEqual(run.call_args.kwargs['input'],b'BEGIN READ ONLY; SELECT 1; ROLLBACK;')

    def test_interrupted_log_collection_still_cleans_its_test_container(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        f=SimpleNamespace(inspect=Mock(side_effect=KeyboardInterrupt),Stop=ValueError)
        b=SimpleNamespace(cleanup=Mock())
        record={'nonce':'test-owned'}
        with self.assertRaises(KeyboardInterrupt):
            m.report_and_cleanup('a'*64,'test-owned','secret',record,f,b)
        b.cleanup.assert_called_once_with(record)


if __name__=='__main__':unittest.main()
