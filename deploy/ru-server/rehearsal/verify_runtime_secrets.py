#!/usr/bin/env python3
"""Compare staged originals to source Management API SHA256 digests, read-only.

Only the hidden Personal Access Token is sent to Supabase. Staged application
secrets stay on this server. A separate receipt binds the check to the input file.
"""
import argparse
from datetime import datetime, timezone
import getpass
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time
import warnings
from urllib.error import HTTPError, URLError
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler, Request

PROJECT = 'obsropbslfwtanyspjbi'
URL = 'https://api.supabase.com/v1/projects/' + PROJECT + '/secrets'
NAMES = ('VK_APP_SECRET', 'BOS_SYNC_KEY', 'HANDS_API_KEY', 'AVITO_CLIENT_ID', 'AVITO_CLIENT_SECRET')
LIMIT = 1024 * 1024


def private_bytes(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > LIMIT):
            raise ValueError('Unexpected private file')
        data = source.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError('File exceeds limit')
    return data


def load_secrets(root):
    info = root.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise ValueError('Unexpected private directory')
    data = private_bytes(root / 'functions-secrets.json')
    checksums = private_bytes(root / 'SHA256SUMS').decode('ascii')
    match = re.fullmatch(r'([a-f0-9]{64})  functions-secrets\.json\n', checksums)
    digest = hashlib.sha256(data).hexdigest()
    if match is None or not hmac.compare_digest(digest, match[1]):
        raise ValueError('Saved secret file checksum differs')
    document = json.loads(data)
    if document.get('format') != 1 or document.get('source_project') != PROJECT:
        raise ValueError('Unexpected secret document')
    values = document.get('values')
    if not isinstance(values, dict) or set(values) != set(NAMES):
        raise ValueError('Unexpected secret set')
    for value in values.values():
        if (not isinstance(value, str) or not 0 < len(value) <= 16384
                or value != value.strip() or any(ord(c) < 32 or ord(c) == 127 for c in value)):
            raise ValueError('Unexpected secret value')
    return values, digest


def parse_digests(rows):
    if not isinstance(rows, list) or not 1 <= len(rows) <= 1000:
        raise ValueError('Unexpected digest inventory')
    result = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Unexpected digest row')
        name, digest = row.get('name'), row.get('value')
        if (not isinstance(name, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,127}', name)
                or name in result or not isinstance(digest, str)
                or not re.fullmatch(r'[a-fA-F0-9]{64}', digest)):
            raise ValueError('Expected unique names and SHA256 digests')
        result[name] = digest.lower()
    return result


def compare(values, digests):
    if set(values) != set(NAMES):
        raise ValueError('Unexpected local secret names')
    matched, missing, mismatched = [], [], []
    for name in NAMES:
        if name not in digests:
            missing.append(name)
        elif hmac.compare_digest(hashlib.sha256(values[name].encode('utf-8')).hexdigest(), digests[name]):
            matched.append(name)
        else:
            mismatched.append(name)
    unexpected = sorted(name for name in digests if name not in NAMES and not name.startswith('SUPABASE_'))
    return {'all_match': not (missing or mismatched or unexpected), 'matched': matched,
            'missing': missing, 'mismatched': mismatched, 'unexpected': unexpected}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPError(newurl, code, 'Redirect refused', headers, fp)


def fetch_digests(token):
    if not re.fullmatch(r'sbp_[A-Za-z0-9_-]+', token):
        raise ValueError('Personal Access Token required')
    opener = build_opener(ProxyHandler({}), NoRedirect())
    headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
               'Accept-Encoding': 'identity', 'User-Agent': 'BusinessOS-SecretVerification/1'}
    for attempt in range(3):
        try:
            request = Request(URL, headers=headers, method='GET')
            with opener.open(request, timeout=30) as response:
                if (response.status != 200 or response.headers.get('Content-Encoding', 'identity') != 'identity'
                        or response.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json'):
                    raise ValueError('Unexpected API response')
                data = response.read(LIMIT + 1)
                if len(data) > LIMIT:
                    raise ValueError('Response exceeds limit')
                return parse_digests(json.loads(data))
        except HTTPError as error:
            error.close()
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
        except (URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(attempt + 1)


def save_receipt(root, digest, result):
    receipt = dict(result, format=1, source_project=PROJECT, secrets_file_sha256=digest,
                   checked_at=datetime.now(timezone.utc).isoformat())
    payload = (json.dumps(receipt, sort_keys=True, indent=2) + '\n').encode('ascii')
    fd, filename = tempfile.mkstemp(prefix='verification-', suffix='.json', dir=root)
    path = Path(filename)
    with os.fdopen(fd, 'wb') as output:
        output.write(payload)
        output.flush()
        os.fsync(output.fileno())
    if private_bytes(path) != payload:
        raise ValueError('Receipt reread failed')
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--secrets-dir', type=Path, required=True)
    args = parser.parse_args()
    root = args.secrets_dir
    if (os.geteuid() != 0 or root.parent != Path('/opt/business-os/deploy')
            or not re.fullmatch(r'runtime-secrets-[A-Za-z0-9_-]+', root.name)):
        raise ValueError('Run as root with the staged directory')
    os.umask(0o077)
    values, digest = load_secrets(root)
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        token = getpass.getpass('Personal Access Token с Edge Function Secrets Read (скрытый ввод): ')
    remote = fetch_digests(token)
    del token
    result = compare(values, remote)
    _, current_digest = load_secrets(root)
    if not hmac.compare_digest(digest, current_digest):
        raise ValueError('Local secret file changed during verification')
    receipt_path = save_receipt(root, digest, result)
    print(f'Совпало ключей: {len(result["matched"])}/{len(NAMES)}')
    for field, label in (('mismatched', 'Не совпали'), ('missing', 'Отсутствуют в Supabase'),
                         ('unexpected', 'Дополнительные секреты в Supabase')):
        if result[field]:
            print(label + ': ' + ', '.join(result[field]))
    print('Файл проверки: ' + str(receipt_path))
    if not result['all_match']:
        print('BOS_RUNTIME_SECRETS_MISMATCH', flush=True)
        sys.exit(1)
    print('BOS_RUNTIME_SECRETS_VERIFIED', flush=True)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('BOS_RUNTIME_SECRETS_CHECK_FAILED category=interrupted', flush=True)
        sys.exit(130)
    except Exception as error:
        category = ('http_' + str(error.code)) if isinstance(error, HTTPError) else type(error).__name__
        print('BOS_RUNTIME_SECRETS_CHECK_FAILED category=' + category, flush=True)
        sys.exit(1)
