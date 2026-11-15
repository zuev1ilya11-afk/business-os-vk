#!/usr/bin/env python3
"""Real PostgreSQL capture/restore proof using disposable synthetic clusters.

Set BOS_RECOVERY_PG_BIN to a PostgreSQL 17 bin directory. ``--require`` fails
instead of skipping when binaries are unavailable. LD_LIBRARY_PATH is inherited
for user-unpacked runtimes. Docker image bytes and discovery are fixtures; every
database command uses an actual PostgreSQL process. No external DB URL is read.

Globals restore requires the same bootstrap role on both fresh clusters. Only
the single duplicate ``CREATE ROLE postgres;`` is removed from a fixture copy;
captured globals remain byte-identical, and grant errors are never ignored.
"""
from contextlib import contextmanager
import errno
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

import backup


REQUIRE = '--require' in sys.argv
if REQUIRE:
    sys.argv.remove('--require')
PROGRAMS = ('postgres', 'initdb', 'pg_ctl', 'psql', 'pg_dump', 'pg_dumpall', 'pg_restore')
READ_ONLY = '-c default_transaction_read_only=on -c statement_timeout=600000'
FIXTURE_MARKER = 'synthetic image fixture; not an actual Docker image export'


def postgres_bin():
    configured = os.environ.get('BOS_RECOVERY_PG_BIN')
    found = shutil.which('postgres')
    directory = Path(configured) if configured else (Path(found).parent if found else None)
    if directory is None or any(not (directory / p).is_file() for p in PROGRAMS):
        return None
    return directory.resolve()


def clean_environment():
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env.update(LC_ALL='C', PGPASSFILE='/nonexistent/bos-recovery-test.pgpass', PGCONNECT_TIMEOUT='5')
    return env


class Cluster:
    """Only a freshly initialized directory can become this test's target."""
    def __init__(self, root, name, user, binary):
        self.path, self.log = root / name, root / (name + '.log')
        self.user, self.binary, self.env = user, binary, clean_environment()
        self.socket_dir = root / (name + '-socket')
        self.socket_dir.mkdir(mode=0o700)
        self.started = False
        # Prefer a private Unix socket with TCP disabled. Some managed runners
        # prohibit AF_UNIX bind; only then use a random loopback TCP port.
        try:
            with socket.socket(socket.AF_UNIX) as probe:
                probe.bind(str(self.socket_dir / 'probe'))
            (self.socket_dir / 'probe').unlink()
            self.host, self.port, self.transport = str(self.socket_dir), 5432, 'unix'
        except OSError as exc:
            if exc.errno not in (errno.EPERM, errno.EACCES, errno.EAFNOSUPPORT):
                raise
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                self.port = probe.getsockname()[1]
            self.host, self.transport = '127.0.0.1', 'loopback'

    def run(self, program, args, *, data=None, check=True):
        result = subprocess.run([str(self.binary / program), *args], input=data,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=self.env, timeout=30)
        if check and result.returncode:
            raise RuntimeError(program + ' failed: ' + result.stderr.decode(errors='replace'))
        return result

    def start(self):
        self.run('initdb', ['-D', str(self.path), '--auth=trust', '--no-locale',
                           '--encoding=UTF8', '--username', self.user, '--no-instructions'])
        listen = '' if self.transport == 'unix' else '127.0.0.1'
        unix = str(self.socket_dir) if self.transport == 'unix' else ''
        # tempfile-generated paths cannot contain quotes; never accept user paths.
        with (self.path / 'postgresql.conf').open('a') as config:
            config.write(f"\nlisten_addresses = '{listen}'\nport = {self.port}\n"
                         f"unix_socket_directories = '{unix}'\n"
                         "unix_socket_permissions = 0700\nmax_connections = 10\n"
                         "shared_buffers = '16MB'\njit = off\n")
        self.run('pg_ctl', ['-D', str(self.path), '-l', str(self.log), '-w', '-t', '20', 'start'])
        self.started = True

    def connection(self, database):
        return ['-h', self.host, '-p', str(self.port), '-U', self.user, '-w', '-d', database]

    def sql(self, database, sql):
        return self.run('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                                *self.connection(database)], data=sql.encode()).stdout.decode().strip()

    def stop(self):
        if (self.path / 'postmaster.pid').exists():
            self.run('pg_ctl', ['-D', str(self.path), '-m', 'fast', '-w', '-t', '20', 'stop'])
        self.started = False


def fixture_tar(members):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w') as archive:
        for name, content in members.items():
            member = tarfile.TarInfo(name)
            member.size, member.mode = len(content), 0o600
            archive.addfile(member, io.BytesIO(content))
    return output.getvalue()


class FakeDocker:
    """A strict Docker-boundary fixture; PG programs remain real subprocesses."""
    container = 'synthetic-postgres-container'

    def __init__(self, source, corrupt_dump=False):
        self.source, self.corrupt_dump, self.processes = source, corrupt_dump, []
        self.last_error = b''
        config = json.dumps({'fixture': FIXTURE_MARKER}, sort_keys=True).encode()
        digest = hashlib.sha256(config).hexdigest()
        self.image_id = 'sha256:' + digest
        self.images = fixture_tar({
            digest + '.json': config,
            'layer.tar': fixture_tar({'FIXTURE_ONLY.txt': FIXTURE_MARKER.encode()}),
            'manifest.json': json.dumps([{'Config': digest + '.json',
                                          'RepoTags': ['synthetic:fixture'],
                                          'Layers': ['layer.tar']}]).encode(),
        })

    def _execute(self, args, *, timeout, limit, input_path=None):
        if args == ['image', 'inspect', self.image_id]:
            return json.dumps([{'Id': self.image_id, 'Size': len(self.images),
                                'Config': {'Labels': {'fixture': FIXTURE_MARKER}}}]).encode()
        if args == ['image', 'save', self.image_id]:
            return self.images
        command = list(args)
        if command[:2] == ['exec', '-i']:
            command.pop(1)
        if command[:4] != ['exec', '-u', 'postgres', self.container]:
            raise AssertionError('Unexpected Docker command')
        command = command[4:]
        if command[:3] != ['timeout', '-k', '10'] or not command[3].isdigit():
            raise AssertionError('Missing bounded client timeout')
        inner_timeout = int(command[3])
        command, env = command[4:], dict(self.source.env)
        if command and command[0] == 'env':
            poisoned = {'PGHOST': 'invalid.fixture.example', 'PGHOSTADDR': '203.0.113.1',
                        'PGPORT': '9', 'PGDATABASE': 'never_connect_here',
                        'PGUSER': 'never_use_this_user', 'PGSERVICE': 'invalid-fixture',
                        'PGSERVICEFILE': '/nonexistent/fixture',
                        'PGOPTIONS': '-c default_transaction_read_only=off'}
            env.update(poisoned)
            command.pop(0)
            unset = set()
            while command and command[0] == '-u':
                unset.add(command[1])
                env.pop(command[1], None)
                del command[:2]
            # Refuse to start any process if routing poison has not been cleared.
            if not set(poisoned) <= unset:
                raise AssertionError('Inherited PG routing/options were not cleared')
            while command and '=' in command[0]:
                key, value = command.pop(0).split('=', 1)
                env[key] = value
            # These belong to the synthetic container, not caller routing.
            # Preserve them in the environment; never copy secrets into argv.
            for key in ('PGPASSWORD', 'PGPASSFILE'):
                if env.get(key) != self.source.env.get(key):
                    raise AssertionError('Container authentication was not preserved')
        program, pg_args = command[0], command[1:]
        database_user = None
        if program not in ('psql', 'pg_dump', 'pg_dumpall', 'pg_restore'):
            raise AssertionError('Unexpected executable')
        if program == 'pg_restore':
            if pg_args != ['--list'] or input_path is None:
                raise AssertionError('Adapter must never execute a database restore')
        else:
            if env.get('PGOPTIONS') != READ_ONLY:
                raise AssertionError('Capture did not preserve read-only PGOPTIONS')
            if (len(pg_args) < 7 or pg_args[:5] != ['-h', '/var/run/postgresql', '-p', '5432', '-U']
                    or pg_args[5] not in ('postgres', 'supabase_admin') or pg_args[6] != '-w'):
                raise AssertionError('Unexpected database routing')
            database_user = pg_args[5]
            pg_args = ['-h', self.source.host, '-p', str(self.source.port), *pg_args[4:]]
        with (input_path.open('rb') if input_path else open(os.devnull, 'rb')) as stdin:
            result = subprocess.run([str(self.source.binary / program), *pg_args],
                                    stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    env=env, timeout=min(timeout, inner_timeout))
        self.processes.append({'program': program, 'returncode': result.returncode,
                               'readonly': env.get('PGOPTIONS') == READ_ONLY,
                               'database_user': database_user})
        self.last_error = result.stderr
        if result.returncode:
            raise backup.Stop('COMMAND_FAILED')
        if result.stderr:
            raise backup.Stop('COMMAND_WARNINGS')
        if len(result.stdout) > limit:
            raise backup.Stop('COMMAND_OUTPUT_LIMIT')
        return result.stdout[:16] if self.corrupt_dump and program == 'pg_dump' else result.stdout

    def __call__(self, args, *, timeout=30, limit=16 * backup.MIB):
        return self._execute(args, timeout=timeout, limit=limit)

    def write(self, args, path, *, timeout, limit, input_path=None):
        # Preserve exclusive private-file creation and failed partial artifacts.
        with backup.exclusive(path) as output:
            output.write(self._execute(args, timeout=timeout, limit=limit, input_path=input_path))
            output.flush()
            os.fsync(output.fileno())


FIXTURE_SQL = """
SET ROLE app_owner;
CREATE SCHEMA app AUTHORIZATION app_owner;
CREATE SCHEMA storage AUTHORIZATION app_owner;
CREATE TYPE app.order_state AS ENUM ('open','closed');
CREATE TABLE app.orders (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 code text NOT NULL UNIQUE,
 state app.order_state NOT NULL DEFAULT 'open',
 quantity integer NOT NULL CHECK (quantity > 0),
 price numeric(12,2) NOT NULL CHECK (price >= 0),
 total numeric(14,2) GENERATED ALWAYS AS (quantity * price) STORED,
 metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE app.items (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id bigint NOT NULL REFERENCES app.orders(id), name text NOT NULL, payload bytea NOT NULL
);
CREATE TABLE app.events (id bigserial PRIMARY KEY, order_id bigint NOT NULL, verb text NOT NULL);
CREATE TABLE storage.objects (name text PRIMARY KEY, sha256 text NOT NULL);
CREATE FUNCTION app.record_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO app.events(order_id,verb) VALUES (NEW.id,TG_OP); RETURN NEW; END
$$;
CREATE TRIGGER order_insert AFTER INSERT ON app.orders FOR EACH ROW EXECUTE FUNCTION app.record_order();
CREATE INDEX orders_metadata ON app.orders USING gin(metadata);
CREATE VIEW app.order_totals AS SELECT state, sum(total) AS amount FROM app.orders GROUP BY state;
ALTER TABLE app.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY reader_open ON app.orders FOR SELECT TO app_reader USING (state = 'open');
GRANT USAGE ON SCHEMA app TO app_reader;
GRANT SELECT ON app.orders TO app_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO app_reader;
INSERT INTO app.orders(code,state,quantity,price,metadata) VALUES
 ('SYNTH-1','open',2,15.50,'{"label":"Синтетика"}'),
 ('SYNTH-2','closed',1,99.99,'{"nullable":null}'),
 ('SYNTH-3','open',5,0,'{"tags":["a","b"]}');
INSERT INTO app.items(order_id,name,payload) VALUES
 (1,'Unicode товар',decode('0001ff','hex')), (2,'second',decode('ff00','hex'));
COMMENT ON TABLE app.orders IS 'Synthetic recovery fixture; no production data';
"""
SNAPSHOT_SQL = """
SELECT jsonb_build_object(
 'orders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.orders t),
 'items',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.items t),
 'events',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.events t),
 'totals',(SELECT jsonb_agg(to_jsonb(t) ORDER BY state) FROM app.order_totals t),
 'storage',(SELECT jsonb_agg(to_jsonb(t) ORDER BY name) FROM storage.objects t));
"""


@contextmanager
def laboratory(binary, source_user='postgres'):
    # Short /tmp paths keep Unix sockets below sockaddr_un's path length limit.
    with tempfile.TemporaryDirectory(prefix='bos-pg-', dir='/tmp') as temp:
        root = Path(temp).resolve()
        source = Cluster(root, 'source', source_user, binary)
        target = Cluster(root, 'target', 'postgres', binary)
        try:
            source.start()
            target.start()
            source.sql('postgres', "CREATE ROLE app_owner NOLOGIN; CREATE ROLE app_reader NOLOGIN; "
                       "CREATE ROLE app_login LOGIN PASSWORD 'synthetic-never-production'; "
                       "GRANT app_reader TO app_login;")
            source.sql('postgres', 'CREATE DATABASE synthetic OWNER app_owner;')
            source.sql('synthetic', FIXTURE_SQL)
            yield root, source, target
        finally:
            try:
                target.stop()
            finally:
                source.stop()


def layout_fixture(root, source, runner):
    release, storage = root / 'release', root / 'storage'
    release.mkdir(mode=0o700)
    storage.mkdir(mode=0o700)
    (storage / 'empty').mkdir(mode=0o700)
    (release / 'compose.yaml').write_text('# synthetic configuration fixture\n')
    files = {'public/report.txt': 'Синтетический файл\n'.encode(),
             'private/file with spaces.bin': b'\x00\xff\x01fixture\x00'}
    for name, content in files.items():
        path = storage / name
        path.parent.mkdir(mode=0o700, exist_ok=True)
        path.write_bytes(content)
        digest = hashlib.sha256(content).hexdigest()
        source.sql('synthetic', "INSERT INTO storage.objects VALUES ('" + name + "','" + digest + "');")
    container = {'Id': runner.container, 'Image': runner.image_id,
                 'Mounts': [{'Source': str(storage), 'Destination': '/fixture-storage'}],
                 'Config': {'Labels': {'fixture': FIXTURE_MARKER}},
                 'State': {'StartedAt': 'synthetic'}, 'RestartCount': 0}
    return {'roots': [str(release), str(storage)], 'protected': [str(source.path)],
            'release': str(release), 'database_container': runner.container,
            'database': 'synthetic', 'images': {'database': runner.image_id},
            'containers': [container], 'build': 'synthetic-integration-fixture'}, files


def schema(cluster, database):
    value = cluster.run('pg_dump', [*cluster.connection(database), '--schema-only']).stdout.decode()
    return '\n'.join(line for line in value.splitlines()
                     if not line.startswith(('\\restrict ', '\\unrestrict ')))


ROLES_SQL = """
SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,
 rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolpassword) ORDER BY rolname)
FROM pg_authid WHERE rolname IN ('app_owner','app_reader','app_login','postgres');
"""


class PostgreSQLIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.binary = postgres_bin()
        reason = None
        if cls.binary is None:
            reason = 'Set BOS_RECOVERY_PG_BIN to real PostgreSQL 17 binaries'
        elif os.geteuid() == 0:
            reason = 'PostgreSQL initdb requires an unprivileged test user'
        if reason:
            if REQUIRE:
                raise RuntimeError(reason)
            raise unittest.SkipTest(reason)
        version = subprocess.run([str(cls.binary / 'postgres'), '--version'],
                                 env=clean_environment(), capture_output=True, text=True,
                                 check=True, timeout=10).stdout.strip()
        if not version.startswith('postgres (PostgreSQL) 17.'):
            raise RuntimeError('Integration requires PostgreSQL major 17: ' + version)
        print('\nReal database binaries: ' + version, flush=True)

    def test_existing_admin_selected_for_complete_capture_without_role_changes(self):
        # A demoted bootstrap postgres still owns system catalogs. Use the
        # Supabase-like owner here so the limited postgres permission failures
        # are real; every role and privilege change below belongs to this lab.
        with laboratory(self.binary, source_user='supabase_admin') as (root, source, target):
            runner = FakeDocker(source)
            layout, _ = layout_fixture(root, source, runner)
            admin_password = 'synthetic-existing-admin-password'
            source.sql('postgres', "CREATE ROLE postgres LOGIN SUPERUSER; "
                       "ALTER ROLE postgres NOSUPERUSER; "
                       "SET password_encryption='scram-sha-256'; "
                       "ALTER ROLE supabase_admin PASSWORD '" + admin_password + "';")
            mapped = [(source.path, PurePosixPath(source.path), True)]
            before_data = source.sql('synthetic', SNAPSHOT_SQL)

            def role_snapshot():
                dump = source.run('pg_dumpall', ['-h', source.host, '-p', str(source.port),
                                  '-U', source.user, '-w', '-l', 'synthetic', '--roles-only']).stdout.decode()
                return '\n'.join(line for line in dump.splitlines()
                                 if not line.startswith(('\\restrict ', '\\unrestrict ')))

            before_roles = role_snapshot()
            with patch.object(backup.discovery, 'DATABASE', 'synthetic'):
                with self.assertRaises(backup.discovery.Stop):
                    backup.discovery.database_config_files(runner, {'Id': runner.container}, mapped)
                self.assertIn(b'permission denied', runner.last_error)
                with self.assertRaisesRegex(backup.Stop, '^COMMAND_FAILED$'):
                    runner(backup.db_command(layout, 'pg_dumpall', ['--globals-only', '-l', 'synthetic']))
                self.assertIn(b'permission denied', runner.last_error)
                probes = []

                def record_probe(args, **kwargs):
                    response = runner(args, **kwargs)
                    probes.append(json.loads(response))
                    return response

                selected = backup.discovery.select_backup_role(record_probe, {'Id': runner.container})
                self.assertEqual(selected, 'supabase_admin')
                self.assertEqual(probes, [
                    {'user': 'postgres', 'session_user': 'postgres', 'database': 'synthetic',
                     'readonly': True, 'superuser': False, 'supabase_admin': True},
                    {'user': 'supabase_admin', 'session_user': 'supabase_admin', 'database': 'synthetic',
                     'readonly': True, 'superuser': True, 'supabase_admin': True},
                ])
                self.assertEqual(backup.discovery.database_config_files(
                    runner, {'Id': runner.container}, mapped, user=selected), set())
            layout['database_user'] = selected
            start = len(runner.processes)
            with patch.object(backup.discovery, 'discover', return_value=layout):
                bundle = backup.capture(layout, root / 'output', runner)
            self.assertEqual(backup.verify(bundle)['integrity'], 'VERIFIED')
            self.assertTrue((bundle / 'database.dump').read_bytes().startswith(b'PGDMP'))
            captured_globals = (bundle / 'globals.sql').read_text()
            self.assertIn('CREATE ROLE supabase_admin;', captured_globals)
            for name in ('supabase_admin', 'app_login'):
                password_hash = source.sql('postgres', "SELECT rolpassword FROM pg_authid WHERE rolname='" + name + "';")
                self.assertTrue(password_hash.startswith('SCRAM-SHA-256$'))
                self.assertIn(password_hash, captured_globals)
            self.assertEqual(role_snapshot(), before_roles)
            self.assertEqual(source.sql('synthetic', SNAPSHOT_SQL), before_data)
            self.assertTrue(all(p['database_user'] == 'supabase_admin' and p['readonly']
                                for p in runner.processes[start:] if p['program'] != 'pg_restore'))

            # The candidate exists, but authentication may still fail. Require
            # its real SCRAM rejection; postgres remains able to run its probe.
            (source.path / 'pg_hba.conf').write_text(
                'local all supabase_admin scram-sha-256\nlocal all all trust\n'
                'host all supabase_admin 127.0.0.1/32 scram-sha-256\n'
                'host all all 127.0.0.1/32 trust\n'
                'host all supabase_admin ::1/128 scram-sha-256\n'
                'host all all ::1/128 trust\n')
            source.run('pg_ctl', ['-D', str(source.path), 'reload'])
            source.env['PGPASSWORD'] = 'synthetic-wrong-admin-password'
            deadline = time.monotonic() + 5
            with patch.object(backup.discovery, 'DATABASE', 'synthetic'):
                while True:
                    try:
                        backup.discovery.select_backup_role(runner, {'Id': runner.container})
                    except backup.discovery.Stop:
                        self.assertIn(b'password authentication failed', runner.last_error)
                        self.assertEqual(runner.processes[-1]['database_user'], 'supabase_admin')
                        self.assertNotEqual(runner.processes[-1]['returncode'], 0)
                        self.assertEqual(runner.processes[-2]['database_user'], 'postgres')
                        self.assertEqual(runner.processes[-2]['returncode'], 0)
                        break
                    if time.monotonic() >= deadline:
                        self.fail('Synthetic candidate did not reject incorrect credentials')
                    time.sleep(0.05)
            source.env['PGPASSWORD'] = admin_password
            self.assertEqual(role_snapshot(), before_roles)
        self.assertFalse(root.exists())
        self.assertFalse(source.started or target.started)

    def test_scram_auth_preserves_container_password_and_passfile(self):
        with laboratory(self.binary) as (root, source, target):
            runner = FakeDocker(source)
            layout, _ = layout_fixture(root, source, runner)
            before = source.sql('synthetic', SNAPSHOT_SQL)
            password = 'synthetic-container-scram-password'
            source.sql('postgres', "SET password_encryption='scram-sha-256'; "
                       "ALTER ROLE postgres PASSWORD '" + password + "';")
            (source.path / 'pg_hba.conf').write_text(
                'local all all scram-sha-256\n'
                'host all all 127.0.0.1/32 scram-sha-256\n'
                'host all all ::1/128 scram-sha-256\n')
            source.run('pg_ctl', ['-D', str(source.path), 'reload'])
            # pg_ctl reload returns before SIGHUP has necessarily been applied.
            # Wait for actual password enforcement, never infer it from the file.
            deadline = time.monotonic() + 5
            while True:
                no_password = source.run('psql', ['-X', '-qAt', *source.connection('synthetic'),
                                                  '-c', 'SELECT 1;'], check=False)
                if no_password.returncode:
                    self.assertIn(b'no password supplied', no_password.stderr)
                    break
                if time.monotonic() >= deadline:
                    self.fail('Synthetic cluster did not enforce SCRAM after reload')
                time.sleep(0.05)
            good_passfile, wrong_passfile = root / 'good.pgpass', root / 'wrong.pgpass'
            for path, value in ((good_passfile, password), (wrong_passfile, 'synthetic-wrong')):
                with backup.exclusive(path) as output:
                    output.write(('*:*:*:postgres:' + value + '\n').encode())
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            missing_passfile = root / 'does-not-exist.pgpass'
            mapped = [(source.path, PurePosixPath(source.path), True)]
            cases = [
                ('password', {'PGPASSWORD': password, 'PGPASSFILE': str(missing_passfile)}, None),
                ('passfile', {'PGPASSFILE': str(good_passfile)}, None),
                ('wrong-password', {'PGPASSWORD': 'synthetic-wrong', 'PGPASSFILE': str(missing_passfile)},
                 b'password authentication failed'),
                ('wrong-passfile', {'PGPASSFILE': str(wrong_passfile)}, b'password authentication failed'),
                ('missing-credentials', {'PGPASSFILE': str(missing_passfile)}, b'no password supplied'),
            ]
            for name, credentials, auth_error in cases:
                with self.subTest(credentials=name):
                    succeeds = auth_error is None
                    source.env.pop('PGPASSWORD', None)
                    source.env.pop('PGPASSFILE', None)
                    source.env.update(credentials)
                    with patch.object(backup.discovery, 'DATABASE', 'synthetic'):
                        if succeeds:
                            self.assertEqual(backup.discovery.database_config_files(
                                runner, {'Id': runner.container}, mapped), set())
                        else:
                            with self.assertRaises(backup.discovery.Stop):
                                backup.discovery.database_config_files(
                                    runner, {'Id': runner.container}, mapped)
                            self.assertEqual(runner.processes[-1]['program'], 'psql')
                            self.assertNotEqual(runner.processes[-1]['returncode'], 0)
                            self.assertIn(auth_error, runner.last_error)
                    if succeeds:
                        with patch.object(backup.discovery, 'discover', return_value=layout):
                            bundle = backup.capture(layout, root / ('output-' + name), runner)
                        self.assertEqual(backup.verify(bundle)['integrity'], 'VERIFIED')
                        self.assertTrue((bundle / 'database.dump').read_bytes().startswith(b'PGDMP'))
                        self.assertEqual(source.sql('synthetic', SNAPSHOT_SQL), before)
                    else:
                        with self.assertRaisesRegex(backup.Stop, '^COMMAND_FAILED$'):
                            runner(backup.db_command(layout, 'pg_dump', ['-Fc', '-d', 'synthetic']))
                        self.assertEqual(runner.processes[-1]['program'], 'pg_dump')
                        self.assertNotEqual(runner.processes[-1]['returncode'], 0)
                        self.assertIn(auth_error, runner.last_error)
            self.assertTrue(all(p['readonly'] for p in runner.processes if p['program'] != 'pg_restore'))
        self.assertFalse(root.exists())
        self.assertFalse(source.started or target.started)

    def test_external_nonstandard_config_and_include_use_server_metadata(self):
        with laboratory(self.binary) as (root, source, target):
            config_dir = root / 'external-settings'
            config_dir.mkdir(mode=0o700)
            config = config_dir / 'server.runtime'
            included = config_dir / 'tuning.fragment'
            main_marker = 'SYNTHETIC_MAIN_BODY_MUST_NOT_BE_RETURNED'
            include_marker = 'SYNTHETIC_INCLUDE_BODY_MUST_NOT_BE_RETURNED'
            included.write_text('# ' + include_marker + "\nwork_mem = '7MB'\n")
            config.write_text((source.path / 'postgresql.conf').read_text() +
                              f"\n# {main_marker}\n"
                              f"data_directory = '{source.path}'\n"
                              f"hba_file = '{source.path / 'pg_hba.conf'}'\n"
                              f"ident_file = '{source.path / 'pg_ident.conf'}'\n"
                              f"include = '{included.name}'\n")
            target_started = target.sql('postgres', 'SELECT pg_postmaster_start_time();')
            before = source.sql('synthetic', SNAPSHOT_SQL)
            # Only this freshly created test cluster is restarted. No real
            # Docker endpoint or externally supplied database target is used.
            source.stop()
            source.run('pg_ctl', ['-D', str(source.path), '-l', str(source.log),
                                  '-w', '-t', '20', '-o',
                                  '-c config_file=' + str(config), 'start'])
            source.started = True
            self.assertEqual(source.sql('synthetic', 'SHOW config_file;'), str(config))
            self.assertEqual(source.sql('synthetic', 'SHOW work_mem;'), '7MB')
            runner = FakeDocker(source)
            responses = []

            def record_metadata(args, **kwargs):
                response = runner(args, **kwargs)
                responses.append(response)
                return response

            mapped = [(source.path, PurePosixPath(source.path), True),
                      (config, PurePosixPath(config), False),
                      (included, PurePosixPath(included), False)]
            with patch.object(backup.discovery, 'DATABASE', 'synthetic'):
                recognized = backup.discovery.database_config_files(
                    record_metadata, {'Id': runner.container}, mapped)
            self.assertEqual(recognized, {PurePosixPath(config), PurePosixPath(included)})
            self.assertEqual(len(responses), 1)
            metadata = json.loads(responses[0])
            self.assertEqual(set(metadata), {'data_directory', 'files'})
            self.assertEqual(metadata['data_directory'], str(source.path))
            self.assertTrue({str(config), str(included),
                             str(source.path / 'pg_hba.conf'),
                             str(source.path / 'pg_ident.conf')} <= set(metadata['files']))
            # The server supplies paths only; even recognized config bodies
            # and settings must never cross the discovery query boundary.
            for marker in (main_marker, include_marker, 'work_mem'):
                self.assertNotIn(marker.encode(), responses[0])
            self.assertTrue(all(p['readonly'] and p['returncode'] == 0
                                for p in runner.processes))
            self.assertEqual(source.sql('synthetic', SNAPSHOT_SQL), before)
            self.assertEqual(target.sql('postgres', 'SELECT pg_postmaster_start_time();'), target_started)
        self.assertFalse(root.exists())
        self.assertFalse(source.started or target.started)

    def test_capture_verify_and_real_restore(self):
        with laboratory(self.binary) as (root, source, target):
            runner = FakeDocker(source)
            layout, storage_files = layout_fixture(root, source, runner)
            print('Isolated cluster transport: ' + source.transport, flush=True)
            before = source.sql('synthetic', SNAPSHOT_SQL)
            before_schema = schema(source, 'synthetic')
            with patch.object(backup.discovery, 'discover', return_value=layout):
                bundle = backup.capture(layout, root / 'output', runner)
            report = backup.verify(bundle)
            self.assertEqual(report['integrity'], 'VERIFIED')
            self.assertEqual(report['restore'], 'NOT_RUN')
            self.assertEqual(report['database_storage_consistency'], 'NOT_PROVEN')
            self.assertFalse(report['disaster_recovery_ready'])
            self.assertEqual(source.sql('synthetic', SNAPSHOT_SQL), before)
            self.assertEqual(schema(source, 'synthetic'), before_schema)
            self.assertEqual({p.name for p in bundle.iterdir()}, backup.PAYLOADS | {'manifest.json'})
            self.assertEqual(stat.S_IMODE(bundle.stat().st_mode), 0o700)
            for path in bundle.iterdir():
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            # This probes the same PGOPTIONS route used by real capture clients.
            readonly = runner(backup.db_command(layout, 'psql',
                              ['-X', '-qAt', '-d', 'synthetic', '-c', 'SHOW transaction_read_only;']))
            self.assertEqual(readonly.strip(), b'on')
            with self.assertRaisesRegex(backup.Stop, '^COMMAND_FAILED$'):
                runner(backup.db_command(layout, 'psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                       '-v', 'VERBOSITY=verbose',
                       '-d', 'synthetic', '-c', 'CREATE TABLE public.capture_must_not_write(id int);']))
            self.assertIn(b'25006', runner.last_error)
            self.assertEqual(source.sql('synthetic', "SELECT to_regclass('public.capture_must_not_write') IS NULL;"), 't')
            # Both fresh clusters need the same bootstrap role for PG17's
            # GRANTED BY postgres semantics. Remove only its duplicate CREATE
            # from a fixture copy; preserve all ALTER/grant/password statements,
            # the captured archive, and strict ON_ERROR_STOP behavior.
            globals_sql = (bundle / 'globals.sql').read_text()
            captured_globals_hash = backup.hash_file(bundle / 'globals.sql')
            bootstrap_create = 'CREATE ROLE postgres;\n'
            self.assertEqual(globals_sql.count(bootstrap_create), 1)
            restore_globals = root / 'fixture-globals.sql'
            restore_globals.write_text(globals_sql.replace(bootstrap_create, '', 1))
            target.run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', *target.connection('postgres'),
                                '-f', str(restore_globals)])
            self.assertEqual(backup.hash_file(bundle / 'globals.sql'), captured_globals_hash)
            target.sql('postgres', 'CREATE DATABASE restored OWNER app_owner;')
            target.run('pg_restore', [*target.connection('restored'), '--exit-on-error',
                                      '--single-transaction', str(bundle / 'database.dump')])
            self.assertEqual(target.sql('restored', SNAPSHOT_SQL), before)
            self.assertEqual(schema(target, 'restored'), before_schema)
            self.assertEqual(target.sql('postgres', ROLES_SQL), source.sql('postgres', ROLES_SQL))
            self.assertEqual(target.sql('restored', "SELECT pg_has_role('app_login','app_reader','member');"), 't')
            self.assertEqual(target.sql('restored', 'SET ROLE app_reader; SELECT count(*) FROM app.orders;'), '2')
            self.assertEqual(target.sql('restored', 'SET ROLE app_login; SELECT count(*) FROM app.orders;'), '2')
            self.assertEqual(target.sql('restored', "INSERT INTO app.orders(code,quantity,price) VALUES ('SYNTH-4',3,2) RETURNING id,total;"), '4|6.00')
            self.assertEqual(target.sql('restored', 'SELECT count(*) FROM app.events;'), '4')
            bad_fk = target.run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', *target.connection('restored')],
                                data=b"INSERT INTO app.items(order_id,name,payload) VALUES (999,'invalid','');", check=False)
            self.assertNotEqual(bad_fk.returncode, 0)
            self.assertIn(b'foreign key constraint', bad_fk.stderr)
            bad_check = target.run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', *target.connection('restored')],
                                   data=b"INSERT INTO app.orders(code,quantity,price) VALUES ('INVALID',0,1);", check=False)
            self.assertNotEqual(bad_check.returncode, 0)
            self.assertIn(b'check constraint', bad_check.stderr)
            no_grant = target.run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', *target.connection('restored')],
                                  data=b"SET ROLE app_reader; INSERT INTO app.orders(code,quantity,price) VALUES ('DENIED',1,1);", check=False)
            self.assertNotEqual(no_grant.returncode, 0)
            self.assertIn(b'permission denied', no_grant.stderr)
            restored_storage = root / 'restored-storage'
            restored_storage.mkdir(mode=0o700)
            with tarfile.open(bundle / 'files.tar') as archive:
                self.assertEqual(archive.extractfile('root-000/compose.yaml').read(),
                                 (root / 'release' / 'compose.yaml').read_bytes())
                for name, content in storage_files.items():
                    # Explicit known members only; no extractall or archive paths.
                    copied = archive.extractfile('root-001/' + name).read()
                    destination = restored_storage / name
                    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    destination.write_bytes(copied)
                    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
                    self.assertEqual(copied, content)
                    self.assertEqual(target.sql('restored', "SELECT sha256 FROM storage.objects WHERE name='" + name + "';"), digest)
                self.assertTrue(archive.getmember('root-001/empty').isdir())
            # The real restore process also rejects damaged dump bytes and leaves
            # the target transaction uncommitted.
            target.sql('postgres', 'CREATE DATABASE damaged OWNER app_owner;')
            corrupt = root / 'damaged.dump'
            dump = (bundle / 'database.dump').read_bytes()
            corrupt.write_bytes(dump[:len(dump) // 2])
            failed = target.run('pg_restore', [*target.connection('damaged'), '--exit-on-error',
                                              '--single-transaction', str(corrupt)], check=False)
            self.assertNotEqual(failed.returncode, 0)
            self.assertEqual(target.sql('damaged', "SELECT count(*) FROM pg_namespace WHERE nspname IN ('app','storage');"), '0')
            self.assertTrue(all(p['readonly'] for p in runner.processes if p['program'] != 'pg_restore'))
            self.assertEqual({p['program'] for p in runner.processes}, {'psql', 'pg_dump', 'pg_dumpall', 'pg_restore'})
        self.assertFalse(root.exists())
        self.assertFalse(source.started or target.started)

    def test_real_dump_check_failure_keeps_only_private_partial(self):
        with laboratory(self.binary) as (root, source, target):
            runner = FakeDocker(source, corrupt_dump=True)
            layout, _ = layout_fixture(root, source, runner)
            before = source.sql('synthetic', SNAPSHOT_SQL)
            output = root / 'output'
            with patch.object(backup.discovery, 'discover', return_value=layout):
                with self.assertRaisesRegex(backup.Stop, '^COMMAND_FAILED$'):
                    backup.capture(layout, output, runner)
            partials = list(output.iterdir())
            self.assertEqual(len(partials), 1)
            partial = partials[0]
            self.assertTrue(partial.name.startswith('.') and partial.name.endswith('.partial'))
            self.assertFalse((partial / 'manifest.json').exists())
            self.assertEqual(stat.S_IMODE(partial.stat().st_mode), 0o700)
            for path in partial.iterdir():
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertTrue(any(p['program'] == 'pg_restore' and p['returncode'] != 0
                                for p in runner.processes))
            with self.assertRaises(backup.Stop):
                backup.verify(partial)
            self.assertEqual(source.sql('synthetic', SNAPSHOT_SQL), before)
        self.assertFalse(root.exists())
        self.assertFalse(source.started or target.started)


if __name__ == '__main__':
    unittest.main(verbosity=2)
