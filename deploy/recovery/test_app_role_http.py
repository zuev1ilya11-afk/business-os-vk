"""Role control is a local-only JSON capability endpoint, never an upstream route."""
import http.client
import json
import threading
import unittest

import app_browser


class FakeRoles:
    def __init__(self):
        self.calls = []
        self.closed = False

    def handle(self, *args):
        self.calls.append(args)
        return 200, {'ok': True, 'current': {'name': 'Synthetic owner'}}

    def close(self):
        self.closed = True


class RoleHTTPTests(unittest.TestCase):
    def setUp(self):
        self.upstream = []
        def transport(*args):
            self.upstream.append(args)
            return 200, {'Content-Type': 'text/html'}, b'<head><script>captured()</script></head>'
        self.portal = app_browser.LocalPortal(transport)
        self.roles = FakeRoles()
        self.portal.role_switcher = self.roles
        self.thread = threading.Thread(target=self.portal.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close)

    def close(self):
        self.portal.shutdown()
        self.thread.join(timeout=2)

    def request(self, method='POST', path=app_browser.ROLE_PATH, body=b'{"action":"list"}',
                changes=None, duplicates=()):
        headers = {'Host': self.portal.host, 'Origin': self.portal.origin,
                   'Content-Type': 'application/json', 'X-BOS-Session': 'synthetic-session',
                   'X-BOS-Role-Control': 'synthetic-grant', 'Content-Length': str(len(body))}
        for key, value in (changes or {}).items():
            if value is None:
                headers.pop(key, None)
            else:
                headers[key] = value
        connection = http.client.HTTPConnection('127.0.0.1', self.portal.server.server_address[1], timeout=3)
        try:
            connection.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
            for key, value in list(headers.items()) + list(duplicates):
                connection.putheader(key, value)
            connection.endheaders(body)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_strict_local_request_dispatches_once_and_never_forwards_control(self):
        status, headers, body = self.request(body=b'{"action":"switch","staff_id":"master-1"}')
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)['ok'])
        self.assertEqual(self.roles.calls, [('switch', {'staff_id': 'master-1'},
                                            'synthetic-session', 'synthetic-grant')])
        self.assertEqual(self.upstream, [])
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertNotIn('Access-Control-Allow-Origin', headers)

    def test_foreign_missing_origins_hosts_and_ambiguous_headers_denied(self):
        for changes in ({'Origin': None}, {'Origin': 'null'}, {'Origin': 'https://outside.invalid'},
                        {'Host': 'localhost'}, {'Sec-Fetch-Site': 'cross-site'},
                        {'Content-Type': 'text/plain'}, {'X-BOS-Session': None},
                        {'X-BOS-Session': 'x' * 1025}, {'X-BOS-Role-Control': 'x' * 129}):
            with self.subTest(changes=changes):
                self.assertIn(self.request(changes=changes)[0], (400, 403))
        for key, value in (('X-BOS-Session', 'other'), ('X-BOS-Role-Control', 'other'),
                           ('Origin', self.portal.origin), ('Content-Type', 'application/json')):
            self.assertIn(self.request(duplicates=[(key, value)])[0], (400, 403))
        self.assertEqual(self.roles.calls, [])
        self.assertEqual(self.upstream, [])

    def test_methods_query_encoded_paths_and_invalid_bodies_denied(self):
        self.assertEqual(self.request(method='GET')[0], 405)
        for path in (app_browser.ROLE_PATH + '?secret=1', '/%5f_bos_local_roles',
                     app_browser.ROLE_PATH + '/extra'):
            self.assertEqual(self.request(path=path)[0], 404)
        for body in (b'[]', b'{}', b'{"action":1}', b'{"action":"list","action":"switch"}',
                     b'\xff', b'not json'):
            self.assertEqual(self.request(body=body)[0], 400)
        self.assertEqual(self.request(body=b'x' * 2049)[0], 413)
        self.assertEqual(self.roles.calls, [])
        self.assertEqual(self.upstream, [])

    def test_role_assets_exist_only_when_explicitly_enabled(self):
        status, _, html = self.request(method='GET', path='/', body=b'')
        self.assertEqual(status, 200)
        self.assertLess(html.index(app_browser.GUARD_PATH.encode()), html.index(app_browser.ROLE_SCRIPT_PATH.encode()))
        self.assertLess(html.index(app_browser.ROLE_SCRIPT_PATH.encode()), html.index(b'captured()'))
        self.assertEqual(self.request(method='GET', path=app_browser.ROLE_SCRIPT_PATH, body=b'')[0], 200)
        self.portal.role_switcher = None
        self.assertEqual(self.request()[0], 404)
        self.assertEqual(self.request(method='GET', path=app_browser.ROLE_SCRIPT_PATH, body=b'')[0], 404)
        self.assertNotIn(app_browser.ROLE_SCRIPT_PATH.encode(), self.request(method='GET', path='/', body=b'')[2])
        self.assertEqual(len(self.upstream), 2)

    def test_unexpected_backend_errors_do_not_expose_values(self):
        def fail(*args):
            raise RuntimeError('synthetic-private-key')
        self.roles.handle = fail
        status, _, body = self.request()
        self.assertEqual(status, 503)
        self.assertNotIn(b'synthetic-private-key', body)
        self.assertEqual(self.upstream, [])


if __name__ == '__main__':
    unittest.main()
