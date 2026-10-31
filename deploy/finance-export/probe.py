"""Fixture API/REST runner, executed only in a network-none namespace."""
import base64
import copy
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import socket
import sys
import threading
import time
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler, Request
import zipfile


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None


def request(base, body, headers=None):
    opener = build_opener(ProxyHandler({}), NoRedirect())
    req = Request(base + '/functions/v1/mini-app-api', data=json.dumps(body).encode(),
                  headers={'Content-Type': 'application/json', 'Origin': 'https://homemaster.qd.je', **(headers or {})})
    try: response = opener.open(req, timeout=15)
    except HTTPError as error: response = error
    with response:
        data = response.read(4_000_001)
        if len(data) > 4_000_000: raise RuntimeError('PROBE_RESPONSE_LIMIT')
        return response.status, data, response.headers


def require(ok, code):
    if not ok: raise RuntimeError(code)


def public_probe(base):
    status, raw, _ = request(base, {'action': 'health'})
    require(status == 200 and json.loads(raw).get('ok') is True, 'MINI_HEALTH')
    for action in ('previewFinanceExport', 'downloadFinanceExport'):
        status, raw, _ = request(base, {'action': action})
        require(status == 401 and json.loads(raw).get('ok') is False, 'ANONYMOUS_EXPORT')
    return {'health': True, 'anonymous_denied': True}


def fixture_probe(config, fixture):
    require([n for _, n in socket.if_nameindex()] == ['lo'], 'NETWORK_NOT_ISOLATED')
    data = copy.deepcopy(fixture)
    staff = [{ 'id': role, 'external_id': 'probe_' + role, 'full_name': role,
               'role': role, 'is_active': True} for role in ('owner', 'manager', 'master', 'dispatcher')]
    tables = {'business_staff': staff + data['staff'], 'orders': data['orders'],
              'finance_expenses': data['expenses'], 'order_claims': []}
    effects = {'writes': 0, 'unexpected': 0}

    class Mock(BaseHTTPRequestHandler):
        def log_message(self, *args): pass

        def response(self, value, status=200):
            raw = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers(); self.wfile.write(raw)

        def do_GET(self):
            url = urlsplit(self.path); name = url.path.removeprefix('/rest/v1/').lstrip('/')
            if name not in tables:
                effects['unexpected'] += 1; self.response({'error': 'unexpected'}, 404); return
            rows = copy.deepcopy(tables[name]); query = parse_qs(url.query)
            for key, values in query.items():
                if key in ('select', 'order', 'offset', 'limit'): continue
                for value in values:
                    op, _, target = value.partition('.')
                    def keep(row):
                        actual = str(row.get(key, '')).lower() if isinstance(row.get(key), bool) else str(row.get(key, ''))
                        if op == 'eq': return actual == target
                        if op == 'gte': return actual >= target
                        if op == 'lte': return actual <= target
                        raise RuntimeError('MOCK_OPERATOR_UNSUPPORTED')
                    rows = [row for row in rows if keep(row)]
            offset, limit = int(query.get('offset', ['0'])[0]), int(query.get('limit', ['1000'])[0])
            rows = rows[offset:offset + limit]
            if 'application/vnd.pgrst.object+json' in self.headers.get('Accept', ''):
                self.response(rows[0] if len(rows) == 1 else None)
            else: self.response(rows)

        def blocked(self):
            effects['writes'] += 1; self.response({'error': 'writes denied'}, 405)
        do_POST = do_PATCH = do_PUT = do_DELETE = blocked

    server = ThreadingHTTPServer(('127.0.0.1', 19001), Mock)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    def session(role, expiry=None):
        text = 'probe_' + role + '.' + str(expiry or int(time.time()) + 600)
        signature = base64.urlsafe_b64encode(hmac.new(config['vk_secret'].encode(), text.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
        return text + '.' + signature
    def call(action, role='owner', extra=None, token=None):
        return request('http://127.0.0.1:9000', {'action': action, 'filters': data['filters'], **(extra or {})},
                       {'X-BOS-Session': token if token is not None else session(role)})
    try:
        ready = False
        for _ in range(20):
            try: public_probe('http://127.0.0.1:9000'); ready = True; break
            except Exception: time.sleep(0.5)
        require(ready, 'RUNTIME_STARTUP')
        for role in ('owner', 'manager'):
            status, raw, _ = call('previewFinanceExport', role)
            require(status == 200, 'PREVIEW_STATUS_' + role)
            preview = json.loads(raw)
            require(preview['count'] == 7 and preview['total']['revenue'] == 6000
                    and preview['total']['pay'] == 3539.5 and preview['total']['net'] == 2310.5, 'PREVIEW_TOTALS')
            status, raw, headers = call('downloadFinanceExport', role, {'revision': preview['revision']})
            require(status == 200 and 'spreadsheetml' in headers.get('Content-Type', ''), 'DOWNLOAD_STATUS')
            require('no-store' in headers.get('Cache-Control', ''), 'DOWNLOAD_CACHE')
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                require(archive.testzip() is None, 'XLSX_CRC')
                workbook = archive.read('xl/workbook.xml').decode()
                require(all(name in workbook for name in ('Сводка', 'Заявки', 'Работы', 'Мастера', 'Источники', 'Расходы')), 'XLSX_SHEETS')
                require(b'>2310.5<' in archive.read('xl/worksheets/sheet1.xml'), 'XLSX_PROFIT')
        for role in ('master', 'dispatcher'):
            for action in ('previewFinanceExport', 'downloadFinanceExport'):
                require(call(action, role, {'role': 'owner'})[0] == 403, 'ROLE_DENIED')
        for token in ('forged', session('owner', 1)):
            require(call('previewFinanceExport', token=token)[0] == 401, 'SESSION_DENIED')
        require(call('downloadFinanceExport', extra={'revision': 'outdated'})[0] == 409, 'REVISION_DENIED')
        empty = {'filters': {'period': {'start': '2027-01-01', 'end': '2027-01-01'}}}
        status, raw, _ = call('previewFinanceExport', extra=empty)
        require(status == 200 and json.loads(raw)['empty'], 'EMPTY_PREVIEW')
        require(call('downloadFinanceExport', extra={**empty, 'revision': json.loads(raw)['revision']})[0] == 422, 'EMPTY_DOWNLOAD')
        status, raw, _ = call('previewFinanceExport', extra={'filters': {**data['filters'], 'source': 'Руки (Hands)'}})
        require(status == 200 and json.loads(raw)['count'] == 2, 'SOURCE_FILTER')
        require(effects == {'writes': 0, 'unexpected': 0}, 'UNEXPECTED_UPSTREAM_EFFECT')
        return {'xlsx': True, 'totals': True, 'roles': True, 'sessions': True, 'filters': True, 'empty': True, 'writes': False}
    finally:
        server.shutdown(); server.server_close()


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--live']:
            result = public_probe(json.load(sys.stdin)['base'])
        else:
            result = fixture_probe(json.load(sys.stdin), json.loads(Path(sys.argv[1]).read_text()))
        print(json.dumps(result))
    except Exception as error:
        # Only our fixed identifiers; never include a response or arbitrary error.
        code = str(error) if isinstance(error, RuntimeError) and str(error).replace('_', '').isalnum() else type(error).__name__
        print('PROBE_FAILED=' + code)
        raise SystemExit(1)
