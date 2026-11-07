"""CI-only Caddy integration, on a disposable GitHub Actions runner."""
import http.server
import importlib.util
import json
from pathlib import Path
import re
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
    block = p.site_block(password_hash, "owner@example.com").decode()
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
                      " profile shortlived\n }\n }\n respond STAFF_FIXTURE\n}\n"
                      "homemaster.qd.je {\n tls {\n"
                      " issuer acme https://acme-v02.api.letsencrypt.org/directory {\n"
                      " email staff-owner@example.com\n }\n }\n respond STAFF_DOMAIN_FIXTURE\n}\n")
        (root / "Caddyfile.validate").write_text(production + block)
        p.run(["docker", "run", "--rm", "-v", f"{root}:/etc/caddy:ro", IMAGE,
               "caddy", "validate", "--config", "/etc/caddy/Caddyfile.validate", "--adapter", "caddyfile"])
        # Adapt the full real TLS configuration without requesting certificates.
        adapted = json.loads(p.run(["docker", "run", "--rm", "-v", f"{root}:/etc/caddy:ro", IMAGE,
                                    "caddy", "adapt", "--config", "/etc/caddy/Caddyfile.validate",
                                    "--adapter", "caddyfile"]))
        policies = adapted["apps"]["tls"]["automation"]["policies"]
        site_policy = [item for item in policies if item.get("subjects") == [p.SITE]]
        assert len(site_policy) == 1
        assert site_policy[0]["issuers"] == [{"module": "acme", "ca": p.ACME_DIRECTORY,
                                               "email": "owner@example.com"}]
        ip_policy = [item for item in policies if "139.100.237.167" in item.get("subjects", [])]
        assert len(ip_policy) == 1
        assert set(ip_policy[0]["subjects"]) == {"139.100.237.167", "136.234.17.113"}
        assert ip_policy[0]["issuers"] == [{"module": "acme",
            "ca": "https://acme-v02.api.letsencrypt.org/directory", "profile": "shortlived"}]
        staff_policy = [item for item in policies if item.get("subjects") == [p.STAFF]]
        assert len(staff_policy) == 1
        assert staff_policy[0]["issuers"] == [{"module": "acme",
            "ca": "https://acme-v02.api.letsencrypt.org/directory", "email": "staff-owner@example.com"}]
        print("CADDY_SITE_ONLY_ZEROSSL_POLICY_OK")
        # TLS was validated above. The HTTP-only route/rollback fixture must not
        # contact a real CA or create accounts while CI exercises authentication.
        http_block, removed = re.subn(r"\n\ttls \{.*?\n\t\}", "", block, flags=re.S)
        assert removed == 1
        # Use the real file_server mechanism: its hide list embeds config filename.
        (root / "index.html").write_text("STAFF_FIXTURE")
        base = "{\n admin 127.0.0.1:12019\n}\nhttp://employee.test:18480 {\n root * /etc/caddy\n file_server\n}\n"
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
            old_active = p.active_config()
            assert old_active == obj.adapt("/etc/caddy/Caddyfile")
            combined = base + http_block.replace(p.SITE + " {", "http://site.test:18480 {")
            candidate = root / "Caddyfile.preview-fixture"
            candidate.write_text(combined)
            candidate_json = obj.adapt("/etc/caddy/" + candidate.name)
            config.write_text(combined)
            obj.caddy("validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")
            desired = obj.adapt("/etc/caddy/Caddyfile")
            # Reproduce the installer failure without exposing secrets in logs.
            assert candidate_json != desired, "Fixture must reproduce filename-dependent adaptation"
            assert "/etc/caddy/Caddyfile.preview-fixture" in json.dumps(candidate_json)
            assert "/etc/caddy/Caddyfile.preview-fixture" not in json.dumps(desired)
            candidate.unlink()
            print("CADDY_FILENAME_MISMATCH_REPRODUCED")
            obj.reload(desired)
            assert p.active_config() == desired
            assert p.probe("employee.test", "/Caddyfile", port=18480)[0] == 404
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
            obj.reload(old_active)
            assert p.active_config() == old_active
            assert p.probe("employee.test", port=18480)[2] == b"STAFF_FIXTURE"
            assert p.probe("site.test", port=18480)[2] != b"WEBSITE_FIXTURE"
            print("CADDY_PUBLISH_SMOKE_OK: validate, auth, headers, isolation, reload and rollback")
        finally:
            subprocess.run(["docker", "rm", "-fv", container], check=False, capture_output=True)
            upstream.shutdown()
            upstream.server_close()


if __name__ == "__main__":
    main()
