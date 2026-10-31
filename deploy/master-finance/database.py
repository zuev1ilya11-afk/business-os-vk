"""One verified historical recovery; additive, transactional accrual storage.

File rollback deliberately retains captured financial history. This module never
drops the table or restores an entire database from a backup.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
from datetime import datetime, timezone
from decimal import Decimal
from common import require, read, run, atomic, emit

FIELDS = 'id order_number external_id external_source source status completed_at report_reviewed_at scheduled_date created_at received_date master_agreed_at master_staff_id master_id master_name address city amount original_amount master_payout extra_work_amount extra_work_description uncompleted_work_amount uncompleted_work_description uncompleted_work_items work work_items manual_completion_history'.split()
CURRENT_FIELDS = FIELDS + ['is_claim', 'claim_opened_at', 'claim_closed_at', 'claim_revisit_payment']
ORIGINAL_DATE = '2026-10-13T17:10:21.807+00:00'
REPEAT_DATE = '2026-10-31T14:24:50.693+00:00'
BASIS = 'verified_backup_7395762_20261013'
FUNCTIONS = ('bos_capture_claim_finance', 'bos_close_claim_after_completion')


def route():
    try:
        import claim_check
    except ModuleNotFoundError:
        path = Path(__file__).resolve().parents[1] / 'finance-export/check-claim.py'
        spec = importlib.util.spec_from_file_location('claim_check', path)
        claim_check = importlib.util.module_from_spec(spec); spec.loader.exec_module(claim_check)
    return claim_check.database()


def query(sql, stage=None, label='claim-database', target=None):
    container, name = target or route()
    return run(['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', name, '-f', '-'],
               stage, label, timeout=30, data=sql.encode())


def projection(alias='o'):
    keys = ','.join("'" + key + "'" for key in CURRENT_FIELDS)
    return '(SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(' + alias + ')) WHERE key=ANY(ARRAY[' + keys + ']))'


def current_sql():
    return """BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
SELECT json_build_object('current', (SELECT """ + projection() + """ FROM public.orders o WHERE o.id=1769),
'claim',(SELECT jsonb_build_object('id',c.id,'order_id',c.order_id,'status',c.status,'opened_at',c.opened_at,
 'closed_at',c.closed_at,'pay_revisit',c.pay_revisit,'revisit_payment',c.revisit_payment) FROM public.order_claims c WHERE c.id=4),
'schema_exists',to_regclass('public.order_financial_snapshots') IS NOT NULL,
'other_legacy_claims',(SELECT count(*) FROM public.orders WHERE is_claim IS TRUE AND id<>1769),
'functions',(SELECT coalesce(json_agg(json_build_object('name',p.proname,'body',p.prosrc,'definer',p.prosecdef,'config',p.proconfig)), '[]'::json)
 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public'
 AND p.proname IN ('bos_capture_claim_finance','bos_close_claim_after_completion')));
ROLLBACK;"""


def instant(value):
    require(isinstance(value, str), 'HISTORICAL_DATE_MISSING')
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(stamp.tzinfo is not None, 'HISTORICAL_TIMEZONE_MISSING')
    return stamp.astimezone(timezone.utc)


def number(value):
    require(value is not None and not isinstance(value, bool), 'HISTORICAL_AMOUNT_MISSING')
    result = Decimal(str(value)); require(result.is_finite(), 'HISTORICAL_AMOUNT_INVALID')
    return result


def choose_snapshot(evidence):
    candidates = [c for c in evidence['candidates'] if not c['is_claim'] and c['snapshot'].get('status') == 'Выполнена']
    require(candidates, 'COMPLETED_ORIGINAL_NOT_FOUND')
    for candidate in candidates:
        s = candidate['snapshot']
        require(str(s.get('id')) == '1769' and (str(s.get('order_number')) == '7395762' or s.get('external_id') in ('7395762', 'hands:7395762')), 'RECOVERY_ORDER_MISMATCH')
        require(instant(s.get('completed_at')) == instant(ORIGINAL_DATE), 'RECOVERY_DATE_CONFLICT')
        require(number(s.get('master_payout')) == Decimal('3754.79') and number(s.get('extra_work_amount')) == 0, 'RECOVERY_PAY_CONFLICT')
    chosen = max(candidates, key=lambda c: c['mtime'])
    snapshot = {key: value for key, value in chosen['snapshot'].items() if key in FIELDS}
    # COPY timestamps use spaces and short offsets; Safari needs a proper ISO date.
    for key in ('completed_at', 'report_reviewed_at', 'created_at', 'master_agreed_at'):
        if snapshot.get(key): snapshot[key] = instant(snapshot[key]).isoformat(timespec='milliseconds')
    return snapshot, chosen


def validate_current(current, claim, snapshot):
    require(current and str(current.get('id')) == '1769' and current.get('status') == 'Выполнена' and current.get('is_claim') is True, 'CLAIM_CURRENT_STATE_CHANGED')
    require(str(current.get('order_number')) == '7395762' or current.get('external_id') in ('7395762', 'hands:7395762'), 'CLAIM_CURRENT_NUMBER_CHANGED')
    require(instant(current.get('completed_at')) == instant(REPEAT_DATE) and instant(current.get('report_reviewed_at')) == instant(REPEAT_DATE), 'CLAIM_COMPLETION_CHANGED')
    require(current.get('claim_closed_at') is None and number(current.get('claim_revisit_payment') or 0) == 0, 'CLAIM_REVISIT_CHANGED')
    for key in ('amount', 'master_payout', 'extra_work_amount', 'uncompleted_work_amount'):
        same = current.get(key) is None and snapshot.get(key) is None
        require(same or number(current.get(key)) == number(snapshot.get(key)), 'CLAIM_FINANCIAL_VALUES_CHANGED_' + key)
    require(claim and claim.get('id') == 4 and claim.get('order_id') == 1769 and claim.get('status') == 'open' and claim.get('pay_revisit') is False and number(claim.get('revisit_payment') or 0) == 0, 'CLAIM_JOURNAL_CHANGED')
    require(instant(claim.get('opened_at')) < instant(REPEAT_DATE) and instant(claim.get('opened_at')) > instant(ORIGINAL_DATE), 'CLAIM_DATE_ORDER_CHANGED')


def json_sql(value):
    raw = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()
    return "convert_from(decode('" + raw.hex() + "','hex'),'UTF8')::jsonb"


def verify_schema(migration, target, stage=None, expected_snapshot=None):
    data = json.loads(query(current_sql(), target=target))
    bodies = dict(re.findall(r'CREATE OR REPLACE FUNCTION public\.(bos_\w+)\(\).*?AS \$\$(.*?)\$\$;', migration, re.S))
    require(data['schema_exists'] and len(data['functions']) == 2, 'CLAIM_SCHEMA_INCOMPLETE')
    for f in data['functions']:
        require(f['body'] == bodies.get(f['name']) and f['definer'] and f['config'] == ['search_path=""'], 'CLAIM_FUNCTION_CHANGED')
    sql = """BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
SELECT json_build_object('snapshot',(SELECT financial_data FROM public.order_financial_snapshots WHERE order_id=1769),
'basis',(SELECT basis FROM public.order_financial_snapshots WHERE order_id=1769),
'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.order_financial_snapshots'::regclass),
'grants',(SELECT coalesce(json_agg(grantee||':'||privilege_type ORDER BY grantee,privilege_type),'[]'::json) FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='order_financial_snapshots' AND grantee IN ('anon','authenticated','service_role','PUBLIC')),
'closed',(SELECT status='closed' AND closed_at='2026-10-31T14:24:50.693+00:00'::timestamptz FROM public.order_claims WHERE id=4));
ROLLBACK;"""
    result = json.loads(query(sql, stage, 'claim-verify', target))
    require(result['rls'] is True and result['grants'] == ['service_role:SELECT'], 'CLAIM_ACCESS_CHANGED')
    require(result['basis'] == BASIS and result['closed'] is True, 'CLAIM_REPAIR_INCOMPLETE')
    require(result['snapshot'] is not None and (expected_snapshot is None or result['snapshot'] == expected_snapshot), 'CLAIM_SNAPSHOT_CHANGED')
    return result


def prepare(migration):
    evidence_path = Path('/tmp/bos-claim-recovery.json')
    inventory_path = Path('/tmp/bos-claim-backups.json')
    for path in (evidence_path, inventory_path):
        require(path.stat().st_uid == 0 and path.stat().st_mode & 0o077 == 0, 'RECOVERY_FILE_PERMISSIONS')
    snapshot, candidate = choose_snapshot(json.loads(read(evidence_path, 2_000_000)))
    inventory = json.loads(read(inventory_path, 100000))
    item = inventory[candidate['backup']]; path = Path(item['path'])
    require(any(path.is_relative_to(Path(root)) for root in ('/opt/business-os', '/var/backups', '/root')) and path.resolve() == path and not path.is_symlink(), 'RECOVERY_BACKUP_PATH')
    st = path.stat()
    require(all(getattr(st, 'st_' + key) == item[key] for key in ('size', 'mtime', 'ino', 'dev')) and st.st_size <= 256 * 1024 * 1024, 'RECOVERY_BACKUP_CHANGED')
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(65536), b''): digest.update(block)
    require(digest.hexdigest() == candidate['sha256'], 'RECOVERY_BACKUP_HASH')
    target = route(); live = json.loads(query(current_sql(), target=target))
    existing = live['schema_exists']
    if existing:
        verify_schema(migration, target, expected_snapshot=snapshot)
    else:
        require(not live['functions'], 'CLAIM_FUNCTION_NAME_CONFLICT')
        validate_current(live['current'], live['claim'], snapshot)
    return {'snapshot': snapshot, 'expected_current': live['current'], 'expected_claim': live['claim'],
            'backup_sha256': candidate['sha256'], 'existing': existing, 'other_legacy_claims': live['other_legacy_claims']}


def repair_sql(plan, migration):
    expected = json_sql(plan['expected_current']); claim = json_sql(plan['expected_claim']); snapshot = json_sql(plan['snapshot'])
    return """BEGIN;
SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='20s';
SELECT pg_advisory_xact_lock(7395762);
LOCK TABLE public.orders,public.order_claims IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ DECLARE current_row jsonb; current_claim jsonb; BEGIN
IF to_regclass('public.order_financial_snapshots') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND p.proname IN ('bos_capture_claim_finance','bos_close_claim_after_completion')) THEN RAISE EXCEPTION 'CLAIM_SCHEMA_CHANGED'; END IF;
SELECT """ + projection() + """ INTO current_row FROM public.orders o WHERE o.id=1769;
SELECT jsonb_build_object('id',c.id,'order_id',c.order_id,'status',c.status,'opened_at',c.opened_at,'closed_at',c.closed_at,'pay_revisit',c.pay_revisit,'revisit_payment',c.revisit_payment) INTO current_claim FROM public.order_claims c WHERE c.id=4;
IF current_row IS DISTINCT FROM """ + expected + ' OR current_claim IS DISTINCT FROM ' + claim + """ THEN RAISE EXCEPTION 'CLAIM_CHANGED_AFTER_PREPARE'; END IF;
END $guard$;
""" + migration + "\nINSERT INTO public.order_financial_snapshots(order_id,financial_data,basis) VALUES(1769," + snapshot + ",'" + BASIS + "');\n" + """UPDATE public.orders SET claim_closed_at=completed_at WHERE id=1769;
UPDATE public.order_claims SET status='closed',closed_at='2026-10-31T14:24:50.693+00:00' WHERE id=4;
DO $check$ DECLARE final_row jsonb; BEGIN
SELECT """ + projection() + """ INTO final_row FROM public.orders o WHERE o.id=1769;
IF (final_row-'claim_closed_at') IS DISTINCT FROM (""" + expected + """-'claim_closed_at') THEN RAISE EXCEPTION 'CLAIM_FINANCIAL_VALUES_MUTATED'; END IF;
END $check$;
COMMIT;
"""


def apply(plan, migration, stage):
    target = route()
    if plan['existing']:
        verify_schema(migration, target, stage, plan['snapshot']); return
    sql = repair_sql(plan, migration)
    atomic(stage / 'claim-repair.sql', sql.encode())
    query(sql, stage, 'claim-apply', target)
    verify_schema(migration, target, stage, plan['snapshot'])
    emit('CLAIM_HISTORY_RESTORED', {'order': '7395762', 'date': '2026-10-13', 'pay': 3754.79, 'repeat_pay': 0})
