#!/usr/bin/env python3
"""Back up deployed function sources and metadata using read-only Management API.

Run on the migration server. The PAT stays in memory; source files remain in a
private local directory. Nothing is invoked, deployed, or changed in Supabase.
"""
import argparse
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import sys
import tempfile
import time
import warnings
from urllib.error import HTTPError, URLError
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler, Request

PROJECT = 'obsropbslfwtanyspjbi'
ORIGIN = 'https://api.supabase.com/v1/projects/' + PROJECT
LIMIT = 32 * 1024 * 1024
SLUG = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}')
FIELDS = ('id', 'slug', 'version', 'status', 'verify_jwt', 'entrypoint_path',
          'import_map', 'import_map_path', 'ezbr_sha256', 'created_at', 'updated_at')


def validate_inventory(rows, expected_count):
    if not isinstance(rows, list) or len(rows) != expected_count or not rows:
        raise ValueError('Unexpected function count')
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Invalid function metadata')
        slug = row.get('slug')
        if (not isinstance(slug, str) or not SLUG.fullmatch(slug) or slug in seen
                or type(row.get('version')) is not int or row['version'] < 1
                or type(row.get('verify_jwt')) is not bool or row.get('status') != 'ACTIVE'):
            raise ValueError('Unexpected function metadata')
        seen.add(slug)


def fingerprint(rows):
    return json.dumps([{key: row.get(key) for key in FIELDS}
                       for row in sorted(rows, key=lambda r: r['slug'])], sort_keys=True)


def decode_multipart(content_type, body):
    if (not isinstance(content_type, str) or '\r' in content_type or '\n' in content_type
            or len(content_type) > 1024 or len(body) > LIMIT):
        raise ValueError('Invalid multipart response')
    message = BytesParser(policy=policy.default.clone(raise_on_defect=True)).parsebytes(
        b'MIME-Version: 1.0\r\nContent-Type: ' + content_type.encode('ascii') + b'\r\n\r\n' + body)
    if message.get_content_type() != 'multipart/form-data' or not message.is_multipart():
        raise ValueError('Expected multipart/form-data')
    metadata, files, seen = None, [], set()
    for part in message.iter_parts():
        if part.is_multipart() or part.defects:
            raise ValueError('Invalid multipart part')
        if part.get('Content-Transfer-Encoding', '').lower() not in ('', 'binary', '8bit'):
            raise ValueError('Unexpected transfer encoding')
        source_path = part.get('Supabase-Path') or part.get_filename()
        payload = part.get_payload(decode=True)
        if not isinstance(payload, bytes):
            raise ValueError('Missing part bytes')
        if source_path:
            source_path = str(source_path)
            if source_path in seen or '\x00' in source_path or len(source_path) > 8192:
                raise ValueError('Invalid or duplicate source path')
            seen.add(source_path)
            files.append((source_path, payload))
        elif part.get_param('name', header='content-disposition') == 'metadata':
            if metadata is not None:
                raise ValueError('Duplicate metadata')
            metadata = json.loads(payload)
            if not isinstance(metadata, dict):
                raise ValueError('Invalid body metadata')
        else:
            raise ValueError('Unrecognized multipart part')
    if not files:
        raise ValueError('No source files')
    return metadata or {}, files


def env_names(files):
    names = set()
    for _, body in files:
        names.update(re.findall(rb'''\bDeno\s*\.\s*env\s*\.\s*get\s*\(\s*["']([A-Z][A-Z0-9_]*)["']''', body))
    return sorted(name.decode('ascii') for name in names)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPError(newurl, code, 'Redirect refused', headers, fp)


class Client:
    def __init__(self, token):
        if not re.fullmatch(r'sbp_[A-Za-z0-9_-]+', token):
            raise ValueError('Personal Access Token required')
        self.headers = {'Authorization': 'Bearer ' + token,
                        'Accept-Encoding': 'identity', 'User-Agent': 'BusinessOS-FunctionsBackup/1'}
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def get(self, path, accept):
        if not re.fullmatch(r'/functions(?:/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}/body)?', path):
            raise ValueError('Unexpected API endpoint')
        for attempt in range(3):
            try:
                request = Request(ORIGIN + path, headers=dict(self.headers, Accept=accept), method='GET')
                with self.opener.open(request, timeout=45) as response:
                    if response.status != 200 or response.headers.get('Content-Encoding', 'identity') != 'identity':
                        raise ValueError('Unexpected API response')
                    body = response.read(LIMIT + 1)
                    if len(body) > LIMIT:
                        raise ValueError('Response exceeds size limit')
                    return response.headers.get('Content-Type', ''), body
            except HTTPError as error:
                error.close()
                if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise
            except (URLError, TimeoutError):
                if attempt == 2:
                    raise
            time.sleep(attempt + 1)

    def inventory(self, expected_count):
        content_type, body = self.get('/functions', 'application/json')
        if content_type.split(';')[0].strip() != 'application/json':
            raise ValueError('Unexpected inventory content type')
        rows = json.loads(body)
        validate_inventory(rows, expected_count)
        return rows


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + '\n').encode('utf-8')


def save_file(root, relative, data, checksums):
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with target.open('xb') as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    digest = hashlib.sha256(data).hexdigest()
    checksums[relative] = digest
    return {'file': relative, 'size': len(data), 'sha256': digest}


def snapshot(client, root, expected_count):
    checksums = {}
    before = client.inventory(expected_count)
    save_file(root, 'inventory-before.json', json_bytes(before), checksums)
    functions = []
    for number, row in enumerate(sorted(before, key=lambda r: r['slug']), 1):
        slug = row['slug']
        print(f'Сохранение функций: {number}/{len(before)} ({slug})', flush=True)
        content_type, body = client.get('/functions/' + slug + '/body', 'multipart/form-data')
        base = 'functions/' + slug + '/'
        raw = save_file(root, base + 'response.multipart', body, checksums)
        save_file(root, base + 'content-type.txt', (content_type + '\n').encode('utf-8'), checksums)
        metadata, files = decode_multipart(content_type, body)
        parts = []
        for index, (source_path, contents) in enumerate(files):
            # Original paths are metadata only, never filesystem destinations.
            part = save_file(root, base + f'parts/{index:04d}', contents, checksums)
            parts.append(dict(part, source_path=source_path))
        functions.append({'function': row, 'body_metadata': metadata, 'raw_response': raw,
                          'content_type': content_type, 'files': parts,
                          'literal_env_names': env_names(files)})
    after = client.inventory(expected_count)
    save_file(root, 'inventory-after.json', json_bytes(after), checksums)
    if fingerprint(before) != fingerprint(after):
        raise ValueError('Function versions changed during backup')
    manifest = {'format': 1, 'project_ref': PROJECT,
                'captured_at': datetime.now(timezone.utc).isoformat(),
                'purpose': 'Source backup only; runtime secret export and deployment checks are not included',
                'functions': functions}
    save_file(root, 'manifest.json', json_bytes(manifest), checksums)
    hashes = ''.join(digest + '  ' + name + '\n' for name, digest in sorted(checksums.items())).encode('ascii')
    save_file(root, 'SHA256SUMS', hashes, {})
    for name, digest in checksums.items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
            raise ValueError('Local checksum verification failed')
    return functions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-count', type=int, required=True)
    args = parser.parse_args()
    if os.geteuid() != 0 or not 1 <= args.expected_count <= 1000:
        raise ValueError('Run as root with expected function count')
    os.umask(0o077)
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(130))
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        token = getpass.getpass('Personal Access Token Supabase (скрытый ввод): ')
    client = Client(token)
    del token
    parent = Path('/opt/business-os/backups')
    if not parent.is_dir():
        raise ValueError('Backup directory is missing')
    root = Path(tempfile.mkdtemp(prefix='functions-snapshot-', dir=parent))
    print('Каталог: ' + str(root), flush=True)
    functions = snapshot(client, root, args.expected_count)
    print(f'Проверено функций: {len(functions)}; исходных файлов: {sum(len(f["files"]) for f in functions)}')
    names = sorted({name for fn in functions for name in fn['literal_env_names']})
    print('Имена переменных в коде: ' + ', '.join(names))
    print('BOS_FUNCTIONS_BACKUP_OK', flush=True)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('BOS_FUNCTIONS_BACKUP_FAILED category=interrupted', flush=True)
        sys.exit(130)
    except Exception as error:
        category = ('http_' + str(error.code)) if isinstance(error, HTTPError) else type(error).__name__
        # No exception messages or traceback: remote errors can contain secrets/code.
        print('BOS_FUNCTIONS_BACKUP_FAILED category=' + category, flush=True)
        sys.exit(1)
