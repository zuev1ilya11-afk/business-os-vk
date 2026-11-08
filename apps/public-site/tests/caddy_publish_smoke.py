"""CI-only Caddy integration, on a disposable GitHub Actions runner."""
import http.server
import importlib.util
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import tempfile
import threading
import time
import uuid
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("publish", Path(__file__).parents[1] / "ops/publish.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
IMAGE = "caddy:2.11.7"
PASSWORD = "S" * 32


class Upstream(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        assert self.headers.get("Authorization") is None, "Gateway credential leaked upstream"
        self.send_response(404 if self.path.startswith("/.public-site-stage/") else 200)
        self.end_headers()
        self.wfile.write(b'{"environment":"staging"}' if self.path == "/healthz" else b"WEBSITE_FIXTURE")

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
        assert "zerossl" not in json.dumps(adapted)
        print("CADDY_SITE_ONLY_LE_POLICY_OK")
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
                expected = b'{"environment":"staging"}' if route == "/healthz" else b"WEBSITE_FIXTURE"
                assert code == 200 and body == expected
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
        try:
            ip_preview_smoke(root, password_hash)
        finally:
            upstream.shutdown()
            upstream.server_close()


def ip_preview_smoke(root, password_hash):
    # A disposable test CA and existing IP certificate are loaded before the
    # preview listener is added. Python trusts only this CA during the fixture;
    # neither system trust stores nor any external CA are touched.
    p.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
           "-subj", "/CN=BOS disposable CI CA", "-addext", "basicConstraints=critical,CA:TRUE",
           "-keyout", str(root / "ca.key"), "-out", str(root / "ca.pem")])
    # Model an already-managed certificate in CertMagic's storage, just like
    # the RU server. A manual `tls cert key` loader adds certificate selection
    # tags and is not equivalent to the existing ACME-managed configuration.
    names = ["127.0.0.2", "127.0.0.3", "employee.test"]
    data = root / "data"
    for name in names:
        # Separate SANs prove the secondary-IP probe uses its real local
        # destination, rather than silently matching the default certificate.
        p.run(["openssl", "req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=" + name,
               "-keyout", str(root / "ip.key"), "-out", str(root / "ip.csr")])
        san = ("DNS:" if name == "employee.test" else "IP:") + name
        (root / "ip.ext").write_text("subjectAltName=" + san + "\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n")
        p.run(["openssl", "x509", "-req", "-in", str(root / "ip.csr"), "-CA", str(root / "ca.pem"),
               "-CAkey", str(root / "ca.key"), "-CAcreateserial", "-days", "2", "-extfile", str(root / "ip.ext"),
               "-out", str(root / "ip.pem")])
        location = data / "caddy/certificates/acme-v02.api.letsencrypt.org-directory" / name
        location.mkdir(parents=True, exist_ok=True)
        (location / (name + ".crt")).write_bytes((root / "ip.pem").read_bytes())
        (location / (name + ".key")).write_bytes((root / "ip.key").read_bytes())
        (location / (name + ".json")).write_text(json.dumps({"sans": [name]}))
    context_factory = ssl.create_default_context
    container = "bos-caddy-ip-" + uuid.uuid4().hex[:10]
    base = ("{\n admin 127.0.0.1:12019\n default_sni 127.0.0.3\n}\n"
            "https://127.0.0.2, https://127.0.0.3 {\n"
            " tls {\n"
            " issuer acme https://acme-v02.api.letsencrypt.org/directory {\n"
            " profile shortlived\n }\n }\n respond STAFF_IP_FIXTURE\n}\n"
            "employee.test {\n tls {\n issuer acme https://acme-v02.api.letsencrypt.org/directory {\n"
            " email staff-owner@example.com\n }\n }\n respond STAFF_IP_FIXTURE\n}\n")
    config = root / "Caddyfile"
    config.write_text(base)
    with patch.object(p, "PUBLIC_IP", "127.0.0.3"), patch.object(p, "SECONDARY_IP", "127.0.0.2"), \
            patch.object(p, "STAFF", "employee.test"), \
            patch.object(ssl, "create_default_context", side_effect=lambda: context_factory(cafile=str(root / "ca.pem"))):
        try:
            p.run(["docker", "run", "-d", "--name", container, "--network", "host", "-v",
                   f"{root}:/etc/caddy:ro", "-v", f"{data}:/data", IMAGE,
                   "caddy", "run", "--config", "/etc/caddy/Caddyfile"])
            obj = p.Publisher.__new__(p.Publisher)
            obj.container = container
            obj.ip_preview = True
            obj.hostname, obj.https_port, obj.origin = p.PUBLIC_IP, p.IP_PORT, p.ip_origin()
            for attempt in range(100):
                try:
                    assert p.probe(p.PUBLIC_IP, tls=True)[2] == b"STAFF_IP_FIXTURE"
                    break
                except OSError:
                    time.sleep(0.2)
            else:
                raise RuntimeError("IP fixture did not start")
            original = p.active_config()
            fingerprint = p.existing_ip_certificate()
            routes_before = p.ip_route_fingerprints()
            issuer = p.existing_ip_issuer(original)
            p.require_free_ip_port()
            config.write_bytes(base.encode() + p.ip_site_block(password_hash, issuer))
            obj.caddy("validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")
            desired = obj.adapt("/etc/caddy/Caddyfile")
            p.verify_ip_isolation(original, desired)
            obj.https_started = time.time()
            obj.reload(desired)
            assert p.active_config() == desired
            obj.verify_https(PASSWORD)
            assert p.existing_ip_certificate(p.IP_PORT) == fingerprint
            assert p.ip_route_fingerprints() == routes_before
            assert p.probe(p.PUBLIC_IP, tls=True, port=p.IP_PORT, auth="wrong-password")[0] == 401
            # With no matching route Caddy returns an empty 200 response.
            # Even valid preview credentials must not expose either app here.
            for credentials in (None, PASSWORD):
                wrong_host = p.probe("employee.test", tls=True, port=p.IP_PORT, auth=credentials)
                assert wrong_host[0] == 200 and wrong_host[2] == b"", (wrong_host[0], wrong_host[2])
            assert p.probe("employee.test", tls=True)[2] == b"STAFF_IP_FIXTURE"
            assert p.probe(p.PUBLIC_IP, tls=True, port=p.IP_PORT, auth=PASSWORD)[1]["x-robots-tag"] == "noindex, nofollow"
            # The saved Caddyfile must also survive a full restart in this
            # disposable test. Deployment itself only uses graceful reload.
            p.run(["docker", "restart", container])
            for attempt in range(100):
                try:
                    if p.probe(p.PUBLIC_IP, tls=True, port=p.IP_PORT)[0] == 401:
                        break
                except OSError:
                    pass
                time.sleep(0.2)
            else:
                raise RuntimeError("Persisted IP preview did not restart")
            obj.verify_https(PASSWORD)
            assert p.existing_ip_certificate(p.IP_PORT) == fingerprint
            assert p.ip_route_fingerprints() == routes_before
            # Move the already installed protected preview, preserving the
            # password and every employee route/automation policy.
            old_preview = config.read_bytes()
            primary_config = p.active_config()
            secondary_certificate = p.existing_ip_certificate(host=p.SECONDARY_IP, connect_host=p.SECONDARY_IP)
            assert secondary_certificate != fingerprint
            assert p.probe(p.SECONDARY_IP, tls=True, port=p.IP_PORT, connect_host=p.SECONDARY_IP)[2] == b""
            config.write_bytes(p.switch_preview_config(old_preview, primary_config))
            obj.caddy("validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")
            switched = obj.adapt("/etc/caddy/Caddyfile")
            p.verify_ip_switch_isolation(primary_config, switched)
            obj.reload(switched)
            obj.hostname = obj.connect_host = p.SECONDARY_IP
            obj.origin = p.ip_origin(p.SECONDARY_IP)
            obj.verify_https(PASSWORD)
            assert p.existing_ip_certificate(p.IP_PORT, host=p.SECONDARY_IP, connect_host=p.SECONDARY_IP) == secondary_certificate
            assert p.ip_route_fingerprints() == routes_before
            assert p.probe(p.PUBLIC_IP, tls=True, port=p.IP_PORT, auth=PASSWORD)[2] == b""
            assert p.probe(p.SECONDARY_IP, tls=True, port=p.IP_PORT, connect_host=p.SECONDARY_IP, auth="wrong")[0] == 401
            p.run(["docker", "restart", container])
            obj.verify_https(PASSWORD)
            assert p.ip_route_fingerprints() == routes_before
            config.write_bytes(old_preview)
            obj.reload(primary_config)
            obj.hostname, obj.connect_host, obj.origin = p.PUBLIC_IP, "127.0.0.1", p.ip_origin()
            obj.verify_https(PASSWORD)
            assert p.ip_route_fingerprints() == routes_before
            print("CADDY_IP_SWITCH_OK: distinct trusted certificates, same password, staff routes, restart and rollback")
            logs = p.subprocess.run(["docker", "logs", container], capture_output=True, text=True, check=True)
            assert '"logger":"tls.obtain"' not in logs.stdout + logs.stderr, "No certificate issuance should be attempted"
            config.write_text(base)
            obj.reload(original)
            assert p.active_config() == original
            assert p.ip_route_fingerprints() == routes_before
            p.require_free_ip_port()
            print("CADDY_IP_REUSE_OK: trusted TLS, same certificate, unchanged policy/routes, auth, restart and rollback")
        except Exception as error:
            # These are synthetic test values only; aid diagnosis without any
            # server access or production configuration in CI.
            if isinstance(error, p.CommandError):
                print(error.output)
            result = subprocess.run(["docker", "exec", container, "caddy", "adapt", "--config", "/etc/caddy/Caddyfile"],
                                    capture_output=True, text=True)
            print(result.stdout + result.stderr)
            raise
        finally:
            subprocess.run(["docker", "rm", "-fv", container], check=False, capture_output=True)
            # Restore ownership only of this disposable fixture's bind mount.
            subprocess.run(["docker", "run", "--rm", "-v", f"{data}:/data", "--entrypoint", "chown",
                            IMAGE, "-R", f"{os.getuid()}:{os.getgid()}", "/data"],
                           check=False, capture_output=True)


if __name__ == "__main__":
    main()
