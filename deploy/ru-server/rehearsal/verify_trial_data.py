#!/usr/bin/env python3
"""Compare restored COPY rows and sequence state with the immutable source dump.

Read-only PostgreSQL sessions. Offline trial only. Vault ciphertext is excluded
because it was separately rekeyed and verified; all its other fields are checked.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time

from rehearse_restore import validate_backup, stop_trial
from vault_rekey_trial import validate_container

IDENT = r'(?:[a-z_][a-z_0-9]*|"(?:[^"]|"")+")'
QUALIFIED = IDENT + r'\.' + IDENT
COPY_HEADER = re.compile(r'COPY (' + QUALIFIED + r') \((' + IDENT + r'(?:, ' + IDENT + r')*)\) FROM stdin;')
SEQUENCE = re.compile(r"SELECT pg_catalog.setval\('((?:[^']|'')+)', (-?\d+), (true|false)\);")


def digest_rows(lines, skip_column=None):
    hashes = []
    for line in lines:
        if skip_column is not None:
            fields = line.rstrip(b'\n').split(b'\t')
            fields[skip_column] = b'<vault-ciphertext-checked-separately>'
            line = b'\t'.join(fields) + b'\n'
        hashes.append(hashlib.sha256(line).digest())
    return hashlib.sha256(b''.join(sorted(hashes))).hexdigest()


def parse_data(data):
    tables, sequences, seen = [], [], set()
    stream = io.BytesIO(data)
    for line in stream:
        if line.startswith(b'COPY '):
            match = COPY_HEADER.fullmatch(line.decode('utf-8').rstrip('\n'))
            if not match or match[1] in seen:
                raise ValueError('Unsupported or duplicate COPY header')
            relation, columns = match.groups()
            seen.add(relation)
            column_list = re.findall(IDENT, columns)
            skip = column_list.index('secret') if relation == 'vault.secrets' else None
            rows = []
            for row in stream:
                if row == b'\\.\n':
                    break
                if not row.endswith(b'\n') or len(row.rstrip(b'\n').split(b'\t')) != len(column_list):
                    raise ValueError('Invalid COPY row')
                rows.append(row)
            else:
                raise ValueError('Truncated COPY block')
            tables.append({'table': relation, 'columns': columns, 'skip': skip,
                           'rows': len(rows), 'sha256': digest_rows(rows, skip)})
        elif line.startswith(b'SELECT pg_catalog.setval('):
            match = SEQUENCE.fullmatch(line.decode('utf-8').rstrip('\n'))
            if not match:
                raise ValueError('Unsupported sequence command')
            name = match[1].replace("''", "'")
            if not re.fullmatch(QUALIFIED, name) or any(s[0] == name for s in sequences):
                raise ValueError('Unsupported or duplicate sequence name')
            sequences.append((name, int(match[2]), match[3] == 'true'))
    if not tables:
        raise ValueError('No COPY data found')
    return tables, sequences


SETTINGS = """
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
SET LOCAL timezone='UTC';
SET LOCAL datestyle='ISO';
SET LOCAL intervalstyle='postgres';
SET LOCAL extra_float_digits=3;
SET LOCAL bytea_output='hex';
SET LOCAL row_security=off;
SET LOCAL search_path='';
"""
INVENTORY = """
SELECT json_build_object(
  'database_owner', (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),
  'database_acl', (SELECT datacl::text FROM pg_database WHERE datname=current_database()),
  'cron_enabled', current_setting('cron.launch_active_jobs'),
  'extensions', (SELECT json_agg(json_build_object('name',extname,'version',extversion,
                  'owner',pg_get_userbyid(extowner)) ORDER BY extname) FROM pg_extension),
  'tables_with_rls', (SELECT count(*) FROM pg_class WHERE relrowsecurity),
  'policies', (SELECT count(*) FROM pg_policy),
  'vault_rows', (SELECT count(*) FROM vault.secrets)
);
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', required=True)
    parser.add_argument('--backup', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if os.geteuid() != 0:
        raise ValueError('Run as root')
    backup = args.backup.resolve(strict=True)
    if backup.parent != Path('/opt/business-os/backups'):
        raise ValueError('Unexpected backup path')
    validate_backup(backup)
    contents = (backup / 'contents.txt').read_text()
    if re.search(r' (?:BLOB|BLOBS|LARGE OBJECT|MATERIALIZED VIEW DATA) ', contents):
        raise ValueError('Archive needs additional non-COPY data verification')
    info = json.loads(subprocess.run(['docker', 'inspect', args.container], check=True,
                       capture_output=True, text=True, timeout=20).stdout)[0]
    cid = validate_container(info, args.container)
    if not any(m['Destination'] == '/backup' and m['Source'] == str(backup) and not m['RW']
               for m in info['Mounts']):
        raise ValueError('Archive mount mismatch')
    stage = Path(tempfile.mkdtemp(prefix='data-verify-', dir='/opt/business-os/deploy'))
    print('Каталог проверки:', stage, flush=True)
    phase = 'start'
    success = False

    def run(command, timeout=90, required=True):
        result = subprocess.run(command, capture_output=True, timeout=timeout)
        # Stdout may contain rows/password hashes: NEVER log or print it.
        with (stage / 'verify.log').open('ab') as log:
            log.write(result.stderr)
        if required and result.returncode:
            raise RuntimeError('Command failed')
        return result

    def sql(query, required=True):
        return run(['docker', 'exec', cid, 'psql', '-X', '-w', '-qAt',
                    '-h', '127.0.0.1', '-U', 'bos_restore_loader', '-d', 'bos_restore_check',
                    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse',
                    '-c', SETTINGS, '-c', query, '-c', 'ROLLBACK;'], required=required)

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    try:
        run(['docker', 'start', cid], timeout=30)
        for _ in range(30):
            result = sql('SELECT 1;', required=False)
            if result.returncode == 0 and result.stdout.strip() == b'1':
                break
            time.sleep(1)
        else:
            raise RuntimeError('Database startup timeout')
        if sql('SHOW cron.launch_active_jobs;').stdout.strip() != b'off':
            raise RuntimeError('Cron is not disabled')
        phase = 'read_archive'
        print('Чтение данных из проверенного архива...', flush=True)
        result = run(['docker', 'exec', cid, 'pg_restore', '--data-only',
                      '--file=-', '/backup/source.dump'], timeout=300)
        tables, sequences = parse_data(result.stdout)
        del result
        if len(tables) != len(re.findall(r' TABLE DATA ', contents)):
            raise ValueError('Not every archive data entry was parsed')
        if len(sequences) != len(re.findall(r' SEQUENCE SET ', contents)):
            raise ValueError('Not every archive sequence was parsed')
        phase = 'compare_rows'
        report = {'tables': [], 'sequences': [], 'vault_ciphertext': 'verified_separately'}
        for index, table in enumerate(tables, 1):
            relation, columns = table['table'], table['columns']
            result = sql(f'COPY (SELECT {columns} FROM ONLY {relation}) TO STDOUT;')
            rows = list(io.BytesIO(result.stdout))
            actual = digest_rows(rows, table['skip'])
            matched = len(rows) == table['rows'] and actual == table['sha256']
            report['tables'].append({'table': relation, 'rows': len(rows), 'match': matched})
            if index % 20 == 0 or index == len(tables):
                print(f'Сверено таблиц: {index}/{len(tables)}', flush=True)
        phase = 'compare_sequences'
        for name, value, called in sequences:
            actual = sql(f'SELECT last_value, is_called FROM {name};').stdout.strip().decode()
            matched = actual == f'{value}|{"t" if called else "f"}'
            report['sequences'].append({'sequence': name, 'match': matched})
        report['inventory'] = json.loads(sql(INVENTORY).stdout)
        (stage / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        bad_tables = [x['table'] for x in report['tables'] if not x['match']]
        bad_sequences = [x['sequence'] for x in report['sequences'] if not x['match']]
        print('Расхождения таблиц:', json.dumps(bad_tables, ensure_ascii=False), flush=True)
        print('Расхождения счётчиков:', json.dumps(bad_sequences, ensure_ascii=False), flush=True)
        print('Права и расширения:', json.dumps(report['inventory'], ensure_ascii=False), flush=True)
        if bad_tables or bad_sequences:
            raise RuntimeError('Data differs from archive')
        print(f'Данные совпали: {len(tables)} таблиц, {len(sequences)} счётчиков.', flush=True)
        success = True
    except (Exception, KeyboardInterrupt):
        print('BOS_TRIAL_DATA_FAILED phase=' + phase, flush=True)
        print('Журнал оставлен на сервере; не отправляйте его целиком.', flush=True)
    finally:
        if not stop_trial(cid):
            print('BOS_TRIAL_STOP_FAILED: ' + args.container, flush=True)
            success = False
        else:
            print('Пробный контейнер остановлен.', flush=True)
    if success:
        print('BOS_TRIAL_DATA_OK', flush=True)
        print('Права, версии расширений, Storage и приложение ещё требуют проверки.', flush=True)
        return 0
    return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('BOS_DATA_PREFLIGHT_FAILED: проверьте архив, пути и изоляцию контейнера.', file=sys.stderr)
        sys.exit(1)
