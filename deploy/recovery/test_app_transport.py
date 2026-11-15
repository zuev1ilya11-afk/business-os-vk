import os
import sys
import time
import unittest
from unittest.mock import patch

import app_transport as transport


class LocalRunner:
    def __init__(self, script):
        self.script = script
        self.env = dict(os.environ)

    def _command(self, args):
        return [sys.executable, '-c', self.script]


class InputCallTests(unittest.TestCase):
    def test_binary_stdin_and_concurrent_output(self):
        data = bytes(range(256)) * 4096
        runner = LocalRunner('import sys; sys.stderr.buffer.write(b"e"*131072); '
                             'sys.stderr.flush(); '
                             'sys.stdout.buffer.write(sys.stdin.buffer.read())')
        self.assertEqual(transport.input_call(runner, ['test'], data), data)
        self.assertEqual(runner.last_error, b'e' * 8192)

    def test_nonzero_is_fixed_error_with_private_bounded_stderr(self):
        runner = LocalRunner('import sys; sys.stderr.write("secret-value"); sys.exit(4)')
        with self.assertRaisesRegex(transport.Stop, '^APP_DOCKER_COMMAND_FAILED$'):
            transport.input_call(runner, ['test'], b'')
        self.assertEqual(runner.last_error, b'secret-value')

    def test_stdout_and_stderr_caps(self):
        for target, limit in [('stdout', 1024), ('stderr', 64 * transport.MIB)]:
            runner = LocalRunner(f'import sys; sys.{target}.buffer.write(b"x"*2097152)')
            with self.subTest(target=target):
                with self.assertRaisesRegex(transport.Stop, '^APP_DOCKER_OUTPUT_LIMIT$'):
                    transport.input_call(runner, ['test'], b'', limit=limit)
                self.assertLessEqual(len(runner.last_error), 8192)

    def test_blocked_stdin_times_out_without_deadlock(self):
        runner = LocalRunner('import time; time.sleep(30)')
        before = time.monotonic()
        with self.assertRaisesRegex(transport.Stop, '^APP_DOCKER_COMMAND_TIMEOUT$'):
            transport.input_call(runner, ['test'], b'x' * transport.MIB, timeout=0.15)
        self.assertLess(time.monotonic() - before, 5)

    def test_closed_stdin_fails_without_deadlock(self):
        runner = LocalRunner('import os; os.close(0)')
        with self.assertRaisesRegex(transport.Stop, '^APP_DOCKER_PIPE_FAILED$'):
            transport.input_call(runner, ['test'], b'x' * transport.MIB)

    def test_http_mode_keeps_stdin_open_until_response(self):
        script = ('import os,sys,threading; '
                  'data=sys.stdin.buffer.read(3); ended=threading.Event(); '
                  'threading.Thread(target=lambda:(sys.stdin.buffer.read(1),ended.set()),daemon=True).start(); '
                  'early=ended.wait(0.1); '
                  'os.write(1,b"premature EOF" if early else data); os._exit(0)')
        self.assertEqual(transport.input_call(LocalRunner(script), ['test'], b'abc',
                                             close_stdin=False), b'abc')
        self.assertEqual(transport.input_call(LocalRunner(script), ['test'], b'abc'),
                         b'premature EOF')

    def test_http_mode_closes_stdin_only_after_complete_response(self):
        responses = [b'HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nA\x00Z',
                     b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n'
                     b'3\r\nA\x00Z\r\n0\r\n\r\n']
        for response in responses:
            # Model nc_bloaty: it emits the complete response but does not exit
            # until stdin EOF. An earlier EOF aborts the asynchronous response.
            script = ('import os,sys,threading,time; '
                      'sys.stdin.buffer.read(3); ended=threading.Event(); '
                      'threading.Thread(target=lambda:(sys.stdin.buffer.read(1),ended.set()),daemon=True).start(); '
                      f'os.write(1,{response[:-2]!r}); '
                      'early=ended.wait(0.1); '
                      'exec("if early: os._exit(7)"); '
                      f'os.write(1,{response[-2:]!r}); '
                      'finished=ended.wait(1); os._exit(0 if finished else 8)')
            with self.subTest(response=response):
                result = transport.input_call(LocalRunner(script), ['test'], b'abc',
                    timeout=2, close_stdin=False, output_complete=transport._HTTPFrameComplete('POST'))
                self.assertEqual(result, response)

    def test_unframed_response_fails_promptly_in_http_mode(self):
        runner = LocalRunner('import os,time; os.write(1,b"HTTP/1.1 200 OK\\r\\n\\r\\nbody"); time.sleep(10)')
        before = time.monotonic()
        with self.assertRaisesRegex(transport.Stop, '^APP_HTTP_RESPONSE_FRAMING_REQUIRED$'):
            transport.input_call(runner, ['test'], b'', timeout=2, close_stdin=False,
                                 output_complete=transport._HTTPFrameComplete('GET'))
        self.assertLess(time.monotonic() - before, 1)


class HttpCallTests(unittest.TestCase):
    cid = 'a' * 64

    def request(self, response, **kwargs):
        with patch.object(transport, 'input_call', return_value=response) as call:
            result = transport.http_call(object(), self.cid,
                                         kwargs.get('method', 'POST'),
                                         kwargs.get('path', '/functions/v1/orders-api'),
                                         kwargs.get('headers', {}), kwargs.get('body', b''),
                                         port=kwargs.get('port', 18080))
            return result, call

    def test_binary_post_and_target(self):
        body = b'\x00\xff\r\n\r\nGET / HTTP/1.1\r\n'
        result, call = self.request(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK',
                                    body=body, headers={'Content-Type': 'application/octet-stream',
                                                        'Host': 'external.invalid',
                                                        'Content-Length': '900'})
        self.assertEqual(result, (200, {'content-length': '2'}, b'OK'))
        argv, wire = call.call_args.args[1:]
        self.assertEqual(argv, ['exec', '-i', '--user', 'postgres', self.cid,
                                '/bin/busybox', 'nc', '-w', '60', '127.0.0.1', '18080'])
        head, sent = wire.split(b'\r\n\r\n', 1)
        self.assertEqual(sent, body)
        self.assertIn(f'Content-Length: {len(body)}'.encode(), head)
        self.assertIn(b'Host: 127.0.0.1:18080', head)
        self.assertNotIn(b'external.invalid', wire)
        self.assertIs(call.call_args.kwargs['close_stdin'], False)

    def test_chunked_response_and_hop_headers(self):
        response = (b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n'
                    b'Connection: close, x-private\r\nX-Private: remove\r\n'
                    b'Content-Type: application/octet-stream\r\n\r\n'
                    b'3\r\n\x00\xffx\r\n2\r\nYZ\r\n0\r\n\r\n')
        result, _ = self.request(response)
        self.assertEqual(result, (200, {'content-type': 'application/octet-stream',
                                        'content-length': '5'}, b'\x00\xffxYZ'))

    def test_request_host_matches_generated_caddy_site(self):
        import app_plan
        request = transport._request('GET', '/', {}, b'', app_plan.PORTS['https'])
        host = next(line[6:] for line in request.split(b'\r\n') if line.startswith(b'Host: '))
        self.assertIn(b'http://' + host + b' {', app_plan.CADDY)

    def test_continue_and_no_body(self):
        result, _ = self.request(b'HTTP/1.1 100 Continue\r\n\r\n'
                                 b'HTTP/1.1 204 No Content\r\n\r\n')
        self.assertEqual(result[0], 204)
        self.assertEqual(result[2], b'')
        result, _ = self.request(b'HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n',
                                 method='HEAD')
        self.assertEqual(result[2], b'')

    def test_invalid_request_rejected_before_spawn(self):
        cases = [{'path': 'https://example.com/'}, {'path': '//example.com/'},
                 {'path': '/\r\nHost: evil'}, {'path': '/foo bar'},
                 {'headers': {'X-Test': 'x\r\nInjected: yes'}},
                 {'headers': {'Transfer-Encoding': 'chunked'}}, {'port': 22},
                 {'method': 'CONNECT'}]
        for params in cases:
            with self.subTest(params=params), patch.object(transport, 'input_call') as call:
                with self.assertRaises(transport.Stop):
                    transport.http_call(object(), self.cid, params.get('method', 'GET'),
                                        params.get('path', '/'), params.get('headers', {}),
                                        b'', port=params.get('port', 18080))
                call.assert_not_called()

    def test_malformed_and_ambiguous_responses(self):
        bad = [b'not http secret',
               b'HTTP/1.1 200 OK\nContent-Length: 0\n\n',
               b'HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nx',
               b'HTTP/1.1 200 OK\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\nx',
               b'HTTP/1.1 200 OK\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\nx',
               b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nx',
               b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nx!!0\r\n\r\n',
               b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nContent-Length: 0\r\n\r\n',
               b'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\nHTTP/1.1 200 OK\r\n\r\n',
               b'HTTP/1.1 200 OK\r\nX: value\r\n folded\r\n\r\n',
               b'HTTP/1.1 101 Switching Protocols\r\n\r\n']
        for response in bad:
            with self.subTest(response=response):
                with self.assertRaisesRegex(transport.Stop, '^APP_HTTP_RESPONSE_INVALID$'):
                    self.request(response)

    def test_body_limit(self):
        with patch.object(transport, 'MAX_BODY', 4):
            with self.assertRaisesRegex(transport.Stop, '^APP_HTTP_BODY_LIMIT$'):
                self.request(b'HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n12345')
            with self.assertRaisesRegex(transport.Stop, '^APP_HTTP_BODY_LIMIT$'):
                self.request(b'HTTP/1.1 200 OK\r\n\r\n12345')

    def test_frame_detection_is_incremental(self):
        responses = [
            ('GET', b'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabc'),
            ('HEAD', b'HTTP/1.1 200 OK\r\nContent-Length: 123\r\n\r\n'),
            ('GET', b'HTTP/1.1 204 No Content\r\n\r\n'),
            ('GET', b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n'
                    b'3;foo=bar\r\na\x00c\r\n2\r\nde\r\n0\r\nX-Check: yes\r\n\r\n')]
        for method, response in responses:
            frame = transport._HTTPFrameComplete(method)
            with self.subTest(method=method, response=response):
                for end in range(len(response)):
                    self.assertFalse(frame(bytearray(response[:end])))
                self.assertTrue(frame(bytearray(response)))

    def test_http_timeout_is_propagated(self):
        with patch.object(transport, 'input_call', return_value=b'HTTP/1.1 204 No Content\r\n\r\n') as call:
            transport.http_call(object(), self.cid, 'GET', '/', {}, b'', timeout=10)
        self.assertEqual(call.call_args.kwargs['timeout'], 10)
        self.assertIn('10', call.call_args.args[1])


if __name__ == '__main__':
    unittest.main()
