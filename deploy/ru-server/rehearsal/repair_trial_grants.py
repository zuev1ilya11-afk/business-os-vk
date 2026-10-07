#!/usr/bin/env python3
"""Restore only diagnosed DB/GraphQL schema grants in an isolated restore trial.

Known administrative extension-owner differences stay explicit. No cloud access,
owner changes or production container actions. Whole-state guards run before
and after the fixed GRANTs in one transaction, then the result is read again.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

from vault_rekey_trial import validate_container
from verify_trial_access import (collect, compare, compare_details, validate_baseline,
                                 validate_inventory, validate_details)

OWNER_EXCEPTIONS = {'pg_stat_statements': 5, 'pgcrypto': 36, 'uuid-ossp': 10}
DB_GRANTS = [
    ['postgres', 'dashboard_user', 'CONNECT', False],
    ['postgres', 'dashboard_user', 'CREATE', False],
    ['postgres', 'dashboard_user', 'TEMPORARY', False],
    ['postgres', 'supabase_etl_admin', 'CREATE', False],
    ['postgres', 'supabase_storage_admin', 'CREATE', False],
]
SCHEMA_OWNER_GRANTS = [['supabase_admin', 'supabase_admin', 'CREATE', False],
                       ['supabase_admin', 'supabase_admin', 'USAGE', False]]
SCHEMA_SOURCE_GRANTS = sorted(SCHEMA_OWNER_GRANTS + [
    ['supabase_admin', 'anon', 'USAGE', False],
    ['supabase_admin', 'authenticated', 'USAGE', False],
    ['supabase_admin', 'postgres', 'USAGE', True],
    ['supabase_admin', 'service_role', 'USAGE', False],
])


def project_state(value):
    validate_inventory(value['inventory'])
    validate_details(value['details'])
    result = copy.deepcopy(value)
    # These two categories are checked by their complete per-object details.
    for category in ('schema_metadata', 'extension_member_owners'):
        del result['inventory']['categories'][category]
    return result


def expected_states(inventory, details):
    after = project_state({'inventory': inventory, 'details': details})
    if inventory['database_owner'] != 'postgres' or not all(g in inventory['database_grants'] for g in DB_GRANTS):
        raise ValueError('Unexpected source database grants')
    for schema in ('graphql', 'graphql_public'):
        if details['schema_metadata'].get(schema) != ['supabase_admin', SCHEMA_SOURCE_GRANTS]:
            raise ValueError('Unexpected source GraphQL grants')
    for extension, expected_count in OWNER_EXCEPTIONS.items():
        if inventory['extension_owners'].get(extension) != 'postgres':
            raise ValueError('Unexpected source extension owner')
        members = [k for k in details['extension_member_owners'] if k.startswith(extension + '|')]
        if (len(members) != expected_count
                or any(details['extension_member_owners'][k] != 'postgres' for k in members)
                or set(members) & set(details['extension_security_definers'])):
            raise ValueError('Unexpected extension-member ownership exception')
        after['inventory']['extension_owners'][extension] = 'supabase_admin'
        for member in members:
            after['details']['extension_member_owners'][member] = 'supabase_admin'
    before = copy.deepcopy(after)
    before['inventory']['database_grants'] = [g for g in inventory['database_grants'] if g not in DB_GRANTS]
    for schema in ('graphql', 'graphql_public'):
        before['details']['schema_metadata'][schema] = ['supabase_admin', copy.deepcopy(SCHEMA_OWNER_GRANTS)]
    return before, after


def check_state(actual, before, after, repaired=False):
    if actual != after and (repaired or actual != before):
        raise ValueError('Access state differs from diagnosed before/after states')


def sql_literal(value):
    return "'" + json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace("'", "''") + "'::jsonb"


def snapshot_function(name, query):
    if name not in ('bos_grant_inventory', 'bos_grant_details'):
        raise ValueError('Unexpected snapshot function')
    if query.count('BEGIN READ ONLY;') != 1 or not query.rstrip().endswith('ROLLBACK;'):
        raise ValueError('Unexpected read-only query wrapper')
    body = query[query.index('WITH'):query.rindex('ROLLBACK;')].strip()
    if '$bos_snapshot$' in body:
        raise ValueError('Snapshot delimiter collision')
    return f'CREATE FUNCTION pg_temp.{name}() RETURNS json LANGUAGE sql AS $bos_snapshot$\n{body}\n$bos_snapshot$;\n'


def build_sql(inventory_query, details_query, before, after):
    return """BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=pg_catalog;
SET LOCAL standard_conforming_strings=on;
DO $bos_env$ BEGIN
  IF current_database() <> 'bos_restore_check'
     OR current_user <> 'bos_restore_loader'
     OR session_user <> 'bos_restore_loader'
     OR current_setting('cron.launch_active_jobs') <> 'off'
     OR current_setting('server_version_num') <> '170011'
     OR (SELECT extversion FROM pg_extension WHERE extname='pg_net') IS DISTINCT FROM '0.20.4'
  THEN RAISE EXCEPTION 'BOS_GRANTS_ENVIRONMENT_MISMATCH'; END IF;
END $bos_env$;
""" + snapshot_function('bos_grant_inventory', inventory_query) + snapshot_function('bos_grant_details', details_query) + """
CREATE FUNCTION pg_temp.bos_grant_state() RETURNS jsonb LANGUAGE sql AS $bos_state$
  SELECT jsonb_build_object('inventory',
    (inv - 'categories') || jsonb_build_object('categories',
      (inv -> 'categories') - ARRAY['schema_metadata','extension_member_owners']),
    'details',pg_temp.bos_grant_details()::jsonb)
  FROM (SELECT pg_temp.bos_grant_inventory()::jsonb AS inv) snapshot;
$bos_state$;
CREATE FUNCTION pg_temp.bos_grant_guard(repaired boolean) RETURNS void LANGUAGE plpgsql AS $bos_guard$
DECLARE
  actual jsonb := pg_temp.bos_grant_state();
  expected_before jsonb := """ + sql_literal(before) + ";\n  expected_after jsonb := " + sql_literal(after) + """;
BEGIN
  IF actual IS DISTINCT FROM expected_after AND (repaired OR actual IS DISTINCT FROM expected_before)
  THEN RAISE EXCEPTION 'BOS_GRANTS_STATE_MISMATCH'; END IF;
END $bos_guard$;
SELECT pg_temp.bos_grant_guard(false);
SET LOCAL ROLE postgres;
GRANT CREATE ON DATABASE bos_restore_check TO supabase_etl_admin, supabase_storage_admin;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE bos_restore_check TO dashboard_user;
RESET ROLE;
SET LOCAL ROLE supabase_admin;
GRANT USAGE ON SCHEMA graphql, graphql_public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA graphql, graphql_public TO postgres WITH GRANT OPTION;
RESET ROLE;
SELECT pg_temp.bos_grant_guard(true);
COMMIT;
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog;
SELECT json_build_object('inventory',pg_temp.bos_grant_inventory(),'details',pg_temp.bos_grant_details());
ROLLBACK;
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if os.geteuid() != 0:
        raise ValueError('Run as root')
    folder = Path(__file__).resolve().parent
    queries, sources = {}, {}
    for kind, validator in (('inventory', validate_inventory), ('details', validate_details)):
        queries[kind] = (folder / f'access_{kind}.sql').read_bytes()
        sources[kind] = json.loads((folder / f'source_access_{kind}.json').read_bytes())
        validate_baseline(sources[kind], queries[kind], validator)
    before, after = expected_states(sources['inventory']['inventory'], sources['details']['inventory'])
    patch_sql = build_sql(queries['inventory'].decode(), queries['details'].decode(), before, after)
    info = json.loads(subprocess.run(['docker', 'inspect', args.container], check=True,
                      capture_output=True, text=True, timeout=20).stdout)[0]
    cid = validate_container(info, args.container)
    stage = Path(tempfile.mkdtemp(prefix='grant-repair-', dir='/opt/business-os/deploy'))
    (stage / 'patch.sql').write_text(patch_sql)
    print('Каталог проверки:', stage, flush=True)

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)

    def validate_after(value):
        check_state(project_state(value), before, after, repaired=True)

    # collect provides the existing stopped/offline lifecycle and finally-stop.
    actual = collect(cid, stage, patch_sql.encode(), validate_after)
    inventory_diff = compare(sources['inventory']['inventory'], actual['inventory'])
    details_diff = compare_details(sources['details']['inventory'], actual['details'])
    report = {'container_id': cid, 'source_project': sources['inventory']['project_id'],
              'actual': actual, 'inventory_comparison': inventory_diff, 'details_comparison': details_diff,
              'administrative_owner_exceptions': OWNER_EXCEPTIONS,
              'scope': 'known DB/schema grant repair only; service behavior remains unverified'}
    (stage / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print('Права базы и схем совпали с исходными.', flush=True)
    print('Категорий совпало:', 12 - len(inventory_diff['different_categories']), '/ 12')
    print('Остаточные расхождения категорий:', json.dumps(inventory_diff['different_categories']))
    print('Различия владельцев расширений:', json.dumps(inventory_diff['different_extension_owners']))
    print('Изменённые SECURITY DEFINER:', json.dumps(details_diff['changed_security_definers']))
    print('BOS_TRIAL_GRANTS_OK', flush=True)
    print('Владельцы трёх расширений и 51 их объекта отличаются; сервисы ещё требуют проверки.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (Exception, KeyboardInterrupt):
        print('BOS_TRIAL_GRANTS_FAILED; журнал оставлен на сервере, не отправляйте его целиком.', flush=True)
        sys.exit(1)
