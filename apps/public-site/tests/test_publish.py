import importlib.util
import copy
import json
import os
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("publisher", Path(__file__).parents[1] / "ops/publish.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
HASH = "$2a$14$" + "A" * 53
EMAIL = "owner@example.com"


class Files(unittest.TestCase):
    def test_origin_preserves_other_settings(self):
        data = b"# owner settings\nCONTACT=hello\nWEBSITE_STAGING_ORIGIN=old\nKEEP=value\n"
        changed = p.origin_env(data)
        self.assertIn(b"CONTACT=hello\n", changed)
        self.assertIn(b"KEEP=value\n", changed)
        self.assertEqual(changed.count(b"WEBSITE_STAGING_ORIGIN="), 1)
        self.assertEqual(changed.count(b"WEBSITE_STAGING_HTTPS_ORIGIN="), 1)
        self.assertTrue(changed.endswith((p.ORIGIN + "\n").encode()))

    def test_unexpected_env_syntax_is_rejected(self):
        with self.assertRaises(RuntimeError):
            p.origin_env(b"export WEBSITE_STAGING_ORIGIN=foo\n")

    def test_config_requires_hash_and_protects_entire_host(self):
        with self.assertRaises(RuntimeError):
            p.site_block("plaintext\n}", EMAIL)
        block = p.site_block(HASH, EMAIL).decode()
        self.assertIn("basic_auth {", block)
        self.assertIn("header_up -Authorization", block)
        self.assertIn("noindex, nofollow", block)
        self.assertNotIn("/healthz", block)  # no unauthenticated exceptions

    def test_certificate_contact_is_private_configuration_not_embedded(self):
        config = {"apps": {"tls": {"automation": {"policies": [
            {"issuers": [{"module": "acme", "email": EMAIL}]}
        ]}}}}
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(p.certificate_email(config), EMAIL)
            self.assertIsNone(p.certificate_email({}))
            config["apps"]["tls"]["automation"]["policies"].append(
                {"issuers": [{"module": "acme", "email": "other@example.com"}]})
            self.assertIsNone(p.certificate_email(config))
        with patch.dict(os.environ, {"WEBSITE_ACME_EMAIL": EMAIL}, clear=True):
            self.assertEqual(p.certificate_email(config), EMAIL)

    def test_certificate_contact_cannot_inject_configuration(self):
        for invalid in ("", "owner@example.com\n}", "{env.EMAIL}", "owner@example.com {"):
            with self.subTest(email=invalid), self.assertRaises(RuntimeError):
                p.site_block(HASH, invalid)

    def test_letsencrypt_can_reuse_existing_account_without_email_override(self):
        block = p.site_block(HASH).decode()
        self.assertIn("issuer acme https://acme-v02.api.letsencrypt.org/directory", block)
        self.assertNotIn("email ", block)
        self.assertNotIn("zerossl", block)

    def test_atomic_write_preserves_permissions_and_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config"
            path.write_bytes(b"old")
            path.chmod(0o640)
            p.write_atomic(path, b"new")
            self.assertEqual(path.stat().st_mode & 0o777, 0o640)
            link = Path(directory) / "link"
            link.symlink_to(path)
            with self.assertRaises(RuntimeError):
                p.write_atomic(link, b"bad")
            self.assertEqual(path.read_bytes(), b"new")

    def test_restore_does_not_overwrite_concurrent_edit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config"
            path.write_bytes(b"someone else's edit")
            with self.assertRaises(RuntimeError):
                p.restore_owned(path, b"our change", b"old")
            self.assertEqual(path.read_bytes(), b"someone else's edit")


class Transaction(unittest.TestCase):
    def exercise(self, failure=None, existing_env=False, ip=False, switch=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            obj = p.Publisher.__new__(p.Publisher)
            obj.container = "fixture-caddy"
            obj.config = root / "Caddyfile"
            obj.old_config = b"# original employee configuration\n"
            obj.config.write_bytes(obj.old_config)
            obj.old_active = {"old": True}
            obj.acme_email = EMAIL
            obj.ip_preview = ip or switch
            obj.switch_ip = switch
            if obj.ip_preview:
                obj.hostname, obj.https_port, obj.origin = p.PUBLIC_IP, p.IP_PORT, p.ip_origin()
                obj.ip_issuer = {"module": "acme", "ca": p.ACME_DIRECTORY, "profile": "shortlived"}
            if switch:
                obj.old_config += p.ip_site_block(HASH, obj.ip_issuer)
                obj.config.write_bytes(obj.old_config)
                obj.hostname = obj.connect_host = p.SECONDARY_IP
                obj.origin = p.ip_origin(p.SECONDARY_IP)
                obj.password = "S" * 32
                obj.old_access = (f"URL: {p.ip_origin()}\nLogin: preview\nPassword: {obj.password}\n").encode()
                obj.new_access = obj.old_access.replace(p.ip_origin().encode(), obj.origin.encode(), 1)
                obj.new_config = obj.old_config.replace(p.ip_origin().encode(), obj.origin.encode(), 1)
            obj.env = root / ".env"
            obj.old_env = b"CONTACT=keep\n" if existing_env else None
            if existing_env:
                obj.env.write_bytes(obj.old_env)
            obj.new_env = p.origin_env(obj.old_env or b"", obj.origin)
            obj.changed_env = obj.changed_config = False
            events = []
            runtime = dict(obj.old_active)
            stage = {
                "Image": "sha256:unchanged", "Config": {
                    "Image": "synthetic:fixture",
                    "Labels": {"com.docker.compose.project": p.PROJECT}},
                "HostConfig": {"PortBindings": {
                    "4173/tcp": [{"HostIp": "127.0.0.1", "HostPort": "4185"}]}}}
            effective = {"name": p.PROJECT, "services": {p.SERVICE: {
                "environment": {"WEBSITE_ENV": "staging", "WEBSITE_STAGING_ORIGIN": obj.origin,
                                "WEBSITE_STAGING_HTTPS_ORIGIN": obj.origin},
                "ports": [{"host_ip": "127.0.0.1", "published": "4185", "target": 4173}],
                "volumes": [{"type": "volume", "source": "public-site-synthetic-data",
                             "target": "/app/.public-site-stage"}]}}}
            if failure == "ports":
                effective["services"][p.SERVICE]["ports"][0]["host_ip"] = "0.0.0.0"
            def compose(*args):
                if args[0] == "ps":
                    return "fixture-stage\n"
                if args[0] == "config":
                    return json.dumps(effective)
                if args[0] == "logs":
                    return "synthetic startup diagnostic\n"
                self.fail("Unexpected compose mutation")
            def caddy(*args, **kwargs):
                if args[0] == "hash-password":
                    self.assertFalse(switch, "Switch must preserve the existing password/hash")
                    self.assertNotIn(kwargs["data"].strip(), args)
                    return HASH
                self.assertEqual(args[0], "validate")
                if failure == "validation":
                    raise RuntimeError("injected invalid Caddyfile")
                if failure == "final-validation" and "/etc/caddy/Caddyfile" in args:
                    raise RuntimeError("injected final-path validation failure")
                return ""
            def reload(config):
                nonlocal runtime
                events.append("reload")
                if failure == "reload" and len(events) == 2:
                    raise RuntimeError("injected reload failure")
                runtime = {"unexpected": True} if failure == "active-mismatch" and config == {"new": True} else config
            def https(password):
                self.assertGreater(len(password), 20)
                if failure == "https":
                    raise RuntimeError("injected HTTPS failure")
            def restart():
                events.append("stage-up")
                if failure == "stage-up" and len(events) == 1:
                    raise p.CommandError(["docker", "compose", "up"],
                                         subprocess.CompletedProcess([], 1, "", "synthetic unhealthy state"))
            obj.compose = compose
            obj.caddy = caddy
            def adapt(path):
                self.assertEqual(path, "/etc/caddy/Caddyfile", "Must compile the actual filename")
                return {"new": True}
            obj.adapt = adapt
            obj.verify_stage = lambda: None
            obj.staff_fingerprint = lambda: "staff-page-fingerprint"
            obj.restart_stage = restart
            obj.reload = reload
            obj.verify_https = https
            access = root / "access.txt"
            if switch:
                access.write_bytes(obj.old_access)
                access.chmod(0o600)
            with patch.object(p, "BACKUPS", root / "backups"), patch.object(p, "ACCESS", access), \
                    patch.object(p, "active_config", lambda: runtime), \
                    patch.object(p, "certificate_events", return_value=[]), \
                    patch.object(p, "require_free_ip_port"), \
                    patch.object(p, "require_local_secondary_ip"), \
                    patch.object(p, "probe", return_value=(200, {}, b'{"environment":"staging"}')), \
                    patch.object(p, "existing_ip_certificate", return_value="certificate"), \
                    patch.object(p, "verify_ip_isolation"), \
                    patch.object(p, "verify_ip_switch_isolation"), \
                    patch.object(p, "ip_route_fingerprints", return_value=["unchanged"]), \
                    patch.object(p, "run", return_value=json.dumps([stage])):
                if failure:
                    with self.assertRaises(RuntimeError):
                        obj.apply()
                    self.assertEqual(obj.config.read_bytes(), obj.old_config)
                    self.assertEqual(obj.env.read_bytes() if obj.env.exists() else None, obj.old_env)
                    if switch:
                        self.assertEqual(access.read_bytes(), obj.old_access)
                    else:
                        self.assertFalse(access.exists())
                    self.assertEqual(runtime, obj.old_active)
                    if failure in ("https", "reload", "active-mismatch"):
                        self.assertEqual(events.count("reload"), 2)
                        self.assertEqual(events.count("stage-up"), 2)
                    if failure == "active-mismatch":
                        diagnostic = list((root / "backups").glob("*/unexpected-active.json"))
                        self.assertEqual(len(diagnostic), 1)
                        self.assertEqual(diagnostic[0].stat().st_mode & 0o777, 0o600)
                    if failure == "validation":
                        self.assertEqual(events, [])
                    if failure == "stage-up":
                        self.assertEqual(events, ["stage-up", "stage-up"])
                        diagnostic = list((root / "backups").glob("*/staging-start.log"))
                        self.assertEqual(len(diagnostic), 1)
                        self.assertEqual(diagnostic[0].stat().st_mode & 0o777, 0o600)
                else:
                    obj.apply()
                    self.assertEqual(obj.config.read_bytes(), obj.new_config)
                    self.assertEqual(obj.env.read_bytes(), obj.new_env)
                    self.assertEqual(access.stat().st_mode & 0o777, 0o600)
                    self.assertEqual(events, ["stage-up", "reload"])
                    self.assertEqual(runtime, {"new": True})
                    self.assertIn("Login: preview", access.read_text())
                    self.assertIn("URL: " + obj.origin, access.read_text())
                    if switch:
                        self.assertEqual(access.read_bytes(), obj.new_access)
                        self.assertIn(HASH.encode(), obj.config.read_bytes())
            self.assertFalse(list(root.glob("Caddyfile.preview-*")))

    def test_success(self):
        self.exercise()

    def test_failed_validation_never_changes_live_files(self):
        self.exercise("validation")

    def test_failed_reload_restores_both_files(self):
        self.exercise("reload", existing_env=True)

    def test_failed_https_removes_new_env_and_restores_caddy(self):
        self.exercise("https")

    def test_exposed_port_is_rejected_before_restart(self):
        self.exercise("ports")

    def test_failed_stage_boot_restores_origin_without_touching_caddy(self):
        self.exercise("stage-up")

    def test_final_path_validation_failure_restores_both_files(self):
        self.exercise("final-validation")

    def test_actual_configuration_mismatch_still_triggers_rollback(self):
        self.exercise("active-mismatch")

    def test_ip_success_and_exact_origin(self):
        self.exercise(ip=True)

    def test_ip_https_failure_restores_both_files(self):
        self.exercise("https", existing_env=True, ip=True)

    def test_switch_success_preserves_password_and_hash(self):
        self.exercise(existing_env=True, switch=True)

    def test_switch_failed_https_restores_previous_preview_and_access(self):
        self.exercise("https", existing_env=True, switch=True)

    def test_switch_failed_reload_restores_previous_preview_and_access(self):
        self.exercise("reload", existing_env=True, switch=True)


class IPPreview(unittest.TestCase):
    def before(self):
        return {"admin": {"listen": p.ADMIN}, "apps": {
            "http": {"servers": {"srv0": {"listen": [":443"], "routes": [{"fixture": "staff"}]}}},
            "tls": {"automation": {"policies": [{"subjects": [p.PUBLIC_IP], "issuers": [
                {"module": "acme", "ca": p.ACME_DIRECTORY, "profile": "shortlived"}]}]}}}}

    def after(self, before):
        after = copy.deepcopy(before)
        after["apps"]["http"]["servers"]["srv1"] = {
            "listen": [":8443"], "routes": [{"match": [{"host": [p.PUBLIC_IP]}]}],
            "tls_connection_policies": [{"default_sni": p.PUBLIC_IP}]}
        return after

    def test_existing_issuer_must_match_observed_managed_ip_policy(self):
        before = self.before()
        self.assertEqual(p.existing_ip_issuer(before)["profile"], "shortlived")
        before["apps"]["tls"]["automation"]["policies"][0]["issuers"][0]["module"] = "internal"
        with self.assertRaises(RuntimeError):
            p.existing_ip_issuer(before)

    def test_new_listener_cannot_change_old_routes_or_certificate_automation(self):
        before = self.before()
        after = self.after(before)
        p.verify_ip_isolation(before, after)
        changed = copy.deepcopy(after)
        changed["apps"]["http"]["servers"]["srv0"]["routes"] = []
        with self.assertRaises(RuntimeError):
            p.verify_ip_isolation(before, changed)
        changed = copy.deepcopy(after)
        changed["apps"]["tls"]["automation"]["policies"][0]["issuers"][0]["profile"] = "different"
        with self.assertRaises(RuntimeError):
            p.verify_ip_isolation(before, changed)
        changed = copy.deepcopy(after)
        changed["apps"]["http"]["servers"]["srv1"]["routes"] = []
        with self.assertRaises(RuntimeError):
            p.verify_ip_isolation(before, changed)

    def test_switch_only_replaces_owned_block_and_preserves_employee_config(self):
        active = self.before()
        active["apps"]["tls"]["automation"]["policies"][0]["subjects"].append(p.SECONDARY_IP)
        issuer = p.existing_ip_issuer(active)
        original = b"# employee config must remain byte-identical\n" + p.ip_site_block(HASH, issuer)
        updated = p.switch_preview_config(original, active)
        self.assertEqual(updated, b"# employee config must remain byte-identical\n"
                         + p.ip_site_block(HASH, issuer, p.SECONDARY_IP))
        for invalid in (original.replace(b"4185", b"9999"), original + b"# another edit\n",
                        original + p.ip_site_block(HASH, issuer)):
            with self.assertRaises(RuntimeError):
                p.switch_preview_config(invalid, active)

    def test_switch_isolation_rejects_auth_upstream_staff_and_issuer_changes(self):
        before = self.after(self.before())
        preview = before["apps"]["http"]["servers"]["srv1"]
        preview["routes"][0]["handle"] = [{"auth": HASH, "upstream": "127.0.0.1:4185"}]
        preview["tls_connection_policies"][0]["match"] = {"sni": ["", p.PUBLIC_IP]}
        after = copy.deepcopy(before)
        after["apps"]["http"]["servers"]["srv1"]["routes"][0]["match"] = [{"host": [p.SECONDARY_IP]}]
        after["apps"]["http"]["servers"]["srv1"]["tls_connection_policies"][0]["match"]["sni"] = ["", p.SECONDARY_IP]
        p.verify_ip_switch_isolation(before, after)
        for field in ("auth", "upstream"):
            altered = copy.deepcopy(after)
            altered["apps"]["http"]["servers"]["srv1"]["routes"][0]["handle"][0][field] = "changed"
            with self.assertRaises(RuntimeError):
                p.verify_ip_switch_isolation(before, altered)
        altered = copy.deepcopy(after)
        altered["apps"]["http"]["servers"]["srv0"]["routes"] = []
        with self.assertRaises(RuntimeError):
            p.verify_ip_switch_isolation(before, altered)
        altered = copy.deepcopy(after)
        altered["apps"]["tls"]["automation"]["policies"][0]["issuers"][0]["profile"] = "changed"
        with self.assertRaises(RuntimeError):
            p.verify_ip_switch_isolation(before, altered)

    def test_existing_credentials_must_match_previous_ip_and_remain_private(self):
        original = f"URL: {p.ip_origin()}\nLogin: preview\nPassword: {'S' * 32}\n".encode()
        self.assertEqual(p.read_preview_access(original), "S" * 32)
        with self.assertRaises(RuntimeError):
            p.read_preview_access(original.replace(p.PUBLIC_IP.encode(), p.SECONDARY_IP.encode()))

    def test_port_collision_stops_before_staging_or_caddy_changes(self):
        obj = p.Publisher.__new__(p.Publisher)
        obj.ip_preview = True
        obj.verify_stage = Mock()
        with patch.object(p, "require_free_ip_port", side_effect=RuntimeError("port occupied")):
            with self.assertRaisesRegex(RuntimeError, "port occupied"):
                obj.apply()
        obj.verify_stage.assert_not_called()

    def test_untrusted_existing_certificate_stops_before_changes(self):
        obj = p.Publisher.__new__(p.Publisher)
        obj.ip_preview = True
        obj.verify_stage = Mock()
        with patch.object(p, "require_free_ip_port"), \
                patch.object(p, "existing_ip_certificate", side_effect=p.ssl.SSLError("untrusted")):
            with self.assertRaises(p.ssl.SSLError):
                obj.apply()
        obj.verify_stage.assert_not_called()


class Certificates(unittest.TestCase):
    def quota(self, **changes):
        event = {"ts": 100, "level": "error", "logger": "tls.obtain", "identifier": p.SITE,
                 "issuer": "acme-v02.api.letsencrypt.org-directory",
                 "msg": "could not get certificate from issuer",
                 "error": 'HTTP 429 urn:ietf:params:acme:error:rateLimited - too many certificates '
                          '(50) already issued for "qd.je"; retry after 2026-11-07 12:07:44 UTC'}
        return dict(event, **changes)

    def test_quota_guard_respects_ca_timestamp_and_moscow_time(self):
        events = [self.quota()]
        retry = p.certificate_retry_at(events)
        with patch.object(p.time, "time", return_value=retry.timestamp() - 1):
            with self.assertRaisesRegex(RuntimeError, "2026-11-07 15:07:44 MSK"):
                p.require_certificate_quota(events)
        with patch.object(p.time, "time", return_value=retry.timestamp()):
            p.require_certificate_quota(events)

    def test_obtained_certificate_clears_old_quota_and_other_ca_does_not_set_it(self):
        success = self.quota(ts=101, msg="certificate obtained successfully", error="")
        self.assertIsNone(p.certificate_retry_at([self.quota(), success]))
        self.assertIsNone(p.certificate_retry_at([self.quota(issuer="acme.zerossl.com-v2-DV90")]))

    def test_collects_only_this_site_and_sorts_both_docker_streams(self):
        early, late = self.quota(ts=101), self.quota(ts=102)
        other = self.quota(identifier="other.example.com")
        result = subprocess.CompletedProcess([], 0,
            json.dumps(late) + "\n" + json.dumps(other) + "\nnot JSON\n[]",
            json.dumps(early))
        with patch.object(p.subprocess, "run", return_value=result) as docker:
            self.assertEqual(p.certificate_events("fixture"), [early, late])
            self.assertEqual(docker.call_args.args[0][:2], ["docker", "logs"])

    def test_log_failure_does_not_block_recovery(self):
        with patch.object(p.subprocess, "run", side_effect=OSError("log unavailable")):
            self.assertEqual(p.certificate_events("fixture"), [])

    def test_known_quota_stops_before_any_deployment_actions(self):
        obj = p.Publisher.__new__(p.Publisher)
        obj.container = "fixture"
        obj.verify_stage = Mock()
        with patch.object(p, "certificate_events", return_value=[self.quota()]), \
                patch.object(p.time, "time", return_value=0):
            with self.assertRaisesRegex(RuntimeError, "LE_RATE_LIMIT"):
                obj.apply()
        obj.verify_stage.assert_not_called()

    def test_new_quota_stops_https_wait_without_sleep(self):
        obj = p.Publisher.__new__(p.Publisher)
        obj.container = "fixture"
        obj.https_started = 0
        with patch.object(p, "probe", side_effect=OSError("TLS alert")), \
                patch.object(p, "certificate_events", return_value=[self.quota()]), \
                patch.object(p.time, "time", return_value=0), patch.object(p.time, "sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "LE_RATE_LIMIT"):
                obj.verify_https("never printed")
        sleep.assert_not_called()

    def test_timeout_shows_ca_error_without_contact_or_query_secrets(self):
        obj = p.Publisher.__new__(p.Publisher)
        obj.container = "fixture"
        obj.https_started = 0
        event = self.quota(error="Registration failed for owner@example.com https://ca.example/error?key=secret")
        with patch.object(p, "probe", side_effect=OSError("TLS alert")), \
                patch.object(p, "certificate_events", return_value=[event]), \
                patch.object(p.time, "monotonic", side_effect=[0, 301]):
            with self.assertRaisesRegex(RuntimeError, "CA_ERROR: Registration failed") as raised:
                obj.verify_https("never printed")
        self.assertNotIn("owner@example.com", str(raised.exception))
        self.assertNotIn("secret", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
