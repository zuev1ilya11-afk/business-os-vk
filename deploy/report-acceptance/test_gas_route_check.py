"""Route probe tests: local TLS only, no production keys or remote requests."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.error import URLError
from urllib.request import HTTPSHandler, ProxyHandler, build_opener
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('gas_route_test',ROOT/'gas-route-check.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class RouteTests(unittest.TestCase):
    def test_route_only_changes_target_resolution_and_restores_after_exception(self):
        original = socket.getaddrinfo
        calls = []
        def lookup(host,*args,**kwargs):
            calls.append(host)
            return []
        with patch.object(socket,'getaddrinfo',side_effect=lookup) as resolver:
            with self.assertRaisesRegex(RuntimeError,'fixture'):
                with m.route_target('142.250.1.1'):
                    socket.getaddrinfo(m.TARGET,443)
                    socket.getaddrinfo(m.SOURCE,443)
                    socket.getaddrinfo('untouched.example',443)
                    raise RuntimeError('fixture')
            self.assertIs(socket.getaddrinfo,resolver)
        self.assertEqual(calls,['142.250.1.1','script.google.com','untouched.example'])
        self.assertIs(socket.getaddrinfo,original)

    def test_dns_candidates_reject_private_addresses_and_deduplicate(self):
        answers = [(socket.AF_INET,socket.SOCK_STREAM,6,'',(ip,443))
                   for ip in ('127.0.0.1','10.0.0.1','142.250.1.1','142.250.1.1','142.250.1.2')]
        with patch.object(socket,'getaddrinfo',return_value=answers):
            self.assertEqual(m.candidate_addresses(),['142.250.1.1','142.250.1.2'])

    def test_probe_never_claims_success_for_connection_or_signing_error(self):
        class App:
            def verify_gas(self,key):
                raise RuntimeError('GAS_VERSION_OR_SIGNING_CHECK_FAILED')
        with contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertFalse(m.probe(App(),'fixture-key','142.250.1.1'))
        self.assertNotIn('fixture-key',output.getvalue())
        self.assertIn('GAS_VERSION_OR_SIGNING_CHECK_FAILED',output.getvalue())

    def test_pinned_activation_matches_installed_release_helper(self):
        import hashlib
        self.assertEqual(m.ACTIVATE_SHA,hashlib.sha256((ROOT/'activate.py').read_bytes()).hexdigest())

    def test_rerouting_keeps_https_hostname_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            cert,key = path/'cert.pem',path/'key.pem'
            subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
                '-subj','/CN='+m.TARGET,'-addext','subjectAltName=DNS:'+m.TARGET,
                '-keyout',str(key),'-out',str(cert)],check=True,capture_output=True)
            class Handler(BaseHTTPRequestHandler):
                def do_GET(self):
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'route-confirmed')
                def log_message(self,*args):
                    pass
            server = HTTPServer(('127.0.0.1',0),Handler)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert,key)
            server.socket = context.wrap_socket(server.socket,server_side=True)
            thread = threading.Thread(target=server.serve_forever,daemon=True)
            thread.start()
            try:
                trusted = ssl.create_default_context(cafile=str(cert))
                opener = build_opener(ProxyHandler({}),HTTPSHandler(context=trusted))
                with m.route_target('127.0.0.1'):
                    with opener.open('https://'+m.TARGET+':'+str(server.server_port),timeout=3) as response:
                        self.assertEqual(response.read(),b'route-confirmed')
                    # Same IP, same trusted certificate, wrong hostname must fail.
                    with self.assertRaises(URLError):
                        opener.open('https://127.0.0.1:'+str(server.server_port),timeout=3)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)


if __name__=='__main__':
    unittest.main()
