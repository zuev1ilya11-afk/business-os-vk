import json
from pathlib import Path
from tempfile import TemporaryDirectory
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ops"))
import publish
import release as r


class Config(unittest.TestCase):
    def test_switch_only_the_domain_preview(self):
        hashed = "$2a$14$" + "A" * 53
        host = publish.site_block(hashed)
        ip = publish.ip_site_block(hashed, {"module": "acme", "ca": publish.ACME_DIRECTORY, "profile": "shortlived"})
        base = b"homemaster.qd.je {\n respond staff\n}\n" + ip
        raw, mode, port = r.managed_part(base + host)
        self.assertEqual((mode, port), ("preview", None))
        updated = (base + host).replace(raw, r.block("phone", 4186))
        self.assertIn(base, updated)
        self.assertEqual(r.managed_part(updated)[1:], ("phone", 4186))
        self.assertNotIn(b"127.0.0.1:4181", updated)

    def test_unowned_vhost_or_modified_block_is_rejected(self):
        for data in (b"site.homemaster.qd.je {\n respond other\n}\n",
                     r.block("online", 4186).replace(b"reverse_proxy", b"# reverse_proxy"),
                     r.block("phone", 4186) * 2, r.BEGIN + b"\n"):
            with self.subTest(config=data), self.assertRaises(RuntimeError):
                r.managed_part(data)

    def test_online_routes_and_dns(self):
        block = r.block("online", 4187)
        self.assertIn(b"header_up X-Real-IP {remote_host}", block)
        self.assertIn(b"/client-api/staff/*", block)
        self.assertIn(b"127.0.0.1:4181", block)
        with patch.object(r, "addresses", side_effect=[{"203.0.113.2", "2001:db8::7"}, {"203.0.113.2"}]), \
             patch.object(r, "run", return_value='[{"addr_info": [{"local":"10.0.0.3"}]}]'), self.assertRaises(RuntimeError):
            r.verify_dns([])


class ReleaseTransaction(unittest.TestCase):
    def setUp(self):
        files = self.enterContext(TemporaryDirectory())
        state = Path(files)
        self.enterContext(patch.object(r, "STATE", state))
        self.base = b"homemaster.qd.je {\n respond staff\n}\n"
        self.gateway = Mock()
        self.gateway.path = state / "Caddyfile"
        self.gateway.path.write_bytes(self.base)
        self.gateway.adapt.side_effect = lambda: {"config": self.gateway.path.read_text()}
        self.active = self.gateway.adapt()
        self.gateway.get_active.side_effect = lambda: self.active
        self.gateway.load.side_effect = self.load
        self.revision = 100
        self.docker = {}
        self.enterContext(patch.object(r, "staff_signature", return_value="same staff"))
        self.wait = self.enterContext(patch.object(r, "wait_site"))
        self.enterContext(patch.object(r, "container_info", side_effect=self.docker.get))
        self.enterContext(patch.object(r, "build_image", side_effect=lambda mode, rev: "img:" + rev))
        self.enterContext(patch.object(r, "run_image", side_effect=self.run_image))
        self.enterContext(patch.object(r, "run", side_effect=self.run_command))

    def load(self, config):
        self.active = config

    def run_image(self, port, image):
        self.docker[port] = {"State": {"Running": True}, "Image": image, "Config": {"Image": image}}

    def run_command(self, args, **kwargs):
        if args[0] == "git":
            return str(self.revision) if args[1] == "rev-parse" else ""
        port = int(args[-1].split("-")[-1])
        self.docker[port]["State"]["Running"] = args[1] == "start"
        return ""

    def deploy(self, port):
        self.revision += 1
        before = self.gateway.path.read_bytes()
        r.apply(self.gateway, before, r.managed_part(before), "phone", port)

    def rollback(self):
        r.restore(self.gateway, r.STATE / r.pointer("current"))

    def test_first_publication_and_manual_rollback(self):
        self.deploy(4186)
        self.assertEqual(r.managed_part(self.gateway.path.read_bytes())[1:], ("phone", 4186))
        self.rollback()
        self.assertEqual(self.gateway.path.read_bytes(), self.base)
        self.assertEqual(self.active, self.gateway.adapt())
        self.assertFalse(self.docker[4186]["State"]["Running"])

    def test_failed_tls_restores_previous_release(self):
        self.deploy(4186)
        before = self.gateway.path.read_bytes()
        previous = r.pointer("current")
        def fail_tls(port, mode, *, tls=False, **kwargs):
            if tls and port == 4187:
                raise RuntimeError("test certificate not ready")
        self.wait.side_effect = fail_tls
        with self.assertRaisesRegex(RuntimeError, "certificate"):
            self.deploy(4187)
        self.assertEqual(self.active, self.gateway.adapt())
        self.assertEqual(self.gateway.path.read_bytes(), before)
        self.assertEqual((r.pointer("pending"), r.pointer("current")), ("", previous))
        self.assertTrue(self.docker[4186]["State"]["Running"])
        self.assertFalse(self.docker[4187]["State"]["Running"])

    def test_repeated_rollbacks_restore_each_exact_image(self):
        self.deploy(4186)
        first = self.docker[4186]["Image"]
        self.deploy(4187)
        second = self.docker[4187]["Image"]
        self.deploy(4186)
        self.rollback()
        self.assertEqual(self.docker[4187]["Image"], second)
        self.rollback()
        self.assertEqual(self.docker[4186]["Image"], first)
        self.assertTrue(self.docker[4186]["State"]["Running"])

    def test_rollback_preserves_independent_configuration(self):
        self.deploy(4186)
        independent = self.gateway.path.read_bytes() + b"# subsequent admin edit\n"
        self.gateway.path.write_bytes(independent)
        with self.assertRaises(RuntimeError):
            self.rollback()
        self.assertEqual(self.gateway.path.read_bytes(), independent)


if __name__ == "__main__":
    unittest.main()
