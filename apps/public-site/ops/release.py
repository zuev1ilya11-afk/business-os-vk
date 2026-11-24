#!/usr/bin/env python3
"""Publish the customer website through the existing Caddy host (run from any directory)."""
import argparse
import contextlib
import fcntl
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True

from publish import (ACME_DIRECTORY, APP, ORIGIN, SITE, STAFF, certificate_events,
                     probe, require, require_certificate_quota,
                     run, site_block, write_atomic)

ROOT = APP.parents[1]
STATE = Path("/var/lib/homemaster-site")
LABEL = "ru.homemaster.public-site"
BEGIN = b"# BEGIN HOMEMASTER CUSTOMER SITE"
END = b"# END HOMEMASTER CUSTOMER SITE"
PREVIEW = b"# BEGIN BOS PUBLIC SITE PREVIEW"
PREVIEW_END = b"# END BOS PUBLIC SITE PREVIEW"
SLOTS = (4186, 4187)
API_PORT = 4181
INTAKE_CONFIG = Path("/etc/homemaster-site/intake.env")


def block(mode, port):
    require(mode in ("phone", "online") and port in SLOTS, "Неверные параметры сайта.")
    api = ""
    if mode == "online":
        api = (f"    handle /client-api/* {{\n        reverse_proxy 127.0.0.1:{API_PORT} {{\n"
               "            header_up X-Real-IP {remote_host}\n        }\n    }\n")
    return (f"{BEGIN.decode()}\n{SITE} {{\n    tls {{\n        issuer acme {ACME_DIRECTORY}\n    }}\n"
            "    @internal path /staff /staff/* /stage-api /stage-api/* /client-api/staff /client-api/staff/*\n"
            "    handle @internal {\n        respond 404\n    }\n"
            + api + f"    handle {{\n        reverse_proxy 127.0.0.1:{port}\n    }}\n}}\n"
            + END.decode() + "\n").encode()


def managed_part(config):
    """Accept our exact release block or the known domain preview, never an unrelated vhost."""
    items = []
    for start, end in [(BEGIN, END), (PREVIEW, PREVIEW_END)]:
        ranges = list(re.finditer(rb"^" + start + rb"\n.*?^" + end + rb"(?:\n|$)", config, re.M | re.S))
        require(len(ranges) == config.splitlines().count(start) == config.splitlines().count(end),
                "Незавершённый блок сайта в Caddyfile.")
        for match in ranges:
            raw = match.group()
            if start == PREVIEW and SITE.encode() not in raw:
                continue  # The existing password-protected IP preview has its own listener.
            if start == BEGIN:
                choices = [(mode, port) for mode in ("online", "phone") for port in SLOTS
                           if raw == block(mode, port)]
                require(len(choices) == 1, "Секция сайта была изменена вручную.")
                mode, port = choices[0]
            else:
                pwd = re.search(rb"^\s*preview (\S+)$", raw, re.M)
                email = re.search(rb"^\s*email (\S+)$", raw, re.M)
                require(pwd and site_block(pwd[1].decode(), email[1].decode() if email else None).lstrip(b"\n") == raw,
                        "Поддомен занят другой конфигурацией.")
                mode, port = "preview", None
            items.append((raw, mode, port))
    require(len(items) <= 1, "Найдено несколько секций поддомена.")
    raw, mode, port = items[0] if items else (b"", None, None)
    rest = config.replace(raw, b"", 1) if raw else config
    require(SITE.encode() not in rest, "Поддомен уже настроен вне управляемой секции.")
    return raw, mode, port


def production_api():
    def read(path, *, quote=False):
        conn = http.client.HTTPConnection("127.0.0.1", API_PORT, timeout=5)
        try:
            headers = {"Origin": ORIGIN, "Content-Type": "application/json"}
            conn.request("POST" if quote else "GET", "/client-api/" + path,
                         body=b'{"items":[]}' if quote else None, headers=headers)
            response = conn.getresponse()
            require(response.status == 200, "Клиентский API: " + path + " — HTTP " + str(response.status))
            return json.loads(response.read(4000000))
        finally:
            conn.close()
    status = read("health")
    require(status.get("ready") and status.get("environment") == "production" and status.get("delivery") == "sms",
            "На порту клиентского API отсутствует рабочий сервис с SMS.")
    docs = read("documents")
    require(docs.get("public_launch_ready") and docs.get("documents") and
            all(d.get("reviewed") for d in docs["documents"]), "Документы клиентского API ещё не утверждены.")
    require(read("website/catalog").get("services"), "В клиентском API нет опубликованных услуг.")
    require(read("website/quote", quote=True).get("ok"), "Проверьте разрешённый origin сайта.")
    return True


def addresses(host):
    return {str(ipaddress.ip_address(x[4][0])) for x in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}


def verify_dns(confirmed):
    ips = addresses(SITE)
    local = json.loads(run(["ip", "-j", "address", "show"]))
    allowed = {ip["local"] for device in local for ip in device.get("addr_info", [])}
    allowed.update(addresses(STAFF))  # The verified staff public address may use inbound NAT.
    allowed.update(str(ipaddress.ip_address(x)) for x in confirmed)
    print("DNS", SITE, ", ".join(sorted(ips)), flush=True)
    require(ips and ips <= allowed, "Сверьте A/AAAA сайта с публичным IP этого сервера. Для NAT см. инструкцию.")


class Gateway:
    def __init__(self):
        # Inspect only metadata needed to find the current Caddy directory mount.
        containers = run(["docker", "ps", "-q"]).split()
        matches = []
        for cid in containers:
            fmt = '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Type}} {{.Source}}{{end}}{{end}}'
            mount = run(["docker", "inspect", "-f", fmt, cid]).strip()
            if mount.startswith("bind ") and run(["docker", "inspect", "-f", "{{.HostConfig.NetworkMode}}", cid]).strip() == "host":
                matches.append((cid, Path(mount[5:]) / "Caddyfile"))
        require(len(matches) == 1, "Ожидался один Caddy с host network и каталогом /etc/caddy.")
        self.container, self.path = matches[0]
        require(self.path.is_file() and not self.path.is_symlink(), "Проверьте путь к Caddyfile.")
        native = self.adapt()
        listen = native.get("admin", {}).get("listen", "localhost:2019")
        match = re.fullmatch(r"(?:localhost|127\.0\.0\.1):(\d+)", listen)
        require(match, "Нужен локальный admin API Caddy.")
        self.admin = int(match[1])

    def caddy(self, *args, data=None):
        return run(["docker", "exec", "-i", self.container, "caddy", *args], data=data)

    def adapt(self, name="Caddyfile"):
        return json.loads(self.caddy("adapt", "--config", "/etc/caddy/" + name, "--adapter", "caddyfile"))

    def get_active(self):
        status, _, body = probe("127.0.0.1", "/config/", port=self.admin)
        require(status == 200, "Admin API Caddy не ответил.")
        return json.loads(body)

    def assert_synced(self):
        require(self.adapt() == self.get_active(), "Активная конфигурация Caddy отличается от файла.")

    def validate(self, config):
        with tempfile.NamedTemporaryFile(dir=self.path.parent, prefix=".hm-check-") as candidate:
            candidate.write(config)
            candidate.flush()
            os.fchmod(candidate.fileno(), self.path.stat().st_mode & 0o777)
            self.caddy("validate", "--config", "/etc/caddy/" + Path(candidate.name).name, "--adapter", "caddyfile")

    def load(self, native):
        self.caddy("reload", "--config", "-", "--address", f"127.0.0.1:{self.admin}", data=json.dumps(native))
        require(self.get_active() == native, "Caddy не подтвердил новую конфигурацию.")


def staff_signature():
    code, _, body = probe(STAFF, tls=True)
    require(code == 200 and b"<html" in body.lower(), "Главная сотрудников не отвечает по HTTPS.")
    return hashlib.sha256(body).hexdigest()


def name(port):
    return "hm-public-" + str(port)


def container_info(port):
    items = run(["docker", "ps", "-aq", "--filter", "name=^/" + name(port) + "$"]).split()
    if not items:
        return None
    item = json.loads(run(["docker", "inspect", items[0]]))[0]
    require((item["Config"].get("Labels") or {}).get(LABEL) == str(port), "Имя контейнера занято другим сервисом.")
    return item


def wait_site(port, mode, tls=False, gateway=None, check_intake=False, information=False):
    deadline = time.monotonic() + (260 if tls else 70)
    started = str(int(time.time()) - 1)
    while True:
        try:
            def get(path):
                return probe(SITE if tls else "127.0.0.1", path, port=443 if tls else port, tls=tls)
            code, _, body = get("/healthz")
            status = json.loads(body)
            require(code == 200 and status.get("service") == "public-site" and
                    status.get("environment") == "production" and status.get("booking") == mode,
                    "Ответил другой сервис.")
            if information:
                require(status.get("informationOnly") is True and status.get("callback") is False,
                        "Информационный сайт не изолирован от приёма заявок.")
            if check_intake:
                require(status.get("callback") is True, "Короткая форма не подключена к Business OS.")
                code, _, body = get("/request")
                require(code == 200 and b'class="form-panel callback-form"' in body, "Короткая форма недоступна.")
            code, _, body = get("/contacts")
            require(code == 200 and b'href="tel:+79816849719"' in body, "Контакты компании недоступны.")
            code, _, body = get("/services")
            if information:
                require(code == 200 and b'class="hm-service-card' in body, "Каталог услуг не загрузился.")
                code, _, body = get("/")
                require(code == 200 and b'class="hm-approved-hero"' in body and b"<form" not in body.lower(),
                        "Новая главная страница не загрузилась или содержит форму.")
                code, _, body = get("/facades")
                require(code == 200 and b'class="hm-facade-details"' in body, "Фасадные работы недоступны.")
                for route in ("/request", "/order", "/login", "/client/"):
                    code, headers, _ = get(route)
                    require(code in (302, 307, 308) and headers.get("location") == "/contacts",
                            "Маршрут оформления не отключён: " + route)
                for route in ("/api/callback", "/client-api/health", "/staff/"):
                    code, _, _ = get(route)
                    require(code == 404, "Внутренний маршрут не закрыт: " + route)
                code, _, body = get("/company-proposal.pdf")
                require(code == 200 and body.startswith(b"%PDF-"), "PDF-предложение недоступно.")
                code, _, body = get("/work-photos/hero-premium.webp")
                require(code == 200 and body[:4] == b"RIFF" and body[8:12] == b"WEBP", "Главное изображение недоступно.")
            else:
                require(code == 200 and b'class="service-card"' in body, "Каталог услуг не загрузился.")
            if tls and mode == "online":
                code, _, body = get("/client/")
                require(code == 200 and b'/client/app.js' in body, "Кабинет недоступен.")
                code, _, body = get("/client-api/health")
                require(code == 200 and json.loads(body).get("delivery") == "sms", "Клиентский маршрут API недоступен.")
            return
        except (OSError, ValueError, RuntimeError, http.client.HTTPException) as error:
            if tls:
                require_certificate_quota(certificate_events(gateway.container, started))
            if time.monotonic() >= deadline:
                raise RuntimeError("Проверка сайта не прошла: " + str(error)) from None
            time.sleep(2)


def pointer(key):
    path = STATE / key
    return path.read_text().strip() if path.exists() else ""


def point(key, value):
    path = STATE / key
    if value:
        write_atomic(path, (value + "\n").encode())
    else:
        path.unlink(missing_ok=True)


def restore(gateway, receipt):
    saved = json.loads((receipt / "release.json").read_text())
    before = (receipt / "before").read_bytes()
    after = (receipt / "after").read_bytes()
    previous = json.loads((receipt / "active-before.json").read_text())
    next_json = receipt / "active-after.json"
    known_active = [previous]
    if next_json.exists():
        known_active.append(json.loads(next_json.read_text()))
    require(gateway.path.read_bytes() in (before, after) and gateway.get_active() in known_active,
            "Конфигурация менялась независимо. Сохранённые файлы: " + str(receipt))
    _, old_mode, old_port = managed_part(before)
    if old_port:
        old = container_info(old_port)
        if old and old["Image"] == saved["previous_image"]:
            run(["docker", "start", name(old_port)])
        else:
            if saved.get("previous_information", False):
                run_image(old_port, saved["previous_image"], information=True)
            else:
                run_image(old_port, saved["previous_image"])
        wait_site(old_port, old_mode, information=saved.get("previous_information", False))
    if gateway.path.read_bytes() != before:
        write_atomic(gateway.path, before)
    if gateway.get_active() != previous:
        gateway.load(previous)
    if container_info(saved["port"]):
        run(["docker", "stop", name(saved["port"])])
    point("current", saved["previous"])
    point("pending", "")
    print("Восстановлена предыдущая конфигурация сайта.")


def build_image(mode, revision):
    image = f"hm-public:{revision[:12]}-{mode}"
    # Building the image first leaves the current route and its fallback running.
    print("Сборка сайта. Журнал: /var/lib/homemaster-site/build.log", flush=True)
    with (STATE / "build.log").open("w") as log:
        result = subprocess.run(["docker", "build", "-f", "apps/public-site/Dockerfile",
                                 "--build-arg", "NEXT_PUBLIC_SITE_URL=" + ORIGIN,
                                 "--build-arg", "NEXT_PUBLIC_BOOKING_MODE=" + mode,
                                 "-t", image, "."], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
    require(result.returncode == 0, "Ошибка сборки. См. " + str(STATE / "build.log"))
    return image


def intake_environment():
    if not INTAKE_CONFIG.exists():
        return []
    info = INTAKE_CONFIG.lstat()
    require(INTAKE_CONFIG.is_file() and not INTAKE_CONFIG.is_symlink()
            and info.st_uid == 0 and info.st_mode & 0o077 == 0,
            "Для intake.env нужны владелец root и права 0600.")
    lines = INTAKE_CONFIG.read_text().splitlines()
    require(len(lines) == 1 and re.fullmatch(r"WEBSITE_INTAKE_DATABASE_URL=postgres(?:ql)?://hm_site_intake:[^\s]+", lines[0]),
            "В intake.env ожидается только подключение hm_site_intake.")
    return ["--env-file", str(INTAKE_CONFIG)]


def is_information(container):
    return "WEBSITE_INFORMATION_ONLY=1" in (container or {}).get("Config", {}).get("Env", [])


def run_image(port, image, *, information=False):
    old = container_info(port)
    if old:
        require(not old["State"]["Running"], "Резервный контейнер уже запущен. Смена остановлена.")
        run(["docker", "rm", name(port)])
    with socket.socket() as test:
        test.bind(("127.0.0.1", port))
    # Information-only containers receive neither intake credentials nor a customer API origin.
    website_env = (["-e", "WEBSITE_INFORMATION_ONLY=1"] if information else
                   [*intake_environment(), "-e", f"WEBSITE_INTERNAL_API_ORIGIN=http://127.0.0.1:{API_PORT}"])
    run(["docker", "run", "-d", "--name", name(port), "--label", f"{LABEL}={port}",
         "--network", "host", "--restart", "unless-stopped", "--read-only", "--cap-drop=ALL",
         "--security-opt", "no-new-privileges", "--tmpfs", "/tmp", "--tmpfs", "/app/apps/public-site/.next/cache",
         *website_env, "-e", "HOST=127.0.0.1", "-e", f"PORT={port}", image])


def apply(gateway, original, part, mode, port, *, information=False):
    prior, old_mode, old_port = part
    revision = run(["git", "rev-parse", "HEAD"], cwd=ROOT).strip()
    require(not run(["git", "status", "--porcelain", "--untracked-files=normal"], cwd=ROOT).strip(),
            "Для публикации используйте чистую копию ветки сайта.")
    require(not information or mode == "phone", "Информационный выпуск допускает только телефонный маршрут.")
    check_intake = not information and INTAKE_CONFIG.exists()
    if old_port and old_mode == mode:
        current = container_info(old_port)
        # A rotated password must reach a new container even on the same revision.
        desired_connection = INTAKE_CONFIG.read_text().strip() if check_intake else None
        container_connection = next((entry for entry in (current or {}).get("Config", {}).get("Env", [])
                                     if entry.startswith("WEBSITE_INTAKE_DATABASE_URL=")), None)
        if (current and is_information(current) == information and container_connection == desired_connection
                and current["Config"]["Image"] == f"hm-public:{revision[:12]}-{mode}"):
            wait_site(old_port, mode, tls=True, gateway=gateway, check_intake=check_intake, information=information)
            print("Эта версия уже опубликована:", ORIGIN)
            return
    updated = original.replace(prior, block(mode, port), 1) if prior else original + b"\n" + block(mode, port)
    gateway.validate(updated)
    before_staff = staff_signature()
    active = gateway.get_active()
    receipt = Path(tempfile.mkdtemp(prefix="release-", dir=STATE))
    for filename, value in [("before", original), ("after", updated), ("active-before.json", json.dumps(active).encode())]:
        write_atomic(receipt / filename, value)
    previous = container_info(old_port) if old_port else None
    require(not old_port or previous, "Контейнер действующей версии не найден.")
    write_atomic(receipt / "release.json", json.dumps({
        "port": port, "previous": pointer("current"), "previous_image": previous["Image"] if previous else None,
        "previous_information": is_information(previous)
    }).encode())
    image = build_image(mode, revision)
    backup_slot = container_info(port)
    require(not backup_slot or not backup_slot["State"]["Running"], "Резервный порт занят активным выпуском.")
    require(gateway.path.read_bytes() == original and gateway.get_active() == active,
            "Конфигурация Caddy менялась во время сборки.")
    point("pending", receipt.name)
    try:
        if information:
            run_image(port, image, information=True)
        else:
            run_image(port, image)
        wait_site(port, mode, check_intake=check_intake, information=information)
        require(gateway.path.read_bytes() == original and gateway.adapt() == active == gateway.get_active(),
                "Конфигурация Caddy изменилась во время сборки.")
        write_atomic(gateway.path, updated)
        adapted = gateway.adapt()
        write_atomic(receipt / "active-after.json", json.dumps(adapted).encode())
        gateway.load(adapted)
        wait_site(port, mode, tls=True, gateway=gateway, check_intake=check_intake, information=information)
        require(staff_signature() == before_staff, "Изменился ответ сайта сотрудников.")
        if old_port:
            require(container_info(old_port), "Предыдущий контейнер сайта недоступен.")
            run(["docker", "stop", name(old_port)])
        point("current", receipt.name)
        point("pending", "")
    except BaseException:
        restore(gateway, receipt)
        raise
    print("Сайт опубликован:", ORIGIN)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--apply", action="store_true")
    actions.add_argument("--rollback", action="store_true")
    parser.add_argument("--online", action="store_true", help="прежний режим; недоступен в этой редакции")
    parser.add_argument("--information", action="store_true", help="информационный сайт без форм и подключения к БД")
    parser.add_argument("--public-ip", action="append", default=[], help="проверенный у провайдера адрес для NAT")
    args = parser.parse_args()
    require(os.geteuid() == 0, "Запустите на сервере от root или с sudo.")
    os.umask(0o077)
    # Lock before inspecting or updating either slot. A plain check does not write site state.
    with contextlib.ExitStack() as resources:
        if args.apply or args.rollback:
            STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
            lock = resources.enter_context((STATE / "lock").open("a"))
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        gateway = Gateway()
        if args.rollback:
            target = pointer("pending") or pointer("current")
            require(target, "Сохранённых выпусков для отката ещё нет.")
            restore(gateway, STATE / target)
            return
        require(not pointer("pending"), "Обнаружен прерванный выпуск. Выполните --rollback.")
        gateway.assert_synced()
        original = gateway.path.read_bytes()
        part = managed_part(original)
        require(part[0] or SITE not in json.dumps(gateway.get_active()), "Поддомен уже описан в импортированном конфиге.")
        verify_dns(args.public_ip)
        staff_signature()
        require(args.information and not args.online,
                "Эта редакция — информационный сайт. Укажите --information.")
        # Intentionally do not call production_api or read intake.env.
        # The existing database credentials and old containers are left intact for rollback.
        mode = "phone"
        port = SLOTS[1] if part[2] == SLOTS[0] else SLOTS[0]
        backup_slot = container_info(port)
        require(not backup_slot or not backup_slot["State"]["Running"],
                "Резервный порт занят активным выпуском.")
        with socket.socket() as test:
            test.bind(("127.0.0.1", port))
        print("Режим: информационный сайт, только телефон и почта; резервный порт", port)
        if args.apply:
            require_certificate_quota(certificate_events(gateway.container))
            apply(gateway, original, part, mode, port, information=True)
        else:
            print("Проверка пройдена. Для публикации добавьте --apply.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, http.client.HTTPException) as error:
        sys.exit("Выпуск остановлен. " + str(error))
