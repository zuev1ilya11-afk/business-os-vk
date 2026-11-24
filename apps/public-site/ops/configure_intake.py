#!/usr/bin/env python3
"""Configure the website's dedicated PostgreSQL login on the deployment host."""
import getpass
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import quote

def main():
    if os.geteuid() != 0:
        sys.exit("Запустите от root.")
    port = int(input("Порт PostgreSQL на 127.0.0.1 [5432]: ").strip() or "5432")
    database = input("Имя базы действующего Business OS: ").strip()
    if not 1 <= port <= 65535 or not database or not all(c.isalnum() or c in "_-" for c in database):
        sys.exit("Проверьте порт и имя базы.")
    password = getpass.getpass("Пароль hm_site_intake: ")
    if not password:
        sys.exit("Пароль не введён.")
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env.update(PGPASSWORD=password, PGCONNECT_TIMEOUT="5")
    sql = ("select current_user = 'hm_site_intake' and has_function_privilege("
           "current_user,'hm_site_private.submit(uuid,text,text,text,text,text)','EXECUTE')")
    check = subprocess.run(["psql", "-XAtw", "-h", "127.0.0.1", "-p", str(port),
                            "-U", "hm_site_intake", "-d", database, "-c", sql],
                           capture_output=True, text=True, env=env, timeout=12)
    if check.returncode or check.stdout.strip() != "t":
        sys.exit("Не удалось проверить подключение и право вызова. Настройки не записаны.")
    directory = Path("/etc/homemaster-site")
    os.umask(0o077)
    directory.mkdir(mode=0o700, exist_ok=True)
    url = f"postgresql://hm_site_intake:{quote(password, safe='')}@127.0.0.1:{port}/{quote(database, safe='')}"
    with tempfile.NamedTemporaryFile(dir=directory, mode="w", delete=False) as handle:
        handle.write("WEBSITE_INTAKE_DATABASE_URL=" + url + "\n")
    os.replace(handle.name, directory / "intake.env")
    print("Подключение проверено. Настройки сохранены для следующего выпуска сайта.")

if __name__ == "__main__":
    main()
