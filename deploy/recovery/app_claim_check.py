"""Read-only business-data evidence for one existing synthetic reclamation.

Uses the same strict local-clone checks and normal owner login as flow v2.
Only login, role control and bootstrap are allowed. No SQL, report submission,
record creation, migrations, repairs, file uploads or production requests.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import secrets

import app_cli
import app_flow_check as flow
import app_login_diagnostic as safety
import drill


def prior_input(work, launch):
    candidates = sorted(p for p in work.glob('BOS-Flow-Check-*.json')
        if re.fullmatch(r'BOS-Flow-Check-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.json', p.name))
    flow.require(0 < len(candidates) <= 512, 'CLAIM_PRIOR_REPORT_NOT_FOUND')
    raw, _ = safety.drill_files._read(candidates[-1], limit=1024*1024, collect=True)
    prior = json.loads(raw, object_pairs_hook=safety.drill_files._unique_pairs)
    flow.require(isinstance(prior, dict) and prior.get('format') == 2
        and prior.get('diagnostic') == 'LIVE_SYNTHETIC_FLOW'
        and prior.get('status') == 'PARTIAL_EXTERNAL_ARCHIVE_DISABLED', 'CLAIM_PRIOR_REPORT_INVALID')
    flow.require(prior.get('run_id') == launch['run_id']
        and prior.get('source_manifest_sha256') == launch['source_manifest_sha256'], 'CLAIM_CLONE_MISMATCH')
    flow.require(re.fullmatch(r'BOS-CHECK-[0-9a-f]{16}', str(prior.get('marker', '')))
        and re.fullmatch(r'[1-9][0-9]{0,17}', str(prior.get('synthetic_order_id', '')))
        and re.fullmatch(r'[0-9a-f]{64}', str(prior.get('captured_build_file_sha256', ''))), 'CLAIM_PRIOR_IDENTITY_INVALID')
    staff = prior.get('synthetic_staff')
    flow.require(isinstance(staff, dict) and isinstance(staff.get('master'), str)
        and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', staff['master']), 'CLAIM_PRIOR_MASTER_INVALID')
    return prior


def financial_facts(order):
    """No free-text fields, identities, attachments or server messages escape."""
    out = {}
    choices = {'status': {'В работе', 'Выполнена', 'Рекламация', 'Отменена', 'Новая'},
        'report_review_status': {'pending', 'approved', 'rejected'},
        'financial_snapshot_status': {'other_master'}}
    for key, allowed in choices.items():
        value = order.get(key)
        out[key] = value if value in allowed else None
    out['is_claim'] = order.get('is_claim') is True
    out['report_present'] = bool(order.get('report_uploaded_at'))
    for key in ('master_payout', 'extra_work_amount', 'uncompleted_work_amount', 'claim_revisit_payment'):
        try:
            n = float(order[key]) if order.get(key) is not None and not isinstance(order[key], bool) else None
            out[key] = n if n is not None and math.isfinite(n) and abs(n) <= 1e12 else None
        except (ValueError, TypeError, OverflowError):
            out[key] = None
    for key in ('completed_at', 'report_reviewed_at', 'scheduled_date', 'claim_opened_at', 'claim_closed_at'):
        value = order.get(key)
        out[key] = value if isinstance(value, str) and re.fullmatch(r'[0-9TZ:+. -]{10,40}', value) else None
    return out


def snapshot_facts(order):
    snap = order.get('financial_snapshot')
    valid = isinstance(snap, dict) and str(snap.get('id')) == str(order.get('id')) and snap.get('status') == 'Выполнена'
    return {'present': valid, 'fields': financial_facts(snap) if valid else None}


class Checker(flow.Checker):
    def request(self, step, path, body=None, role='owner', expected=200, binary=False):
        permitted = (body is None and path in (safety.GUARD, '/build-version.js')) or (
            isinstance(body, dict) and ((path == flow.API+'password-session-api' and body.get('action') == 'login')
            or (path == flow.API+'mini-app-api' and body == {'action': 'bootstrap'})
            or (path == '/__bos_local_roles' and body.get('action') in ('authorize', 'switch', 'revoke'))))
        flow.require(permitted, 'CLAIM_READ_ONLY_ROUTE_REQUIRED')
        return super().request(step, path, body, role, expected, binary)

    def run(self, login, password, prior):
        self.ids = {'order': str(prior['synthetic_order_id']), 'master': prior['synthetic_staff']['master']}
        guard = self.request('ISOLATION_GUARD', safety.GUARD, binary=True)
        flow.require(b'LOCAL_DRILL_EXTERNAL_BLOCKED' in guard, 'GUARD_NOT_RECOGNIZED')
        build = self.request('CAPTURED_BUILD', '/build-version.js', binary=True)
        flow.require(hashlib.sha256(build).hexdigest() == prior['captured_build_file_sha256'], 'CLAIM_BUILD_CHANGED')
        result = self.api('OWNER_LOGIN', 'password-session-api', 'login', login=login, password=password)
        flow.require(result.get('user', {}).get('role') == 'owner' and isinstance(result.get('session_token'), str)
            and bool(result['session_token']), 'OWNER_REQUIRED')
        self.tokens['owner'] = result['session_token']
        boot = self.api('OWNER_BOOTSTRAP', 'mini-app-api', 'bootstrap')
        flow.require(boot.get('user', {}).get('role') == 'owner', 'OWNER_REQUIRED')
        staff = [s for s in boot.get('users', []) if str(s.get('id')) == self.ids['master']]
        flow.require(len(staff) == 1 and staff[0].get('role') == 'master' and staff[0].get('is_active') is True
            and staff[0].get('full_name') == self.marker+' master', 'CLAIM_MASTER_CHANGED')
        rows = [o for o in boot.get('orders', []) if str(o.get('id')) == self.ids['order']]
        flow.require(len(rows) == 1 and rows[0].get('order_number') == self.marker
            and rows[0].get('client') == self.marker, 'CLAIM_ORDER_CHANGED')
        order = rows[0]
        self.report['owner_order'] = financial_facts(order)
        self.report['owner_snapshot'] = snapshot_facts(order)
        self.report['still_assigned_to_test_master'] = str(order.get('master_staff_id')) == self.ids['master']
        self.grant = self.request('ROLE_CONTROL', '/__bos_local_roles', {'action': 'authorize'}).get('grant', '')
        flow.require(isinstance(self.grant, str) and bool(self.grant), 'ROLE_GRANT_MISSING')
        switched = self.request('SWITCH_MASTER', '/__bos_local_roles', {'action': 'switch', 'staff_id': self.ids['master']})
        flow.require(switched.get('current', {}).get('role') == 'master'
            and isinstance(switched.get('session_token'), str) and bool(switched['session_token']), 'ROLE_SWITCH_INVALID')
        self.tokens['master'] = switched['session_token']
        master = self.api('MASTER_BOOTSTRAP', 'mini-app-api', 'bootstrap', 'master')
        flow.require(master.get('user', {}).get('role') == 'master', 'BOOTSTRAP_ROLE_INVALID')
        own = [o for o in master.get('orders', []) if str(o.get('id')) == self.ids['order']]
        flow.require(len(own) <= 1, 'CLAIM_DUPLICATE_ORDER')
        self.report['master_order'] = financial_facts(own[0]) if own else None
        self.report['master_snapshot'] = snapshot_facts(own[0]) if own else {'present': False, 'fields': None}
        history = [o for o in master.get('user', {}).get('financial_history', []) if str(o.get('id')) == self.ids['order']]
        self.report['master_history'] = [financial_facts(o) for o in history[:2]]
        snap = self.report['owner_snapshot']
        fields = snap['fields'] or {}
        self.report['finding'] = ('ORIGINAL_ACCRUAL_PRESERVED_IN_API' if snap['present']
            and fields.get('master_payout') == 552.5 and fields.get('extra_work_amount') == 100
            else 'ORIGINAL_ACCRUAL_DIFFERS_REVIEW_REQUIRED' if snap['present']
            else 'HISTORICAL_SNAPSHOT_MISSING' if order.get('is_claim') or order.get('status') == 'Рекламация'
            else 'NO_CLAIM_SNAPSHOT_ON_THIS_ORDER')
        self.report['status'] = 'CHECK_COMPLETE'


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--package-dir', required=True)
    work = Path(parser.parse_args(argv).package_dir)
    name = 'BOS-Claim-Check-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+secrets.token_hex(4)+'.json'
    report = {'format': 1, 'diagnostic': 'SYNTHETIC_CLAIM_READ_ONLY', 'status': 'STOPPED',
        'checks': [], 'business_data_changed': False, 'production_changed': False,
        'candidate_code_installed': False, 'credentials_saved': False}
    checker = None
    try:
        launch = safety.select_launch(work)
        prior = prior_input(work, launch)
        report.update(marker=prior['marker'], synthetic_order_id=str(prior['synthetic_order_id']),
            run_id=launch['run_id'], source_manifest_sha256=launch['source_manifest_sha256'])
        checker = Checker(drill.DockerRunner(), launch, report)
        checker.isolated()
        login, password = flow.credentials()
        try:
            checker.run(login, password, prior)
        finally:
            login = password = ''
    except (Exception, KeyboardInterrupt) as error:
        reason = getattr(error, 'reason_code', '')
        report['reason'] = reason if isinstance(reason, str) and re.fullmatch(r'[A-Z][A-Z0-9_]{3,110}', reason) else 'CLAIM_CHECK_FAILED'
        report['failed_step'] = report.get('current_step', 'PREFLIGHT')
    finally:
        if checker:
            checker.close()
    try:
        app_cli.write_report(work/name, report)
    except OSError:
        print('CLAIM_REPORT_WRITE_FAILED')
        return 1
    print(json.dumps({'status': report['status'], 'finding': report.get('finding'), 'report': name}, ensure_ascii=True))
    return 0 if report['status'] == 'CHECK_COMPLETE' else 1


if __name__ == '__main__':
    raise SystemExit(main())
