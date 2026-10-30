#!/usr/bin/env python3
"""Loopback-only fixture runner. Invoked inside a disposable network namespace."""
import base64
import copy
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import socket
import sys
import threading
import time
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler, Request


def main(config):
    if [n for _, n in socket.if_nameindex()] != ['lo']:
        raise RuntimeError('PROBE_NETWORK_NOT_ISOLATED')
    owner = {'id':'00000000-0000-0000-0000-000000000001','external_id':'123456',
             'role':'owner','is_active':True,'full_name':'Isolated Test'}
    token, uploaded = 'probe-report-token', '2026-10-30T00:00:00+00:00'
    prefix = 'https://139.100.237.167/storage/v1/object/sign/business-os-vk-files/orders/1/' + token
    order = {'id':1,'status':'В работе','report_review_status':'pending','report_type':'work',
             'report_upload_token':token,'report_uploaded_at':uploaded,'updated_at':uploaded,
             'report_act_url':prefix+'/act.pdf?token=fixture',
             'report_photo_urls':json.dumps([prefix+'/photo.jpg?token=fixture']),
             'drive_archive_status':'pending','completed_at':None,'master_staff_id':None}
    state = {'order':order,'claims':0,'finishes':[],'storage':0,'gas':0,'unexpected':[], 'patches':0}

    def service_authorized(value):
        try:
            if not value.startswith('Bearer '):
                return False
            head, payload, signature = value[7:].split('.')
            decode = lambda part: base64.urlsafe_b64decode(part + '=' * (-len(part) % 4))
            if json.loads(decode(head)).get('alg') != 'HS256':
                return False
            expected = hmac.new(config['jwt_secret'].encode(),(head+'.'+payload).encode(),hashlib.sha256).digest()
            claims = json.loads(decode(payload))
            return (hmac.compare_digest(expected,decode(signature)) and claims.get('role')=='service_role'
                    and claims.get('exp',0)>time.time())
        except Exception:
            return False

    class Mock(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def response(self, data, code=200, content_type='application/json'):
            body = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def handle_request(self):
            parsed = urlsplit(self.path)
            path = parsed.path
            for base in ('/rest/v1', '/storage/v1', '/auth/v1'):
                if path.startswith(base + '/'):
                    path = path[len(base):]
                    break
            raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            if path == '/gas':
                fields = parse_qs(raw.decode())
                if fields.get('act_data'):
                    state['gas'] += 1
                    assert fields.get('photos_json') and fields.get('archive_sign')
                return self.response({'ok':True,'drive_folder_url':'https://drive.google.com/drive/folders/isolated',
                                      'drive_folder_id':'isolated','probe':True})
            # The real gateway must forward the fixture service JWT internally.
            if not service_authorized(self.headers.get('Authorization','')):
                state['unexpected'].append('UPSTREAM_SERVICE_AUTH')
                return self.response({'error':'fixture auth'}, 401)
            if path == '/business_staff' and self.command == 'GET':
                value = owner if 'application/vnd.pgrst.object+json' in self.headers.get('Accept','') else [owner]
                return self.response(value)
            if path == '/orders' and self.command in ('GET', 'PATCH'):
                if self.command == 'PATCH':
                    state['patches'] += 1
                    patch = json.loads(raw)
                    assert patch['report_review_status'] == 'approved'
                    assert patch['report_reviewer_staff_id'] == owner['id']
                    state['order'].update(patch)
                value = state['order'] if 'application/vnd.pgrst.object+json' in self.headers.get('Accept','') else [state['order']]
                return self.response(value)
            if path == '/rpc/bos_drive_claim' and self.command == 'POST':
                state['claims'] += 1
                if state['claims'] > 1:
                    return self.response(None)
                assert state['order']['report_review_status'] == 'approved'
                return self.response({'order_id':1,'report_token':token,'report_uploaded_at':uploaded,
                                      'lease':'00000000-0000-0000-0000-000000000099','snapshot':copy.deepcopy(state['order'])})
            if path == '/rpc/bos_drive_finish' and self.command == 'POST':
                state['finishes'].append(json.loads(raw))
                return self.response(True)
            if path.startswith('/object/authenticated/business-os-vk-files/orders/1/' + token + '/') and self.command == 'GET':
                state['storage'] += 1
                return self.response(b'fixture-file', content_type='application/pdf' if path.endswith('.pdf') else 'image/jpeg')
            state['unexpected'].append(self.command + ' ' + path)
            return self.response({'error':'unexpected fixture route'}, 404)

        do_GET = do_POST = do_PATCH = handle_request

    server = ThreadingHTTPServer(('127.0.0.1', 19001), Mock)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    opener = build_opener(ProxyHandler({}), NoRedirect())

    def call(slug, body=None, headers=None, method='POST'):
        request = Request('http://127.0.0.1:9000/functions/v1/' + slug,
                          data=None if body is None else json.dumps(body).encode(), method=method,
                          headers={'Content-Type':'application/json','Origin':'https://homemaster.qd.je',**(headers or {})})
        try:
            response = opener.open(request, timeout=12)
        except HTTPError as error:
            response = error
        with response:
            data = response.read(65536)
            try:
                value = json.loads(data)
            except Exception:
                value = None
            return response.status, value, response.headers

    def require(ok, label):
        if not ok:
            raise RuntimeError(label)

    try:
        for attempt in range(20):
            try:
                status, data, _ = call('order-lifecycle-api', {'action':'health'})
                if status == 200 and data and data.get('ok'):
                    break
            except Exception:
                pass
            time.sleep(0.5)
        else:
            raise RuntimeError('RUNTIME_HEALTH_FAILED')
        cases = {'order-lifecycle-api':{'action':'reviewReport'}, 'report-api':{'action':'finalizeMasterReport'},
                 'report-file-upload':{},'drive-archive-api':{'action':'worker'},
                 'hands-report-api':{'action':'worker'},'push-api':{'action':'status'}}
        for slug, body in cases.items():
            status, data, _ = call(slug, body)
            require(status == 401 and data and data.get('ok') is False, 'AUTH_' + slug)
        for slug in ('order-lifecycle-api','report-api','report-file-upload','drive-archive-api','push-api'):
            status, _, headers = call(slug, method='OPTIONS', headers={'Access-Control-Request-Method':'POST',
                                        'Access-Control-Request-Headers':'content-type,x-bos-session'})
            require(status in (200,204) and headers.get('Access-Control-Allow-Origin') in ('*','https://homemaster.qd.je'), 'CORS_' + slug)
        require(not any(state[k] for k in ('patches','claims','storage','gas')), 'UNAUTHENTICATED_SIDE_EFFECT')
        expiry = str(int(time.time()) + 600)
        message = owner['external_id'] + '.' + expiry
        signature = base64.urlsafe_b64encode(hmac.new(config['vk_secret'].encode(), message.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
        headers = {'X-BOS-Session':message + '.' + signature}
        body = {'action':'reviewReport','id':1,'decision':'approved','expected_report_token':token,
                'expected_report_uploaded_at':uploaded}
        status, data, _ = call('order-lifecycle-api', body, headers)
        require(status == 200 and data and data.get('ok') and state['order']['report_review_status']=='approved', 'APPROVAL_RUNTIME_FAILED')
        require(state['patches']==1 and state['claims']==state['gas']==0, 'APPROVAL_WAITED_FOR_ARCHIVE')
        status, data, _ = call('order-lifecycle-api', body, headers)
        require(status == 200 and data and data.get('ok') and state['patches']==1, 'APPROVAL_RETRY_NOT_IDEMPOTENT')
        status, data, _ = call('drive-archive-api', {'action':'worker'}, {'X-BOS-Drive-Worker':config['worker_key']})
        require(status == 200 and data and data.get('archive_status')=='completed' and data.get('processed')==1, 'ARCHIVE_RUNTIME_FAILED')
        require(state['storage']==2 and state['gas']==1 and len(state['finishes'])==1, 'ARCHIVE_ROUTING_FAILED')
        require(state['finishes'][0]['p_result']['drive_folder_id']=='isolated' and state['finishes'][0]['p_error'] is None, 'ARCHIVE_RECEIPT_FAILED')
        status, data, _ = call('drive-archive-api', {'action':'worker'}, {'X-BOS-Drive-Worker':config['worker_key']})
        require(status == 200 and data and data.get('processed')==0, 'EMPTY_QUEUE_RUNTIME_FAILED')
        status, data, _ = call('gas-bridge-health', method='GET')
        require(status == 200 and data and data.get('ok') and json.loads(data.get('body','{}')).get('probe'), 'GAS_CONFIG_NOT_FORWARDED')
        require(not state['unexpected'], 'UNEXPECTED_UPSTREAM_REQUEST')
        print(json.dumps({'isolated':True,'auth':True,'cors':True,'approval':True,'retry':True,
                          'storage':True,'archive':True,'empty_queue':True,'gas_config':True}), flush=True)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    try:
        main(json.load(sys.stdin))
    except Exception as error:
        # This process has only dummy credentials. Still expose fixed labels only.
        import re
        label = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[A-Za-z0-9_-]+', str(error)) else 'PROBE_FAILED'
        print('RUNTIME_PROBE_STOPPED=' + label, flush=True)
        raise SystemExit(1)
