#!/usr/bin/env python3
"""Restore only the verified original accrual of 7337869; never close its claim."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys

PACKAGE = Path('/tmp/bos-master.pyz')
PACKAGE_SHA = 'fe03bb275c1a78a71d850f7596b6a21b85e2b197f6c211a22ee469f950cb7cde'
DIAGNOSTIC = Path('/tmp/bos-left.py')
DIAGNOSTIC_SHA = '73d1fea42f50ac07141cb7bdc84a509ae70ba00f39c49cb0386e11f84ae6cffb'
ORIGINAL_DATE = '2026-09-30T15:45:51.605+00:00'
FIRST_CLAIM = '2026-10-09T08:55:57.233006+00:00'
BASIS = 'verified_backup_7337869_20260930'
STAGE = Path('/opt/business-os/deploy/claim-history-1688')
db = None
APPLY_ATTEMPTED = False


class Stop(Exception): pass


def require(value, code):
    if not value: raise Stop(code)


def identity(row):
    return str(row.get('id')) == '1688' and (str(row.get('order_number')) == '7337869' or row.get('external_id') in ('7337869', 'hands:7337869'))


def choose_snapshot(evidence):
    candidates = [c for c in evidence['candidates'] if str(c['snapshot'].get('id')) == '1688'
                  and c.get('is_claim') is False and c['snapshot'].get('status') == 'Выполнена']
    require(candidates, 'VERIFIED_ORIGINAL_NOT_FOUND')
    compare = ['amount', 'original_amount', 'master_payout', 'extra_work_amount', 'uncompleted_work_amount',
               'master_staff_id', 'master_id', 'source', 'external_source']
    first = candidates[0]['snapshot']
    for candidate in candidates:
        s = candidate['snapshot']
        require(identity(s), 'ORIGINAL_IDENTITY_CHANGED')
        require(db.instant(s.get('completed_at')) == db.instant(ORIGINAL_DATE), 'ORIGINAL_DATE_CONFLICT')
        require(db.number(s.get('master_payout')) == db.number('4506.19'), 'ORIGINAL_PAY_CONFLICT')
        require(all(s.get(k) == first.get(k) for k in compare), 'ORIGINAL_FINANCIAL_HISTORY_CONFLICT')
    chosen = max(candidates, key=lambda c: c['mtime'])
    snapshot = {k: v for k, v in chosen['snapshot'].items() if k in db.FIELDS}
    for key in ('completed_at', 'report_reviewed_at', 'created_at', 'master_agreed_at'):
        if snapshot.get(key):
            stamp = db.instant(snapshot[key])
            snapshot[key] = stamp.isoformat(timespec='milliseconds' if stamp.microsecond % 1000 == 0 else 'microseconds')
    return snapshot, candidates


def state_expression():
    return """jsonb_build_object(
'current',(SELECT """ + db.projection() + """ FROM public.orders o WHERE o.id=1688),
'claims',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'order_id',c.order_id,
 'status',c.status,'opened_at',c.opened_at,'closed_at',c.closed_at,
 'pay_revisit',c.pay_revisit,'revisit_payment',c.revisit_payment) ORDER BY c.id),'[]'::jsonb)
 FROM public.order_claims c WHERE c.order_id=1688),
'first_claim',(SELECT coalesce((SELECT min(c.opened_at) FROM public.order_claims c WHERE c.order_id=1688),o.claim_opened_at)
 FROM public.orders o WHERE o.id=1688),
'saved',(SELECT jsonb_build_object('financial_data',s.financial_data,'basis',s.basis)
 FROM public.order_financial_snapshots s WHERE s.order_id=1688),
'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.order_financial_snapshots'::regclass),
'grants',(SELECT coalesce(jsonb_agg(grantee||':'||privilege_type ORDER BY grantee,privilege_type),'[]'::jsonb)
 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='order_financial_snapshots'
 AND grantee IN ('anon','authenticated','service_role','PUBLIC')),
'triggers',(SELECT count(*) FROM pg_trigger WHERE tgrelid='public.order_financial_snapshots'::regclass AND NOT tgisinternal))"""


def current_sql():
    return "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT " + state_expression() + ' AS state; ROLLBACK;'


def validate_live(live, snapshot, evidence):
    row = live.get('current')
    require(row and identity(row) and row.get('is_claim') is True and row.get('status') == 'В работе'
            and row.get('completed_at') is None, 'LIVE_ORDER_STATE_CHANGED')
    require(db.number(row.get('master_payout')) == db.number(snapshot['master_payout']), 'LIVE_PAY_CHANGED')
    require(db.instant(live.get('first_claim')) == db.instant(FIRST_CLAIM)
            and db.instant(ORIGINAL_DATE) < db.instant(FIRST_CLAIM), 'FIRST_CLAIM_CHANGED')
    prior = next((o for o in evidence['current'] if str(o.get('id')) == '1688'), None)
    require(prior and identity(prior) and all(row.get(k) == prior.get(k) for k in
            ('status', 'is_claim', 'completed_at', 'master_payout', 'extra_work_amount', 'claim_revisit_payment')), 'LIVE_CHANGED_SINCE_DIAGNOSTIC')
    require(live['rls'] is True and live['grants'] == ['service_role:SELECT'] and live['triggers'] == 0, 'FINANCIAL_HISTORY_ACCESS_CHANGED')
    require(live['saved'] is None or live['saved'] == {'financial_data': snapshot, 'basis': BASIS}, 'EXISTING_HISTORY_CONFLICT')


def repair_sql(plan):
    # All JSON values are hex encoded by the verified package, never interpolated as SQL.
    expected = db.json_sql(plan['expected'])
    saved = db.json_sql({'financial_data': plan['snapshot'], 'basis': BASIS})
    return """BEGIN;
SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='10s';
SELECT pg_advisory_xact_lock(7337869);
LOCK TABLE public.orders,public.order_claims,public.order_financial_snapshots IN SHARE ROW EXCLUSIVE MODE;
DO $repair$ DECLARE before_state jsonb; after_state jsonb; before_order jsonb; after_order jsonb; BEGIN
SELECT """ + state_expression() + """ INTO before_state;
IF before_state IS DISTINCT FROM """ + expected + """ THEN RAISE EXCEPTION 'HISTORY_CHANGED_AFTER_PREPARE'; END IF;
IF before_state->'rls' IS DISTINCT FROM 'true'::jsonb OR before_state->'grants' IS DISTINCT FROM '["service_role:SELECT"]'::jsonb
 OR before_state->'triggers' IS DISTINCT FROM '0'::jsonb THEN RAISE EXCEPTION 'FINANCIAL_HISTORY_ACCESS_CHANGED'; END IF;
SELECT to_jsonb(o) INTO before_order FROM public.orders o WHERE o.id=1688;
IF before_state->'saved'='null'::jsonb THEN
 INSERT INTO public.order_financial_snapshots(order_id,financial_data,basis) VALUES(1688,""" + db.json_sql(plan['snapshot']) + ",'" + BASIS + """');
ELSIF before_state->'saved' IS DISTINCT FROM """ + saved + """ THEN RAISE EXCEPTION 'EXISTING_HISTORY_CONFLICT'; END IF;
SELECT """ + state_expression() + """ INTO after_state;
SELECT to_jsonb(o) INTO after_order FROM public.orders o WHERE o.id=1688;
IF (before_state-'saved') IS DISTINCT FROM (after_state-'saved') OR before_order IS DISTINCT FROM after_order
 OR after_state->'saved' IS DISTINCT FROM """ + saved + """ THEN RAISE EXCEPTION 'UNEXPECTED_RECOVERY_CHANGE'; END IF;
END $repair$;
COMMIT;
"""


OTHER_SQL = """BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
SELECT json_build_object('remaining',(SELECT count(*) FROM public.orders o LEFT JOIN public.order_financial_snapshots s ON s.order_id=o.id
 WHERE (o.is_claim IS TRUE OR o.status='Рекламация') AND s.order_id IS NULL),
'other',(SELECT jsonb_build_object('id',o.id,'status',o.status,'is_claim',o.is_claim,
 'created_at',o.created_at,'completed_at',o.completed_at,'report_reviewed_at',o.report_reviewed_at,
 'scheduled_date',o.scheduled_date,'pay',o.master_payout,'extras',o.extra_work_amount,'amount',o.amount,
 'master_assigned',(to_jsonb(o)->>'master_staff_id' IS NOT NULL OR to_jsonb(o)->>'master_id' IS NOT NULL),
 'report_status',to_jsonb(o)->>'report_review_status',
 'manual_completions',CASE WHEN jsonb_typeof(to_jsonb(o)->'manual_completion_history')='array' THEN jsonb_array_length(to_jsonb(o)->'manual_completion_history') ELSE 0 END,
 'claim_events',(SELECT count(*) FROM public.order_claims c WHERE c.order_id=o.id)) FROM public.orders o WHERE o.id=1819));
ROLLBACK;"""


def private_json(path, common, limit):
    require(path.stat().st_uid == 0 and path.stat().st_mode & 0o077 == 0, 'EVIDENCE_PERMISSIONS')
    return json.loads(common.read(path, limit))


def load_dependencies():
    global db
    for path, digest in ((PACKAGE, PACKAGE_SHA), (DIAGNOSTIC, DIAGNOSTIC_SHA)):
        require(path.is_file() and path.resolve() == path and not path.is_symlink()
                and path.stat().st_uid == 0 and path.stat().st_mode & 0o022 == 0
                and path.stat().st_size < 1_000_000, 'VERIFIED_TOOL_MISSING')
        require(hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'VERIFIED_TOOL_HASH_CHANGED')
    sys.path.insert(0, str(PACKAGE))
    import database
    import common
    import claim_check
    db = database
    spec = importlib.util.spec_from_file_location('remaining_diagnostic', DIAGNOSTIC)
    diagnostic = importlib.util.module_from_spec(spec); spec.loader.exec_module(diagnostic)
    return common, claim_check, diagnostic


def main():
    global APPLY_ATTEMPTED
    require(sys.argv[1:] in ([], ['--apply']), 'UNKNOWN_OPTION')
    require(os.geteuid() == 0, 'ROOT_REQUIRED')
    apply = sys.argv[1:] == ['--apply']
    common, codec, diagnostic = load_dependencies()
    evidence = private_json(Path('/tmp/bos-remaining-recovery.json'), common, 2_000_000)
    inventory = private_json(Path('/tmp/bos-claim-backups.json'), common, 100000)
    snapshot, candidates = choose_snapshot(evidence)
    target = db.route()
    original_current = next(o for o in evidence['current'] if str(o.get('id')) == '1688')
    # Re-decode every selected archive and compare it with the private diagnostic.
    for candidate in candidates:
        require(type(candidate['backup']) is int and 0 <= candidate['backup'] < len(inventory), 'BACKUP_INDEX_INVALID')
        item = inventory[candidate['backup']]
        require(item['mtime'] == candidate['mtime'], 'BACKUP_METADATA_CHANGED')
        rows, digest = diagnostic.archive_rows(item, {'1688': original_current}, codec, target[0])
        require(rows and digest == candidate['sha256'] and rows.get('1688') == {
            'snapshot': candidate['snapshot'], 'is_claim': False}, 'BACKUP_EVIDENCE_CHANGED')
    live = json.loads(db.query(current_sql(), target=target))
    validate_live(live, snapshot, evidence)
    plan = {'expected': live, 'snapshot': snapshot, 'archives': [c['sha256'] for c in candidates]}
    common.emit('HISTORY_VERIFIED', {'order': '7337869', 'date': '2026-09-30', 'pay': 4506.19})
    changed = False
    if apply:
        if not STAGE.exists(): STAGE.mkdir(mode=0o700)
        require(STAGE.is_dir() and STAGE.resolve() == STAGE and STAGE.stat().st_uid == 0
                and STAGE.stat().st_mode & 0o077 == 0, 'STAGE_UNSAFE')
        logs = STAGE / 'logs'
        if not logs.exists(): logs.mkdir(mode=0o700)
        require(logs.is_dir() and logs.resolve() == logs and logs.stat().st_uid == 0
                and logs.stat().st_mode & 0o077 == 0, 'LOG_DIRECTORY_UNSAFE')
        common.atomic(STAGE / 'evidence.json', json.dumps(plan, ensure_ascii=False, allow_nan=False).encode())
        sql = repair_sql(plan)
        common.atomic(STAGE / 'repair.sql', sql.encode())
        APPLY_ATTEMPTED = True
        db.query(sql, STAGE, 'history-apply', target)
        changed = live['saved'] is None
        verified = json.loads(db.query(current_sql(), STAGE, 'history-verify', target))
        require(verified['saved'] == {'financial_data': snapshot, 'basis': BASIS}, 'HISTORY_POSTCHECK_FAILED')
        common.emit('CLAIM_HISTORY_RESTORED', {'order': '7337869', 'date': '2026-09-30', 'pay': 4506.19})
        common.emit('OPERATIONAL_ORDER_UNCHANGED')
    common.emit('DATABASE_CHANGED', changed)
    # The ambiguous zero-pay manual claim is read only. Do not manufacture its history.
    rest = json.loads(db.query(OTHER_SQL, target=target))
    common.emit('REMAINING_CLAIMS', rest['remaining'])
    other = rest.get('other')
    if other:
        for label, fields in (
            ('OTHER_STATE', ['id', 'status', 'is_claim', 'master_assigned', 'claim_events', 'manual_completions']),
            ('OTHER_DATES', ['created_at', 'completed_at', 'report_reviewed_at', 'scheduled_date']),
            ('OTHER_PAY', ['pay', 'extras', 'amount', 'report_status'])):
            print(label + '=' + json.dumps({k: other[k] for k in fields}, ensure_ascii=False, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        # Imported tool errors contain controlled error codes; never raw SQL/stderr.
        safe = isinstance(error, Stop) or (type(error).__name__ == 'Stop' and type(error).__module__ in ('common', 'remaining_diagnostic'))
        print('RECOVERY_STOPPED=' + (str(error) if safe else type(error).__name__))
        if APPLY_ATTEMPTED: print('VERIFY_DATABASE_STATE=true')
        raise SystemExit(1)
