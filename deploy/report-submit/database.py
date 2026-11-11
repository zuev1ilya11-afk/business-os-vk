#!/usr/bin/env python3
"""Function-only release, explicit action, exact baseline, backup and rollback.
Uses existing psql authentication (PGSERVICE/PG* or local peer), never prints it.
No production invocation is performed by development tests.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261110140000_preserve_submitted_report.sql'
BASELINE = ROOT / 'supabase/migrations/20261004100840_manual_order_completion.sql'


def body(sql):
    return sql.split('$function$')[1].replace('\r\n', '\n')


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def runner(args, sql):
    cmd = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
    if args.database:
        cmd += ['-d', args.database]
    if args.container:
        cmd = ['docker', 'exec', '-i', args.container, *cmd, '-U', 'postgres']
    env = {**os.environ, 'PGCONNECT_TIMEOUT': '10'}
    result = subprocess.run(cmd, input=sql, text=True, capture_output=True, env=env, timeout=45)
    if result.returncode:
        raise RuntimeError('DATABASE_COMMAND_FAILED; run check before retry (details suppressed)')
    return result.stdout.strip()


def literal(text):
    return "'" + text.replace("'", "''") + "'"


def guarded(expected, replacement):
    # Lock before checking: concurrent application updates wait for the function switch.
    return """BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s';
LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE;
DO $check$ BEGIN
 IF (SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.guard_order_completion()'))
    IS DISTINCT FROM """ + literal(expected) + """ THEN
  RAISE EXCEPTION 'GUARD_CHANGED';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.orders'::regclass
    AND tgfoid=to_regprocedure('public.guard_order_completion()') AND tgenabled IN ('O','A')) THEN
  RAISE EXCEPTION 'GUARD_TRIGGER_NOT_ENABLED';
 END IF;
END $check$;
""" + replacement + '\nCOMMIT;'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'apply', 'rollback'])
    parser.add_argument('--container', help='Existing PostgreSQL container, if used')
    parser.add_argument('--database', help='Explicit database name; otherwise existing psql configuration')
    parser.add_argument('--backup', default='report-submit-backup.json')
    args = parser.parse_args()
    if args.action == 'check':
        print(runner(args, (ROOT / 'deploy/report-submit/check.sql').read_text()))
        return
    new_sql = MIGRATION.read_text()
    old_body = body(BASELINE.read_text())
    new_body = body(new_sql)
    backup = Path(args.backup)
    if args.action == 'apply':
        raw = runner(args, "BEGIN READ ONLY; SELECT json_build_object('body',prosrc,'sql',pg_get_functiondef(oid),'database',current_database()) FROM pg_proc WHERE oid=to_regprocedure('public.guard_order_completion()'); ROLLBACK;")
        saved = json.loads(raw)
        if saved['body'] == new_body:
            print('ALREADY_APPLIED')
            return
        if saved['body'] != old_body:
            raise RuntimeError('UNRECOGNIZED_GUARD: compare live function before deployment')
        saved['new_sha256'] = sha(new_sql)
        # Never overwrite an earlier rollback point.
        fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as out:
            json.dump(saved, out, ensure_ascii=False)
        runner(args, guarded(old_body, new_sql))
        print('APPLIED_FUNCTION_ONLY; backup=' + str(backup))
    else:
        saved = json.loads(backup.read_text())
        if saved.get('new_sha256') != sha(new_sql) or body(saved['sql']) != old_body:
            raise RuntimeError('ROLLBACK_BACKUP_MISMATCH')
        actual_db = runner(args, 'SELECT current_database();')
        if actual_db != saved['database']:
            raise RuntimeError('ROLLBACK_DATABASE_MISMATCH')
        runner(args, guarded(new_body, saved['sql']))
        print('ROLLED_BACK_FUNCTION_ONLY')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never echo stderr, connection URLs or customer data from PostgreSQL.
        print(str(error) if isinstance(error, RuntimeError) else type(error).__name__, file=sys.stderr)
        sys.exit(1)
