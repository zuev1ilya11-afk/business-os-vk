import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


s = load('verify_stage_base', ROOT / 'stage.py')
m = load('verify_stage', ROOT / 'verify-stage.py')
m.s = s


class VerifyTests(unittest.TestCase):
    def test_temporary_database_cannot_reach_production_or_mount_its_data(self):
        args = m.db_arguments('sha256:' + 'a'*64, 'probe-test', Path('/root/backup/db.dump'),
                              ['/usr/lib/postgresql/17/bin/postgres', '/usr/lib/postgresql/17/bin/initdb'],
                              ['pg_cron', 'pg_net', 'pg_stat_statements'])
        self.assertIn('--network=none', args)
        self.assertIn('--pull=never', args)
        self.assertNotIn('-p', args)
        self.assertEqual(args.count('--mount'), 1)
        self.assertEqual(args[args.index('--mount')+1], 'type=bind,src=/root/backup/db.dump,dst=/bos-backup.dump,readonly')
        self.assertIn('cron.launch_active_jobs=off', args[-1])
        self.assertIn("listen_addresses=''", args[-1])
        self.assertIn('/tmp/bos-db', args[-1])

    def test_all_production_queries_are_wrapped_read_only(self):
        with patch.object(m, 'run', return_value=b'') as call:
            m.sql('production-id', 'real-db', 'SELECT 1;', Path('/private'), 'metadata')
        args, _, _, data = call.call_args.args
        self.assertIn('production-id', args)
        self.assertTrue(data.startswith(b'BEGIN READ ONLY;'))
        self.assertTrue(data.endswith(b'COMMIT;'))
        self.assertIn(b'statement_timeout', data)

    def test_gateway_diagnostics_hide_literal_secrets_and_comments(self):
        source = '''const envVars = [
 ["SUPABASE_URL", "http://127.0.0.1:9000"],
 ['SUPABASE_SERVICE_ROLE_KEY', 'secret-jwt-value'], // private-comment
 ["BOS_SYNC_KEY", `private-template-${token}`],
];
const worker = {envVars: envVars};'''
        result = m.gateway_shape(source)
        self.assertIn('envVars', result)
        self.assertIn('SUPABASE_URL', result)
        for private in ('127.0.0.1', 'secret-jwt-value', 'private-comment', 'private-template', '${token}'):
            self.assertNotIn(private, result)

    def test_stored_report_origins_never_include_tokens_or_credentials(self):
        raw = json.dumps(['https://old.example:8443/storage/v1/object/sign/bucket/a?token=private',
                          'https://u:password@secret.example/storage/v1/a',
                          'https://drive.google.com/drive/folders/id',
                          'https://current.example/storage/v1/a?secret=value'])
        self.assertEqual(m.origins_from_reports(raw), ['https://current.example', 'https://old.example:8443'])

    def test_probe_contract_executes_and_rolls_back_report_changes(self):
        script = r'''
const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
(async()=>{const pg=new PGlite();try{
 await pg.exec('create role anon;create role authenticated;create role service_role;');
 await pg.exec(fs.readFileSync('tests/sql/order-guards-schema.sql','utf8')+'COMMIT;');
 await pg.exec("create table business_staff(id uuid primary key);insert into business_staff values('00000000-0000-0000-0000-000000000001');insert into orders(id,status) values(1,'В работе');");
 await pg.exec(fs.readFileSync('supabase/migrations/20260929160000_capture_live_order_guards.sql','utf8'));
 const migration=fs.readFileSync('supabase/migrations/20261030090000_report_archive_queue.sql','utf8');
 await pg.exec(migration);await pg.exec(migration);
 await pg.exec(fs.readFileSync(0,'utf8'));
 const o=(await pg.query('select status,report_review_status,report_upload_token from orders where id=1')).rows[0];
 if(o.status!=='В работе'||o.report_review_status!==null||o.report_upload_token!==null)throw Error('report data not rolled back');
 if((await pg.query('select count(*)::int as n from bos_drive_private.jobs')).rows[0].n!==0)throw Error('job not rolled back');
 console.log('CONTRACT_OK');
 }finally{await pg.close()}})().catch(e=>{console.error(e.message);process.exitCode=1});
'''
        result = subprocess.run(['node', '-e', script], cwd=REPO, input=m.CONTRACT.encode(),
                                capture_output=True, timeout=40)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stdout.strip(), b'CONTRACT_OK')


if __name__ == '__main__':
    unittest.main()
