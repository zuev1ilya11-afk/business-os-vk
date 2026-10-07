#!/usr/bin/env python3
"""Restore a local archive into a NEW, offline, stopped-after-use trial container.

Never connects to cloud or modifies the existing Business OS container. A passed
rehearsal is not a migration or a production cutover. Python standard library only.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import time

IMAGE = 'supabase/postgres:17.6.1.136'
CANDIDATE_IMAGE = ('supabase/postgres@sha256:'
                   '4b438c22395a9a2bd19ee0522742cc9a1ff91db4732ff0c1b08fc07e9c767c22')
EXPECTED_EXTENSIONS = {'pg_net': '0.20.4', 'pg_cron': '1.6.4', 'supabase_vault': '0.3.1',
                       'pgcrypto': '1.3', 'uuid-ossp': '1.1', 'btree_gist': '1.7',
                       'pg_stat_statements': '1.11'}
DATABASE = 'bos_restore_check'
LOADER = 'bos_restore_loader'


def resolve_image(reference):
    if reference not in (IMAGE, CANDIDATE_IMAGE):
        raise ValueError('Image reference is not an inspected rehearsal candidate')
    # Resolve the requested already-pulled image; never fall back to another tag.
    result = subprocess.run(['docker', 'image', 'inspect', reference], check=True,
                            capture_output=True, text=True, timeout=30)
    rows = json.loads(result.stdout)
    if not isinstance(rows, list) or len(rows) != 1:
        raise ValueError('Expected exactly one local image')
    info = rows[0]
    image = info.get('Id', '')
    if (not re.fullmatch(r'sha256:[a-f0-9]{64}', image)
            or info.get('Os') != 'linux' or info.get('Architecture') != 'amd64'
            or (reference == CANDIDATE_IMAGE and reference not in (info.get('RepoDigests') or []))):
        raise ValueError('Local image identity differs from inspected candidate')
    return image, {'requested_ref': reference, 'image_id': image,
                   'repo_digests': info.get('RepoDigests') or [],
                   'os': info['Os'], 'architecture': info['Architecture']}


def check_restored_versions(stats, reference):
    if stats['cron_enabled'] != 'off':
        raise RuntimeError('Cron setting changed during restore')
    if reference == CANDIDATE_IMAGE:
        if stats.get('server_version_num') != 170011:
            raise RuntimeError('Candidate PostgreSQL version differs')
        versions = stats.get('extensions')
        if (not isinstance(versions, dict)
                or any(versions.get(name) != version for name, version in EXPECTED_EXTENSIONS.items())):
            raise RuntimeError('Candidate installed extension versions differ')


def adapt_roles(sql, loader):
    if re.search(r'\b' + re.escape(loader) + r'\b', sql):
        raise ValueError('Loader role collides with source role definitions')
    lines = []
    count = 0
    for line in sql.splitlines(keepends=True):
        if line.strip().startswith('CREATE ROLE'):
            match = re.fullmatch(r'CREATE ROLE ([a-z_][a-z_0-9]*);\s*', line)
            if not match:
                raise ValueError('Unrecognized CREATE ROLE syntax; manual review required')
            role = match.group(1)
            line = ("DO $bos_roles$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles "
                    f"WHERE rolname = '{role}') THEN CREATE ROLE {role}; "
                    "END IF; END $bos_roles$;\n")
            count += 1
        lines.append(line)
    if not count:
        raise ValueError('No role definitions found')
    return ''.join(lines)


def validate_backup(path):
    expected = {}
    for line in (path / 'SHA256SUMS').read_text().splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  (source\.dump|roles\.sql|contents\.txt)', line)
        if not match or match[2] in expected:
            raise ValueError('Unexpected checksum manifest')
        expected[match[2]] = match[1]
    if set(expected) != {'source.dump', 'roles.sql', 'contents.txt'}:
        raise ValueError('Incomplete checksum manifest')
    for name, checksum in expected.items():
        file = path / name
        if file.is_symlink() or not file.is_file() or not file.stat().st_size:
            raise ValueError('Missing, empty or symlinked backup file')
        with file.open('rb') as stream:
            actual = hashlib.file_digest(stream, 'sha256').hexdigest()
        if actual != checksum:
            raise ValueError('Backup checksum mismatch: ' + name)


def create_args(name, stage, backup, image):
    return [
        'docker', 'create', '--name', name, '--label', 'bos.restore-trial=true',
        '--network', 'none', '--restart', 'no', '--memory', '2g', '--cpus', '2',
        '--shm-size', '256m', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=2',
        '--env-file', str(stage / 'trial.env'),
        '--mount', f'type=bind,source={stage / "data"},target=/var/lib/postgresql/data',
        '--mount', f'type=bind,source={backup},target=/backup,readonly',
        '--mount', f'type=volume,source={name}-config,target=/etc/postgresql-custom',
        image, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf',
        '-c', 'cron.launch_active_jobs=off', '-c', 'cron.database_name=' + DATABASE,
        '-c', 'log_min_messages=fatal',
    ]


def safe_failure(log):
    """Only classify errors; never print dumped SQL, credentials or row values."""
    text = log.read_text(errors='replace').lower()
    for fragment, label in (
        ('already exists', 'object_already_exists'),
        ('permission denied', 'permission_denied'),
        ('must be owner', 'ownership'),
        ('does not exist', 'missing_object'),
        ('not available', 'unavailable_extension_or_feature'),
        ('authentication failed', 'local_authentication'),
        ('connection refused', 'local_connection'),
    ):
        if fragment in text:
            return label
    return 'see_private_restore_log'


def stop_trial(cid):
    try:
        stopped = subprocess.run(['docker', 'stop', '--time', '20', cid],
                                 capture_output=True, text=True, timeout=40)
        state = subprocess.run(['docker', 'inspect', '--format', '{{.State.Running}}', cid],
                               capture_output=True, text=True, timeout=20)
        return (stopped.returncode == 0 and state.returncode == 0
                and state.stdout.strip() == 'false')
    except (subprocess.TimeoutExpired, OSError, KeyboardInterrupt):
        return False


def prepare_database(sql):
    admin = 'supabase_admin'
    result = sql('SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user;',
                 user=admin)
    if result.stdout.strip() != 'supabase_admin|t':
        raise RuntimeError('Bootstrap administrator must already be a superuser')
    sql("\\getenv local_pw POSTGRES_PASSWORD\n"
        f"CREATE ROLE {LOADER} LOGIN SUPERUSER PASSWORD :'local_pw';\n"
        f"CREATE DATABASE {DATABASE} TEMPLATE template0 OWNER postgres;\n", user=admin)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--image', choices=(IMAGE, CANDIDATE_IMAGE), default=IMAGE,
                        help='Already-pulled original image or inspected immutable candidate')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('Run as root on the new server')
    os.umask(0o077)
    backup = args.backup.resolve(strict=True)
    if backup.parent != Path('/opt/business-os/backups'):
        raise ValueError('Backup must be directly under /opt/business-os/backups')
    validate_backup(backup)
    role_sql = adapt_roles((backup / 'roles.sql').read_text(), LOADER)
    image, provenance = resolve_image(args.image)
    stage = Path(tempfile.mkdtemp(prefix='restore-trial-', dir='/opt/business-os/deploy'))
    (stage / 'data').mkdir(mode=0o700)
    (stage / 'image.json').write_text(json.dumps(provenance, sort_keys=True, indent=2) + '\n')
    password = secrets.token_hex(32)
    (stage / 'trial.env').write_text(
        f'POSTGRES_PASSWORD={password}\nPGPASSWORD={password}\n'
        'POSTGRES_DB=postgres\nPGDATABASE=postgres\nPGPORT=5432\n'
        'POSTGRES_PORT=5432\nPOSTGRES_HOST=/var/run/postgresql\nJWT_EXP=3600\n')
    (stage / 'roles.apply.sql').write_text(role_sql)
    del password, role_sql
    name = 'bos-' + stage.name
    log = stage / 'restore.log'
    cid = None
    phase = 'create'
    success = False
    print('Каталог проверки:', stage, flush=True)
    print('Контейнер:', name, flush=True)
    print('Образ:', args.image, flush=True)

    def run(command, input=None, timeout=300, required=True):
        result = subprocess.run(command, input=input, capture_output=True,
                                text=True, timeout=timeout)
        with log.open('a') as output:
            output.write(result.stdout)
            output.write(result.stderr)
        if required and result.returncode:
            raise RuntimeError('Command failed in phase ' + phase)
        return result

    def sql(query, user='postgres', db='postgres'):
        return run(['docker', 'exec', '-i', cid, 'psql', '-X', '-w', '-h', '127.0.0.1',
                    '-U', user, '-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], input=query)

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    try:
        cid = run(create_args(name, stage, backup, image)).stdout.strip()
        if not re.fullmatch(r'[a-f0-9]{64}', cid):
            raise RuntimeError('Invalid container ID')
        (stage / 'container-id').write_text(cid + '\n')
        phase = 'start'
        run(['docker', 'start', cid])
        inspected = json.loads(run(['docker', 'inspect', cid]).stdout)[0]
        if (inspected['HostConfig']['NetworkMode'] != 'none'
                or inspected.get('Image') != image
                or inspected['HostConfig'].get('PortBindings')
                or inspected['HostConfig']['RestartPolicy']['Name'] != 'no'):
            raise RuntimeError('Rehearsal isolation check failed')
        mounts = inspected['Mounts']
        if not any(m['Destination'] == '/backup' and not m['RW'] for m in mounts):
            raise RuntimeError('Backup mount is not read-only')
        phase = 'wait_database'
        print('Ожидание запуска отдельной БД...', flush=True)
        for attempt in range(90):
            result = run(['docker', 'exec', cid, 'psql', '-X', '-w', '-h', '127.0.0.1',
                          '-U', 'postgres', '-d', 'postgres', '-Atc', 'SELECT 1'],
                         timeout=10, required=False)
            if result.returncode == 0 and result.stdout.strip() == '1':
                break
            time.sleep(2)
        else:
            raise RuntimeError('Database startup timeout')
        if sql('SHOW cron.launch_active_jobs;').stdout.strip() != 'off':
            raise RuntimeError('Cron is not disabled')
        if sql('SHOW cron.database_name;').stdout.strip() != DATABASE:
            raise RuntimeError('Cron database does not match rehearsal database')
        phase = 'prepare_database'
        prepare_database(sql)
        phase = 'roles'
        print('Восстановление ролей в отдельном контейнере...', flush=True)
        # Separate loader keeps its privileges when source role attributes are applied.
        run(['docker', 'exec', '-i', cid, 'psql', '-X', '-w', '-h', '127.0.0.1',
             '-U', LOADER, '-d', DATABASE, '--single-transaction',
             '-v', 'ON_ERROR_STOP=1'], input=(stage / 'roles.apply.sql').read_text())
        phase = 'restore'
        print('Пробное восстановление схем и данных...', flush=True)
        run(['docker', 'exec', '-e', 'PGOPTIONS=-c session_replication_role=replica', cid,
             'pg_restore', '-h', '127.0.0.1', '-U', LOADER, '-d', DATABASE, '-w',
             '--exit-on-error', '--single-transaction', '/backup/source.dump'], timeout=600)
        phase = 'verification'
        result = sql("SELECT json_build_object("
                     "'postgresql', current_setting('server_version'),"
                     "'server_version_num', current_setting('server_version_num')::integer,"
                     "'extensions', (SELECT json_object_agg(extname,extversion) FROM pg_extension),"
                     "'orders', (SELECT count(*) FROM public.orders),"
                     "'staff', (SELECT count(*) FROM public.business_staff),"
                     "'auth_users', (SELECT count(*) FROM auth.users),"
                     "'storage_objects', (SELECT count(*) FROM storage.objects),"
                     "'cron_jobs', (SELECT count(*) FROM cron.job),"
                     "'cron_enabled', current_setting('cron.launch_active_jobs'),"
                     "'pg_net', (SELECT extversion FROM pg_extension WHERE extname='pg_net'));",
                     user=LOADER, db=DATABASE)
        stats = json.loads(result.stdout)
        check_restored_versions(stats, args.image)
        print('Результат:', json.dumps(stats, ensure_ascii=False), flush=True)
        success = True
    except (Exception, KeyboardInterrupt):
        print('BOS_TRIAL_FAILED phase=' + phase, flush=True)
        print('Категория:', safe_failure(log) if log.exists() else 'preparation', flush=True)
        print('Полный журнал оставлен на сервере; не отправляйте его целиком.', flush=True)
    finally:
        if cid and re.fullmatch(r'[a-f0-9]{64}', cid):
            if not stop_trial(cid):
                print('BOS_TRIAL_STOP_FAILED: ' + name, flush=True)
                success = False
            else:
                print('Пробный контейнер остановлен. Файлы и журнал сохранены.', flush=True)
    if success:
        print('BOS_TRIAL_RESTORE_OK', flush=True)
        print('Это пробное восстановление. Версии расширений, ACL, Vault, файлы и приложение '
              'требуют отдельной проверки перед рабочим запуском.', flush=True)
        return 0
    return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('BOS_TRIAL_PREFLIGHT_FAILED: проверьте путь, SHA256SUMS, Docker и наличие образа.',
              file=sys.stderr)
        sys.exit(1)
