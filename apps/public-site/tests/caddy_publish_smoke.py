"""CI-only Caddy integration, on a disposable GitHub Actions runner."""
import http.server
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import uuid

spec = importlib.util.spec_from_file_location("publish", Path(__file__).parents[1] / "ops/publish.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
IMAGE = "caddy:2.11.7"
PASSWORD = "synthetic-ci-preview-password"


class Upstream(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        assert self.headers.get("Authorization") is None, "Gateway credential leaked upstream"
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"WEBSITE_FIXTURE")

    def log_message(self, *args):
        pass


def main():
    subprocess.run(["docker", "pull", IMAGE], check=True)
    password_hash = p.run(["docker", "run", "--rm", "-i", IMAGE, "caddy", "hash-password"],
                          data=PASSWORD + "\n").strip()
    block = p.site_block(password_hash).decode()
    container = "bos-caddy-test-" + uuid.uuid4().hex[:10]
    upstream = http.server.ThreadingHTTPServer(("127.0.0.1", 4185), Upstream)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        # The observed RU global/IP directives plus the new protected hostname.
        production = ("{\n admin 127.0.0.1:12019\n default_sni 139.100.237.167\n}\n"
                      "https://139.100.237.167, https://136.234.17.113 {\n"
                      " tls {\n issuer acme https://acme-v02.api.letsencrypt.org/directory {\n"
                      " profile shortlived\n }\n }\n respond STAFF_FIXTURE\n}\n")
        (root / "Caddyfile.validate").write_text(production + block)
        p.run(["docker", "run", "--rm", "-v", f"{root}:/etc/caddy:ro", IMAGE,
               "caddy", "validate", "--config", "/etc/caddy/Caddyfile.validate", "--adapter", "caddyfile"])
        base = "{\n admin 127.0.0.1:12019\n}\nhttp://employee.test:18480 {\n respond STAFF_FIXTURE\n}\n"
        config = root / "Caddyfile"
        config.write_text(base)
        try:
            p.run(["docker", "run", "-d", "--name", container, "--network", "host", "-v",
                   f"{root}:/etc/caddy:ro", IMAGE, "caddy", "run", "--config", "/etc/caddy/Caddyfile"])
            obj = p.Publisher.__new__(p.Publisher)
            obj.container = container
            for attempt in range(100):
                try:
                    assert p.probe("employee.test", port=18480)[2] == b"STAFF_FIXTURE"
                    break
                except OSError:
                    time.sleep(0.2)
            else:
                raise RuntimeError("Fixture did not start")
            assert p.active_config() == obj.adapt("/etc/caddy/Caddyfile")
            config.write_text(base + block.replace(p.SITE + " {", "http://site.test:18480 {"))
            obj.caddy("validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")
            obj.reload()
            assert p.active_config() == obj.adapt("/etc/caddy/Caddyfile")
            assert p.probe("employee.test", port=18480)[2] == b"STAFF_FIXTURE"
            for route in ("/", "/healthz", "/client/", "/staff/", "/client-api/health"):
                code, headers, _ = p.probe("site.test", route, port=18480)
                assert code == 401 and "Basic" in headers["www-authenticate"]
                code, headers, body = p.probe("site.test", route, port=18480, auth=PASSWORD)
                assert code == 200 and body == b"WEBSITE_FIXTURE"
                assert headers["x-robots-tag"] == "noindex, nofollow"
            assert p.probe("site.test", port=18480, auth="wrong-password")[0] == 401
            # Exact old file restoration, through the same graceful reload.
            config.write_text(base)
            obj.reload()
            assert p.probe("employee.test", port=18480)[2] == b"STAFF_FIXTURE"
            assert p.probe("site.test", port=18480)[2] != b"WEBSITE_FIXTURE"
            print("CADDY_PUBLISH_SMOKE_OK: validate, auth, headers, isolation, reload and rollback")
        finally:
            subprocess.run(["docker", "rm", "-fv", container], check=False, capture_output=True)
            upstream.shutdown()
            upstream.server_close()


if __name__ == "__main__":
    main()
