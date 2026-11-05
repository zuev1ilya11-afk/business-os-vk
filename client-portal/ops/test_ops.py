import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


audit = module("audit_host")
release = module("build_release")


class OpsTests(unittest.TestCase):
    def test_directory_summary_does_not_follow_symlinks_or_return_names(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "photos").mkdir()
            (root / "photos" / "private-customer-name.jpg").write_bytes(b"123")
            (root / "outside-secret").write_bytes(b"do not traverse")
            (root / "photos" / "link").symlink_to(root / "outside-secret")
            result = audit.directory_summary(root / "photos")
            self.assertEqual(result, {"files": 1, "bytes": 3, "complete": True})
            self.assertNotIn("private-customer", json.dumps(result))

    def test_sql_contains_no_business_rows_and_is_read_only(self):
        self.assertIn("BEGIN READ ONLY", audit.SCHEMA_SQL)
        self.assertIn("ROLLBACK", audit.SCHEMA_SQL)
        self.assertNotIn("FROM public.orders", audit.SCHEMA_SQL)
        self.assertNotIn("FROM public.business_staff", audit.SCHEMA_SQL)

    def test_errors_do_not_echo_command_output_or_secrets(self):
        class Failed:
            returncode = 1
            stdout = b"private-value"
            stderr = b"password=secret"
        with patch.object(audit.subprocess, "run", return_value=Failed()):
            result = audit.run(["unavailable"])
        self.assertEqual(result, {"available": False, "reason": "command_failed", "exit_code": 1})

    def test_release_rejects_secrets_runtime_paths_and_traversal(self):
        for name in (".env", ".env.production", "client-portal/data/db", "x/private/key",
                     "x/node_modules/lib.js", "../oops", "/absolute", "secret.pem", "db.sqlite"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                release.safe_path(name)
        self.assertEqual(release.safe_path("client-portal/server.cjs"), "client-portal/server.cjs")

    def test_no_production_command_in_release_builder(self):
        source = Path(release.__file__).read_text()
        for command in ('"ssh"', '"scp"', '"psql"', '"docker"', '"systemctl"'):
            self.assertNotIn(command, source)

    def test_real_candidate_archive_is_deterministic_and_rejects_dirty_worktree(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            ops = root / "client-portal/ops"
            ops.mkdir(parents=True)
            shutil.copyfile(release.__file__, ops / "build_release.py")
            (root / "staff.js").write_text("const before = true;\n")
            def git(*args):
                return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.DEVNULL).decode().strip()
            git("init")
            git("config", "user.name", "Synthetic Release Test")
            git("config", "user.email", "test@example.invalid")
            git("add", ".")
            git("commit", "-m", "synthetic baseline")
            baseline = git("rev-parse", "HEAD")
            (root / "staff.js").write_text("const after = true;\n")
            (root / "client-portal/new.js").write_text("const portal = true;\n")
            git("add", ".")
            git("commit", "-m", "synthetic candidate")
            first, second = Path(temporary) / "first.zip", Path(temporary) / "second.zip"
            def build(output):
                return subprocess.run([sys.executable, str(ops / "build_release.py"), "--base", baseline,
                                       "--output", str(output)], capture_output=True, timeout=30)
            self.assertEqual(build(first).returncode, 0)
            self.assertEqual(build(second).returncode, 0)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with zipfile.ZipFile(first) as archive:
                manifest = json.loads(archive.read("manifest.json"))
                self.assertFalse(manifest["production_authorized"])
                self.assertFalse(manifest["automatic_apply_supported"])
                self.assertEqual(len(manifest["files"]), 2)
                self.assertEqual(archive.read("candidate/staff.js"), b"const after = true;\n")
                original = next(f for f in manifest["files"] if f["path"] == "staff.js")
                self.assertIsNotNone(original["base_sha256"])
            (root / "staff.js").write_text("uncommitted candidate\n")
            dirty = build(Path(temporary) / "dirty.zip")
            self.assertNotEqual(dirty.returncode, 0)
            self.assertFalse((Path(temporary) / "dirty.zip").exists())


if __name__ == "__main__":
    unittest.main()
