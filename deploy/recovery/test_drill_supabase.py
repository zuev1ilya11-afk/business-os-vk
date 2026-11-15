#!/usr/bin/env python3
"""Run the complete drill against a pinned, public Supabase PostgreSQL image.

Only synthetic records and newly labelled Docker resources are used. The source
and restored server both have no network and no extension workers. The normal
Supabase entrypoint, migrations, secrets and key-fetch scripts are never run.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from unittest import mock

REQUIRE = '--require' in sys.argv
if REQUIRE:
    sys.argv.remove('--require')

import backup
import discovery
import drill
import drill_db
from drill_profile import build_runtime_profile
from test_docker import DisposableDocker
from test_drill_integration import (FIXTURE_BYTES, LABEL, PARAMETER_ACL_SQL,
                                    SNAPSHOT_SQL, SQL, FixtureObservedRunner,
                                    file_archive, write_json)

# Official linux/amd64 manifest of supabase/postgres:17.11.0.017. The digest
# prevents a moving tag from silently changing the compatibility fixture.
PUBLIC_IMAGE = ('docker.io/supabase/postgres@sha256:'
                'cd71229b4041fa5d0baede5dbd9ea9e3b45aba23e0fa601733f530b8a3def5c8')
EXTENSIONS = ('pg_cron', 'pg_net', 'pg_stat_statements', 'pgaudit', 'pg_tle',
              'pgcrypto', 'pgsodium', 'supabase_vault', 'uuid-ossp')
BOOTSTRAP = 'supabase_admin'
SOURCE_START = r'''set -eu
umask 077
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE PGSYSCONFDIR PGDATA
initdb -D /bos/data --username supabase_admin --auth-local=trust --auth-host=reject --no-locale --encoding=UTF8 --no-instructions >/dev/null
exec postgres -D /bos/data -c listen_addresses= -c port=5432 -c unix_socket_directories=/tmp -c unix_socket_permissions=0700 -c max_connections=20 -c shared_buffers=64MB -c logging_collector=off -c log_min_error_statement=panic -c log_statement=none "$@"
'''
INERT_SQL = """
CREATE TABLE public.fixture_execution_sentinel (source text NOT NULL);
SELECT cron.schedule('synthetic-inert-job', '* * * * *',
 $$INSERT INTO public.fixture_execution_sentinel VALUES ('cron');$$);
INSERT INTO net.http_request_queue(method,url,headers,timeout_milliseconds)
 VALUES ('GET','http://192.0.2.1/synthetic-must-never-be-sent','{}',1000);
"""
BACKGROUND_SQL = """SELECT count(*) FROM pg_stat_activity WHERE backend_type
 NOT IN ('client backend','checkpointer','background writer','walwriter');"""
INERT_SNAPSHOT_SQL = """SELECT json_build_object(
 'jobs',(SELECT json_agg(t ORDER BY jobid) FROM cron.job t),
 'sentinel',(SELECT count(*) FROM public.fixture_execution_sentinel),
 'requests',(SELECT json_agg(t ORDER BY id) FROM net.http_request_queue t),
 'responses',(SELECT count(*) FROM net._http_response),
 'workers',(SELECT count(*) FROM pg_stat_activity WHERE backend_type
 NOT IN ('client backend','checkpointer','background writer','walwriter')))::text;"""


class SyntheticDocker(DisposableDocker):
    """Bounded errors for only this test's public image and synthetic records."""
    def run(self, args, *, data=None, timeout=60, check=True):
        result = subprocess.run([self.binary, '--host=' + self.host, *args],
                                input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=self.env, timeout=timeout)
        if check and result.returncode:
            print('CI_SYNTHETIC_SUPABASE_ERROR=' + json.dumps({
                'operation': args[0], 'code': result.returncode,
                'stderr': result.stderr[:8192].decode(errors='replace')}), flush=True)
            raise RuntimeError('Synthetic Supabase fixture command failed')
        if len(result.stdout) > 16 * 1024 * 1024 or len(result.stderr) > 1024 * 1024:
            raise RuntimeError('Synthetic Supabase command output exceeded its limit')
        return result.stdout


class SupabaseRestoreDrill(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        socket_value = os.environ.get('BOS_RECOVERY_DOCKER_SOCKET', '')
        if os.environ.get('BOS_RECOVERY_SUPABASE_TEST') != '1' or not socket_value:
            reason = 'Supabase drill needs its explicit disposable Docker daemon'
            if REQUIRE:
                raise RuntimeError(reason)
            raise unittest.SkipTest(reason)
        cls.temp = tempfile.TemporaryDirectory(prefix='bos-supabase-drill-test-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name).resolve()
        cls.docker = SyntheticDocker(socket_value, cls.root)
        cls.runner = drill.DockerRunner(host=cls.docker.host)
        version = json.loads(cls.docker.run(['version', '--format', '{{json .Server.Version}}']))
        if version != os.environ.get('BOS_RECOVERY_DOCKER_VERSION', '').removeprefix('v'):
            raise RuntimeError('Supabase fixture Docker version differs from the selected version')
        cls.source_image = cls.docker.inspect([PUBLIC_IMAGE])[0]
        cls.profile = build_runtime_profile({'database': discovery.DATABASE,
                                             'extensions': [[name, '1'] for name in EXTENSIONS]})
        cls.settings = [item for setting in cls.profile.startup_settings for item in ('-c', setting)]
        cls.fixture_name = 'bos-synthetic-supabase-' + uuid.uuid4().hex[:12]
        cls.source = cls.docker.run([
            'run', '-d', '--name', cls.fixture_name, '--network', 'none',
            '--read-only', '--user', 'postgres', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--no-healthcheck',
            '--pids-limit', '256', '--memory', '1g', '--memory-swap', '1g',
            '--tmpfs', '/bos:rw,size=512m,mode=1777',
            '--tmpfs', '/tmp:rw,size=64m,mode=1777',
            '--env', 'PATH=' + drill_db.PATH, '--entrypoint', '/bin/sh',
            cls.source_image['Id'], '-ceu', SOURCE_START, 'fixture', *cls.settings,
        ], timeout=60).decode().strip()
        if not re.fullmatch(r'[0-9a-f]{64}', cls.source):
            raise RuntimeError('Fixture container ID was not returned')
        cls.addClassCleanup(cls.docker.run, ['rm', '-f', '-v', cls.source], check=False)
        cls.wait_ready(cls.source, database='postgres')
        if cls.sql(cls.source, 'SHOW server_version_num;', database='postgres') != '170011':
            raise RuntimeError('Pinned Supabase fixture is not PostgreSQL 17.11')
        cls.sql(cls.source, 'CREATE DATABASE bos_restore_check;', database='postgres')
        cls.sql(cls.source, 'CREATE ROLE postgres LOGIN CREATEROLE CREATEDB REPLICATION BYPASSRLS;')
        for extension in EXTENSIONS:
            cls.sql(cls.source, 'CREATE EXTENSION "' + extension + '";')
        cls.sql(cls.source, SQL)
        cls.sql(cls.source, INERT_SQL)
        if cls.sql(cls.source, BACKGROUND_SQL) != '0':
            raise RuntimeError('Source fixture unexpectedly launched extension workers')
        cls.parameter_acl = cls.sql(cls.source, PARAMETER_ACL_SQL)
        cls.source_before = cls.snapshot()
        cls.inert_before = cls.sql(cls.source, INERT_SNAPSHOT_SQL)
        # Unique synthetic config forces the drill to load this identity from
        # the saved archive, rather than accidentally using the pulled image.
        producer = cls.docker.run([
            'create', '--name', cls.fixture_name + '-image', '--network', 'none',
            '--entrypoint', '/bin/true', cls.source_image['Id'],
        ]).decode().strip()
        cls.addClassCleanup(cls.docker.run, ['rm', '-f', '-v', producer], check=False)
        variant = cls.docker.run([
            'commit', '--change', 'LABEL io.business-os.synthetic-drill=' + uuid.uuid4().hex,
            producer,
        ]).decode().strip()
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', variant):
            raise RuntimeError('Synthetic image commit returned no image identity')
        cls.image = cls.docker.inspect([variant])[0]
        cls.addClassCleanup(cls.docker.run, ['image', 'rm', cls.image['Id']], check=False)
        cls.docker.run(['rm', '-v', producer])
        cls.bundle = cls.root / 'capture-20261115T000000Z-0123456789ab'
        cls.bundle.mkdir(mode=0o700)
        for program, arguments, filename in (
                ('pg_dump', ['-Fc', '-d', discovery.DATABASE], 'database.dump'),
                ('pg_dumpall', ['--globals-only', '-l', discovery.DATABASE], 'globals.sql')):
            data = cls.docker.run(['exec', '-u', 'postgres', cls.source, program,
                                   '-h', '/tmp', '-U', BOOTSTRAP, *arguments], timeout=60)
            (cls.bundle / filename).write_bytes(data)
            (cls.bundle / filename).chmod(0o600)
        metadata = json.loads(cls.sql(cls.source, backup.META_SQL))
        cls.extensions = dict(metadata['extensions'])
        cls.docker.save(cls.bundle / 'images.tar', [cls.image])
        cls.docker.run(['image', 'rm', cls.image['Id']])
        write_json(cls.bundle / 'inventory.json', file_archive(cls.bundle / 'files.tar'))
        containers = [{
            'Id': hashlib.sha256(('synthetic-supabase-' + role).encode()).hexdigest(),
            'Name': '/' + discovery.PREFIX + '-' + role, 'Image': cls.image['Id'],
            'Config': {'Env': [], 'Labels': {'fixture': 'synthetic only'}}, 'Mounts': [],
        } for role in discovery.ROLES]
        storage = next(item for item in containers if item['Name'].endswith('-storage'))
        storage['Config']['Env'] = ['STORAGE_BACKEND=file',
                                    'FILE_STORAGE_BACKEND_PATH=/var/lib/storage',
                                    'TENANT_ID=fixture-tenant']
        storage['Mounts'] = [{'Type': 'bind', 'Source': '/fixture/storage',
                              'Destination': '/var/lib/storage', 'RW': True}]
        write_json(cls.bundle / 'private-config.json', {
            'containers': containers, 'database': metadata, 'database_user': 'postgres',
            'images': [cls.image], 'roots': ['/fixture/storage'], 'contains_secrets': True})
        write_json(cls.bundle / 'manifest.json', {
            'format': 1, 'capture': 'COMPLETE', 'build': discovery.BUILD,
            'started_at': '2026-11-15T00:00:00Z', 'finished_at': '2026-11-15T00:00:01Z',
            'database_snapshot': 'PG_DUMP', 'database_storage_consistency': 'NOT_PROVEN',
            'independent_copy': 'NOT_VERIFIED', 'restore': 'NOT_RUN',
            'disaster_recovery_ready': False,
            'payloads': {name: backup.hash_file(cls.bundle / name) for name in sorted(backup.PAYLOADS)}})
        cls.original_hashes = {p.name: backup.hash_file(p) for p in cls.bundle.iterdir()}

    @classmethod
    def sql(cls, container, sql, *, database=discovery.DATABASE, user=BOOTSTRAP):
        return cls.docker.run(['exec', '-i', '-u', 'postgres', container,
                               'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                               '-h', '/tmp', '-U', user, '-d', database],
                               data=sql.encode()).decode().strip()

    @classmethod
    def wait_ready(cls, container, *, database=discovery.DATABASE):
        for _ in range(80):
            try:
                if cls.sql(container, 'SELECT 1;', database=database) == '1':
                    return
            except RuntimeError:
                pass
            time.sleep(0.25)
        # Every byte in this fixture is synthetic; bounded startup stderr is
        # useful for failures in the public image or fixture, never production.
        logs = cls.docker.run(['logs', '--tail', '20', container], check=False)
        print('CI_SYNTHETIC_SUPABASE_STARTUP=' + logs[:4096].decode(errors='replace'), flush=True)
        raise RuntimeError('Synthetic Supabase PostgreSQL did not become ready')

    @classmethod
    def snapshot(cls):
        return hashlib.sha256(cls.sql(cls.source, SNAPSHOT_SQL).encode()).hexdigest()

    def cleanup_drill(self, run_id):
        self.assertRegex(run_id, r'^bos-drill-[0-9a-f]{12}$')
        ids = self.docker.run(['ps', '-aq', '--filter', 'label=' + LABEL + '=' + run_id]).decode().split()
        for container in ids:
            info = json.loads(self.docker.run(['inspect', container]))[0]
            self.assertEqual(info['Config']['Labels'].get(LABEL), run_id)
            self.docker.run(['rm', '-f', '-v', container])
        volume = run_id + '-data'
        info = json.loads(self.docker.run(['volume', 'inspect', volume]))[0]
        self.assertEqual(info['Labels'].get(LABEL), run_id)
        self.docker.run(['volume', 'rm', volume])

    def test_complete_supabase_restore_keeps_jobs_inert(self):
        self.assertNotIn(self.image['Id'], self.docker.run(
            ['image', 'ls', '--all', '--quiet', '--no-trunc']).decode().split())
        observed = FixtureObservedRunner(self.runner)
        try:
            report = drill.run_drill(self.bundle, observed)
        except Exception:
            observed.failure_diagnostic()
            raise
        run_id = report['run_id']
        self.addCleanup(self.cleanup_drill, run_id)
        self.assertEqual(report['status'], 'DRILL_COMPLETED')
        self.assertEqual(report['scope'], 'DATABASE_GLOBALS_AND_FILE_BYTES')
        self.assertFalse(report['disaster_recovery_ready'])
        self.assertEqual(report['application'], 'NOT_RUN')
        self.assertEqual(report['restore']['counts'], {'orders': 3, 'staff': 2, 'storage_objects': 1})
        self.assertEqual(report['files']['files'], 1)
        self.assertEqual(report['files']['bytes'], len(FIXTURE_BYTES))
        self.assertEqual({p.name: backup.hash_file(p) for p in self.bundle.iterdir()}, self.original_hashes)
        self.assertEqual(self.snapshot(), self.source_before)
        self.assertEqual(self.sql(self.source, INERT_SNAPSHOT_SQL), self.inert_before)
        self.assertEqual(self.docker.run(['ps', '-q', '--filter', 'label=' + LABEL + '=' + run_id]).strip(), b'')
        verifier = self.docker.run([
            'run', '-d', '--name', run_id + '-verify', '--label', LABEL + '=' + run_id,
            '--network', 'none', '--read-only', '--user', 'postgres', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--no-healthcheck',
            '--pids-limit', '256', '--memory', '1g', '--memory-swap', '1g',
            '--tmpfs', '/tmp:rw,size=64m,mode=1777',
            '--mount', 'type=volume,src=' + run_id + '-data,dst=/bos,volume-nocopy',
            '--env', 'PATH=' + drill_db.PATH, '--entrypoint', 'postgres', self.image['Id'],
            '-D', '/bos/data', '-c', 'listen_addresses=', '-c', 'unix_socket_directories=/tmp',
            '-c', 'logging_collector=off', *self.settings,
        ]).decode().strip()
        self.addCleanup(self.docker.run, ['rm', '-f', '-v', verifier], check=False)
        self.wait_ready(verifier)
        info = json.loads(self.docker.run(['inspect', verifier]))[0]
        self.assertEqual(info['HostConfig']['NetworkMode'], 'none')
        self.assertFalse(info['HostConfig']['PortBindings'])
        self.assertEqual(len(self.docker.run(['exec', verifier, 'cat', '/proc/net/route']).decode().splitlines()), 1)
        self.assertEqual(self.sql(verifier, BACKGROUND_SQL), '0')
        self.assertEqual(self.sql(verifier, 'SHOW max_worker_processes;'), '0')
        self.assertEqual(self.sql(verifier, 'SHOW cron.launch_active_jobs;'), 'off')
        self.assertEqual(self.sql(verifier, 'SHOW cron.database_name;'), discovery.DATABASE)
        self.assertEqual(self.sql(verifier, 'SELECT count(*) FROM cron.job WHERE active;'), '1')
        self.assertEqual(self.sql(verifier, 'SELECT count(*) FROM public.fixture_execution_sentinel;'), '0')
        self.assertEqual(self.sql(verifier, 'SELECT count(*) FROM net._http_response;'), '0')
        self.assertEqual(self.sql(verifier, 'SELECT count(*) FROM public.orders;'), '3')
        self.assertEqual(self.sql(verifier, 'SELECT count(*) FROM public.orders;', user='fixture_reader'), '2')
        self.assertEqual(self.sql(verifier, PARAMETER_ACL_SQL), self.parameter_acl)
        restored_extensions = dict(json.loads(self.sql(verifier,
            'SELECT json_agg(json_build_array(extname,extversion)) FROM pg_extension;')))
        self.assertEqual(restored_extensions, self.extensions)
        with self.assertRaises(RuntimeError):
            self.sql(verifier, "UPDATE public.orders SET status='completed' WHERE id=1;")
        print('\nActual Supabase restore: ' + json.dumps({
            'postgres': '17.11', 'public_fixture_image': PUBLIC_IMAGE,
            'extensions': restored_extensions, 'roles_acl_rls_guard': 'VERIFIED_SYNTHETIC',
            'cron_jobs_preserved_but_disabled': True, 'extension_workers': 0,
            'source_unchanged': True, 'network': 'none', 'full_application': 'NOT_RUN',
            'archive_image_absent_before_load': True,
        }, sort_keys=True), flush=True)

    def test_startup_error_is_classified_after_stopped_container_cleanup(self):
        report_path = self.root / 'synthetic-startup-failure.json'
        original = drill_db.START_SCRIPT
        self.assertEqual(original.count('"$@"'), 1)
        missing_library = 'bos_fixture_missing_library'
        broken = original.replace('"$@"',
            '"$@" -c shared_preload_libraries=' + missing_library)
        with mock.patch.object(drill_db, 'START_SCRIPT', broken):
            with self.assertRaises(drill_db.DrillDBError) as raised:
                drill.run_drill(self.bundle, self.runner, report_path=report_path)
        report = json.loads(report_path.read_text())
        run_id = report['run_id']
        self.addCleanup(self.cleanup_drill, run_id)
        self.assertEqual(raised.exception.reason_code, 'DRILL_DATABASE_START_FAILED')
        self.assertEqual(report['reason'], 'DRILL_DATABASE_START_FAILED')
        self.assertEqual(report['diagnostics']['phase'], 'STARTUP')
        self.assertEqual(report['diagnostics']['category'], 'SHARED_LIBRARY_MISSING')
        self.assertGreater(report['diagnostics']['evidence_bytes'], 0)
        self.assertFalse(report['disaster_recovery_ready'])
        self.assertEqual(report['files'], 'NOT_RUN')
        self.assertNotIn(missing_library, json.dumps(report))
        self.assertEqual(self.docker.run([
            'ps', '-aq', '--filter', 'label=' + LABEL + '=' + run_id]).strip(), b'')
        self.assertEqual({p.name: backup.hash_file(p) for p in self.bundle.iterdir()},
                         self.original_hashes)
        self.assertEqual(self.snapshot(), self.source_before)
        self.assertEqual(self.sql(self.source, INERT_SNAPSHOT_SQL), self.inert_before)
        print('Actual Supabase startup failure: ' + json.dumps({
            'category': report['diagnostics']['category'], 'phase': 'STARTUP',
            'private_log_classified': True, 'owned_containers_removed': True,
            'source_unchanged': True,
        }, sort_keys=True), flush=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
