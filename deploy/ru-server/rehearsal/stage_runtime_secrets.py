#!/usr/bin/env python3
"""Stage the five original runtime secrets in a new private server directory.

This script uses no network, shell, Docker or environment-variable injection.
Saving is not proof that the values match production; verify that separately.
"""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import sys
import tempfile
import warnings

PROJECT = 'obsropbslfwtanyspjbi'
NAMES = ('VK_APP_SECRET', 'BOS_SYNC_KEY', 'HANDS_API_KEY',
         'AVITO_CLIENT_ID', 'AVITO_CLIENT_SECRET')


def valid_value(value):
    return (isinstance(value, str) and 0 < len(value) <= 16384
            and value == value.strip()
            and not any(ord(char) < 32 or ord(char) == 127 for char in value))


def collect_secrets():
    values = {}
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        for name in NAMES:
            while True:
                value = getpass.getpass(name + ' (скрытый ввод): ')
                if valid_value(value):
                    values[name] = value
                    break
                print('Введите непустое значение без пробелов по краям и переносов строк.', flush=True)
    return values


def save_secrets(parent, values):
    if set(values) != set(NAMES) or not all(valid_value(value) for value in values.values()):
        raise ValueError('Invalid secret set')
    parent_info = parent.lstat()
    if (not stat.S_ISDIR(parent_info.st_mode) or parent_info.st_uid != os.geteuid()
            or stat.S_IMODE(parent_info.st_mode) & 0o077):
        raise ValueError('Expected private owned parent directory')
    payload = (json.dumps({'format': 1, 'source_project': PROJECT,
                          'source_verified': False, 'values': values},
                         ensure_ascii=True, sort_keys=True, indent=2) + '\n').encode('utf-8')
    root = Path(tempfile.mkdtemp(prefix='runtime-secrets-', dir=parent))
    path = root / 'functions-secrets.json'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(payload)
        output.flush()
        os.fsync(output.fileno())
    digest = hashlib.sha256(payload).hexdigest()
    hash_path = root / 'SHA256SUMS'
    fd = os.open(hash_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='ascii') as output:
        output.write(digest + '  functions-secrets.json\n')
        output.flush()
        os.fsync(output.fileno())
    if (path.read_bytes() != payload or stat.S_IMODE(path.stat().st_mode) != 0o600
            or stat.S_IMODE(root.stat().st_mode) != 0o700):
        raise RuntimeError('Local secret file verification failed')
    for directory in (root, parent):
        directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    return root


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    if os.geteuid() != 0:
        raise ValueError('Run as root')
    os.umask(0o077)
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(130))
    values = collect_secrets()
    root = save_secrets(Path('/opt/business-os/deploy'), values)
    print('Сохранено ключей: ' + str(len(values)))
    print('Каталог: ' + str(root))
    print('Совпадение с рабочими секретами ещё не проверено.')
    print('BOS_RUNTIME_SECRETS_SAVED', flush=True)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('BOS_RUNTIME_SECRETS_FAILED category=interrupted', flush=True)
        sys.exit(130)
    except Exception as error:
        # Never include exception text, input values or a traceback in output.
        print('BOS_RUNTIME_SECRETS_FAILED category=' + type(error).__name__, flush=True)
        sys.exit(1)
