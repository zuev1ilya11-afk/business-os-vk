#!/usr/bin/env python3
"""Copy private Storage bytes matching the verified trial snapshot to this server.

No source writes and no application deployment. An API key is read only from the
terminal, held in memory, and sent only to the fixed source HTTPS endpoint.
"""
import argparse
import base64
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
import uuid
import warnings
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler, Request

from rehearse_restore import validate_backup, stop_trial
from vault_rekey_trial import validate_container

PROJECT = 'obsropbslfwtanyspjbi'
ORIGIN = 'https://' + PROJECT + '.supabase.co'
BUCKET = 'business-os-vk-files'


def validate_manifest(rows):
    ids, paths = set(), set()
    if not isinstance(rows, list) or not rows:
        raise ValueError('Empty manifest')
    for row in rows:
        uuid.UUID(row['id'])
        uuid.UUID(row['version'])
        name = row['name']
        if (row['bucket_id'] != BUCKET or not isinstance(name, str) or not name
                or len(name) > 1024 or name.startswith('/') or '\\' in name or '\x00' in name
                or any(part in ('', '.', '..') for part in name.split('/'))):
            raise ValueError('Unexpected object path')
        pair = (row['bucket_id'], name)
        if row['id'] in ids or pair in paths:
            raise ValueError('Duplicate object')
        ids.add(row['id'])
        paths.add(pair)
        size = row['metadata']['size']
        etag = row['metadata']['eTag'].strip('"')
        if type(size) is not int or not 0 <= size <= 100 * 1024 * 1024:
            raise ValueError('Unexpected object size')
        if not re.fullmatch(r'[0-9a-f]{32}', etag):
            raise ValueError('Snapshot checksum is not a single-part MD5')


def object_url(row):
    return ORIGIN + '/storage/v1/object/authenticated/' + quote(row['bucket_id'], safe='') + '/' + quote(row['name'], safe='/')


def local_name(row):
    return str(uuid.UUID(row['id']))


def auth_headers(key):
    if not key or re.search(r'\s', key):
        raise ValueError('Invalid API key')
    headers = {'apikey': key, 'Accept-Encoding': 'identity',
               'User-Agent': 'BusinessOS-StorageBackup/1'}
    if re.fullmatch(r'sb_secret_[A-Za-z0-9_-]+', key):
        return headers
    parts = key.split('.')
    if len(parts) != 3 or not all(re.fullmatch(r'[A-Za-z0-9_-]+', p) for p in parts):
        raise ValueError('A server API key is required')
    payload = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
    if payload.get('role') != 'service_role' or payload.get('ref') != PROJECT:
        raise ValueError('Wrong project or role')
    headers['Authorization'] = 'Bearer ' + key
    return headers


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPError(newurl, code, 'Redirect refused', headers, fp)


def save_stream(stream, target, row):
    partial = target.with_name(target.name + '.partial')
    if target.exists():
        raise ValueError('Refusing to replace an existing backup object')
    expected_size = row['metadata']['size']
    md5 = hashlib.md5(usedforsecurity=False)
    sha = hashlib.sha256()
    size = 0
    try:
        with partial.open('xb') as output:
            while True:
                chunk = stream.read(65536)
                if not chunk:
                    break
                size += len(chunk)
                if size > expected_size:
                    raise ValueError('Object size exceeds snapshot')
                md5.update(chunk)
                sha.update(chunk)
                output.write(chunk)
            if size != expected_size or md5.hexdigest() != row['metadata']['eTag'].strip('"'):
                raise ValueError('Object bytes differ from snapshot')
            output.flush()
            os.fsync(output.fileno())
        partial.rename(target)
        return {'file': 'objects/' + target.name, 'size': size, 'sha256': sha.hexdigest()}
    finally:
        partial.unlink(missing_ok=True)


def read_snapshot(cid):
    def sql(query, required=True):
        result = subprocess.run(['docker', 'exec', cid, 'psql', '-X', '-w', '-qAt',
                   '-h', '127.0.0.1', '-U', 'bos_restore_loader', '-d', 'bos_restore_check',
                   '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse',
                   '-c', 'BEGIN READ ONLY; SET LOCAL statement_timeout=30000;',
                   '-c', query, '-c', 'COMMIT;'], capture_output=True, timeout=45)
        if required and result.returncode:
            raise RuntimeError('Snapshot query failed')
        return result
    stopped = False
    try:
        subprocess.run(['docker', 'start', cid], check=True, capture_output=True, timeout=30)
        for _ in range(30):
            result = sql('SELECT 1;', required=False)
            if result.returncode == 0 and result.stdout.strip() == b'1':
                break
            time.sleep(1)
        else:
            raise RuntimeError('Trial did not start')
        if sql('SHOW cron.launch_active_jobs;').stdout.strip() != b'off':
            raise RuntimeError('Cron is not disabled')
        data = sql("SELECT coalesce(jsonb_agg(jsonb_build_object("
                   "'id',id,'bucket_id',bucket_id,'name',name,'version',version,"
                   "'metadata',metadata,'created_at',created_at,'updated_at',updated_at)"
                   " ORDER BY id),'[]'::jsonb) FROM storage.objects;").stdout
        return json.loads(data)
    finally:
        stopped = stop_trial(cid)
        if not stopped:
            print('BOS_TRIAL_STOP_FAILED', flush=True)
            raise RuntimeError('Trial shutdown failed')
        print('Пробный контейнер остановлен.', flush=True)


def download(opener, headers, row, target):
    for attempt in range(3):
        try:
            request = Request(object_url(row), headers=headers, method='GET')
            with opener.open(request, timeout=30) as response:
                if response.status != 200 or response.headers.get('Content-Encoding', 'identity') != 'identity':
                    raise ValueError('Unexpected object response')
                return save_stream(response, target, row)
        except HTTPError as error:
            error.close()
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
        except (URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(attempt + 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', required=True)
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--expected-count', type=int, required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('Run as root')
    os.umask(0o077)
    backup = args.backup.resolve(strict=True)
    if backup.parent != Path('/opt/business-os/backups'):
        raise ValueError('Unexpected backup path')
    validate_backup(backup)
    info = json.loads(subprocess.run(['docker', 'inspect', args.container], check=True,
                      capture_output=True, text=True, timeout=20).stdout)[0]
    cid = validate_container(info, args.container)
    if not any(m['Destination'] == '/backup' and m['Source'] == str(backup) and not m['RW']
               for m in info['Mounts']):
        raise ValueError('Archive mount mismatch')
    warnings.simplefilter('error', getpass.GetPassWarning)
    headers = auth_headers(getpass.getpass('Серверный API-ключ исходного Supabase (скрытый ввод): ').strip())
    stage = Path(tempfile.mkdtemp(prefix='storage-snapshot-', dir='/opt/business-os/backups'))
    (stage / 'objects').mkdir(mode=0o700)
    print('Каталог файлов:', stage, flush=True)
    phase, item = 'snapshot', 0

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    try:
        rows = read_snapshot(cid)
        validate_manifest(rows)
        if len(rows) != args.expected_count:
            raise ValueError('Snapshot object count changed')
        source_sha = next(line.split()[0] for line in (backup / 'SHA256SUMS').read_text().splitlines()
                          if line.endswith('  source.dump'))
        manifest = {'project': PROJECT, 'source_dump_sha256': source_sha, 'objects': rows}
        (stage / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
        opener = build_opener(ProxyHandler({}), NoRedirect())
        results = []
        phase = 'download'
        print('Скачивание файлов из снимка:', len(rows), flush=True)
        for item, row in enumerate(rows, 1):
            results.append(download(opener, headers, row, stage / 'objects' / local_name(row)))
            if item % 20 == 0 or item == len(rows):
                print(f'Сохранено и проверено: {item}/{len(rows)}', flush=True)
        del headers
        phase = 'verify_local_files'
        sums = []
        for result in results:
            with (stage / result['file']).open('rb') as stream:
                actual = hashlib.file_digest(stream, 'sha256').hexdigest()
            if actual != result['sha256']:
                raise ValueError('Local checksum mismatch')
            sums.append(actual + '  ' + result['file'])
        sums.append(hashlib.sha256((stage / 'manifest.json').read_bytes()).hexdigest() + '  manifest.json')
        (stage / 'SHA256SUMS').write_text('\n'.join(sums) + '\n')
        total = sum(r['size'] for r in results)
        print(f'Проверено файлов: {len(results)}; байт: {total}', flush=True)
        print('Каталог:', stage, flush=True)
        print('BOS_STORAGE_SNAPSHOT_OK', flush=True)
        return 0
    except (Exception, KeyboardInterrupt) as error:
        status = f' http={error.code}' if isinstance(error, HTTPError) else ''
        print(f'BOS_STORAGE_BACKUP_FAILED phase={phase} item={item}{status}', flush=True)
        print('Уже скачанные файлы сохранены. Ключ и файлы в чат не отправляйте.', flush=True)
        return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (Exception, KeyboardInterrupt):
        print('BOS_STORAGE_PREFLIGHT_FAILED: проверьте ключ, пути и пробный контейнер.', file=sys.stderr)
        sys.exit(1)
