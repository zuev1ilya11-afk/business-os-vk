#!/usr/bin/env python3
"""Publish only the existing synthetic website behind the existing Caddy.

Run as root on the inspected RU host. Never builds images, opens Docker ports,
restarts production containers, changes employee files, or connects to its DB.
"""
import argparse
import base64
import copy
from datetime import datetime, timedelta, timezone
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
SECONDARY_IP = "136.234.17.113"
IP_PORT = 8443
ADMIN = "127.0.0.1:12019"
SERVICE = "public-site-staging"
PROJECT = "bos-public-site-staging"
APP = Path(__file__).resolve().parents[1]
ACCESS = Path("/root/bos-site-access.txt")
BACKUPS = Path("/var/backups/bos-public-site")
MARKER = "# BEGIN BOS PUBLIC SITE PREVIEW"
ACME_DIRECTORY = "https://acme-v02.api.letsencrypt.org/directory"


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


def probe(host, path="/", *, tls=False, auth=None, port=None, connect_host="127.0.0.1"):
    # All probes connect to this host, with the real hostname/SNI and strict TLS.
    # No proxy, external credential transmission or DNS-dependent health checks.
    connection = http.client.HTTPConnection(connect_host, port or (443 if tls else 80),
                                            timeout=8)
    try:
        connection.connect()
        if tls:
            connection.sock = ssl.create_default_context().wrap_socket(
                connection.sock, server_hostname=host)
        authority = f"{host}:{port}" if port not in (None, 80, 443) and ":" not in host else host
        headers = {"Host": authority}
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


def origin_env(original, origin=ORIGIN):
    lines = original.decode().splitlines()
    keys = "WEBSITE_STAGING_(?:HTTPS_)?ORIGIN"
    require(not any(re.match(r"\s*export\s+" + keys, x) for x in lines),
            "Unexpected exported origin in .env; inspect before changing it.")
    lines = [x for x in lines if not re.match(r"\s*" + keys + r"\s*=", x)]
    return ("\n".join(lines + ["WEBSITE_STAGING_ORIGIN=" + origin,
                             "WEBSITE_STAGING_HTTPS_ORIGIN=" + origin]) + "\n").encode()


def validate_email(email):
    # Restrict to a single literal token: no Caddyfile placeholders or syntax.
    require(isinstance(email, str) and re.fullmatch(r"[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", email),
            "Set WEBSITE_ACME_EMAIL to the owner's certificate contact email.")
    return email


def certificate_email(config):
    explicit = os.environ.get("WEBSITE_ACME_EMAIL")
    if explicit is not None:
        return validate_email(explicit)
    policies = config.get("apps", {}).get("tls", {}).get("automation", {}).get("policies", [])
    emails = {issuer["email"] for policy in policies for issuer in policy.get("issuers", [])
              if issuer.get("module") == "acme" and issuer.get("email")}
    # Let's Encrypt permits an omitted contact. Never invent one or choose
    # another site's contact when several different owners are configured.
    return validate_email(emails.pop()) if len(emails) == 1 else None


def site_block(password_hash, email=None):
    require(re.fullmatch(r"\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}", password_hash),
            "Caddy returned an unexpected password hash.")
    contact = f"\t\t\temail {validate_email(email)}\n" if email is not None else ""
    return (f"\n{MARKER}\n{SITE} {{\n"
            # Explicitly retain Let's Encrypt. ZeroSSL restricts service in RU
            # and its automatic registration failed on the inspected server.
            f"\ttls {{\n\t\tissuer acme {ACME_DIRECTORY} {{\n"
            + contact + "\t\t}\n\t}\n"
            "\theader X-Robots-Tag \"noindex, nofollow\"\n"
            "\tbasic_auth {\n\t\tpreview " + password_hash + "\n\t}\n"
            "\treverse_proxy 127.0.0.1:4185 {\n"
            "\t\theader_up -Authorization\n\t}\n}\n"
            "# END BOS PUBLIC SITE PREVIEW\n").encode()


def ip_origin(ip=None):
    return f"https://{ip or PUBLIC_IP}:{IP_PORT}"


def existing_ip_issuer(config, ip=None):
    policies = config.get("apps", {}).get("tls", {}).get("automation", {}).get("policies", [])
    matches = [policy for policy in policies if (ip or PUBLIC_IP) in policy.get("subjects", [])]
    require(len(matches) == 1, "Expected one existing explicit IP certificate policy.")
    issuers = matches[0].get("issuers", [])
    require(len(issuers) == 1, "Unexpected existing IP certificate issuers.")
    issuer = issuers[0]
    require(set(issuer) <= {"module", "ca", "profile", "email"}
            and issuer.get("module") == "acme" and issuer.get("ca") == ACME_DIRECTORY
            and issuer.get("profile") == "shortlived", "Existing IP certificate policy differs from inspected setup.")
    if "email" in issuer:
        validate_email(issuer["email"])
    return issuer


def ip_site_block(password_hash, issuer, ip=None):
    # Exactly matching issuer settings consolidate into the existing policy.
    # Do not add `bind`: Caddy also changes the ACME challenge bind host, making
    # the two policies for the same IP conflict. The route matches only our IP.
    block = site_block(password_hash, issuer.get("email")).decode()
    block = block.replace(SITE + " {", ip_origin(ip) + " {", 1)
    block = block.replace("\t\tissuer acme " + ACME_DIRECTORY + " {\n",
                          "\t\tissuer acme " + ACME_DIRECTORY + " {\n\t\t\tprofile shortlived\n", 1)
    return block.encode()


def existing_ip_certificate(port=443, *, host=None, connect_host="127.0.0.1"):
    # Numeric server_hostname checks the IP SAN without sending an invalid IP
    # SNI. The inspected Caddy default_sni selects this existing certificate.
    with socket.create_connection((connect_host, port), timeout=8) as connection:
        with ssl.create_default_context().wrap_socket(connection, server_hostname=host or PUBLIC_IP) as secure:
            certificate = secure.getpeercert()
            expires = ssl.cert_time_to_seconds(certificate["notAfter"])
            require(expires > time.time() + 3600, "Existing IP certificate expires within one hour; inspect renewal first.")
            return hashlib.sha256(secure.getpeercert(binary_form=True)).hexdigest()


def require_local_secondary_ip():
    # An assigned address binds locally. Probes must never send credentials to
    # an external host if this address was detached since the inspected setup.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as check:
        check.bind((SECONDARY_IP, 0))


def switch_preview_config(original, active):
    hashes = re.findall(rb"\n\t\tpreview (\$2[aby]\$\d\d\$[./A-Za-z0-9]{53})\n", original)
    require(len(hashes) == 1 and original.count(MARKER.encode()) == 1,
            "Expected exactly one previously installed IP preview.")
    password_hash = hashes[0].decode()
    old_block = ip_site_block(password_hash, existing_ip_issuer(active))
    require(original.endswith(old_block), "Existing preview block differs from the installed version; nothing changed.")
    new_block = ip_site_block(password_hash, existing_ip_issuer(active, SECONDARY_IP), SECONDARY_IP)
    return original[:-len(old_block)] + new_block


def read_preview_access(data):
    match = re.fullmatch(re.escape(f"URL: {ip_origin()}\nLogin: preview\n")
                         + r"Password: ([A-Za-z0-9_-]{32})\n", data.decode())
    require(match is not None, "Access file does not describe the existing IP preview; nothing changed.")
    return match[1]


def verify_ip_switch_isolation(before, after):
    # The only allowed changes are the preview HTTP Host and its TLS SNI
    # matcher. Auth, upstream, default SNI, renewal and employee servers stay.
    expected = copy.deepcopy(before)
    servers = expected["apps"]["http"]["servers"]
    matches = [s for s in servers.values() if s.get("listen") == [f":{IP_PORT}"]]
    require(len(matches) == 1, "Expected the existing dedicated preview listener.")
    preview = matches[0]
    require(len(preview.get("routes", [])) == 1
            and preview["routes"][0].get("match") == [{"host": [PUBLIC_IP]}],
            "Unexpected existing preview route.")
    preview["routes"][0]["match"] = [{"host": [SECONDARY_IP]}]
    for policy in preview.get("tls_connection_policies", []):
        if "sni" in policy.get("match", {}):
            require(set(policy["match"]["sni"]) == {"", PUBLIC_IP}, "Unexpected preview TLS matcher.")
            policy["match"]["sni"] = [SECONDARY_IP if s == PUBLIC_IP else s for s in policy["match"]["sni"]]
    def canonical(config):
        config = copy.deepcopy(config)
        servers = config["apps"]["http"].pop("servers")
        for server in servers.values():
            if server.get("listen") != [f":{IP_PORT}"]:
                continue
            policies = server.get("tls_connection_policies", [])
            if policies and "match" not in policies[-1]:
                # Caddy may remove a redundant IP matcher when its complete
                # TLS settings equal the following catch-all. Normalize only
                # that exact case on this preview server; never discard TLS
                # settings or change any employee listener.
                fallback = policies[-1]
                normalized = []
                for policy in policies[:-1]:
                    matcher = policy.get("match", {})
                    redundant = (set(matcher) == {"sni"} and set(matcher["sni"]) == {"", SECONDARY_IP}
                                 and {k: v for k, v in policy.items() if k != "match"} == fallback)
                    if not redundant:
                        normalized.append(policy)
                server["tls_connection_policies"] = normalized + [fallback]
        for policy in config.get("apps", {}).get("tls", {}).get("automation", {}).get("policies", []):
            if "subjects" in policy:
                policy["subjects"].sort()
        return config, sorted(json.dumps(server, sort_keys=True) for server in servers.values())
    require(canonical(expected) == canonical(after),
            "Switch would change settings beyond the preview hostname; nothing reloaded.")


def require_free_ip_port():
    for kind in (socket.SOCK_STREAM, socket.SOCK_DGRAM):
        with socket.socket(socket.AF_INET, kind) as check:
            try:
                check.bind(("0.0.0.0", IP_PORT))
            except OSError as error:
                raise RuntimeError(f"Port {IP_PORT} is occupied; nothing changed.") from error


def verify_ip_isolation(before, after):
    # Caddy may renumber servers when appending a listener. Compare their full
    # contents, not those generated names. Every existing server and all other
    # app settings (including certificate automation/storage) must be identical.
    old, new = copy.deepcopy(before), copy.deepcopy(after)
    old_servers = old["apps"]["http"].pop("servers")
    new_servers = new["apps"]["http"].pop("servers")
    listeners = {f":{IP_PORT}"}
    additions = [name for name, server in new_servers.items() if set(server.get("listen", [])) == listeners]
    require(len(additions) == 1, "Expected exactly the isolated IP preview listener.")
    preview = new_servers.pop(additions[0])
    require(len(preview.get("routes", [])) == 1
            and preview["routes"][0].get("match") == [{"host": [PUBLIC_IP]}],
            "IP preview must match only the inspected IP hostname.")
    require(any(policy.get("default_sni") == PUBLIC_IP for policy in preview.get("tls_connection_policies", [])),
            "IP preview must use the existing default SNI.")
    canonical = lambda servers: sorted(json.dumps(server, sort_keys=True) for server in servers.values())
    # Consolidation may reorder subjects inside an otherwise identical policy;
    # these are a set. Keep policy order itself strict (wildcards may overlap).
    for config in (old, new):
        for policy in config.get("apps", {}).get("tls", {}).get("automation", {}).get("policies", []):
            if "subjects" in policy:
                policy["subjects"].sort()
    require(old == new and canonical(old_servers) == canonical(new_servers),
            "IP preview would change existing proxy servers or certificate settings; refusing to apply.")


def ip_route_fingerprints():
    results = []
    for host, tls in ((PUBLIC_IP, True), (PUBLIC_IP, False), (STAFF, False), (SECONDARY_IP, False)):
        code, headers, body = probe(host, tls=tls)
        results.append((code, headers.get("location"), hashlib.sha256(body).hexdigest()))
    return results


def certificate_events(container, since="24h"):
    # Caddy writes JSON to stderr; retain both streams, but only expose errors
    # concerning this preview hostname. Never print the complete proxy log.
    try:
        result = subprocess.run(["docker", "logs", "--since", str(since), "--tail", "1500", container],
                                capture_output=True, text=True, timeout=8)
        if result.returncode:
            return []
        events = []
        for line in (result.stdout + "\n" + result.stderr).splitlines():
            try:
                item = json.loads(line)
            except ValueError:
                continue
            if not isinstance(item, dict) or not isinstance(item.get("ts"), (int, float)):
                continue
            if item.get("identifier") == SITE and item.get("logger") == "tls.obtain":
                events.append(item)
        return sorted(events, key=lambda item: item["ts"])
    except (OSError, subprocess.SubprocessError):
        return []  # Diagnostics must never prevent the existing rollback.


def certificate_retry_at(events):
    retry = None
    for event in events:
        if event.get("msg") == "certificate obtained successfully":
            retry = None
            continue
        error = event.get("error", "")
        issuer = event.get("issuer", "")
        if not isinstance(error, str) or not isinstance(issuer, str):
            continue
        if "letsencrypt.org" not in issuer or "rateLimited" not in error:
            continue
        match = re.search(r"retry after (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC", error)
        if match:
            try:
                candidate = datetime.strptime(match[1], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            if retry is None or candidate > retry:
                retry = candidate
    return retry


def require_certificate_quota(events):
    retry = certificate_retry_at(events)
    if retry is not None and retry.timestamp() > time.time():
        moscow = retry.astimezone(timezone(timedelta(hours=3)))
        raise RuntimeError("LE_RATE_LIMIT: retry after " + moscow.strftime("%Y-%m-%d %H:%M:%S MSK")
                           + ". Shared domain quota; availability at that time is not guaranteed.")


def certificate_diagnostic(events):
    for event in reversed(events):
        if event.get("level") != "error" or not isinstance(event.get("error"), str):
            continue
        # Keep the console short and remove contact emails, URL query strings
        # and terminal control characters before displaying a CA error.
        error = re.sub(r"[\w.+-]+@[\w.-]+", "[email]", event["error"])
        error = re.sub(r"(https?://[^\s?]+)\?[^\s]+", r"\1?[redacted]", error)
        error = " ".join("".join(c for c in error if c.isprintable() or c.isspace()).split())
        return error[:500]
    return "No matching certificate error in the recent Caddy log."


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
    ip_preview = False
    switch_ip = False
    connect_host = "127.0.0.1"
    changed_access = False
    hostname = SITE
    https_port = 443
    origin = ORIGIN

    def __init__(self, *, ip_preview=False, switch_ip=False):
        self.switch_ip = switch_ip
        self.ip_preview = ip_preview or switch_ip
        if self.ip_preview:
            self.hostname, self.https_port, self.origin = PUBLIC_IP, IP_PORT, ip_origin()
        if switch_ip:
            require_local_secondary_ip()
            self.hostname, self.connect_host, self.origin = SECONDARY_IP, SECONDARY_IP, ip_origin(SECONDARY_IP)
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
        if not switch_ip:
            require(MARKER.encode() not in self.old_config and SITE.encode() not in self.old_config,
                    "Site already present; do not append a duplicate. Keep the existing access file.")
        self.old_active = active_config()
        require(SITE not in json.dumps(self.old_active), "Site already exists in active Caddy configuration.")
        require(self.adapt("/etc/caddy/Caddyfile") == self.old_active,
                "Running Caddy configuration differs from Caddyfile. Nothing changed.")
        require(self.old_active.get("admin", {}).get("listen") == ADMIN,
                "Unexpected Caddy admin address.")
        self.acme_email = certificate_email(self.old_active) if not self.ip_preview else None
        if switch_ip:
            self.new_config = switch_preview_config(self.old_config, self.old_active)
        elif ip_preview:
            self.ip_issuer = existing_ip_issuer(self.old_active)
            require(not any(f":{IP_PORT}" in listener for server in
                    self.old_active.get("apps", {}).get("http", {}).get("servers", {}).values()
                    for listener in server.get("listen", [])), "IP preview port already configured.")
        self.env = APP / ".env"
        require(not self.env.is_symlink(), "Unexpected .env symlink.")
        self.old_env = self.env.read_bytes() if self.env.exists() else None
        self.new_env = origin_env(self.old_env or b"", self.origin)
        if switch_ip:
            require(ACCESS.is_file() and not ACCESS.is_symlink() and ACCESS.stat().st_mode & 0o077 == 0,
                    "Expected the private existing preview access file.")
            self.old_access = ACCESS.read_bytes()
            self.password = read_preview_access(self.old_access)
            self.new_access = self.old_access.replace(ip_origin().encode(), self.origin.encode(), 1)
            for key in ("WEBSITE_STAGING_ORIGIN", "WEBSITE_STAGING_HTTPS_ORIGIN"):
                require(re.findall(rb"^" + key.encode() + rb"=(.*)$", self.old_env or b"", re.M)
                        == [ip_origin().encode()], "Existing website origin differs from the inspected preview.")
        else:
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
        deadline = time.monotonic() + (45 if self.ip_preview else 300)
        while True:
            try:
                code, headers, _ = probe(self.hostname, tls=True, port=self.https_port, connect_host=self.connect_host)
                require(code == 401 and "Basic" in headers.get("www-authenticate", ""),
                        "Website must require preview authentication.")
                for route in ("/healthz", "/", "/services", "/client-api/health", "/client/"):
                    code, _, body = probe(self.hostname, route, tls=True, auth=password, port=self.https_port,
                                          connect_host=self.connect_host)
                    require(code == 200, "Authenticated website check failed: " + route)
                    if route == "/healthz":
                        require(json.loads(body).get("environment") == "staging", "Wrong website backend.")
                code, _, _ = probe(self.hostname, "/.public-site-stage/private/access.json", tls=True,
                                   auth=password, port=self.https_port, connect_host=self.connect_host)
                require(code == 404, "Private path is not blocked.")
                if self.ip_preview:
                    certificate_args = dict(host=self.hostname, connect_host=self.connect_host)
                    require(existing_ip_certificate(self.https_port, **certificate_args) == existing_ip_certificate(**certificate_args),
                            "IP preview is not serving the same certificate as the existing IP endpoint.")
                return
            except (OSError, RuntimeError, http.client.HTTPException) as error:
                events = [] if self.ip_preview else certificate_events(self.container, self.https_started)
                # A stated retry-after is authoritative: do not keep polling
                # TLS for five minutes when issuance has already been refused.
                require_certificate_quota(events)
                if time.monotonic() >= deadline:
                    raise RuntimeError("HTTPS/website check timed out. Last check: " + str(error)
                                       + "\nCA_ERROR: " + certificate_diagnostic(events)) from None
                time.sleep(4)

    def rollback(self):
        failures = []
        if self.changed_access:
            try:
                restore_owned(ACCESS, self.new_access, self.old_access)
            except BaseException:
                failures.append("Preview access file restore failed; use the saved backup")
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
        # Read-only guard before backups, password generation, origin changes,
        # staging restart or proxy reload. A known active quota means no changes.
        if self.ip_preview:
            if self.switch_ip:
                require_local_secondary_ip()
                cert_args = dict(host=SECONDARY_IP, connect_host=SECONDARY_IP)
                require(existing_ip_certificate(IP_PORT, **cert_args) == existing_ip_certificate(**cert_args),
                        "Reachable IP must already have the same trusted certificate on both ports.")
                code, _, body = probe(PUBLIC_IP, "/healthz", tls=True, port=IP_PORT, auth=self.password)
                require(code == 200 and json.loads(body).get("environment") == "staging",
                        "Existing preview credentials or backend check failed.")
                require(ACCESS.read_bytes() == self.old_access, "Access file changed; nothing applied.")
            else:
                require_free_ip_port()
                existing_ip_certificate()
            ip_before = ip_route_fingerprints()
        else:
            require_certificate_quota(certificate_events(self.container))
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
        password = self.password if self.switch_ip else secrets.token_urlsafe(24)
        if not self.switch_ip:
            password_hash = self.caddy("hash-password", "--algorithm", "bcrypt", data=password + "\n").strip()
            block = ip_site_block(password_hash, self.ip_issuer) if self.ip_preview else site_block(password_hash, self.acme_email)
            self.new_config = self.old_config + block
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
        if self.switch_ip:
            write_atomic(backup / "preview-access.txt", self.old_access)
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
                    and service["environment"]["WEBSITE_STAGING_ORIGIN"] == self.origin
                    and service["environment"]["WEBSITE_STAGING_HTTPS_ORIGIN"] == self.origin,
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
            if self.switch_ip:
                verify_ip_switch_isolation(self.old_active, desired)
            elif self.ip_preview:
                verify_ip_isolation(self.old_active, desired)
            write_atomic(backup / "expected-after.json", json.dumps(desired).encode())
            self.https_started = time.time()
            self.reload(desired)
            actual = active_config()
            if actual != desired:
                write_atomic(backup / "unexpected-active.json", json.dumps(actual).encode())
                raise RuntimeError("Caddy did not activate the expected configuration; private JSON saved in backup.")
            require(self.staff_fingerprint() == before, "Employee homepage changed; restoring configuration.")
            print("HTTPS_CHECK=" + ("existing IP certificate (up to 45 seconds)" if self.ip_preview
                                   else "Let's Encrypt certificate and authenticated website (up to 5 minutes)"), flush=True)
            self.verify_https(password)
            require(self.staff_fingerprint() == before, "Employee homepage changed; restoring configuration.")
            if self.ip_preview:
                require(ip_route_fingerprints() == ip_before, "Existing IP pages or HTTP redirects changed; restoring configuration.")
            if self.switch_ip:
                require(ACCESS.read_bytes() == self.old_access, "Access file changed during deployment.")
                write_atomic(ACCESS, self.new_access)
                self.changed_access = True
            else:
                write_atomic(ACCESS, (f"URL: {self.origin}\nLogin: preview\nPassword: {password}\n").encode())
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
        print("SITE_READY=" + self.origin)
        print("STAFF_HOME_UNCHANGED=OK")
        print("ACCESS_FILE=" + str(ACCESS))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Enable the password-protected synthetic preview")
    parser.add_argument("--ip", action="store_true", help="Reuse the inspected IP certificate on port 8443")
    parser.add_argument("--switch-ip", action="store_true", help="Move the installed preview to the verified reachable secondary IP")
    args = parser.parse_args()
    require(args.apply, "Use --apply to publish the isolated preview.")
    require(not (args.ip and args.switch_ip), "Choose --ip or --switch-ip, not both.")
    require(os.geteuid() == 0, "Run as root on the inspected server.")
    require("${WEBSITE_STAGING_ORIGIN:-" in (APP / "compose.staging.yml").read_text(),
            "Update the prepared Compose file before running the publisher.")
    if not args.ip and not args.switch_ip:
        addresses = {r[4][0] for r in socket.getaddrinfo(SITE, 443, type=socket.SOCK_STREAM)}
        require(addresses == {PUBLIC_IP}, "DNS must point only to the inspected IP " + PUBLIC_IP)
    with open("/run/bos-public-site-publish.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        Publisher(ip_preview=args.ip, switch_ip=args.switch_ip).apply()


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print("STOP: " + (str(error) if isinstance(error, RuntimeError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
