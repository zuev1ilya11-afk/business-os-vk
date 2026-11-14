"""Real Docker CLI template regression against a synthetic local Engine API.

No Docker daemon, container, image pull, elevated rights, or external network
is required. If Docker CLI is missing, explicitly skip these integration tests.
The ordinary unit suite should still exercise collector partial-failure output.
"""
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import socketserver
import subprocess
import tempfile
import threading
import unittest
from urllib.parse import urlsplit

CLI = shutil.which('docker')
OLD_FORMAT = '{{json .Id}}\t{{json .Name}}\t{{json .Image}}\t{{json .Config.Image}}\t{{json .State.Status}}\t{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}\t{{json .Mounts}}'


def fixture(kind):
    value = {
        'Id': 'a' * 64,
        'Name': '/bos-fixture-' + kind,
        'Image': 'sha256:' + 'b' * 64,
        'Config': {'Image': 'fixture/image:1'},
        'State': {'Status': 'running', 'Running': True},
        'Mounts': [],
    }
    if kind == 'null':
        value['State']['Health'] = None
    elif kind != 'missing':
        value['State']['Health'] = {'Status': kind, 'FailingStreak': 0, 'Log': []}
    return value


class EngineHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def reply(self, status, body, content_type='application/json'):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Api-Version', '1.44')
        self.send_header('Docker-Experimental', 'false')
        self.send_header('Ostype', 'linux')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(raw)

    def handle_read(self):
        path = urlsplit(self.path).path
        self.server.seen.append((self.command, path))
        if path == '/_ping':
            return self.reply(200, b'OK', 'text/plain')
        if path in ('/version', '/v1.44/version'):
            return self.reply(200, {'Version': '26.0.0-fixture', 'ApiVersion': '1.44', 'MinAPIVersion': '1.24', 'Os': 'linux', 'Arch': 'amd64'})
        match = re.fullmatch(r'(?:/v[0-9.]+)?/containers/(missing|null|healthy|unhealthy)/json', path)
        if match:
            return self.reply(200, fixture(match.group(1)))
        return self.reply(404, {'message': 'Only the synthetic inspect endpoint is supported'})

    do_GET = handle_read
    do_HEAD = handle_read

    def do_POST(self):
        self.server.seen.append((self.command, urlsplit(self.path).path))
        self.reply(405, {'message': 'Mutations are forbidden in this synthetic Engine'})

    do_DELETE = do_POST
    do_PUT = do_POST
    do_PATCH = do_POST


class ThreadingUnixHTTPServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


@unittest.skipUnless(CLI, 'Docker CLI unavailable; real-template integration not executed')
class DockerTemplateIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='bos-engine-template-')
        script = Path(os.environ.get('BOS_COLLECTOR_SCRIPT', Path(__file__).resolve().parents[1] / 'scripts/audit-production-readonly.py'))
        namespace = {'__name__': 'audit_docker_template_under_test'}
        exec(compile(script.read_bytes(), str(script), 'exec'), namespace)
        cls.current_format = namespace['DOCKER_FORMAT']
        cls.socket_path = str(Path(cls.temp.name) / 'engine.sock')
        cls.server = ThreadingUnixHTTPServer(cls.socket_path, EngineHandler)
        cls.server.seen = []
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.env = {k: v for k, v in os.environ.items() if not k.startswith('DOCKER_')}
        cls.env['DOCKER_API_VERSION'] = '1.44'
        cls.base = [CLI, '--config', cls.temp.name, '--host', 'unix://' + cls.socket_path]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.temp.cleanup()

    def inspect(self, kind, template):
        return subprocess.run(self.base + ['inspect', '--type', 'container', '--format', template, kind],
                              env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, timeout=10, check=False)

    def test_old_format_fails_missing_health_but_short_probe_succeeds(self):
        short = self.inspect('missing', '{{if .State.Health}}ok{{else}}none{{end}}')
        self.assertEqual(short.returncode, 0, short.stderr)
        self.assertEqual(short.stdout.strip(), 'none')
        old = self.inspect('missing', OLD_FORMAT)
        self.assertNotEqual(old.returncode, 0)
        self.assertIn('Health', old.stderr)
        self.assertIn('template', old.stderr.lower())

    def test_new_format_preserves_missing_null_healthy_and_unhealthy(self):
        for kind, expected in [('missing', None), ('null', None), ('healthy', 'healthy'), ('unhealthy', 'unhealthy')]:
            with self.subTest(kind=kind):
                result = self.inspect(kind, self.current_format)
                self.assertEqual(result.returncode, 0, result.stderr)
                columns = [json.loads(value) for value in result.stdout.strip().split('\t')]
                self.assertEqual(columns[0], 'a' * 64)
                self.assertEqual(columns[1], '/bos-fixture-' + kind)
                self.assertEqual(columns[4], 'running')
                self.assertEqual(columns[5], expected)
                self.assertEqual(columns[6], [])
        self.assertTrue(self.server.seen)
        self.assertTrue(all(method in ('GET', 'HEAD') for method, _ in self.server.seen), self.server.seen)


if __name__ == '__main__':
    unittest.main(verbosity=2)
