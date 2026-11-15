#!/usr/bin/env python3
"""Exercise the actual isolated Docker restore path with synthetic records only.

Opt in using BOS_RECOVERY_DOCKER_TEST=1 and the explicitly selected disposable
BOS_RECOVERY_DOCKER_SOCKET from the export matrix. No production endpoint is
discovered, and all source/target cleanup is restricted to this test's IDs and
the exact run label returned by the drill.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import uuid

REQUIRE = '--require' in sys.argv
if REQUIRE:
    sys.argv.remove('--require')

import backup
import discovery
from test_docker import DisposableDocker, PUBLIC_IMAGE

LABEL = 'io.business-os.restore-drill'
FIXTURE_BYTES = b'Isolated recovery fixture photo bytes.\x00\xff\n'


class FixtureObservedRunner:
    """Retain only a strict diagnostic allowlist for this synthetic CI fixture."""
    HOST_KEYS = ('NetworkMode', 'ReadonlyRootfs', 'Privileged', 'PublishAllPorts',
                 'PidMode', 'IpcMode', 'UTSMode', 'CapDrop', 'CapAdd', 'SecurityOpt',
                 'RestartPolicy', 'LogConfig', 'Tmpfs', 'Memory', 'MemorySwap',
                 'NanoCpus', 'PidsLimit', 'ShmSize')

    def __init__(self, delegate):
        self.delegate, self.isolation, self.restore_errors = delegate, {}, []

    def __getattr__(self, name):
        return getattr(self.delegate, name)

    def __call__(self, args, **kwargs):
        try:
            data = self.delegate(args, **kwargs)
        except Exception:
            # This wrapper is instantiated only by this test's generated
            # synthetic bundle. Production DockerRunner never prints stderr.
            # Keep the first restore failure before cleanup overwrites it.
            if (args[:1] == ['exec'] and args[-1:] in
                    (['/bos/input/globals.sql'], ['/bos/input/globals-restore.sql'],
                     ['/bos/input/database.dump'])):
                raw = getattr(self.delegate, 'last_error', b'')
                if isinstance(raw, bytes):
                    self.restore_errors.append(raw[:8192].decode(errors='replace'))
                    self.restore_errors = self.restore_errors[-2:]
            raise
        if args[:1] == ['exec'] and 'head' in args and args[-1:] in (['/bos/globals-restore.stderr.log'], ['/bos/database-restore.stderr.log']):
            self.restore_errors.append(data[:8192].decode(errors='replace'))
            self.restore_errors = self.restore_errors[-2:]
        if args[:1] == ['inspect'] or args[:2] == ['container', 'inspect']:
            self.observe(json.loads(data))
        return data

    def observe(self, records):
        for item in records:
            config, host = item.get('Config', {}), item.get('HostConfig', {})
            run_id = (config.get('Labels') or {}).get(LABEL, '')
            if not re.fullmatch(r'bos-drill-[0-9a-f]{12}', run_id):
                continue
            safe = {'HostConfig': {key: host.get(key) for key in self.HOST_KEYS},
                    'Config': {'User': config.get('User'),
                               'Entrypoint': config.get('Entrypoint'),
                               'Healthcheck': {'Test': (config.get('Healthcheck') or {}).get('Test')}},
                    'State': {key: (item.get('State') or {}).get(key)
                              for key in ('Running', 'ExitCode')}}
            self.isolation[item['Id']] = safe
            # A single drill creates only three containers; this bound also
            # prevents unrelated large inspect responses expanding CI output.
            while len(self.isolation) > 4:
                del self.isolation[next(iter(self.isolation))]

    def failure_diagnostic(self):
        print('CI_SYNTHETIC_ISOLATION=' + json.dumps(list(self.isolation.values()),
                                                   sort_keys=True), flush=True)
        if self.restore_errors:
            print('CI_SYNTHETIC_RESTORE_ERROR=' + json.dumps(self.restore_errors), flush=True)


class DiagnosticWhitelistTest(unittest.TestCase):
    def test_diagnostic_excludes_environment_commands_and_mount_sources(self):
        observed = FixtureObservedRunner(None)
        observed.observe([{'Id': 'a' * 64,
                           'Config': {'Labels': {LABEL: 'bos-drill-' + 'b' * 12},
                                      'User': 'postgres', 'Entrypoint': ['/bin/sh'],
                                      'Env': ['SECRET=must-not-print'],
                                      'Cmd': ['sensitive SQL'], 'Healthcheck': {'Test': ['NONE']}},
                           'HostConfig': {'NetworkMode': 'none', 'Binds': ['secret-source']},
                           'Mounts': [{'Source': 'private-directory'}],
                           'State': {'Running': False, 'ExitCode': 0, 'Error': 'private stderr'}}])
        text = json.dumps(list(observed.isolation.values()))
        for secret in ('must-not-print', 'sensitive SQL', 'secret-source', 'private-directory', 'private stderr'):
            self.assertNotIn(secret, text)
        self.assertIn('NetworkMode', text)
        self.assertIn('postgres', text)

SQL = """
CREATE ROLE app_owner NOLOGIN;
CREATE ROLE fixture_team NOLOGIN;
CREATE ROLE fixture_reader LOGIN PASSWORD 'SYNTHETIC_ONLY_NOT_A_REAL_SECRET';
CREATE ROLE supabase_realtime_admin LOGIN;
GRANT fixture_team TO fixture_reader;
GRANT SET ON PARAMETER log_min_messages TO supabase_realtime_admin;
GRANT ALTER SYSTEM ON PARAMETER log_min_messages TO fixture_team WITH GRANT OPTION;
ALTER DATABASE bos_restore_check OWNER TO app_owner;
SET ROLE app_owner;
CREATE TABLE public.orders (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 status text NOT NULL,
 report_review_status text NOT NULL,
 quantity integer NOT NULL CHECK (quantity > 0)
);
CREATE TABLE public.business_staff (id integer PRIMARY KEY, active boolean NOT NULL);
CREATE FUNCTION public.guard_order_completion() RETURNS trigger
LANGUAGE plpgsql AS $$BEGIN
 IF NEW.status = 'completed' AND NEW.report_review_status <> 'approved' THEN
  RAISE EXCEPTION 'fixture report must be approved';
 END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER trg_guard_order_completion BEFORE UPDATE OF status,
 report_review_status ON public.orders FOR EACH ROW
 EXECUTE FUNCTION public.guard_order_completion();
INSERT INTO public.orders(status,report_review_status,quantity)
 VALUES ('open','pending',1),('open','approved',2),('waiting','pending',3);
INSERT INTO public.business_staff VALUES (1,true),(2,false);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_visible ON public.orders TO fixture_team
 USING (status = 'open');
GRANT SELECT ON public.orders TO fixture_team;
CREATE SCHEMA storage AUTHORIZATION app_owner;
CREATE TABLE storage.buckets (id text PRIMARY KEY);
CREATE TABLE storage.objects (
 id uuid PRIMARY KEY, bucket_id text REFERENCES storage.buckets(id),
 name text NOT NULL, metadata jsonb NOT NULL
);
INSERT INTO storage.buckets VALUES ('fixture-bucket');
INSERT INTO storage.objects VALUES
 ('00000000-0000-4000-8000-000000000001','fixture-bucket',
  'fixture.bin','{"mimetype":"application/octet-stream"}');
RESET ROLE;
"""

SNAPSHOT_SQL = """SELECT json_build_object(
 'rows',(SELECT json_agg(t ORDER BY id) FROM public.orders t),
 'staff',(SELECT json_agg(t ORDER BY id) FROM public.business_staff t),
 'storage',(SELECT json_agg(t ORDER BY id) FROM storage.objects t),
 'roles',(SELECT json_agg(t ORDER BY rolname) FROM
  (SELECT rolname,rolsuper,rolcanlogin,rolpassword FROM pg_authid
   WHERE rolname IN ('app_owner','fixture_team','fixture_reader','supabase_realtime_admin')) t),
 'parameter_acl',(SELECT json_agg(t ORDER BY parname) FROM
  (SELECT parname,paracl::text FROM pg_parameter_acl) t),
 'acl',(SELECT relacl::text FROM pg_class WHERE oid='public.orders'::regclass),
 'owner',(SELECT pg_get_userbyid(datdba) FROM pg_database
  WHERE datname=current_database()))::text;"""

PARAMETER_ACL_SQL = """SELECT coalesce(json_agg(t ORDER BY
 parname,grantee,privilege_type,grantor)::text,'[]') FROM (
 SELECT p.parname,pg_get_userbyid(a.grantor) AS grantor,
  CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
  a.privilege_type,a.is_grantable
 FROM pg_parameter_acl p CROSS JOIN LATERAL aclexplode(p.paracl) a
 WHERE p.parname='log_min_messages') t;"""


def write_json(path, value):
    path.write_text(json.dumps(value, separators=(',', ':'), sort_keys=True) + '\n')
    path.chmod(0o600)


def file_archive(path):
    members = {
        'root-000': None,
        'root-000/fixture-tenant': None,
        'root-000/fixture-tenant/fixture-bucket': None,
        'root-000/fixture-tenant/fixture-bucket/fixture.bin': FIXTURE_BYTES,
    }
    inventory = {}
    with tarfile.open(path, 'w') as archive:
        for name, payload in members.items():
            entry = tarfile.TarInfo(name)
            entry.mode, entry.uid, entry.gid = 0o700 if payload is None else 0o600, 999, 999
            if payload is None:
                entry.type = tarfile.DIRTYPE
                archive.addfile(entry)
                inventory[name] = {'type': 'directory', 'bytes': 0}
            else:
                entry.size = len(payload)
                archive.addfile(entry, io.BytesIO(payload))
                inventory[name] = {'type': 'file', 'bytes': len(payload),
                                   'sha256': hashlib.sha256(payload).hexdigest()}
    return inventory


class RealRestoreDrill(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        socket_value = os.environ.get('BOS_RECOVERY_DOCKER_SOCKET', '')
        if os.environ.get('BOS_RECOVERY_DOCKER_TEST') != '1' or not socket_value:
            reason = 'Restore drill integration requires an explicit disposable Docker daemon'
            if REQUIRE:
                raise RuntimeError(reason)
            raise unittest.SkipTest(reason)
        import drill
        cls.drill = drill
        cls.temp = tempfile.TemporaryDirectory(prefix='bos-drill-test-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name).resolve()
        cls.docker = DisposableDocker(socket_value, cls.root)
        cls.runner = drill.DockerRunner(host=cls.docker.host)
        cls.source_image = cls.docker.inspect([PUBLIC_IMAGE])[0]
        version = json.loads(cls.docker.run(['version', '--format', '{{json .Server.Version}}']))
        if version != os.environ.get('BOS_RECOVERY_DOCKER_VERSION', '').removeprefix('v'):
            raise RuntimeError('Restore test Docker version differs from the selected matrix')
        cls.fixture_name = 'bos-synthetic-source-' + uuid.uuid4().hex[:12]
        cls.source = cls.docker.run([
            'run', '-d', '--name', cls.fixture_name, '--network', 'none',
            '--read-only', '--tmpfs', '/var/lib/postgresql/data:rw,size=256m',
            '--tmpfs', '/var/run/postgresql:rw,size=16m', '--tmpfs', '/tmp:rw,size=16m',
            '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=bos_restore_check',
            '-e', 'POSTGRES_INITDB_ARGS=--no-locale --encoding=UTF8', cls.source_image['Id'],
        ], timeout=60).decode().strip()
        if not re.fullmatch(r'[0-9a-f]{64}', cls.source):
            raise RuntimeError('Fixture container ID was not returned')
        cls.addClassCleanup(cls.docker.run, ['rm', '-f', '-v', cls.source], check=False)
        for _ in range(60):
            try:
                if cls.sql(cls.source, 'SELECT 1;') == '1':
                    break
            except RuntimeError:
                pass
            time.sleep(0.25)
        else:
            raise RuntimeError('Synthetic PostgreSQL did not become ready')
        if cls.sql(cls.source, PARAMETER_ACL_SQL) != '[]':
            raise RuntimeError('Fresh fixture unexpectedly has parameter grants')
        cls.sql(cls.source, SQL)
        cls.parameter_acl = cls.sql(cls.source, PARAMETER_ACL_SQL)
        cls.source_before = cls.snapshot()
        # Give the archived image a unique config without executing a build or
        # changing the source database image. Remove it before the drill, so a
        # successful restore must load an absent image identity from the archive.
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
            raise RuntimeError('Synthetic image commit did not return an image identity')
        cls.image = cls.docker.inspect([variant])[0]
        if cls.image['Id'] == cls.source_image['Id']:
            raise RuntimeError('Synthetic archive image identity is not distinct')
        cls.addClassCleanup(cls.docker.run, ['image', 'rm', cls.image['Id']], check=False)
        cls.docker.run(['rm', '-v', producer])
        cls.bundle = cls.root / 'capture-20261115T000000Z-0123456789ab'
        cls.bundle.mkdir(mode=0o700)
        cls.save_database_file('pg_dump', ['-Fc', '-d', discovery.DATABASE], 'database.dump')
        cls.save_database_file('pg_dumpall', ['--globals-only', '-l', discovery.DATABASE], 'globals.sql')
        globals_sql = (cls.bundle / 'globals.sql').read_bytes()
        for statement in (
                b'GRANT SET ON PARAMETER log_min_messages TO supabase_realtime_admin;',
                b'GRANT ALTER SYSTEM ON PARAMETER log_min_messages TO fixture_team WITH GRANT OPTION;'):
            if statement not in globals_sql:
                raise RuntimeError('Real globals dump omitted a parameter grant fixture')
        metadata = json.loads(cls.sql(cls.source, backup.META_SQL))
        cls.docker.save(cls.bundle / 'images.tar', [cls.image])
        cls.docker.run(['image', 'rm', cls.image['Id']])
        if cls.image['Id'] in cls.docker.run(['image', 'ls', '--all', '--quiet', '--no-trunc']).decode().split():
            raise RuntimeError('Synthetic image remained available before archive loading')
        inventory = file_archive(cls.bundle / 'files.tar')
        write_json(cls.bundle / 'inventory.json', inventory)
        containers = []
        for index, role in enumerate(discovery.ROLES):
            containers.append({
                'Id': hashlib.sha256(('synthetic-' + role).encode()).hexdigest(),
                'Name': '/' + discovery.PREFIX + '-' + role,
                'Image': cls.image['Id'],
                'Config': {'Env': [], 'Labels': {'fixture': 'synthetic only'}},
                'Mounts': [],
            })
        storage = next(c for c in containers if c['Name'].endswith('-storage'))
        storage['Config']['Env'] = ['STORAGE_BACKEND=file',
                                    'FILE_STORAGE_BACKEND_PATH=/var/lib/storage',
                                    'TENANT_ID=fixture-tenant']
        storage['Mounts'] = [{'Type': 'bind', 'Source': '/fixture/storage',
                              'Destination': '/var/lib/storage', 'RW': True}]
        private = {'containers': containers, 'database': metadata,
                   'database_user': 'postgres', 'images': [cls.image],
                   'roots': ['/fixture/storage'], 'contains_secrets': True}
        write_json(cls.bundle / 'private-config.json', private)
        manifest = {'format': 1, 'capture': 'COMPLETE', 'build': discovery.BUILD,
                    'started_at': '2026-11-15T00:00:00Z', 'finished_at': '2026-11-15T00:00:01Z',
                    'database_snapshot': 'PG_DUMP', 'database_storage_consistency': 'NOT_PROVEN',
                    'independent_copy': 'NOT_VERIFIED', 'restore': 'NOT_RUN',
                    'disaster_recovery_ready': False,
                    'payloads': {p: backup.hash_file(cls.bundle / p) for p in sorted(backup.PAYLOADS)}}
        write_json(cls.bundle / 'manifest.json', manifest)
        cls.original_hashes = {p.name: backup.hash_file(p) for p in cls.bundle.iterdir()}

    @classmethod
    def sql(cls, container, sql, *, user='postgres', check=True):
        data = cls.docker.run(['exec', '-i', '-u', 'postgres', container,
                               'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                               '-h', '/var/run/postgresql', '-U', user,
                               '-d', discovery.DATABASE], data=sql.encode(), check=check)
        return data.decode().strip()

    @classmethod
    def snapshot(cls):
        return hashlib.sha256(cls.sql(cls.source, SNAPSHOT_SQL).encode()).hexdigest()

    @classmethod
    def save_database_file(cls, program, arguments, filename):
        data = cls.docker.run(['exec', '-u', 'postgres', cls.source, program,
                               '-h', '/var/run/postgresql', '-U', 'postgres', *arguments], timeout=60)
        (cls.bundle / filename).write_bytes(data)
        (cls.bundle / filename).chmod(0o600)

    def resource_ids(self):
        return (set(self.docker.run(['ps', '-aq']).decode().split()),
                set(self.docker.run(['volume', 'ls', '-q']).decode().split()))

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

    def test_corrupt_payload_stops_before_docker_mutation(self):
        target = self.bundle / 'database.dump'
        original = target.read_bytes()
        before = self.resource_ids()
        target.write_bytes(original + b'corruption')
        try:
            with self.assertRaises(Exception) as raised:
                self.drill.run_drill(self.bundle, self.runner)
            self.assertEqual(getattr(raised.exception, 'reason_code', None), 'PAYLOAD_HASH_MISMATCH')
            self.assertEqual(self.resource_ids(), before)
            self.assertEqual(self.snapshot(), self.source_before)
        finally:
            target.write_bytes(original)

    def test_parameter_revoke_stops_before_docker_mutation(self):
        target, manifest_path = self.bundle / 'globals.sql', self.bundle / 'manifest.json'
        original, original_manifest = target.read_bytes(), manifest_path.read_bytes()
        before = self.resource_ids()
        # This is an intentionally re-hashed synthetic fixture, not corruption:
        # PostgreSQL can silently ignore this REVOKE on a fresh parameter ACL.
        target.write_bytes(original +
                           b'\nREVOKE ALTER SYSTEM ON PARAMETER log_min_messages FROM postgres;\n')
        manifest = json.loads(original_manifest)
        manifest['payloads']['globals.sql'] = backup.hash_file(target)
        write_json(manifest_path, manifest)
        try:
            with self.assertRaises(Exception) as raised:
                self.drill.run_drill(self.bundle, self.runner)
            self.assertEqual(getattr(raised.exception, 'reason_code', None),
                             'DRILL_BOOTSTRAP_METADATA_REQUIRED')
            self.assertEqual(self.resource_ids(), before)
            self.assertEqual(self.snapshot(), self.source_before)
        finally:
            target.write_bytes(original)
            manifest_path.write_bytes(original_manifest)

    def test_real_bundle_restores_roles_data_guard_and_file_bytes(self):
        self.assertNotIn(self.image['Id'], self.docker.run(
            ['image', 'ls', '--all', '--quiet', '--no-trunc']).decode().split())
        observed = FixtureObservedRunner(self.runner)
        try:
            report = self.drill.run_drill(self.bundle, observed)
        except Exception:
            observed.failure_diagnostic()
            raise
        run_id = report['run_id']
        self.addCleanup(self.cleanup_drill, run_id)
        self.assertEqual(report['status'], 'DRILL_COMPLETED')
        self.assertEqual(report['scope'], 'DATABASE_GLOBALS_AND_FILE_BYTES')
        self.assertEqual(report['application'], 'NOT_RUN')
        self.assertFalse(report['disaster_recovery_ready'])
        self.assertEqual(report['storage_relationships'], 'NOT_VERIFIED')
        self.assertEqual(report['storage_extended_attributes'], 'NOT_CAPTURED')
        self.assertEqual(report['restore']['counts'], {'orders': 3, 'staff': 2, 'storage_objects': 1})
        self.assertEqual(report['files']['files'], 1)
        self.assertEqual(report['files']['bytes'], len(FIXTURE_BYTES))
        self.assertEqual({p.name: backup.hash_file(p) for p in self.bundle.iterdir()}, self.original_hashes)
        self.assertEqual(self.snapshot(), self.source_before)
        serialized = json.dumps(report)
        self.assertNotIn('SYNTHETIC_ONLY_NOT_A_REAL_SECRET', serialized)
        self.assertNotIn('fixture.bin', serialized)
        self.assertNotIn('rolpassword', serialized)
        # The drill leaves the newly restored named volume, but no running
        # workload. Independently reopen that target under the same isolation
        # to exercise owner/ACL/RLS and the trigger against restored records.
        remaining = self.docker.run(['ps', '-q', '--filter', 'label=' + LABEL + '=' + run_id])
        self.assertEqual(remaining.strip(), b'')
        verifier = self.docker.run([
            'run', '-d', '--name', run_id + '-verify', '--label', LABEL + '=' + run_id,
            '--network', 'none', '--read-only', '--user', 'postgres', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--memory', '512m',
            '--tmpfs', '/tmp:rw,size=32m,mode=1777',
            '--mount', 'type=volume,src=' + run_id + '-data,dst=/bos,volume-nocopy',
            '--entrypoint', 'postgres', self.image['Id'], '-D', '/bos/data',
            '-c', 'listen_addresses=', '-c', 'unix_socket_directories=/tmp',
            '-c', 'shared_preload_libraries=', '-c', 'session_preload_libraries=',
            '-c', 'local_preload_libraries=',
        ]).decode().strip()
        self.addCleanup(self.docker.run, ['rm', '-f', '-v', verifier], check=False)
        for _ in range(60):
            try:
                if self.target_sql(verifier, 'SELECT 1;') == '1':
                    break
            except RuntimeError:
                pass
            time.sleep(0.25)
        else:
            self.fail('Restored fixture could not be reopened for independent assertions')
        info = json.loads(self.docker.run(['inspect', verifier]))[0]
        self.assertEqual(info['HostConfig']['NetworkMode'], 'none')
        self.assertFalse(info['HostConfig']['PortBindings'])
        routes = self.docker.run(['exec', verifier, 'cat', '/proc/net/route']).decode().splitlines()
        self.assertEqual(len(routes), 1, 'Isolated target has an external IPv4 route')
        self.assertEqual(self.target_sql(verifier, 'SELECT count(*) FROM public.orders;'), '3')
        self.assertEqual(self.target_sql(verifier, 'SELECT count(*) FROM public.orders;', user='fixture_reader'), '2')
        self.assertEqual(self.target_sql(verifier, "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database();"), 'app_owner')
        self.assertEqual(self.target_sql(verifier, "SELECT pg_get_userbyid(relowner) || ':' || relrowsecurity::text FROM pg_class WHERE oid='public.orders'::regclass;"), 'app_owner:true')
        self.assertEqual(self.target_sql(verifier, PARAMETER_ACL_SQL), self.parameter_acl)
        self.assertEqual(self.target_sql(verifier,
                         "SELECT has_parameter_privilege('supabase_realtime_admin','log_min_messages','SET');"), 't')
        self.assertEqual(self.target_sql(verifier,
                         "SELECT has_parameter_privilege('supabase_realtime_admin','log_min_messages','ALTER SYSTEM');"), 'f')
        self.assertEqual(self.target_sql(verifier,
                         "SELECT has_parameter_privilege('fixture_team','log_min_messages','ALTER SYSTEM WITH GRANT OPTION');"), 't')
        self.assertEqual(self.target_sql(verifier,
                         "SET log_min_messages='debug1'; SHOW log_min_messages;",
                         user='supabase_realtime_admin'), 'debug1')
        with self.assertRaises(RuntimeError):
            self.target_sql(verifier, "SET log_min_messages='debug1';", user='fixture_reader')
        with self.assertRaises(RuntimeError):
            self.target_sql(verifier, "UPDATE public.orders SET status='completed' WHERE id=1;")
        with self.assertRaises(RuntimeError):
            self.target_sql(verifier, "INSERT INTO public.orders(status,report_review_status,quantity) VALUES ('open','pending',1);", user='fixture_reader')
        self.assertEqual(self.target_sql(verifier, 'SELECT sum(quantity) FROM public.orders;'), '6')
        self.assertEqual(self.snapshot(), self.source_before)
        print('\nActual Docker restore: ' + json.dumps({
            'store': os.environ.get('BOS_RECOVERY_DOCKER_STORE'),
            'scope': report['scope'], 'roles_acl_rls_guard': 'VERIFIED_SYNTHETIC',
            'parameter_grants_and_options': 'VERIFIED_SYNTHETIC',
            'source_unchanged': True, 'network': 'none', 'full_application': 'NOT_RUN',
            'archive_image_id_absent_before_load': True,
        }, sort_keys=True), flush=True)

    def target_sql(self, container, sql, *, user='postgres'):
        return self.docker.run(['exec', '-i', '-u', 'postgres', container,
                               'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                               '-h', '/tmp', '-U', user, '-d', discovery.DATABASE],
                               data=sql.encode()).decode().strip()


if __name__ == '__main__':
    unittest.main(verbosity=2)
