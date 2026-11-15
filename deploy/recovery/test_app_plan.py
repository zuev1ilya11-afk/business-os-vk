"""No Docker needed: exercise private plan validation and outbound rewrites."""
import copy
import hashlib
import json
import unittest
from pathlib import PurePosixPath

import app_plan as p
import discovery

SECRET = 'PRIVATE_PRODUCTION_SECRET_NEVER_REUSED'

# Sanitized path/type shapes observed in the 2026-11-15 operator diagnostic.
# All file bodies and digests below are generated synthetic test data.
OBSERVED_ROUTES = (
    ('agent-business-api', 'index.ts', None, True, ('index.ts',)),
    ('agent-core', 'index.ts', None, True, ('index.ts',)),
    ('agent-dispatch-api', 'index.ts', None, True, ('index.ts',)),
    ('agent-link-self', 'index.ts', None, True, ('index.ts',)),
    ('agent-runtime', 'index.ts', None, True, ('index.ts',)),
    ('archive-order-2-once', 'index.ts', None, False, ('index.ts',)),
    ('avito-api', 'index.ts', None, False, ('index.ts',)),
    ('avito-assistant-api', 'functions/avito-assistant-api/index.ts', None, False, ('functions/_shared/avito-price-catalog.json', 'functions/avito-assistant-api/core.ts', 'functions/avito-assistant-api/index.ts')),
    ('bos-api', 'supabase/functions/bos-api/index.ts', 'supabase/functions/bos-api/deno.json', False, ('lib/security.ts', 'lib/validation.ts', 'supabase/functions/bos-api/deno.json', 'supabase/functions/bos-api/index.ts')),
    ('business-os-api', 'index.ts', None, False, ('index.ts',)),
    ('claims-api', 'supabase/functions/claims-api/index.ts', None, False, ('order-payroll.js', 'supabase/functions/claims-api/index.ts')),
    ('drive-archive-api', 'index.ts', None, False, ('index.ts',)),
    ('e2e-create-staff-order-once', 'index.ts', None, False, ('index.ts',)),
    ('employee-meta-api', 'index.ts', None, False, ('index.ts',)),
    ('gas-bridge-health', 'index.ts', None, False, ('index.ts',)),
    ('hands-api', 'index.ts', None, False, ('hands-details.ts', 'index.ts')),
    ('hands-report-api', 'index.ts', 'deno.json', False, ('deno.json', 'index.ts')),
    ('integration-api', 'supabase/functions/integration-api/index.ts', None, False, ('order-payroll.js', 'supabase/functions/integration-api/index.ts')),
    ('master-memo-api', 'index.ts', None, False, ('index.ts',)),
    ('master-workflow-api', 'supabase/functions/master-workflow-api/index.ts', None, False, ('order-payroll.js', 'supabase/functions/master-workflow-api/index.ts')),
    ('mini-app-api', 'supabase/functions/mini-app-api/index.ts', None, False, ('finance-expenses.js', 'order-payroll.js', 'supabase/functions/_shared/hands-details.ts', 'supabase/functions/mini-app-api/index.ts')),
    ('order-lifecycle-api', 'supabase/functions/order-lifecycle-api/index.ts', None, False, ('order-payroll.js', 'report-deduction.js', 'service-catalog.js', 'supabase/functions/_shared/hands-details.ts', 'supabase/functions/order-lifecycle-api/index.ts')),
    ('order-meta-api', 'index.ts', None, False, ('index.ts',)),
    ('password-session-api', 'index.ts', None, False, ('index.ts',)),
    ('profile-self-api', 'supabase/functions/profile-self-api/index.ts', None, False, ('order-payroll.js', 'supabase/functions/profile-self-api/index.ts')),
    ('push-api', 'index.ts', 'deno.json', False, ('deno.json', 'index.ts')),
    ('report-api', 'supabase/functions/report-api/index.ts', None, False, ('order-payroll.js', 'report-deduction.js', 'service-catalog.js', 'supabase/functions/report-api/index.ts')),
    ('report-file-upload', 'index.ts', None, False, ('index.ts',)),
    ('report-upload-gateway', 'index.ts', None, False, ('index.ts',)),
    ('sheets-sync-api', 'index.ts', None, False, ('index.ts',)),
    ('staff-admin-api', 'index.ts', None, False, ('index.ts',)),
    ('staff-invite-api', 'index.ts', None, False, ('index.ts',)),
    ('test-pin-session', 'index.ts', None, False, ('index.ts',)),
    ('vk-auth', 'index.ts', None, True, ('index.ts',)),
    ('vk-session-api', 'index.ts', None, False, ('index.ts',)),
)



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
    add('root-003/bos-report-env.json', {'public': 'https://homemaster.qd.je',
                                      'workerKey': SECRET, 'gas': 'https://production.invalid'})
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

    def test_gateway_preserves_captured_public_contract_and_uses_fresh_worker_key(self):
        result = self.plan()
        config = json.loads(result['generated_files']['gateway/bos-report-env.json'])
        self.assertEqual(config['public'], 'https://homemaster.qd.je')
        self.assertEqual(result['logical_public_origin'], config['public'])
        self.assertIn(config['public'], result['source_origins'])
        self.assertEqual(result['roles']['auth']['env']['GOTRUE_SITE_URL'], 'http://127.0.0.1:18701')
        self.assertEqual(result['roles']['edge']['env']['SUPABASE_URL'], 'http://127.0.0.1:9000')
        self.assertEqual(config['internal'], 'http://127.0.0.1:9000')
        self.assertIn('/__bos_blocked/', config['gas'])
        self.assertEqual(config['workerKey'], result['secrets']['worker'])
        caddy = result['generated_files']['caddy/Caddyfile']
        self.assertIn(b'admin off', caddy)
        self.assertIn(b'auto_https off', caddy)
        self.assertNotIn(b'https://', caddy)

    def test_public_origin_is_preserved_exactly_without_reusing_private_config(self):
        self.add('root-003/bos-report-env.json', {'public': 'https://reports.example.test:8443',
            'internal': 'https://production.invalid', 'workerKey': SECRET, 'gas': SECRET,
            'legacy': '', 'unrelated_secret': SECRET})
        result = self.plan()
        config = json.loads(result['generated_files']['gateway/bos-report-env.json'])
        self.assertEqual(config['public'], 'https://reports.example.test:8443')
        self.assertEqual(result['logical_public_origin'], config['public'])
        self.assertEqual(config['internal'], 'http://127.0.0.1:9000')
        self.assertEqual(config['gas'], 'http://127.0.0.1:18080/__bos_blocked/gas')
        self.assertNotIn(SECRET, repr(result))

    def test_gateway_rejects_invalid_or_missing_public_origin(self):
        values = (None, '', 1, [], 'http://homemaster.qd.je',
            'https://user:secret@homemaster.qd.je', 'https://homemaster.qd.je/',
            'https://homemaster.qd.je/path', 'https://homemaster.qd.je?secret',
            'https://homemaster.qd.je?', 'https://homemaster.qd.je#fragment',
            'https://homemaster.qd.je:65536', 'https://homemaster.qd.je:bad', 'https://homemaster.qd.je:',
            'https://homemaster.qd.je\\@other.test', 'https://home master.qd.je',
            'https://homemaster.qd.je\n', 'https://home%40master.qd.je',
            'https://home..test', 'https://-home.test')
        for value in values:
            with self.subTest(public=value):
                self.add('root-003/bos-report-env.json', {'public': value})
                self.failure('APP_GATEWAY_PUBLIC_ORIGIN_INVALID')
        self.add('root-003/bos-report-env.json', {'workerKey': SECRET})
        self.failure('APP_GATEWAY_PUBLIC_ORIGIN_INVALID')

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

    def test_auth_search_path_is_scoped_to_its_connection_without_extra_privileges(self):
        from urllib.parse import parse_qs, urlsplit
        roles = self.plan()['roles']
        auth = roles['auth']['env']
        self.assertEqual(auth['DATABASE_URL'], auth['GOTRUE_DB_DATABASE_URL'])
        self.assertEqual(parse_qs(urlsplit(auth['DATABASE_URL']).query), {'search_path': ['"auth"']})
        for key in ('GOTRUE_DB_NAMESPACE', 'GOTRUE_DB_DB_NAMESPACE', 'DB_NAMESPACE'):
            self.assertEqual(auth[key], 'auth')
        self.assertEqual(urlsplit(roles['rest']['env']['PGRST_DB_URI']).query, '')
        self.assertEqual(urlsplit(roles['storage']['env']['DATABASE_URL']).query, '')

    def test_auth_custom_schema_is_quoted_and_alias_conflicts_are_refused(self):
        from urllib.parse import parse_qs, urlsplit
        config = self.container('auth')['Config']
        config['Env'].append('DB_NAMESPACE=AuthCustom')
        auth = self.plan()['roles']['auth']['env']
        self.assertEqual(parse_qs(urlsplit(auth['DATABASE_URL']).query), {'search_path': ['"AuthCustom"']})
        config['Env'].append('GOTRUE_DB_DB_NAMESPACE=other')
        self.failure('APP_AUTH_NAMESPACE_CONFLICT')

    def test_auth_namespace_cannot_inject_a_second_schema_or_pg_option(self):
        for value in ('auth,public', 'auth;SELECT', 'auth"', 'auth&host=production'):
            with self.subTest(value=value), self.assertRaises(p.Stop):
                p.auth_database_uri('postgresql://user:local@127.0.0.1:5432/db', value)

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

    def test_stale_release_hash_metadata_is_preserved_not_used_as_capture_baseline(self):
        routes = json.loads(self.files['root-003/routes.json'])
        routes['mini-app-api']['bundle_sha256'] = 'f' * 64
        entry = routes['mini-app-api']['entrypoint']
        routes['mini-app-api']['source_sha256'][entry] = 'e' * 64
        self.add('root-003/routes.json', routes)
        inventory = copy.deepcopy(self.context['inventory'])
        result = self.plan()
        self.assertEqual(json.loads(result['generated_files']['gateway/routes.json']), routes)
        self.assertEqual(self.context['inventory'], inventory)
        self.assertNotEqual(inventory['root-000/mini-app-api.eszip']['sha256'], 'f' * 64)
        self.assertNotEqual(inventory['root-004/mini-app-api/' + entry]['sha256'], 'e' * 64)
        # Historical metadata does not make a missing actual payload acceptable.
        del self.context['inventory']['root-000/mini-app-api.eszip']
        self.failure('APP_ROUTE_PAYLOAD_MISSING')

    def test_route_hash_format_and_structural_guards_stay_strict(self):
        baseline = json.loads(self.files['root-003/routes.json'])
        cases = [('bundle_sha256', 'not-a-digest'), ('verify_jwt', 'false'),
                 ('entrypoint', '/outside/index.ts'), ('import_map', 'https://outside.invalid/map.json'),
                 ('source_sha256', []), ('unexpected_field', True)]
        for field, value in cases:
            with self.subTest(field=field):
                routes = copy.deepcopy(baseline)
                routes['mini-app-api'][field] = value
                self.add('root-003/routes.json', routes)
                with self.assertRaises(p.Stop):
                    self.plan()

    def test_explicit_root_entrypoint_does_not_fall_back_to_nested_source(self):
        routes = json.loads(self.files['root-003/routes.json'])
        route = routes['mini-app-api']
        route['entrypoint'] = 'index.ts'
        route['source_sha256'] = {'index.ts': 'e' * 64}
        self.add('root-003/routes.json', routes)
        # The old nested source is present, but the actual root entry is not.
        self.failure('APP_ROUTE_PAYLOAD_MISSING')
        self.add('root-004/mini-app-api/index.ts', b'synthetic root source')
        result = self.plan()
        self.assertEqual(json.loads(result['generated_files']['gateway/routes.json']), routes)

    def install_observed_routes(self):
        # Remove the two old fixture source layouts, so a mistaken canonical
        # lookup cannot pass because a second copy happens to be present.
        for name in list(self.context['inventory']):
            if name.startswith(('root-004/', 'root-000/')):
                del self.context['inventory'][name]
                self.files.pop(name, None)
        routes = {}
        for slug, entry, import_map, verify_jwt, sources in OBSERVED_ROUTES:
            for source in sources:
                content = b'{"imports":{}}' if source.endswith('/deno.json') or source == 'deno.json' else b'// synthetic source'
                self.add('root-004/' + slug + '/' + source, content)
            self.add('root-000/' + slug + '.eszip', b'synthetic bundle ' + slug.encode())
            routes[slug] = {'entrypoint': entry, 'import_map': import_map, 'verify_jwt': verify_jwt,
                'bundle_sha256': 'f' * 64, 'source_sha256': {source: 'e' * 64 for source in sources}}
        self.add('root-003/routes.json', routes)
        return routes

    def test_all_35_observed_route_shapes_preserve_metadata_and_verified_inputs(self):
        routes = self.install_observed_routes()
        before = copy.deepcopy((self.context, self.files))
        self.assertEqual(len(routes), 35)
        self.assertEqual(sum(r['entrypoint'] == 'index.ts' for r in routes.values()), 26)
        self.assertEqual(sum(r['entrypoint'].startswith('functions/') for r in routes.values()), 1)
        self.assertEqual(sum(r['entrypoint'].startswith('supabase/functions/') for r in routes.values()), 8)
        self.assertEqual(sum(r['import_map'] is not None for r in routes.values()), 3)
        result = self.plan()
        self.assertEqual(json.loads(result['generated_files']['gateway/routes.json']), routes)
        self.assertEqual((self.context, self.files), before)

    def test_observed_import_map_must_exist_and_match_verified_inventory(self):
        self.install_observed_routes()
        name = 'root-004/push-api/deno.json'
        self.files[name] += b'altered'
        self.failure('APP_CAPTURE_FILE_CHANGED')
        self.install_observed_routes()
        del self.context['inventory'][name]
        self.failure('APP_CAPTURE_FILE_REQUIRED')

    def test_import_map_must_be_declared_in_same_route_source_metadata(self):
        routes = self.install_observed_routes()
        del routes['push-api']['source_sha256']['deno.json']
        self.add('root-003/routes.json', routes)
        self.failure('APP_GATEWAY_IMPORT_MAP_INVALID')

    def test_import_map_must_be_adjacent_local_deno_file(self):
        baseline = self.install_observed_routes()
        for value in ('../deno.json', '/deno.json', './deno.json', 'https://outside.invalid/deno.json',
                      'file:///deno.json', 'supabase/functions/other-api/deno.json', 'config.json'):
            with self.subTest(value=value):
                routes = copy.deepcopy(baseline)
                routes['push-api']['import_map'] = value
                routes['push-api']['source_sha256'][value] = 'e' * 64
                self.add('root-003/routes.json', routes)
                self.failure('APP_GATEWAY_IMPORT_MAP_INVALID')

    def test_entrypoint_stays_inside_exact_observed_route_layouts(self):
        baseline = self.install_observed_routes()
        for value in ('../index.ts', '/index.ts', './index.ts', 'functions/other-api/index.ts',
                      'supabase/functions/other-api/index.ts', 'https://outside.invalid/index.ts',
                      'file:///index.ts', 'functions/push-api/../index.ts', 'index.ts?x', 'nested/index.ts'):
            with self.subTest(value=value):
                routes = copy.deepcopy(baseline)
                routes['push-api']['entrypoint'] = value
                routes['push-api']['source_sha256'][value] = 'e' * 64
                self.add('root-003/routes.json', routes)
                self.failure('APP_GATEWAY_ROUTE_INVALID')

    def test_same_login_user_gets_one_shared_password(self):
        self.container('storage')['Config']['Env'] = [v.replace('storage_user:', 'rest_user:') for v in self.container('storage')['Config']['Env']]
        result = self.plan()
        self.assertEqual(set(result['db_roles']), {'rest_user', 'auth_user'})
        self.assertEqual(result['roles']['storage']['env']['DATABASE_URL'], result['roles']['rest']['env']['PGRST_DB_URI'])


if __name__ == '__main__':
    unittest.main()
