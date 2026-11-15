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

SQL = """
CREATE ROLE app_owner NOLOGIN;
CREATE ROLE fixture_team NOLOGIN;
CREATE ROLE fixture_reader LOGIN PASSWORD 'SYNTHETIC_ONLY_NOT_A_REAL_SECRET';
GRANT fixture_team TO fixture_reader;
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
   WHERE rolname IN ('app_owner','fixture_team','fixture_reader')) t),
 'acl',(SELECT relacl::text FROM pg_class WHERE oid='public.orders'::regclass),
 'owner',(SELECT pg_get_userbyid(datdba) FROM pg_database
  WHERE datname=current_database()))::text;"""


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
        cls.image = cls.docker.inspect([PUBLIC_IMAGE])[0]
        version = json.loads(cls.docker.run(['version', '--format', '{{json .Server.Version}}']))
        if version != os.environ.get('BOS_RECOVERY_DOCKER_VERSION', '').removeprefix('v'):
            raise RuntimeError('Restore test Docker version differs from the selected matrix')
        cls.fixture_name = 'bos-synthetic-source-' + uuid.uuid4().hex[:12]
        cls.source = cls.docker.run([
            'run', '-d', '--name', cls.fixture_name, '--network', 'none',
            '--read-only', '--tmpfs', '/var/lib/postgresql/data:rw,size=256m',
            '--tmpfs', '/var/run/postgresql:rw,size=16m', '--tmpfs', '/tmp:rw,size=16m',
            '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=bos_restore_check',
            '-e', 'POSTGRES_INITDB_ARGS=--no-locale --encoding=UTF8', cls.image['Id'],
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
        cls.sql(cls.source, SQL)
        cls.source_before = cls.snapshot()
        cls.bundle = cls.root / 'capture-20261115T000000Z-0123456789ab'
        cls.bundle.mkdir(mode=0o700)
        cls.save_database_file('pg_dump', ['-Fc', '-d', discovery.DATABASE], 'database.dump')
        cls.save_database_file('pg_dumpall', ['--globals-only', '-l', discovery.DATABASE], 'globals.sql')
        metadata = json.loads(cls.sql(cls.source, backup.META_SQL))
        cls.docker.save(cls.bundle / 'images.tar', [cls.image])
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

    def test_real_bundle_restores_roles_data_guard_and_file_bytes(self):
        report = self.drill.run_drill(self.bundle, self.runner)
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
        with self.assertRaises(RuntimeError):
            self.target_sql(verifier, "UPDATE public.orders SET status='completed' WHERE id=1;")
        with self.assertRaises(RuntimeError):
            self.target_sql(verifier, "INSERT INTO public.orders(status,report_review_status,quantity) VALUES ('open','pending',1);", user='fixture_reader')
        self.assertEqual(self.target_sql(verifier, 'SELECT sum(quantity) FROM public.orders;'), '6')
        self.assertEqual(self.snapshot(), self.source_before)
        print('\nActual Docker restore: ' + json.dumps({
            'store': os.environ.get('BOS_RECOVERY_DOCKER_STORE'),
            'scope': report['scope'], 'roles_acl_rls_guard': 'VERIFIED_SYNTHETIC',
            'source_unchanged': True, 'network': 'none', 'full_application': 'NOT_RUN',
        }, sort_keys=True), flush=True)

    def target_sql(self, container, sql, *, user='postgres'):
        return self.docker.run(['exec', '-i', '-u', 'postgres', container,
                               'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                               '-h', '/tmp', '-U', user, '-d', discovery.DATABASE],
                               data=sql.encode()).decode().strip()


if __name__ == '__main__':
    unittest.main(verbosity=2)
