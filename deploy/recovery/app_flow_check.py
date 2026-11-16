"""Native API acceptance in an existing network-isolated recovery clone only.

No migrations, SQL writes, secret extraction, production traffic or automatic
cleanup. Authenticate the owner normally; use the existing owner-controlled
local role broker. Leave uniquely marked synthetic records for UI inspection.
Only explicit assertions and synthetic identifiers enter the evidence report.
"""
import argparse
import base64
from datetime import datetime, timedelta, timezone
import getpass
import hashlib
import http.client
import io
import json
from pathlib import Path
import re
import secrets
import struct
import time
from urllib.parse import urlsplit
import warnings
import zipfile
import zlib

import app_cli
import app_login_diagnostic as safety
import drill

API = '/api/proxy/'
PATHS = frozenset({safety.GUARD, '/__bos_local_roles', API + 'password-session-api',
    API + 'mini-app-api', API + 'master-workflow-api', API + 'report-api',
    API + 'order-lifecycle-api', API + 'drive-archive-api', '/build-version.js'})
MAX_RESPONSE = 32 * 1024 * 1024


def require(condition, code):
    safety.require(condition, 'FLOW_' + code)


def image_bytes():
    """A valid generated 32x32 checkerboard, not a customer attachment."""
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    rows = b''.join(b'\0' + b''.join(bytes((36, 125, 220) if (x//4+y//4)%2 else (245, 245, 245))
        for x in range(32)) for y in range(32))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 32, 32, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


def local_request(origin, method, path, headers, body):
    match = safety.ORIGIN.fullmatch(origin)
    require(match is not None and 1 <= int(match[1]) <= 65535, 'ORIGIN_INVALID')
    # Storage URLs are reduced to this exact local path by Checker. No redirects.
    storage = re.fullmatch(r'/storage/v1/object/sign/business-os-vk-files/orders/[1-9][0-9]*/'
                           r'flow_[a-f0-9]{16}_[12]/[A-Za-z0-9_.-]+\?token=[A-Za-z0-9_.%-]+', path)
    require(path in PATHS or bool(storage), 'PATH_INVALID')
    require(method in ('GET', 'POST') and (method == 'GET') == (not body), 'REQUEST_INVALID')
    connection = http.client.HTTPConnection('127.0.0.1', int(match[1]), timeout=55)
    try:
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        data = response.read(MAX_RESPONSE + 1)
        require(len(data) <= MAX_RESPONSE, 'RESPONSE_LIMIT')
        return response.status, dict(response.getheaders()), data
    finally:
        connection.close()


class Checker:
    def __init__(self, runner, launch, report, host=local_request, progress=print):
        self.runner, self.launch, self.report = runner, launch, report
        self.host, self.progress = host, progress
        self.tokens, self.grant, self.base, self.ids = {}, '', '', {}
        self.marker = report['marker']

    def isolated(self):
        records = safety.discover(self.runner, self.launch)
        require(set(records) == set(safety.ROLES) and all(
            item.get('State', {}).get('Running') is True for item in records.values()), 'SERVICES_NOT_RUNNING')
        self.base = safety.environment(records['edge']).get('SUPABASE_URL', '')
        parsed = urlsplit(self.base)
        require(parsed.scheme in ('http', 'https') and parsed.hostname == '127.0.0.1'
                and not parsed.username and not parsed.password and not parsed.query
                and not parsed.fragment and parsed.path in ('', '/'), 'GATEWAY_NOT_LOCAL')

    def request(self, step, path, body=None, role='owner', expected=200, binary=False):
        self.report['current_step'] = step
        self.progress('FLOW_CHECK=' + step)
        # Revalidate all six services and mounts before EACH request, including writes.
        self.isolated()
        headers = {'Content-Type': 'application/json', 'Origin': self.launch['origin']}
        if role in self.tokens:
            headers['X-BOS-Session'] = self.tokens[role]
        if path == '/__bos_local_roles' and self.grant:
            headers['X-BOS-Role-Control'] = self.grant
        start = time.monotonic()
        trace = {'step': step, 'method': 'GET' if body is None else 'POST',
                 'route': 'storage_attachment' if path.startswith('/storage/') else path,
                 'started_at': datetime.now(timezone.utc).isoformat(), 'passed': False}
        self.report['checks'].append(trace)
        status, headers, raw = self.host(self.launch['origin'], trace['method'], path, headers,
            b'' if body is None else json.dumps(body, ensure_ascii=False).encode())
        trace.update(http_status=status, elapsed_ms=round((time.monotonic()-start)*1000))
        if status != expected:
            try:
                failed = json.loads(raw)
                known = {'INVALID_ATTACHMENT_URL', 'WORK_NOT_STARTED', 'REPORT_CHANGED',
                         'REPORT_NOT_SAVED', 'REJECTION_REASON_REQUIRED', 'CLAIM_HISTORY_REQUIRED',
                         'STALE_VIEW', 'STALE_EXPORT', 'EMPTY_EXPORT', 'LOCAL_DRILL_EXTERNAL_DISABLED'}
                if isinstance(failed, dict):
                    for key in ('code', 'error'):
                        if isinstance(failed.get(key), str) and failed[key] in known:
                            trace['server_code'] = failed[key]
            except (ValueError, UnicodeError):
                pass
        require(status == expected, step + '_HTTP_' + str(status))
        if binary:
            trace['passed'] = True
            return raw
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeError):
            raise app_cli.Stop('FLOW_' + step + '_INVALID_JSON') from None
        require(isinstance(value, dict) and value.get('ok') is (expected == 200), step + '_RESPONSE_INVALID')
        trace['passed'] = True
        return value

    def api(self, step, function, action, actor='owner', expected=200, **fields):
        return self.request(step, API + function, {'action': action, **fields}, actor, expected)

    def order(self, step, role='owner'):
        result = self.api(step, 'mini-app-api', 'bootstrap', role)
        require(result.get('user', {}).get('role') == role, step + '_ROLE_INVALID')
        rows = [o for o in result.get('orders', []) if str(o.get('id')) == self.ids['order']]
        require(len(rows) == 1 and rows[0].get('order_number') == self.marker, step + '_ORDER_NOT_FOUND')
        return rows[0]

    def snapshot(self, name, order):
        require(str(order.get('id')) == self.ids['order'], 'ORDER_ID_CHANGED')
        # Only the new synthetic order, never arbitrary bootstrap rows or comments.
        self.report['states'][name] = {k: order.get(k) for k in (
            'status', 'report_review_status', 'master_workflow_stage', 'master_payout', 'extra_work_amount')}
        self.report['states'][name]['report_present'] = bool(order.get('report_uploaded_at'))

    def run(self, login, password):
        guard = self.request('ISOLATION_GUARD', safety.GUARD, binary=True)
        require(b'LOCAL_DRILL_EXTERNAL_BLOCKED' in guard, 'GUARD_NOT_RECOGNIZED')
        build = self.request('CAPTURED_BUILD', '/build-version.js', binary=True)
        self.report['captured_build_file_sha256'] = hashlib.sha256(build).hexdigest()
        result = self.api('OWNER_LOGIN', 'password-session-api', 'login', login=login, password=password)
        require(result.get('user', {}).get('role') == 'owner' and isinstance(result.get('session_token'), str)
                and bool(result['session_token']), 'OWNER_REQUIRED')
        self.tokens['owner'] = result['session_token']
        auth = self.request('ROLE_CONTROL', '/__bos_local_roles', {'action': 'authorize'})
        require(isinstance(auth.get('grant'), str) and bool(auth['grant']), 'ROLE_GRANT_MISSING')
        self.grant = auth['grant']
        for role in ('manager', 'dispatcher', 'master'):
            result = self.api('CREATE_' + role.upper(), 'mini-app-api', 'addEmployee',
                full_name=self.marker + ' ' + role, role=role,
                phone='700' + str(secrets.randbelow(100000000)).zfill(8), comment='LOCAL SYNTHETIC CHECK')
            # role is an API payload field here, not the calling identity.
            staff = result.get('user', {})
            require(staff.get('role') == role and str(staff.get('id', '')), 'STAFF_INVALID')
            self.ids[role] = str(staff['id'])
            self.report['synthetic_staff'][role] = self.ids[role]
            switched = self.request('SWITCH_' + role.upper(), '/__bos_local_roles',
                                    {'action': 'switch', 'staff_id': self.ids[role]})
            require(switched.get('current', {}).get('role') == role
                    and bool(switched.get('session_token')), 'ROLE_SWITCH_INVALID')
            self.tokens[role] = switched['session_token']
            boot = self.api('BOOTSTRAP_' + role.upper(), 'mini-app-api', 'bootstrap', role)
            require(boot.get('user', {}).get('role') == role, 'BOOTSTRAP_ROLE_INVALID')
        filters = {'format': 'full', 'master': self.ids['master'], 'selected': self.ids['master']}
        for role in ('dispatcher', 'master'):
            self.api('FINANCE_DENIED_' + role.upper(), 'mini-app-api', 'previewFinanceExport',
                     role, expected=403, filters=filters)
            self.api('DOWNLOAD_DENIED_' + role.upper(), 'mini-app-api', 'downloadFinanceExport',
                     role, expected=403, filters=filters, revision='synthetic')
        today = datetime.now(timezone.utc).date().isoformat()
        visit = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
        payload = dict(request_id=self.marker, order_number=self.marker, received_date=today,
            client=self.marker, phone='+70000000001', address='ТЕСТ: локальная проверка, дом 0',
            work='ТЕСТ: проверка отчёта', source='Лемана Про', original_amount=1000, amount=1000)
        created = self.api('CREATE_ORDER', 'mini-app-api', 'createOrder', 'dispatcher', **payload)['order']
        require(re.fullmatch(r'[1-9][0-9]*', str(created.get('id', ''))), 'ORDER_ID_INVALID')
        self.ids['order'] = str(created['id'])
        self.report['synthetic_order_id'] = self.ids['order']
        duplicate = self.api('RETRY_CREATE_ORDER', 'mini-app-api', 'createOrder', 'dispatcher', **payload)['order']
        require(str(duplicate.get('id')) == self.ids['order'], 'DUPLICATE_ORDER_CREATED')
        self.api('ASSIGN_MASTER', 'mini-app-api', 'updateOrder', 'manager',
                 id=self.ids['order'], master_id=self.ids['master'])
        order = self.order('MASTER_SEES_ORDER', 'master')
        require(str(order.get('master_staff_id')) == self.ids['master'], 'ASSIGNMENT_MISMATCH')
        self.api('CONTACT_ATTEMPT', 'master-workflow-api', 'recordContactAttempt', 'master',
                 id=self.ids['order'], phone='+70000000001', attempt_id=self.marker)
        self.api('CONTACT_RESULT', 'master-workflow-api', 'recordContactResult', 'master',
                 id=self.ids['order'], phone='+70000000001', attempt_id=self.marker,
                 result='agreed', comment='ТЕСТ: звонок не совершался', scheduled_date=visit, scheduled_time='12:00')
        self.api('AGREEMENT', 'master-workflow-api', 'setAgreementSchedule', 'master',
                 id=self.ids['order'], scheduled_date=visit, scheduled_time='12:00')
        for stage in ('departed', 'started'):
            self.api('WORK_' + stage.upper(), 'master-workflow-api', 'setStage', 'master',
                     id=self.ids['order'], stage=stage)
        first = self.submit(1)
        self.api('MASTER_CANNOT_REVIEW', 'order-lifecycle-api', 'reviewReport', 'master', expected=403,
                 id=self.ids['order'], decision='rejected', comment='ТЕСТ',
                 expected_report_token=first['report_upload_token'], expected_report_uploaded_at=first['report_uploaded_at'])
        self.api('MANAGER_RETURNS_REPORT', 'order-lifecycle-api', 'reviewReport', 'manager',
                 id=self.ids['order'], decision='rejected', comment='ТЕСТ: повторная отправка',
                 expected_report_token=first['report_upload_token'], expected_report_uploaded_at=first['report_uploaded_at'])
        returned = self.order('RETURNED_REPORT_RELOAD', 'master')
        require(returned.get('report_review_status') == 'rejected', 'RETURN_NOT_PERSISTED')
        self.snapshot('returned', returned)
        second = self.submit(2)
        require(second['report_upload_token'] != first['report_upload_token'], 'REVISION_NOT_REPLACED')
        payroll_filter = {'format': 'master', 'master': self.ids['master']}
        payroll = self.api('NO_APPROVED_PAYROLL', 'mini-app-api', 'previewFinanceExport', 'manager', filters=payroll_filter)
        require(payroll.get('count') == 0 and payroll.get('empty') is True, 'PREMATURE_PAYROLL')
        self.api('NO_APPROVED_PAYROLL_FILE', 'mini-app-api', 'downloadFinanceExport', 'manager', expected=422,
                 filters=payroll_filter, revision=payroll['revision'])
        for role in ('owner', 'manager'):
            preview = self.api('FINANCE_PREVIEW_' + role.upper(), 'mini-app-api', 'previewFinanceExport', role, filters=filters)
            require(preview.get('count') == 1 and preview.get('expenseCount') == 0, 'FINANCE_ORDER_COUNT')
            # In-progress projected payout is not proof of a completed accrual.
            require(preview.get('total', {}).get('completed') == 0, 'PREMATURE_COMPLETION')
            require(preview.get('total', {}).get('pay') == 0, 'PREMATURE_ACCRUAL')
        raw = self.request('FINANCE_XLSX', API + 'mini-app-api',
            {'action': 'downloadFinanceExport', 'filters': filters, 'revision': preview['revision']}, 'manager', binary=True)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            require(len(archive.infolist()) <= 100 and sum(i.file_size for i in archive.infolist()) < MAX_RESPONSE,
                    'XLSX_LIMIT')
            require('xl/workbook.xml' in archive.namelist() and '[Content_Types].xml' in archive.namelist()
                    and archive.testzip() is None, 'XLSX_INVALID')
        self.report['xlsx'] = {'downloaded': True, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                               'scope': 'ONE_SYNTHETIC_PENDING_ORDER_NOT_APPROVED_PAYROLL'}
        blocked = self.request('EXTERNAL_ARCHIVE_BLOCKED', API + 'drive-archive-api',
                              {'order_id': self.ids['order']}, 'manager', expected=501)
        require(blocked.get('code') == 'LOCAL_DRILL_EXTERNAL_DISABLED', 'ARCHIVE_BLOCK_NOT_RECOGNIZED')
        self.report['status'] = 'PARTIAL_EXTERNAL_ARCHIVE_DISABLED'
        self.report['pending_checks'] = ['approval_and_accrual', 'approved_report_retry', 'concurrent_review',
            'claim_no_reaccrual', 'late_source_event', 'all_sources_live', 'history_ui', 'browser_and_phone_ui']

    def submit(self, revision):
        token = 'flow_' + self.marker[-16:] + '_' + str(revision)
        files, data = {}, image_bytes()
        for kind, index in (('act', 0), ('photo', 1)):
            result = self.api('UPLOAD_' + kind.upper() + '_' + str(revision), 'report-api', 'uploadReportFile', 'master',
                order_id=self.ids['order'], upload_token=token, file_kind=kind, file_index=index,
                file_name='synthetic.png', file_mime='image/png', file_data=base64.b64encode(data).decode())
            url = result.get('url', '')
            parsed, base = urlsplit(url), urlsplit(self.base)
            require(parsed.scheme == base.scheme and parsed.netloc == base.netloc and not parsed.fragment
                    and parsed.path.startswith('/storage/v1/object/sign/business-os-vk-files/orders/'
                        + self.ids['order'] + '/' + token + '/'), 'STORAGE_URL_INVALID')
            downloaded = self.request('READ_' + kind.upper() + '_' + str(revision),
                parsed.path + '?' + parsed.query, binary=True)
            require(downloaded == data, 'ATTACHMENT_BYTES_MISMATCH')
            files[kind] = url
        payload = dict(order_id=self.ids['order'], upload_token=token, act_url=files['act'],
            photo_urls=[files['photo']], extra_work_done=True, extra_work_description='ТЕСТ: допработы',
            extra_work_amount=100, uncompleted_work_done=False, uncompleted_work_amount=0)
        result = self.api('SUBMIT_REPORT_' + str(revision), 'report-api', 'finalizeMasterReport', 'master', **payload)['order']
        retry = self.api('RETRY_REPORT_' + str(revision), 'report-api', 'finalizeMasterReport', 'master', **payload)['order']
        saved = self.order('PENDING_RELOAD_' + str(revision), 'master')
        require(saved.get('report_review_status') == 'pending' and saved.get('status') == 'В работе'
                and saved.get('report_upload_token') == token and bool(saved.get('report_uploaded_at')),
                'REPORT_NOT_PENDING_AFTER_RELOAD')
        require(result.get('report_uploaded_at') == retry.get('report_uploaded_at') == saved['report_uploaded_at'],
                'RETRY_CHANGED_REPORT_REVISION')
        require(float(saved.get('master_payout', -1)) == 552.5 and float(saved.get('extra_work_amount', -1)) == 100,
                'LEMANA_PAYOUT_MISMATCH')
        self.snapshot('pending_' + str(revision), saved)
        return saved

    def close(self):
        if self.grant:
            try:
                self.request('REVOKE_ROLE_CONTROL', '/__bos_local_roles', {'action': 'revoke'})
                self.report['role_control_revoked'] = True
            except Exception:
                self.report['role_control_revoked'] = False
        self.tokens.clear()
        self.grant = ''


def credentials():
    print('Введите логин и пароль владельца тестовой копии. Пароль не отображается и не сохраняется.')
    login = input('Логин: ').strip()
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        password = getpass.getpass('Пароль: ')
    require(1 <= len(login) <= 128 and 1 <= len(password) <= 128, 'CREDENTIALS_INVALID')
    return login, password


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--package-dir', required=True)
    work = Path(parser.parse_args(argv).package_dir)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    suffix = secrets.token_hex(8)
    name = 'BOS-Flow-Check-' + stamp + '-' + suffix[:8] + '.json'
    report = {'format': 1, 'diagnostic': 'LIVE_SYNTHETIC_FLOW', 'status': 'STOPPED',
        'marker': 'BOS-CHECK-' + suffix, 'checks': [], 'states': {}, 'synthetic_staff': {},
        'production_changed': False, 'candidate_code_installed': False,
        'migration_installed': False, 'ui_verified': False, 'approved_payroll_verified': False,
        'credentials_saved': False, 'synthetic_records_retained': True}
    checker = None
    try:
        launch = safety.select_launch(work)
        checker = Checker(drill.DockerRunner(), launch, report)
        checker.isolated()
        report.update(run_id=launch['run_id'], source_manifest_sha256=launch['source_manifest_sha256'])
        login, password = credentials()
        try:
            checker.run(login, password)
        finally:
            login = password = ''
    except (Exception, KeyboardInterrupt) as error:
        reason = getattr(error, 'reason_code', '')
        report['reason'] = reason if isinstance(reason, str) and re.fullmatch(r'[A-Z][A-Z0-9_]{3,110}', reason) else 'FLOW_CHECK_FAILED'
        report['failed_step'] = report.get('current_step', 'PREFLIGHT')
    finally:
        if checker:
            checker.close()
    try:
        app_cli.write_report(work / name, report)
    except OSError:
        print('FLOW_REPORT_WRITE_FAILED')
        return 1
    print(json.dumps({'status': report['status'], 'report': name,
                      'test_order': report.get('synthetic_order_id'), 'marker': report['marker']}, ensure_ascii=True))
    return 0 if report['status'] == 'PARTIAL_EXTERNAL_ARCHIVE_DISABLED' else 1


if __name__ == '__main__':
    raise SystemExit(main())
