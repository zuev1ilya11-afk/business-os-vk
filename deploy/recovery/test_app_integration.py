#!/usr/bin/env python3
"""Real public-image application launch, using generated data only.

The fixture first runs real Auth/Storage migrations and uploads a binary through
Storage. It captures those bytes, restores them through run_drill, and launches
the application on a clone. No production archive, endpoint, or secret is used.
Docker is opt-in and must be the explicitly selected disposable CI daemon.
"""
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import re
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
import drill
import drill_db
from drill_profile import build_runtime_profile
from test_drill_integration import LABEL as DRILL_LABEL, SQL, write_json
from test_drill_supabase import (BOOTSTRAP, EXTENSIONS, PUBLIC_IMAGE as DB_IMAGE,
                                  SyntheticDocker)

# Versioned upstream releases from supabase/supabase/docker/docker-compose.yml
# (2026-11-15). Captures export exact inspected identities, never floating tags.
# Auth and Storage commands are checked against their matching upstream Dockerfiles.
PUBLIC_IMAGES = {
    'db': DB_IMAGE,
    'rest': 'docker.io/postgrest/postgrest:v14.18',
    'auth': 'docker.io/supabase/gotrue:v2.197.0',
    'storage': 'docker.io/supabase/storage-api:v1.89.12',
    'edge': 'docker.io/supabase/edge-runtime:v1.77.9',
    'https': 'docker.io/library/caddy:2.10.2-alpine',
}
APP_LABEL = 'io.business-os.local-app'
FIXTURE_BYTES = b'Synthetic Storage API fixture\x00\xff\r\n' * 257
PASSWORD = 'synthetic-ci-password-never-used-outside-this-fixture'
JWT_SECRET = 'synthetic-ci-jwt-secret-at-least-thirty-two-bytes-long'
SOURCE_START = r'''set -eu
umask 077
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE PGSYSCONFDIR PGDATA
initdb -D /bos/data --username supabase_admin --auth-local=trust --auth-host=trust --no-locale --encoding=UTF8 --no-instructions >/dev/null
exec postgres -D /bos/data -c listen_addresses=127.0.0.1 -c port=5432 -c unix_socket_directories=/tmp -c unix_socket_permissions=0700 -c max_connections=50 -c shared_buffers=64MB -c logging_collector=off -c log_min_error_statement=panic -c log_statement=none "$@"
'''
ROLES_SQL = """
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'synthetic-ci-password-never-used-outside-this-fixture';
CREATE ROLE supabase_auth_admin LOGIN CREATEROLE PASSWORD 'synthetic-ci-password-never-used-outside-this-fixture';
CREATE ROLE supabase_storage_admin LOGIN CREATEROLE PASSWORD 'synthetic-ci-password-never-used-outside-this-fixture';
GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO supabase_storage_admin WITH ADMIN OPTION;
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin;
CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA public,auth,storage,extensions TO anon,authenticated,service_role,authenticator,supabase_auth_admin,supabase_storage_admin;
GRANT CREATE ON SCHEMA public TO supabase_auth_admin,supabase_storage_admin;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage GRANT ALL ON TABLES TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.role',true),'')$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
"""

# This generated gateway exercises the actual EdgeRuntime ESZIP worker API.
# Its tiny functions are fixture contracts, not claims about Business OS login.
GATEWAY = r'''const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VK_APP_SECRET'];
const routes=JSON.parse(await Deno.readTextFile('/bos-main/routes.json'));
Deno.serve(async(req)=>{
 const url=new URL(req.url);
 for(const [prefix,env] of [['/rest/v1/','BOS_REST_ORIGIN'],['/auth/v1/','BOS_AUTH_ORIGIN'],['/storage/v1/','BOS_STORAGE_ORIGIN']]){
  if(url.pathname.startsWith(prefix)){
   const target=Deno.env.get(env)+url.pathname.slice(prefix.length-1)+url.search;
   return await fetch(new Request(target,req));
  }
 }
 const slug=url.pathname.split('/')[3];
 if(!routes[slug]) return new Response('fixture route absent',{status:404});
 const worker=await EdgeRuntime.userWorkers.create({
  servicePath:'/bos-src/'+slug,
  maybeEszip:await Deno.readFile('/bos-bundles/'+slug+'.eszip'),
  maybeEntrypoint:'file:///bos-src/'+slug+'/supabase/functions/'+slug+'/index.ts',
  memoryLimitMb:128,workerTimeoutMs:30000,noModuleCache:false,
  envVars:keys.map(key=>[key,Deno.env.get(key)||'']),
  forceCreate:false,cpuTimeSoftLimitMs:5000,cpuTimeHardLimitMs:10000
 });
 return await worker.fetch(req);
});
'''
MINI = r'''Deno.serve(async(req)=>{
 const input=req.method==='POST'?await req.json():{};
 const headers={'apikey':Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
 'Authorization':'Bearer '+Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
 'Content-Type':'application/json'};
 let suffix='/rest/v1/orders?select=id,status,quantity&order=id';
 let init={headers};
 if(input.action==='fixture_write'){
  suffix='/rest/v1/orders?id=eq.1';
  init={method:'PATCH',headers:{...headers,'Prefer':'return=representation'},body:JSON.stringify({quantity:7})};
 }
 const response=await fetch(Deno.env.get('SUPABASE_URL')+suffix,init);
 if(!response.ok)return new Response(await response.text(),{status:response.status});
 return Response.json({ok:true,orders:await response.json()});
});
'''
PASSWORD_FUNCTION = "Deno.serve(()=>Response.json({ok:true,fixture_only:true}));\n"
WEB = b'<!doctype html><html><head><title>Synthetic BOS restore</title></head><body><h1 id="fixture">Captured synthetic web</h1></body></html>'


class BytesSocket:
    def __init__(self, value):
        self.value = value

    def makefile(self, *args, **kwargs):
        return io.BytesIO(self.value)


def archive_tree(root, target):
    """Capture regular generated files, deliberately without POSIX xattrs."""
    inventory = {}
    with tarfile.open(target, 'w', format=tarfile.PAX_FORMAT) as archive:
        for path in [root, *sorted(root.rglob('*'))]:
            name = 'root-000' + ('/' + path.relative_to(root).as_posix() if path != root else '')
            if path.is_symlink():
                raise RuntimeError('Synthetic capture unexpectedly contains a symlink')
            if path.is_dir():
                inventory[name] = {'type': 'directory', 'bytes': 0}
            elif path.is_file():
                inventory[name] = {'type': 'file', 'bytes': path.stat().st_size,
                                   'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            else:
                raise RuntimeError('Synthetic capture contains a special file')
            archive.add(path, arcname=name, recursive=False)
    return inventory


class RealApplicationLaunch(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        socket_value = os.environ.get('BOS_RECOVERY_DOCKER_SOCKET', '')
        if os.environ.get('BOS_RECOVERY_APP_TEST') != '1' or not socket_value:
            reason = 'Application integration needs its explicit disposable Docker daemon'
            if REQUIRE:
                raise RuntimeError(reason)
            raise unittest.SkipTest(reason)
        import app_plan
        cls.temp = tempfile.TemporaryDirectory(prefix='bos-application-ci-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name).resolve()
        cls.docker = SyntheticDocker(socket_value, cls.root)
        cls.runner = drill.DockerRunner(host=cls.docker.host)
        version = json.loads(cls.docker.run(['version', '--format', '{{json .Server.Version}}']))
        if version != os.environ.get('BOS_RECOVERY_DOCKER_VERSION', '').removeprefix('v'):
            raise RuntimeError('Application fixture Docker version differs from selected daemon')
        cls.images = {role: cls.docker.inspect([reference])[0] for role, reference in PUBLIC_IMAGES.items()}
        cls.name = 'bos-synthetic-app-' + uuid.uuid4().hex[:12]
        cls.containers = []
        cls.capture = cls.root / 'captured'
        cls.capture.mkdir(mode=0o755)
        for name in ('storage', 'web', 'caddy', 'caddy-config', 'edge/sources', 'edge/bundles', 'edge/main'):
            (cls.capture / name).mkdir(parents=True, mode=0o755)
        # The source public Storage image owns files in this synthetic host dir.
        (cls.capture / 'storage').chmod(0o777)
        (cls.capture / 'edge/bundles').chmod(0o777)
        cls.addClassCleanup(cls.fix_fixture_ownership)
        cls.profile = build_runtime_profile({'database': discovery.DATABASE,
                                             'extensions': [[name, '1'] for name in EXTENSIONS]})
        settings = [item for setting in cls.profile.startup_settings for item in ('-c', setting)]
        cls.source = cls.docker.run([
            'run', '-d', '--name', cls.name + '-db', '--network', 'none', '--read-only',
            '--user', 'postgres', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--no-healthcheck', '--pids-limit', '256', '--memory', '1g', '--memory-swap', '1g',
            '--tmpfs', '/bos:rw,size=512m,mode=1777', '--tmpfs', '/tmp:rw,size=64m,mode=1777',
            '--env', 'PATH=' + drill_db.PATH, '--entrypoint', '/bin/sh', cls.images['db']['Id'],
            '-ceu', SOURCE_START, 'fixture', *settings,
        ]).decode().strip()
        cls.own_container(cls.source)
        cls.wait_sql()
        # Fail before building a fixture if the selected public DB image cannot
        # support the same stdin/BusyBox nc bridge used on Windows.
        help_text = cls.docker.run(['exec', cls.source, '/bin/busybox', '--list']).decode()
        if 'nc' not in help_text.splitlines():
            raise RuntimeError('Public database fixture does not contain BusyBox nc')
        cls.sql('CREATE DATABASE bos_restore_check;', database='postgres')
        cls.sql('CREATE ROLE postgres LOGIN CREATEROLE CREATEDB REPLICATION BYPASSRLS;')
        for name in EXTENSIONS:
            cls.sql('CREATE EXTENSION "' + name + '";')
        cls.sql(SQL.split('CREATE SCHEMA storage AUTHORIZATION app_owner;')[0] + '\nRESET ROLE;')
        cls.sql(ROLES_SQL)
        cls.anon = app_plan.jwt('anon', JWT_SECRET)
        cls.service = app_plan.jwt('service_role', JWT_SECRET)
        uri = lambda user: 'postgresql://' + user + ':' + PASSWORD + '@127.0.0.1:5432/' + discovery.DATABASE
        cls.envs = {
            'db': {},
            'rest': {'PGRST_DB_URI': uri('authenticator'), 'PGRST_DB_SCHEMAS': 'public',
                     'PGRST_DB_ANON_ROLE': 'anon', 'PGRST_JWT_SECRET': JWT_SECRET,
                     'PGRST_SERVER_HOST': '127.0.0.1', 'PGRST_SERVER_PORT': '3000'},
            'auth': {'GOTRUE_DB_DATABASE_URL': uri('supabase_auth_admin'), 'GOTRUE_DB_DRIVER': 'postgres',
                     'GOTRUE_DB_NAMESPACE': 'auth', 'GOTRUE_API_HOST': '127.0.0.1',
                     'GOTRUE_API_PORT': '9999', 'API_EXTERNAL_URL': 'http://127.0.0.1:18080',
                     'GOTRUE_SITE_URL': 'http://127.0.0.1:18080', 'GOTRUE_JWT_SECRET': JWT_SECRET,
                     'GOTRUE_DISABLE_SIGNUP': 'true', 'GOTRUE_EXTERNAL_EMAIL_ENABLED': 'false',
                     'GOTRUE_EXTERNAL_PHONE_ENABLED': 'false'},
            'storage': {'DATABASE_URL': uri('supabase_storage_admin'),
                        'DATABASE_POOL_URL': uri('supabase_storage_admin'),
                        'DB_INSTALL_ROLES': 'false', 'DB_ALLOW_MIGRATION_REFRESH': 'false',
                        'ANON_KEY': cls.anon, 'SERVICE_KEY': cls.service,
                        'AUTH_JWT_SECRET': JWT_SECRET, 'POSTGREST_URL': 'http://127.0.0.1:3000',
                        'STORAGE_BACKEND': 'file', 'FILE_STORAGE_BACKEND_PATH': '/var/lib/storage',
                        'TENANT_ID': 'fixture-tenant', 'GLOBAL_S3_BUCKET': 'fixture-global',
                        'REGION': 'local', 'PORT': '5000', 'HOST': '127.0.0.1',
                        'PG_QUEUE_ENABLE': 'false', 'ENABLE_IMAGE_TRANSFORMATION': 'false',
                        'FILE_SIZE_LIMIT': '1048576', 'TUS_USE_FILE_VERSION_SEPARATOR': 'false'},
            'edge': {'SUPABASE_URL': 'http://127.0.0.1:9000', 'SUPABASE_SERVICE_ROLE_KEY': cls.service,
                     'VK_APP_SECRET': 'synthetic-ci-vk-secret', 'JWT_SECRET': JWT_SECRET},
            'https': {},
        }
        cls.start_source_service('auth')
        cls.wait_http(9999, '/health')
        cls.start_source_service('rest')
        cls.wait_http(3000, '/')
        cls.start_source_service('storage', mount=(cls.capture / 'storage', '/var/lib/storage'))
        cls.wait_http(5000, '/status')
        auth_headers = {'Authorization': 'Bearer ' + cls.service, 'apikey': cls.service}
        status, _, body = cls.internal_http(5000, 'POST', '/bucket',
             json.dumps({'id': 'fixture-bucket', 'name': 'fixture-bucket', 'public': True}).encode(),
             {**auth_headers, 'Content-Type': 'application/json'})
        if status not in (200, 201):
            raise RuntimeError('Synthetic Storage bucket creation failed: ' + str(status) + ' ' + body[:2048].decode(errors='replace'))
        status, _, body = cls.internal_http(5000, 'POST', '/object/fixture-bucket/fixture.bin', FIXTURE_BYTES,
                                           {**auth_headers, 'Content-Type': 'application/octet-stream'})
        if status not in (200, 201):
            raise RuntimeError('Synthetic Storage upload failed: ' + str(status) + ' ' + body[:2048].decode(errors='replace'))
        status, _, body = cls.internal_http(5000, 'GET', '/object/public/fixture-bucket/fixture.bin')
        if status != 200 or body != FIXTURE_BYTES:
            raise RuntimeError('Real Storage API did not return the uploaded synthetic bytes')
        cls.prepare_gateway()
        (cls.capture / 'web/index.html').write_bytes(WEB)
        (cls.capture / 'caddy/Caddyfile').write_text('http://127.0.0.1:18080 { respond "synthetic" }\n')
        # Stop all source service writers before collecting metadata and files.
        for cid in cls.containers:
            if cid != cls.source:
                cls.docker.run(['stop', '--time', '5', cid])
        cls.bundle = cls.root / 'capture-20261115T000000Z-0123456789ab'
        cls.bundle.mkdir(mode=0o700)
        for program, arguments, filename in (
            ('pg_dump', ['-Fc', '-d', discovery.DATABASE], 'database.dump'),
            ('pg_dumpall', ['--globals-only', '-l', discovery.DATABASE], 'globals.sql')):
            (cls.bundle / filename).write_bytes(cls.docker.run(
                ['exec', '-u', 'postgres', cls.source, program, '-h', '/tmp', '-U', BOOTSTRAP, *arguments]))
        metadata = json.loads(cls.sql(backup.META_SQL))
        cls.docker.save(cls.bundle / 'images.tar', list(cls.images.values()))
        write_json(cls.bundle / 'inventory.json', archive_tree(cls.capture, cls.bundle / 'files.tar'))
        write_json(cls.bundle / 'private-config.json', {
            'containers': cls.captured_containers(), 'database': metadata,
            'database_user': 'postgres', 'images': list(cls.images.values()),
            'roots': ['/synthetic/captured'], 'contains_secrets': True})
        write_json(cls.bundle / 'manifest.json', {
            'format': 1, 'capture': 'COMPLETE', 'build': discovery.BUILD,
            'started_at': '2026-11-15T00:00:00Z', 'finished_at': '2026-11-15T00:00:01Z',
            'database_snapshot': 'PG_DUMP', 'database_storage_consistency': 'NOT_PROVEN',
            'independent_copy': 'NOT_VERIFIED', 'restore': 'NOT_RUN', 'disaster_recovery_ready': False,
            'payloads': {name: backup.hash_file(cls.bundle / name) for name in sorted(backup.PAYLOADS)}})
        cls.bundle_before = {p.name: backup.hash_file(p) for p in cls.bundle.iterdir()}
        cls.source_before = cls.sql('SELECT json_agg(t ORDER BY id) FROM public.orders t;')
        cls.baseline = drill.run_drill(cls.bundle, cls.runner)
        if cls.baseline['status'] != 'DRILL_COMPLETED':
            raise RuntimeError('Synthetic prerequisite restore did not complete')
        cls.addClassCleanup(cls.remove_volume, cls.baseline['volume'], DRILL_LABEL, cls.baseline['run_id'])

    @classmethod
    def own_container(cls, cid):
        if not re.fullmatch(r'[0-9a-f]{64}', cid):
            raise RuntimeError('Synthetic container identity missing')
        cls.containers.append(cid)
        cls.addClassCleanup(cls.docker.run, ['rm', '-f', '-v', cid], check=False)

    @classmethod
    def fix_fixture_ownership(cls):
        # Only this temporary fixture mount is writable. Public image processes
        # can create root-owned files; make the normal TemporaryDirectory cleanup
        # reliable for the unprivileged GitHub runner after its containers stop.
        cls.docker.run(['run', '--rm', '--network', 'none', '--read-only', '--user', '0:0',
            '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--security-opt', 'no-new-privileges',
            '--mount', 'type=bind,src=' + str(cls.capture) + ',dst=/fixture',
            '--entrypoint', '/bin/busybox', cls.images['db']['Id'],
            'chown', '-R', str(os.getuid()) + ':' + str(os.getgid()), '/fixture'])

    @classmethod
    def sql(cls, sql, database=discovery.DATABASE):
        return cls.docker.run(['exec', '-i', '-u', 'postgres', cls.source, 'psql', '-X', '-qAt',
                               '-v', 'ON_ERROR_STOP=1', '-h', '/tmp', '-U', BOOTSTRAP, '-d', database],
                              data=sql.encode()).decode().strip()

    @classmethod
    def wait_sql(cls):
        for _ in range(100):
            try:
                if cls.sql('SELECT 1;', database='postgres') == '1':
                    return
            except RuntimeError:
                pass
            time.sleep(0.2)
        raise RuntimeError('Synthetic PostgreSQL did not start')

    @classmethod
    def internal_http(cls, port, method, path, body=b'', headers=None):
        head = {'Host': '127.0.0.1:' + str(port), 'Connection': 'close',
                'Content-Length': str(len(body)), **(headers or {})}
        data = (method + ' ' + path + ' HTTP/1.1\r\n' + ''.join(k + ': ' + v + '\r\n' for k, v in head.items()) + '\r\n').encode() + body
        raw = cls.docker.run(['exec', '-i', cls.source, '/bin/busybox', 'nc', '-w', '10', '127.0.0.1', str(port)], data=data, timeout=20)
        response = http.client.HTTPResponse(BytesSocket(raw))
        response.begin()
        return response.status, dict(response.getheaders()), response.read()

    @classmethod
    def wait_http(cls, port, path):
        last = None
        for _ in range(90):
            try:
                status, _, body = cls.internal_http(port, 'GET', path)
                if status == 200:
                    return
                last = str(status) + ' ' + body[:1024].decode(errors='replace')
            except (RuntimeError, http.client.HTTPException) as exc:
                last = type(exc).__name__
            time.sleep(0.5)
        for cid in cls.containers:
            print('CI_SYNTHETIC_APP_STARTUP=' + cls.docker.run(['logs', '--tail', '10', cid], check=False)[:4096].decode(errors='replace'))
        raise RuntimeError('Synthetic service did not become ready: ' + str(port) + ' ' + str(last))

    @classmethod
    def start_source_service(cls, role, mount=None):
        args = ['run', '-d', '--name', cls.name + '-' + role, '--network', 'container:' + cls.source,
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--no-healthcheck',
                '--tmpfs', '/tmp:rw,size=64m,mode=1777']
        if mount:
            args += ['--mount', 'type=bind,src=' + str(mount[0]) + ',dst=' + mount[1]]
        for key, value in cls.envs[role].items():
            args += ['--env', key + '=' + value]
        args += [cls.images[role]['Id']]
        cid = cls.docker.run(args).decode().strip()
        cls.own_container(cid)

    @classmethod
    def prepare_gateway(cls):
        (cls.capture / 'edge/main/index.ts').write_text(GATEWAY)
        write_json(cls.capture / 'edge/main/bos-report-env.json', {'synthetic': True})
        write_json(cls.capture / 'edge/main/routes.json', {name: '/bos-bundles/' + name + '.eszip'
                   for name in ('mini-app-api', 'password-session-api')})
        for slug, code in (('mini-app-api', MINI), ('password-session-api', PASSWORD_FUNCTION)):
            relative = slug + '/supabase/functions/' + slug + '/index.ts'
            path = cls.capture / 'edge/sources' / relative
            path.parent.mkdir(parents=True)
            path.write_text(code)
            cls.docker.run(['run', '--rm', '--network', 'none', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges', '--entrypoint', 'edge-runtime',
                '--mount', 'type=bind,src=' + str(cls.capture / 'edge/sources') + ',dst=/bos-src,readonly',
                '--mount', 'type=bind,src=' + str(cls.capture / 'edge/bundles') + ',dst=/bos-output',
                cls.images['edge']['Id'], 'bundle', '--entrypoint', '/bos-src/' + relative,
                '--output', '/bos-output/' + slug + '.eszip', '--quiet', '--timeout', '90'], timeout=120)

    @classmethod
    def captured_containers(cls):
        mounts = {'storage': [('storage', '/var/lib/storage')],
                  'edge': [('edge/sources', '/bos-src'), ('edge/bundles', '/bos-bundles'), ('edge/main', '/bos-main')],
                  'https': [('web', '/srv'), ('caddy', '/etc/caddy'), ('caddy-config', '/config')]}
        result = []
        for role in discovery.ROLES:
            config = dict(cls.images[role]['Config'])
            env = dict(item.split('=', 1) for item in config.get('Env') or [])
            env.update(cls.envs[role])
            # An opaque integration value must be cleared, not propagated.
            env['CI_EXTERNAL_SECRET'] = 'SYNTHETIC_CAPTURED_SECRET_MUST_NOT_REACH_APP'
            config['Env'] = [key + '=' + value for key, value in env.items()]
            result.append({'Id': hashlib.sha256(('fixture-' + role).encode()).hexdigest(),
                           'Name': '/' + discovery.PREFIX + '-' + role,
                           'Image': cls.images[role]['Id'], 'Config': config,
                           'Mounts': [{'Type': 'bind', 'Source': '/synthetic/captured/' + source,
                                       'Destination': target, 'RW': True} for source, target in mounts.get(role, [])]})
        return result

    @classmethod
    def volume_hash(cls, volume):
        data = cls.docker.run(['run', '--rm', '--network', 'none', '--read-only', '--user', '0:0',
            '--cap-drop', 'ALL', '--cap-add', 'DAC_READ_SEARCH', '--security-opt', 'no-new-privileges',
            '--mount', 'type=volume,src=' + volume + ',dst=/baseline,readonly,volume-nocopy',
            '--entrypoint', '/bin/sh', cls.images['db']['Id'], '-ceu',
            '/bin/busybox find /baseline/data /baseline/files -type f -exec /bin/busybox sha256sum {} +'], timeout=120)
        return hashlib.sha256(b'\n'.join(sorted(data.splitlines()))).hexdigest()

    @classmethod
    def remove_volume(cls, volume, label, run_id):
        info = json.loads(cls.docker.run(['volume', 'inspect', volume]))[0]
        if info.get('Labels', {}).get(label) != run_id:
            raise RuntimeError('Refusing to remove an unowned integration volume')
        cls.docker.run(['volume', 'rm', volume])

    def request(self, session, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', int(session.origin.rsplit(':', 1)[1]), timeout=90)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_real_stack_uses_clone_and_serves_captured_binary(self):
        import app
        before = self.volume_hash(self.baseline['volume'])
        session = app.start_app(self.bundle, self.baseline, self.runner)
        self.addCleanup(session.stop)
        # Register cleanup in this order so containers stop before volume remove.
        info = json.loads(self.docker.run(['volume', 'inspect', session.volume]))[0]
        labels = info.get('Labels') or {}
        owned = [(key, value) for key, value in labels.items() if re.fullmatch(r'bos-app-[0-9a-f]{12}', value or '')]
        self.assertEqual(len(owned), 1)
        self.addCleanup(self.remove_volume, session.volume, *owned[0])
        self.addCleanup(session.stop)
        self.assertNotEqual(session.volume, self.baseline['volume'])
        self.assertEqual(set(session.containers), set(discovery.ROLES))
        anchor = session.containers['db']
        for role, cid in session.containers.items():
            record = json.loads(self.docker.run(['inspect', cid]))[0]
            host = record['HostConfig']
            self.assertEqual(host['NetworkMode'], 'none' if role == 'db' else 'container:' + anchor)
            self.assertFalse(host['PortBindings'])
            self.assertFalse(host['Privileged'])
            self.assertFalse(host['PublishAllPorts'])
            self.assertEqual(record['Image'], self.images[role]['Id'])
            self.assertNotIn('CI_EXTERNAL_SECRET=SYNTHETIC_CAPTURED_SECRET_MUST_NOT_REACH_APP', record['Config']['Env'])
            self.assertFalse(any(m.get('Name') == self.baseline['volume'] for m in record['Mounts']))
        routes = self.docker.run(['exec', anchor, 'cat', '/proc/net/route']).decode().splitlines()
        self.assertEqual(len(routes), 1)
        status, headers, html = self.request(session, 'GET', '/')
        self.assertEqual(status, 200)
        self.assertIn(b'Captured synthetic web', html)
        self.assertIn(b'/__bos_local_guard.js', html)
        self.assertIn("connect-src 'self'", headers['Content-Security-Policy'])
        status, _, body = self.request(session, 'POST', '/functions/v1/mini-app-api',
                                      b'{"action":"bootstrap"}', {'Content-Type': 'application/json'})
        self.assertEqual(status, 200, body[:1024])
        self.assertEqual([row['quantity'] for row in json.loads(body)['orders']], [1, 2, 3])
        status, _, body = self.request(session, 'GET', '/storage/v1/object/public/fixture-bucket/fixture.bin')
        self.assertEqual(status, 200, body[:1024])
        self.assertEqual(body, FIXTURE_BYTES)
        status, _, body = self.request(session, 'POST', '/api/proxy/mini-app-api',
                                      b'{"action":"fixture_write"}', {'Content-Type': 'application/json'})
        self.assertEqual(status, 200, body[:1024])
        self.assertEqual(json.loads(body)['orders'][0]['quantity'], 7)
        status, _, _ = self.request(session, 'POST', '/functions/v1/push-api', b'{}', {'Content-Type': 'application/json'})
        self.assertEqual(status, 501)
        self.assertFalse(session.report['disaster_recovery_ready'])
        session.stop()
        self.assertEqual(self.volume_hash(self.baseline['volume']), before)
        self.assertEqual(self.sql('SELECT json_agg(t ORDER BY id) FROM public.orders t;'), self.source_before)
        self.assertEqual({p.name: backup.hash_file(p) for p in self.bundle.iterdir()}, self.bundle_before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
