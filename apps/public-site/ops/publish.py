#!/usr/bin/env python3
"""Publish only the existing synthetic website behind the existing Caddy.

Run as root on the inspected RU host. Never builds images, opens Docker ports,
restarts production containers, changes employee files, or connects to its DB.
"""
import argparse
import base64
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import time

SITE = "site.homemaster.qd.je"
ORIGIN = "https://" + SITE
STAFF = "homemaster.qd.je"
PUBLIC_IP = "139.100.237.167"
ADMIN = "127.0.0.1:12019"
SERVICE = "public-site-staging"
PROJECT = "bos-public-site-staging"
APP = Path(__file__).resolve().parents[1]
ACCESS = Path("/root/bos-site-access.txt")
BACKUPS = Path("/var/backups/bos-public-site")
MARKER = "# BEGIN BOS PUBLIC SITE PREVIEW"


class CommandError(RuntimeError):
    def __init__(self, args, result):
        super().__init__(f"Command failed (exit {result.returncode}): " + " ".join(args))
        self.output = result.stdout + "\n" + result.stderr


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(args, *, data=None, cwd=None, timeout=35):
    result = subprocess.run(args, input=data, text=True, capture_output=True,
                            cwd=cwd, timeout=timeout)
    # Do not print Docker inspect, configs, password hashes or process output.
    if result.returncode:
        raise CommandError(args, result)
    return result.stdout


def probe(host, path="/", *, tls=False, auth=None, port=None):
    # All probes connect to this host, with the real hostname/SNI and strict TLS.
    # No proxy, external credential transmission or DNS-dependent health checks.
    connection = http.client.HTTPConnection("127.0.0.1", port or (443 if tls else 80),
                                            timeout=8)
    connection.connect()
    if tls:
        connection.sock = ssl.create_default_context().wrap_socket(
            connection.sock, server_hostname=host)
    try:
        headers = {"Host": host}
        if auth:
            headers["Authorization"] = "Basic " + base64.b64encode(
                ("preview:" + auth).encode()).decode()
        connection.request("GET", path, headers=headers)
        response = connection.getresponse()
        return response.status, {k.lower(): v for k, v in response.getheaders()}, response.read(4000000)
    finally:
        connection.close()


def active_config():
    code, _, body = probe("127.0.0.1:12019", "/config/", port=12019)
    require(code == 200, "Caddy admin API is unavailable on the inspected port.")
    return json.loads(body)


def origin_env(original):
    lines = original.decode().splitlines()
    keys = "WEBSITE_STAGING_(?:HTTPS_)?ORIGIN"
    require(not any(re.match(r"\s*export\s+" + keys, x) for x in lines),
            "Unexpected exported origin in .env; inspect before changing it.")
    lines = [x for x in lines if not re.match(r"\s*" + keys + r"\s*=", x)]
    return ("\n".join(lines + ["WEBSITE_STAGING_ORIGIN=" + ORIGIN,
                             "WEBSITE_STAGING_HTTPS_ORIGIN=" + ORIGIN]) + "\n").encode()


def site_block(password_hash):
    require(re.fullmatch(r"\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}", password_hash),
            "Caddy returned an unexpected password hash.")
    return (f"\n{MARKER}\n{SITE} {{\n"
            "\theader X-Robots-Tag \"noindex, nofollow\"\n"
            "\tbasic_auth {\n\t\tpreview " + password_hash + "\n\t}\n"
            "\treverse_proxy 127.0.0.1:4185 {\n"
            "\t\theader_up -Authorization\n\t}\n}\n"
            "# END BOS PUBLIC SITE PREVIEW\n").encode()


def write_atomic(path, content, mode=0o600):
    require(not path.is_symlink(), "Refusing to replace a symlink: " + str(path))
    existing = path.stat() if path.exists() else None
    fd, temporary = tempfile.mkstemp(prefix=".bos-site-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), existing.st_mode & 0o777 if existing else mode)
            if existing:
                os.fchown(stream.fileno(), existing.st_uid, existing.st_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def restore_owned(path, expected, original):
    require(path.exists() and path.read_bytes() == expected,
            "Concurrent edit detected; backup retained: " + str(path))
    if original is None:
        path.unlink()
    else:
        write_atomic(path, original)


class Publisher:
    def __init__(self):
        ids = run(["docker", "ps", "-q", "--filter", "name=https"]).split()
        require(len(ids) == 1, "Expected exactly one existing HTTPS container.")
        self.container = ids[0]
        details = json.loads(run(["docker", "inspect", self.container]))[0]
        require(details["HostConfig"]["NetworkMode"] == "host", "Caddy must use host networking.")
        mounts = [m for m in details["Mounts"] if m["Destination"] == "/etc/caddy"]
        require(len(mounts) == 1 and mounts[0]["Type"] == "bind",
                "Expected the inspected directory bind mount /etc/caddy.")
        directory = Path(mounts[0]["Source"])
        require(directory.is_dir() and not directory.is_symlink(), "Caddy directory is unexpected.")
        self.config = directory / "Caddyfile"
        require(self.config.is_file() and not self.config.is_symlink(), "Caddyfile is unexpected.")
        self.old_config = self.config.read_bytes()
        require(MARKER.encode() not in self.old_config and SITE.encode() not in self.old_config,
                "Site already present; do not append a duplicate. Keep the existing access file.")
        self.old_active = active_config()
        require(SITE not in json.dumps(self.old_active), "Site already exists in active Caddy configuration.")
        require(self.adapt("/etc/caddy/Caddyfile") == self.old_active,
                "Running Caddy configuration differs from Caddyfile. Nothing changed.")
        require(self.old_active.get("admin", {}).get("listen") == ADMIN,
                "Unexpected Caddy admin address.")
        self.env = APP / ".env"
        require(not self.env.is_symlink(), "Unexpected .env symlink.")
        self.old_env = self.env.read_bytes() if self.env.exists() else None
        self.new_env = origin_env(self.old_env or b"")
        require(not ACCESS.exists() and not ACCESS.is_symlink(), "Access file already exists; inspect previous deployment.")
        self.changed_env = self.changed_config = False

    def caddy(self, *args, data=None, timeout=35):
        return run(["docker", "exec", "-i", self.container, "caddy", *args],
                   data=data, timeout=timeout)

    def adapt(self, path):
        return json.loads(self.caddy("adapt", "--adapter", "caddyfile", "--config", path))

    def compose(self, *args):
        return run(["docker", "compose", "-f", "compose.staging.yml", *args],
                   cwd=APP, timeout=120)

    def restart_stage(self):
        self.compose("up", "-d", "--no-build", "--no-deps", "--wait", "--wait-timeout", "90", SERVICE)

    def reload(self, config):
        # Load exactly the native JSON that will be checked after activation.
        # Compiling another filename changes file_server's implicit hide list.
        self.caddy("reload", "--config", "-", "--address", ADMIN,
                   data=json.dumps(config))

    def staff_fingerprint(self):
        code, _, body = probe(STAFF, tls=True)
        require(code == 200 and b"<html" in body.lower(), "Employee homepage HTTPS check failed.")
        return hashlib.sha256(body).hexdigest()

    def verify_stage(self):
        for route in ("/healthz", "/client-api/health", "/services", "/client/"):
            code, _, body = probe("127.0.0.1:4185", route, port=4185)
            require(code == 200, "Website check failed: " + route)
            if route == "/healthz":
                require(json.loads(body).get("environment") == "staging", "Expected synthetic staging only.")

    def verify_https(self, password):
        deadline = time.monotonic() + 120
        while True:
            try:
                code, headers, _ = probe(SITE, tls=True)
                require(code == 401 and "Basic" in headers.get("www-authenticate", ""),
                        "Website must require preview authentication.")
                for route in ("/healthz", "/", "/services", "/client-api/health", "/client/"):
                    code, _, body = probe(SITE, route, tls=True, auth=password)
                    require(code == 200, "Authenticated website check failed: " + route)
                    if route == "/healthz":
                        require(json.loads(body).get("environment") == "staging", "Wrong website backend.")
                code, _, _ = probe(SITE, "/.public-site-stage/private/access.json", tls=True, auth=password)
                require(code == 404, "Private path is not blocked.")
                return
            except (OSError, RuntimeError, http.client.HTTPException):
                if time.monotonic() >= deadline:
                    raise RuntimeError("HTTPS/website check timed out; certificate may still be pending.") from None
                time.sleep(4)

    def rollback(self):
        failures = []
        if self.changed_config:
            try:
                restore_owned(self.config, self.new_config, self.old_config)
                self.reload(self.old_active)
                require(active_config() == self.old_active, "Previous Caddy JSON was not restored.")
            except BaseException:
                failures.append("Caddy restore failed; use the saved backup")
        if self.changed_env:
            try:
                restore_owned(self.env, self.new_env, self.old_env)
                self.restart_stage()
            except BaseException:
                failures.append("Website origin restore failed; use the saved backup")
        require(not failures, "; ".join(failures))

    def apply(self):
        self.verify_stage()
        before = self.staff_fingerprint()
        ids = self.compose("ps", "-q", SERVICE).split()
        require(len(ids) == 1, "Expected one running isolated website service.")
        stage = json.loads(run(["docker", "inspect", ids[0]]))[0]
        require(stage["Config"]["Labels"].get("com.docker.compose.project") == PROJECT,
                "Unexpected website Compose project.")
        require(stage["HostConfig"]["PortBindings"] == {
            "4173/tcp": [{"HostIp": "127.0.0.1", "HostPort": "4185"}]},
            "Website must be bound only to loopback port 4185.")
        image = stage["Image"]
        password = secrets.token_urlsafe(24)
        password_hash = self.caddy("hash-password", "--algorithm", "bcrypt", data=password + "\n").strip()
        self.new_config = self.old_config + site_block(password_hash)
        # Place candidate beside the real file so relative imports retain their meaning.
        candidate = self.config.parent / ("Caddyfile.preview-" + secrets.token_hex(6))
        try:
            write_atomic(candidate, self.new_config, 0o644)
            self.caddy("validate", "--adapter", "caddyfile", "--config", "/etc/caddy/" + candidate.name)
        finally:
            candidate.unlink(missing_ok=True)
        backup_root = BACKUPS
        backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        backup = Path(tempfile.mkdtemp(prefix=time.strftime("%Y%m%d-%H%M%S-"), dir=backup_root))
        shutil.copy2(self.config, backup / "Caddyfile")
        os.chmod(backup / "Caddyfile", 0o600)
        write_atomic(backup / "active-before.json", json.dumps(self.old_active).encode())
        if self.old_env is not None:
            write_atomic(backup / "website.env", self.old_env)
        write_atomic(backup / "state.json", json.dumps({
            "config": str(self.config), "env_existed": self.old_env is not None,
            "website_image": image, "admin": ADMIN,
        }, indent=2).encode())
        print("BACKUP=" + str(backup), flush=True)
        try:
            require(self.config.read_bytes() == self.old_config and active_config() == self.old_active,
                    "Caddy changed during preparation; nothing applied.")
            require((self.env.read_bytes() if self.env.exists() else None) == self.old_env,
                    "Website .env changed during preparation; nothing applied.")
            write_atomic(self.env, self.new_env)
            self.changed_env = True
            effective = json.loads(self.compose("config", "--format", "json"))
            service = effective["services"][SERVICE]
            require(effective["name"] == PROJECT and service["environment"]["WEBSITE_ENV"] == "staging"
                    and service["environment"]["WEBSITE_STAGING_ORIGIN"] == ORIGIN
                    and service["environment"]["WEBSITE_STAGING_HTTPS_ORIGIN"] == ORIGIN,
                    "Unexpected effective Compose origin/project/environment.")
            ports = service.get("ports", [])
            require(len(ports) == 1 and ports[0].get("host_ip") == "127.0.0.1"
                    and str(ports[0].get("published")) == "4185" and ports[0].get("target") == 4173,
                    "Effective Compose must expose only loopback port 4185.")
            volumes = service.get("volumes", [])
            require(len(volumes) == 1 and volumes[0].get("type") == "volume"
                    and volumes[0].get("source") == "public-site-synthetic-data"
                    and volumes[0].get("target") == "/app/.public-site-stage",
                    "Effective Compose must use only its own synthetic volume.")
            require(service.get("image") in (None, stage["Config"]["Image"]),
                    "Effective Compose image changed; inspect before restarting.")
            self.restart_stage()
            self.verify_stage()
            current_id = self.compose("ps", "-q", SERVICE).strip()
            require(json.loads(run(["docker", "inspect", current_id]))[0]["Image"] == image,
                    "Website image unexpectedly changed.")
            require(self.config.read_bytes() == self.old_config and active_config() == self.old_active,
                    "Caddy changed while staging restarted; nothing applied to Caddy.")
            write_atomic(self.config, self.new_config)
            self.changed_config = True
            # Compile the final pathname while the old runtime is still serving.
            # The candidate was validated earlier; validate this actual file too.
            self.caddy("validate", "--adapter", "caddyfile", "--config", "/etc/caddy/Caddyfile")
            desired = self.adapt("/etc/caddy/Caddyfile")
            write_atomic(backup / "expected-after.json", json.dumps(desired).encode())
            self.reload(desired)
            actual = active_config()
            if actual != desired:
                write_atomic(backup / "unexpected-active.json", json.dumps(actual).encode())
                raise RuntimeError("Caddy did not activate the expected configuration; private JSON saved in backup.")
            require(self.staff_fingerprint() == before, "Employee homepage changed; restoring configuration.")
            print("HTTPS_CHECK=waiting for certificate and authenticated website", flush=True)
            self.verify_https(password)
            require(self.staff_fingerprint() == before, "Employee homepage changed; restoring configuration.")
            write_atomic(ACCESS, (f"URL: {ORIGIN}\nLogin: preview\nPassword: {password}\n").encode())
        except BaseException as error:
            if isinstance(error, CommandError):
                try:
                    write_atomic(backup / "failed-command.log", error.output.encode())
                    logs = self.compose("logs", "--no-color", "--tail", "40", SERVICE)
                    write_atomic(backup / "staging-start.log", logs.encode())
                    print("PRIVATE_DIAGNOSTICS=" + str(backup), flush=True)
                except Exception:
                    pass  # Diagnostic collection must never prevent rollback.
            print("APPLY_FAILED: restoring the previous proxy and website origin", flush=True)
            self.rollback()
            print("ROLLBACK_OK", flush=True)
            raise
        print("SITE_READY=" + ORIGIN)
        print("STAFF_HOME_UNCHANGED=OK")
        print("ACCESS_FILE=" + str(ACCESS))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Enable the password-protected synthetic preview")
    args = parser.parse_args()
    require(args.apply, "Use --apply to publish the isolated preview.")
    require(os.geteuid() == 0, "Run as root on the inspected server.")
    require("${WEBSITE_STAGING_ORIGIN:-" in (APP / "compose.staging.yml").read_text(),
            "Update the prepared Compose file before running the publisher.")
    addresses = {r[4][0] for r in socket.getaddrinfo(SITE, 443, type=socket.SOCK_STREAM)}
    require(addresses == {PUBLIC_IP}, "DNS must point only to the inspected IP " + PUBLIC_IP)
    with open("/run/bos-public-site-publish.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        Publisher().apply()


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print("STOP: " + (str(error) if isinstance(error, RuntimeError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
