#!/usr/bin/env python3
"""Synthetic report fixture. Run only inside a network=none namespace."""
import base64
import copy
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import socket
import sys
import threading
import time
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler, Request


def require(ok, label):
    if not ok:
        raise RuntimeError(label)


def body(stream, headers):
    if not headers.get('Transfer-Encoding'):
        size = int(headers.get('Content-Length', 0))
        require(0 <= size <= 1048576, 'BODY_SIZE')
        data = stream.read(size)
        require(len(data) == size, 'BODY_TRUNCATED')
        return data
    require(headers['Transfer-Encoding'].lower() == 'chunked', 'TRANSFER_ENCODING')
    data = b''
    while True:
        line = stream.readline(128)
        require(line.endswith(b'\r\n'), 'CHUNK_HEADER')
        size = int(line.split(b';', 1)[0], 16)
        require(0 <= size <= 1048576-len(data), 'CHUNK_SIZE')
        if size == 0:
            for _ in range(64):
                if stream.readline(4096) == b'\r\n':
                    return data
            raise RuntimeError('CHUNK_TRAILER')
        part = stream.read(size)
        require(len(part) == size and stream.read(2) == b'\r\n', 'CHUNK_TRUNCATED')
        data += part


def signed_session(external_id, secret):
    text = external_id + '.' + str(int(time.time()) + 600)
    sign = base64.urlsafe_b64encode(hmac.new(secret.encode(), text.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
    return text + '.' + sign


def authorized(value, secret):
    try:
        require(value.startswith('Bearer '), 'SERVICE_AUTH')
        head, payload, signature = value[7:].split('.')
        decode = lambda part: base64.urlsafe_b64decode(part + '=' * (-len(part) % 4))
        expected = hmac.new(secret.encode(), (head+'.'+payload).encode(), hashlib.sha256).digest()
        claims = json.loads(decode(payload))
        return (json.loads(decode(head)).get('alg') == 'HS256' and
                hmac.compare_digest(expected, decode(signature)) and
                claims.get('role') == 'service_role' and claims.get('exp', 0) > time.time())
    except Exception:
        return False


def matches(row, query):
    for key, values in query.items():
        if key in ('select', 'limit', 'order', 'offset'):
            continue
        for test in values:
            if test == 'is.null' and row.get(key) is not None:
                return False
            if test.startswith('eq.') and str(row.get(key)) != test[3:]:
                # PostgreSQL serializes boolean filters in lower case.
                if not (isinstance(row.get(key), bool) and str(row[key]).lower() == test[3:]):
                    return False
    return True


def main(config):
    require([n for _, n in socket.if_nameindex()] == ['lo'], 'NETWORK_NOT_ISOLATED')
    people = [dict(id='00000000-0000-0000-0000-00000000000'+str(i), external_id=str(120000+i),
                   role=role, is_active=True, full_name='Synthetic '+role)
              for i, role in ((1, 'master'), (2, 'manager'), (3, 'master'))]
    master, manager, other = people
    initial = dict(id=1, status='Назначена', report_review_status='not_submitted',
                   master_staff_id=master['id'], master_workflow_stage='started',
                   master_started_at='2026-11-10T10:00:00Z', master_agreed_at='2026-11-10T09:00:00Z',
                   updated_at='2026-11-10T10:00:00Z', report_upload_token=None, report_uploaded_at=None,
                   external_source='manual', external_id=None, source='Лемана Про', amount=5000,
                   original_amount=5000, uncompleted_work_amount=0, report_act_url=None, report_photo_urls='[]')
    state = dict(order=copy.deepcopy(initial), patches=0, storage=0, clear=False, empty=False)
    errors = []
    last = {}

    class Mock(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def response(self, value, code=200):
            data = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def rows(self, rows):
            if 'application/vnd.pgrst.object+json' in self.headers.get('Accept', ''):
                return self.response(rows[0] if len(rows) == 1 else None)
            return self.response(rows)

        def handle_request(self):
            raw = body(self.rfile, self.headers)
            parsed = urlsplit(self.path)
            path = parsed.path
            for prefix in ('/rest/v1', '/storage/v1', '/auth/v1'):
                if path.startswith(prefix + '/'):
                    path = path[len(prefix):]
                    break
            require(authorized(self.headers.get('Authorization', ''), config['jwt_secret']), 'UPSTREAM_AUTH')
            query = parse_qs(parsed.query)
            if path == '/business_staff' and self.command == 'GET':
                return self.rows([p for p in people if matches(p, query)])
            if path == '/orders' and self.command in ('GET', 'PATCH'):
                if not matches(state['order'], query):
                    return self.rows([])
                if self.command == 'PATCH':
                    patch = json.loads(raw)
                    require(patch.get('report_review_status') in ('pending', 'approved'), 'UNEXPECTED_WRITE')
                    state['patches'] += 1
                    state['order'].update(patch)
                    if state['clear']:
                        state['order'].update(report_review_status='not_submitted', report_upload_token=None,
                                              report_uploaded_at=None, master_workflow_stage='assigned')
                    if state['empty']:
                        state['empty'] = False
                        return self.rows([])
                return self.rows([copy.deepcopy(state['order'])])
            if path.startswith('/object/sign/business-os-vk-files/orders/1/') and self.command == 'POST':
                return self.response({'signedURL':path+'?token=synthetic-signature'})
            if path.startswith('/object/business-os-vk-files/orders/1/') and self.command == 'POST':
                state['storage'] += 1
                return self.response({'Key':path.removeprefix('/object/')})
            raise RuntimeError('UNEXPECTED_UPSTREAM_ROUTE')

        def checked(self):
            try:
                self.handle_request()
            except Exception as error:
                errors.append(str(error) if isinstance(error, RuntimeError) else type(error).__name__)
                self.response({'error':'FIXTURE_HANDLER_FAILED'}, 500)

        do_GET = do_POST = do_PATCH = checked

    server = ThreadingHTTPServer(('127.0.0.1', 19001), Mock)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None

    opener = build_opener(ProxyHandler({}), NoRedirect())

    def call(slug, value, person=None):
        headers = {'Content-Type':'application/json', 'Origin':'https://homemaster.qd.je'}
        if person:
            headers['X-BOS-Session'] = signed_session(person['external_id'], config['vk_secret'])
        request = Request('http://127.0.0.1:9000/functions/v1/'+slug,
                          data=json.dumps(value).encode(), headers=headers)
        try:
            response = opener.open(request, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            data = json.loads(response.read(65536))
            last.update(slug=slug, status=response.status,
                        error=data.get('error') if re.fullmatch('[A-Z_]{1,80}', str(data.get('error', ''))) else 'OTHER')
            return response.status, data

    def reset():
        state.update(order=copy.deepcopy(initial), patches=0, storage=0, clear=False, empty=False)

    try:
        for _ in range(30):
            try:
                code, data = call('order-lifecycle-api', {'action':'health'})
                if code == 200 and data.get('ok'):
                    break
            except Exception:
                pass
            time.sleep(.5)
        else:
            raise RuntimeError('HEALTH_FAILED')
        code, _ = call('mini-app-api', dict(action='previewFinanceExport'))
        require(code in (401,403), 'FINANCE_AUTH_FAILED')
        for slug in ('order-lifecycle-api', 'report-api'):
            reset()
            token = 'synthetic-'+slug
            urls = []
            for kind in ('act', 'photo'):
                code, data = call('report-api', dict(action='uploadReportFile', order_id=1,
                    upload_token=token, file_kind=kind, file_index=0, file_name=kind+'.pdf',
                    file_mime='application/pdf', file_data=base64.b64encode(b'synthetic-file').decode()), master)
                require(code == 200 and data.get('ok'), 'UPLOAD_FAILED')
                require(data.get('url', '').startswith('https://homemaster.qd.je/'), 'PUBLIC_URL_FAILED')
                urls.append(data['url'])
            request = dict(action='finalizeMasterReport', order_id=1, upload_token=token,
                           act_url=urls[0], photo_urls=[urls[1]], extra_work_done=False,
                           uncompleted_work_done=True, uncompleted_work_amount=1425,
                           uncompleted_work_items=[dict(service_id='lemana_20261111_014',quantity=1.5,unit_price=950)],
                           uncompleted_work_description='Synthetic unfinished item')
            code, _ = call(slug, request)
            require(code in (401, 403) and state['patches'] == 0, 'NO_AUTH_WRITE')
            for actor in (manager, other):
                code, _ = call(slug, request, actor)
                require(code in (401, 403) and state['patches'] == 0, 'ROLE_WRITE')
            invalid = copy.deepcopy(request)
            invalid['uncompleted_work_items'][0]['unit_price'] = 1
            code, _ = call(slug, invalid, master)
            require(code == 400 and state['patches'] == 0, 'PRICE_TAMPER_ACCEPTED')
            invalid['uncompleted_work_items'][0] = dict(service_id='lemana_20261111_006',quantity=1,unit_price=2800)
            code, _ = call(slug, invalid, master)
            require(code == 400 and state['patches'] == 0, 'MINIMUM_AS_DEDUCTION_ACCEPTED')
            code, data = call(slug, request, master)
            require(state['order'].get('uncompleted_work_items',[{}])[0].get('catalog_version') == '2026-11-11', 'PRICE_VERSION_NOT_SAVED')
            require(code == 200 and data.get('ok') and data.get('order', {}).get('report_upload_token') == token,
                    'SUBMIT_FAILED')
            require(state['patches'] == 1 and state['storage'] == 2 and state['order']['amount'] == 3575,
                    'SUBMIT_EFFECTS')
            require(state['order']['master_agreed_at'] == initial['master_agreed_at'] and
                    state['order']['master_staff_id'] == master['id'], 'AGREEMENT_LOST')
            code, data = call(slug, request, master)
            require(code == 200 and data.get('ok') and state['patches'] == 1, 'SUBMIT_RETRY')
            approved = dict(action='reviewReport', id=1, decision='approved', expected_report_token=token,
                            expected_report_uploaded_at=state['order']['report_uploaded_at'])
            code, data = call('order-lifecycle-api', approved, manager)
            require(code == 200 and data.get('ok') and state['order']['report_review_status'] == 'approved',
                    'MANAGER_APPROVAL')
            code, data = call(slug, request, master)
            require(code == 200 and data.get('ok') and state['patches'] == 2 and
                    state['order']['amount'] == 3575, 'APPROVED_RETRY')
            reset()
            state['clear'] = True
            code, data = call(slug, request, master)
            require(code == 409 and data.get('error') == 'REPORT_NOT_SAVED', 'FALSE_SUCCESS_NOT_REJECTED')
            reset()
            state['empty'] = True
            code, data = call(slug, request, master)
            require(code == 200 and data.get('ok') and state['patches'] == 1, 'READ_AFTER_EMPTY_WRITE')
        require(not errors, 'FIXTURE_ERRORS')
        print(json.dumps(dict(isolated=True, roles=True, uploads=True, public_urls=True, submit=True,
                              repeat=True, manager=True, false_success=True, readback=True, deduction=True, lemana_price=True, price_tamper=True, minimum_rule=True)))
    except Exception:
        print('PROBE_DIAGNOSTIC='+json.dumps({'last':last, 'fixture_errors':errors[-3:]}))
        raise
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    try:
        main(json.load(sys.stdin))
    except Exception as error:
        label = str(error) if isinstance(error, RuntimeError) and re.fullmatch('[A-Z_]+', str(error)) else type(error).__name__
        print('PROBE_STOP='+label)
        sys.exit(1)
