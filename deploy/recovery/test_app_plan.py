"""No Docker needed: exercise private plan validation and outbound rewrites."""
import copy
import hashlib
import json
import unittest
from pathlib import PurePosixPath

import app_plan as p
import discovery

SECRET = 'PRIVATE_PRODUCTION_SECRET_NEVER_REUSED'


def fixture():
    roots = ['/capture/' + item for item in ('bundles', 'caddy', 'config', 'main', 'sources', 'storage', 'web')]
    records = {f'root-{i:03d}': {'type': 'directory', 'bytes': 0} for i in range(len(roots))}
    files = {}
    def add(name, value):
        data = value if isinstance(value, bytes) else json.dumps(value).encode()
        files[name] = data
        records[name] = {'type': 'file', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    add('root-003/index.ts', b"const keys = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VK_APP_SECRET','EXTERNAL_KEY'];\n")
    routes = {}
    for role in ('mini-app-api', 'password-session-api'):
        source = 'supabase/functions/' + role + '/index.ts'
        add('root-004/' + role + '/' + source, b'synthetic source')
        add('root-000/' + role + '.eszip', b'synthetic bundle')
        routes[role] = {'entrypoint': source,
            'bundle_sha256': hashlib.sha256(b'synthetic bundle').hexdigest(),
            'source_sha256': {source: hashlib.sha256(b'synthetic source').hexdigest()},
            'import_map': None, 'verify_jwt': False}
    add('root-003/routes.json', routes)
    add('root-003/bos-report-env.json', {'workerKey': SECRET, 'gas': 'https://production.invalid'})
    containers, images = [], []
    for i, role in enumerate(discovery.ROLES, 1):
        image = 'sha256:' + f'{i:064x}'
        images.append({'Id': image, 'Os': 'linux', 'Architecture': 'amd64', 'Size': 1024,
                       'Config': {'Env': ['IMAGE_SECRET=' + SECRET, 'PATH=/unsafe/private/bin']}})
        config = {'Env': ['EXTERNAL_KEY=' + SECRET], 'Entrypoint': [], 'Cmd': []}
        if role in ('rest', 'auth', 'storage'):
            uri_key = {'rest': 'PGRST_DB_URI', 'auth': 'GOTRUE_DB_DATABASE_URL', 'storage': 'DATABASE_URL'}[role]
            config['Env'].append(uri_key + '=postgresql://' + role + '_user:' + SECRET + '@db:5432/' + discovery.DATABASE)
        if role == 'auth':
            config['Cmd'] = ['auth']
            config['Env'].append('GOTRUE_EXTERNAL_GOOGLE_ENABLED=true')
        if role == 'storage':
            config.update(Entrypoint=['docker-entrypoint.sh'], Cmd=['node', 'dist/start/server.js'], WorkingDir='/app')
            config['Env'] += ['STORAGE_BACKEND=file', 'FILE_STORAGE_BACKEND_PATH=/var/lib/storage',
                              'TENANT_ID=stub', 'GLOBAL_S3_BUCKET=stub', 'TUS_USE_FILE_VERSION_SEPARATOR=true']
        mount_pairs = {'edge': [('sources', '/bos-src'), ('bundles', '/bos-bundles'), ('main', '/bos-main')],
                       'https': [('web', '/srv'), ('caddy', '/etc/caddy'), ('config', '/config')],
                       'storage': [('storage', '/var/lib/storage')]}.get(role, [])
        mounts = [{'Source': '/capture/' + name, 'Destination': dest, 'Type': 'bind'} for name, dest in mount_pairs]
        containers.append({'Name': '/' + discovery.PREFIX + '-' + role, 'Id': f'{i:064x}',
                           'Image': image, 'Config': config, 'Mounts': mounts})
    private = {'contains_secrets': True, 'roots': roots, 'containers': containers, 'images': images,
               'database_user': 'supabase_admin', 'database': {'database': discovery.DATABASE,
               'version': 170011, 'bytes': 1024, 'extensions': [['plpgsql', '1.0']]}}
    return {'private': private, 'inventory': records, 'storage_archive_prefix': 'root-005'}, files, add


class PlanTests(unittest.TestCase):
    def setUp(self):
        self.context, self.files, self.add = fixture()

    def plan(self):
        return p.build_plan(self.context, self.files.__getitem__, 'http://127.0.0.1:18701')

    def container(self, role):
        return next(v for v in self.context['private']['containers'] if v['Name'].endswith('-' + role))

    def failure(self, reason):
        with self.assertRaises(p.Stop) as caught:
            self.plan()
        self.assertEqual(caught.exception.reason_code, reason)
        self.assertNotIn(SECRET, str(caught.exception))

    def test_plan_keeps_capture_immutable_and_does_not_claim_app_verified(self):
        before = copy.deepcopy((self.context, self.files))
        result = self.plan()
        self.assertEqual((self.context, self.files), before)
        self.assertEqual(set(result['roles']), {'rest', 'auth', 'storage', 'edge', 'https'})
        self.assertEqual(result['application'], 'NOT_RUN')
        self.assertFalse(result['disaster_recovery_ready'])
        self.assertEqual(result['web_archive_prefix'], 'root-006')
        self.assertEqual(result['gateway_archive_prefix'], 'root-003')
        self.assertEqual(result['roles']['storage']['mounts'][0]['source'], 'root-005')
        self.assertNotIn(SECRET, repr(result))

    def test_fresh_secrets_and_all_service_connections_are_local(self):
        first, second = self.plan(), self.plan()
        self.assertNotEqual(first['secrets']['jwt'], second['secrets']['jwt'])
        self.assertNotEqual(first['db_roles'], second['db_roles'])
        for role, key in [('rest', 'PGRST_DB_URI'), ('auth', 'GOTRUE_DB_DATABASE_URL'), ('storage', 'DATABASE_URL')]:
            uri = first['roles'][role]['env'][key]
            self.assertIn('@127.0.0.1:5432/' + discovery.DATABASE, uri)
            self.assertIn(first['db_roles'][role + '_user'], uri)
        for role in first['roles'].values():
            self.assertEqual(role['env']['IMAGE_SECRET'], '')
            self.assertFalse(role['env'].get('EXTERNAL_KEY'))
            self.assertEqual(role['env']['PATH'], p.SAFE_PATH)
        self.assertEqual(first['roles']['auth']['env']['GOTRUE_EXTERNAL_GOOGLE_ENABLED'], 'false')
        self.assertEqual(first['roles']['storage']['env']['TUS_USE_FILE_VERSION_SEPARATOR'], 'true')
        self.assertEqual(first['roles']['storage']['cmd'], ['/app/dist/start/server.js'])

    def test_gateway_uses_local_public_url_and_no_production_worker_key(self):
        result = self.plan()
        config = json.loads(result['generated_files']['gateway/bos-report-env.json'])
        self.assertEqual(config['public'], 'http://127.0.0.1:18701')
        self.assertEqual(config['internal'], 'http://127.0.0.1:9000')
        self.assertIn('/__bos_blocked/', config['gas'])
        self.assertEqual(config['workerKey'], result['secrets']['worker'])
        caddy = result['generated_files']['caddy/Caddyfile']
        self.assertIn(b'admin off', caddy)
        self.assertIn(b'auto_https off', caddy)
        self.assertNotIn(b'https://', caddy)

    def test_duplicate_unknown_main_json_rejected(self):
        self.add('root-003/private.json', {'secret': SECRET})
        self.failure('APP_GATEWAY_JSON_UNSUPPORTED')

    def test_dynamic_gateway_keys_rejected(self):
        self.add('root-003/index.ts', b'const keys = getKeys();')
        self.failure('APP_GATEWAY_KEYS_UNSUPPORTED')

    def test_injected_route_rejected(self):
        self.add('root-003/routes.json', {'mini-app-api': 'https://evil.invalid', 'password-session-api': 'password-session-api'})
        self.failure('APP_GATEWAY_ROUTE_INVALID')

    def test_duplicate_json_key_rejected(self):
        self.add('root-003/routes.json', b'{"mini-app-api":"mini-app-api","mini-app-api":"mini-app-api"}')
        self.failure('APP_JSON_DUPLICATE_KEY')

    def test_storage_arbitrary_shell_command_is_rejected(self):
        self.container('storage')['Config'].update(Entrypoint=['/bin/sh'], Cmd=['-c', 'node dist/start/server.js'])
        self.failure('APP_STORAGE_COMMAND_UNSUPPORTED')

    def test_auth_arbitrary_shell_command_is_rejected(self):
        self.container('auth')['Config'].update(Entrypoint=['/bin/sh'], Cmd=['-c', 'auth'])
        self.failure('APP_AUTH_COMMAND_UNSUPPORTED')

    def test_database_uri_queries_are_not_carried(self):
        config = self.container('rest')['Config']
        config['Env'] = [v + '?host=production.invalid' if v.startswith('PGRST_DB_URI=') else v for v in config['Env']]
        self.failure('APP_DATABASE_URI_INVALID')

    def test_changed_callback_bytes_rejected(self):
        self.files['root-003/index.ts'] += b'change'
        self.failure('APP_CAPTURE_FILE_CHANGED')

    def test_public_origin_rejected(self):
        with self.assertRaises(p.Stop) as caught:
            p.build_plan(self.context, self.files.__getitem__, 'https://production.invalid')
        self.assertEqual(caught.exception.reason_code, 'APP_ORIGIN_INVALID')

    def test_unknown_source_mount_is_rejected(self):
        self.container('edge')['Mounts'][0]['Source'] = '/outside/private'
        self.failure('APP_MOUNT_ROOT_NOT_UNIQUE')

    def test_missing_route_bundle_fails_preflight(self):
        del self.context['inventory']['root-000/mini-app-api.eszip']
        self.failure('APP_ROUTE_PAYLOAD_MISSING')

    def test_route_hash_mismatch_fails_preflight(self):
        self.context['inventory']['root-000/mini-app-api.eszip']['sha256'] = 'f' * 64
        self.failure('APP_ROUTE_PAYLOAD_HASH_MISMATCH')

    def test_same_login_user_gets_one_shared_password(self):
        self.container('storage')['Config']['Env'] = [v.replace('storage_user:', 'rest_user:') for v in self.container('storage')['Config']['Env']]
        result = self.plan()
        self.assertEqual(set(result['db_roles']), {'rest_user', 'auth_user'})
        self.assertEqual(result['roles']['storage']['env']['DATABASE_URL'], result['roles']['rest']['env']['PGRST_DB_URI'])


if __name__ == '__main__':
    unittest.main()
