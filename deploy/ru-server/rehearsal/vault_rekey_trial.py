#!/usr/bin/env python3
"""Re-encrypt exported Vault values ONLY in an existing offline restore trial.

The source export remains on the server. No source connection, production update,
outgoing network, secret command arguments or secret terminal output is used.
"""
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import uuid

NAMES = {'bos-hands-report-worker-v1', 'bos-push-vapid-v1', 'bos-push-worker-v1'}
HEADER = ['id', 'name', 'description', 'decrypted_secret', 'created_at', 'updated_at']
DATABASE = 'bos_restore_check'
LOADER = 'bos_restore_loader'


def read_export(folder):
    for name in ('vault.csv', 'SHA256SUMS'):
        path = folder / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
            raise ValueError('Invalid export file')
    data = (folder / 'vault.csv').read_bytes()
    expected = hashlib.sha256(data).hexdigest() + '  vault.csv'
    if (folder / 'SHA256SUMS').read_text().strip() != expected:
        raise ValueError('Export checksum mismatch')
    text = data.decode('utf-8')
    if '\x00' in text or any(line == '\\.' for line in text.splitlines()):
        raise ValueError('Unsupported COPY input')
    reader = csv.DictReader(io.StringIO(text, newline=''), strict=True)
    rows = list(reader)
    if reader.fieldnames != HEADER or len(rows) != 3 or {r['name'] for r in rows} != NAMES:
        raise ValueError('Unexpected secret set')
    if len({r['id'] for r in rows}) != 3:
        raise ValueError('Duplicate identifiers')
    for row in rows:
        uuid.UUID(row['id'])
        if set(row) != set(HEADER) or not all(row[k] for k in ('decrypted_secret', 'created_at', 'updated_at')):
            raise ValueError('Incomplete secret record')
    return data


def validate_container(info, name):
    if (not re.fullmatch(r'bos-restore-trial-[a-z0-9]+', name)
            or info['Name'] != '/' + name
            or info['Config'].get('Labels', {}).get('bos.restore-trial') != 'true'
            or info['State']['Running']
            or info['HostConfig']['NetworkMode'] != 'none'
            or info['HostConfig'].get('PortBindings')
            or info['HostConfig']['RestartPolicy']['Name'] != 'no'
            or 'cron.launch_active_jobs=off' not in info['Config']['Cmd']
            or not re.fullmatch(r'[a-f0-9]{64}', info['Id'])):
        raise ValueError('Expected a stopped, isolated restore trial')
    return info['Id']


PREPARE = """
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL log_statement = 'none';
SET LOCAL log_min_error_statement = 'panic';
SET LOCAL log_error_verbosity = 'terse';
SET LOCAL pgaudit.log = 'none';
SET LOCAL session_replication_role = 'replica';
DO $guard$ BEGIN
  IF current_database() <> 'bos_restore_check'
     OR current_user <> 'bos_restore_loader'
     OR current_setting('cron.launch_active_jobs') <> 'off'
     OR (SELECT extversion FROM pg_extension WHERE extname='supabase_vault') IS DISTINCT FROM '0.3.1'
  THEN RAISE EXCEPTION 'BOS_VAULT_ENVIRONMENT_MISMATCH'; END IF;
END $guard$;
LOCK TABLE vault.secrets IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE bos_vault_import (
  id uuid PRIMARY KEY, name text NOT NULL UNIQUE, description text,
  decrypted_secret text NOT NULL, created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
) ON COMMIT DROP;
"""
COPY = '\\copy bos_vault_import (id,name,description,decrypted_secret,created_at,updated_at) FROM PSTDIN WITH (FORMAT csv, HEADER true)'
CHECK_METADATA = """
DO $guard$ BEGIN
  IF (SELECT count(*) FROM bos_vault_import) <> 3
     OR (SELECT count(*) FROM vault.secrets) <> 3
     OR EXISTS (
       SELECT 1 FROM vault.secrets s FULL JOIN bos_vault_import i USING (id)
       WHERE s.id IS NULL OR i.id IS NULL OR s.key_id IS NOT NULL
          OR s.name IS DISTINCT FROM i.name
          OR s.description IS DISTINCT FROM i.description
          OR s.created_at IS DISTINCT FROM i.created_at
          OR s.updated_at IS DISTINCT FROM i.updated_at
     )
  THEN RAISE EXCEPTION 'BOS_VAULT_SNAPSHOT_MISMATCH'; END IF;
END $guard$;
"""
# vault.update_secret in 0.3.1 reads the old plaintext in its DECLARE block,
# which fails with a different root key. Use the exact encryption expression
# from that function, retaining the existing UUID, nonce and all metadata.
REKEY = """
UPDATE vault.secrets s
SET secret = encode(vault._crypto_aead_det_encrypt(
  message := convert_to(i.decrypted_secret, 'utf8'),
  additional := convert_to(s.id::text, 'utf8'),
  key_id := 0, context := 'pgsodium'::bytea, nonce := s.nonce
), 'base64')
FROM bos_vault_import i WHERE i.id = s.id;
"""
CHECK_VALUES = """
DO $guard$ BEGIN
  IF (SELECT count(*) FROM vault.decrypted_secrets d
      JOIN bos_vault_import i USING (id)
      WHERE d.decrypted_secret IS NOT DISTINCT FROM i.decrypted_secret) <> 3
  THEN RAISE EXCEPTION 'BOS_VAULT_VALUE_MISMATCH'; END IF;
END $guard$;
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', required=True)
    parser.add_argument('--export', dest='export_dir', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if os.geteuid() != 0:
        raise ValueError('Run as root')
    folder = args.export_dir
    if (folder.is_symlink() or folder.resolve(strict=True).parent != Path('/opt/business-os/deploy')
            or not folder.name.startswith('vault-export-')
            or folder.stat().st_mode & 0o077):
        raise ValueError('Expected a private vault-export directory')
    for name in ('vault.csv', 'SHA256SUMS'):
        if (folder / name).stat().st_mode & 0o077:
            raise ValueError('Export permissions are not private')
    data = read_export(folder)
    inspection = subprocess.run(['docker', 'inspect', args.container], check=True,
                                capture_output=True, text=True, timeout=20)
    info = json.loads(inspection.stdout)[0]
    cid = validate_container(info, args.container)
    stage = Path(tempfile.mkdtemp(prefix='vault-import-', dir='/opt/business-os/deploy'))
    log = stage / 'import.log'
    phase = 'start'
    success = False
    print('Каталог проверки:', stage, flush=True)

    def run(command, input=None, timeout=90, required=True):
        result = subprocess.run(command, input=input, capture_output=True, timeout=timeout)
        with log.open('ab') as stream:
            stream.write(result.stdout + result.stderr)
        if required and result.returncode:
            raise RuntimeError('Command failed')
        return result

    def psql():
        return ['docker', 'exec', '-i', cid, 'psql', '-X', '-w', '-qAt',
                '-h', '127.0.0.1', '-U', LOADER, '-d', DATABASE,
                '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse']

    def start_ready():
        run(['docker', 'start', cid], timeout=30)
        for _ in range(30):
            result = run(psql() + ['-c', 'SELECT 1'], timeout=10, required=False)
            if result.returncode == 0 and result.stdout.strip() == b'1':
                return
            time.sleep(1)
        raise RuntimeError('Database did not start')

    def stop():
        try:
            run(['docker', 'stop', '--time', '20', cid], timeout=40)
            result = run(['docker', 'inspect', '--format', '{{.State.Running}}', cid], timeout=20)
            return result.stdout.strip() == b'false'
        except (Exception, KeyboardInterrupt):
            return False

    def transfer(apply):
        finish = CHECK_METADATA + (REKEY if apply else '') + CHECK_VALUES
        finish += 'COMMIT;' if apply else 'ROLLBACK;'
        result = run(psql() + ['-c', PREPARE, '-c', COPY, '-c', finish,
                              '-c', "SELECT 'BOS_VAULT_VALUES_OK'"], input=data)
        if result.stdout.strip() != b'BOS_VAULT_VALUES_OK':
            raise RuntimeError('Unexpected verification result')

    try:
        start_ready()
        phase = 'rekey'
        print('Проверка снимка и шифрование трёх секретов...', flush=True)
        transfer(apply=True)
        phase = 'restart'
        if not stop():
            raise RuntimeError('Could not stop for persistence check')
        start_ready()
        phase = 'verify_after_restart'
        transfer(apply=False)
        print('Проверено после перезапуска: 3 из 3. Идентификаторы сохранены.', flush=True)
        success = True
    except (Exception, KeyboardInterrupt):
        print('BOS_VAULT_IMPORT_FAILED phase=' + phase, flush=True)
        print('Журнал сохранён на сервере; не отправляйте его целиком.', flush=True)
    finally:
        if not stop():
            print('BOS_TRIAL_STOP_FAILED: ' + args.container, flush=True)
            success = False
        else:
            print('Пробный контейнер остановлен. Cron выключен.', flush=True)
    if success:
        print('BOS_TRIAL_VAULT_OK', flush=True)
        return 0
    return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('BOS_VAULT_PREFLIGHT_FAILED: проверьте пути, права, контрольную сумму и контейнер.',
              file=sys.stderr)
        sys.exit(1)
