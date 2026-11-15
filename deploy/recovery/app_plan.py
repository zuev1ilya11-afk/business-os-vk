"""Construct a private, offline app plan from an already validated capture.

This module performs no Docker or filesystem mutations.  All returned credentials,
paths and source bytes are private orchestration data, never a public report.
"""
import base64
import hashlib
import hmac
import json
from pathlib import PurePosixPath
import re
import secrets
import time
from urllib.parse import quote, unquote, urlsplit

import drill_files

PORTS = {'rest': 3000, 'auth': 9999, 'storage': 5000, 'edge': 9000, 'https': 18080}
ALIASES = {'bos-release-probe-' + role: '127.0.0.1' for role in ('rest', 'auth', 'storage')}
SAFE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
ENV_KEY = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
IDENT = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,62}')
SLUG = re.compile(r'[a-z][a-z0-9-]{0,79}')
DIGEST = re.compile(r'[0-9a-f]{64}')


class Stop(Exception):
    def __init__(self, reason_code):
        self.reason_code = reason_code
        super().__init__(reason_code)


def require(condition, reason):
    if not condition:
        raise Stop(reason)


def environment(config):
    values = config.get('Env') or []
    require(isinstance(values, list) and len(values) <= 2048, 'APP_ENV_INVALID')
    result = {}
    for item in values:
        require(isinstance(item, str) and '=' in item and '\x00' not in item, 'APP_ENV_INVALID')
        key, value = item.split('=', 1)
        require(ENV_KEY.fullmatch(key) is not None and key not in result, 'APP_ENV_INVALID')
        result[key] = value
    return result


def path(value, absolute=True):
    require(isinstance(value, str) and 0 < len(value) <= 4096 and '\x00' not in value
            and '\\' not in value and '\n' not in value and '\r' not in value,
            'APP_PATH_INVALID')
    result = PurePosixPath(value)
    require(result.is_absolute() == absolute and '..' not in result.parts
            and str(result) == value and value != '/', 'APP_PATH_INVALID')
    return result


def archive_path(source, roots):
    source = path(source)
    matches = [(i, root) for i, root in enumerate(roots)
               if source == root or root in source.parents]
    require(len(matches) == 1, 'APP_MOUNT_ROOT_NOT_UNIQUE')
    index, root = matches[0]
    return str(PurePosixPath(f'root-{index:03d}') / source.relative_to(root))


def read_checked(context, read_file, name, limit=4 * 1024 * 1024):
    path(name, False)
    record = context['inventory'].get(name)
    require(isinstance(record, dict) and record.get('type') == 'file'
            and type(record.get('bytes')) is int and 0 <= record['bytes'] <= limit,
            'APP_CAPTURE_FILE_REQUIRED')
    try:
        data = read_file(name)
    except Exception:
        raise Stop('APP_CAPTURE_READ_FAILED') from None
    require(isinstance(data, bytes) and len(data) == record['bytes']
            and hashlib.sha256(data).hexdigest() == record.get('sha256'),
            'APP_CAPTURE_FILE_CHANGED')
    return data


def json_bytes(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=True).encode()


def json_read(data):
    def unique(pairs):
        value = {}
        for key, child in pairs:
            require(key not in value, 'APP_JSON_DUPLICATE_KEY')
            value[key] = child
        return value
    try:
        return json.loads(data, object_pairs_hook=unique)
    except (ValueError, UnicodeError):
        raise Stop('APP_JSON_INVALID') from None


def jwt(role, secret):
    encode = lambda item: base64.urlsafe_b64encode(json_bytes(item)).rstrip(b'=').decode()
    message = encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode({
        'role': role, 'iss': 'supabase', 'iat': int(time.time()), 'exp': int(time.time()) + 86400})
    signature = hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()
    return message + '.' + base64.urlsafe_b64encode(signature).rstrip(b'=').decode()


def gateway_public_origin(config):
    """Retain the captured gateway's public URL contract without contacting it.

    The installed report helper validates this value at module import. Its
    origin is metadata; the isolated browser maps requests to the local portal.
    Credentials, upstream services and external integration URLs stay fresh
    or local and are never copied from this configuration.
    """
    require(isinstance(config, dict), 'APP_GATEWAY_PUBLIC_ORIGIN_INVALID')
    value = config.get('public')
    require(isinstance(value, str) and 0 < len(value) <= 2048
            and all(33 <= ord(char) <= 126 for char in value) and '\\' not in value,
            'APP_GATEWAY_PUBLIC_ORIGIN_INVALID')
    try:
        parsed = urlsplit(value)
        port = parsed.port
        require(parsed.scheme == 'https' and parsed.hostname
                and parsed.username is None and parsed.password is None
                and not parsed.path and not parsed.query and not parsed.fragment
                and value == 'https://' + parsed.netloc and not parsed.netloc.endswith(':')
                and re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?', parsed.hostname)
                and all(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', label)
                        for label in parsed.hostname.split('.'))
                and (port is None or 1 <= port <= 65535),
                'APP_GATEWAY_PUBLIC_ORIGIN_INVALID')
    except ValueError:
        raise Stop('APP_GATEWAY_PUBLIC_ORIGIN_INVALID') from None
    return value


def gateway(context, read_file, prefix, origin, secret):
    try:
        main = read_checked(context, read_file, prefix + '/index.ts').decode('utf-8')
    except UnicodeError:
        raise Stop('APP_GATEWAY_SOURCE_ENCODING') from None
    lists = re.findall(r'\bconst\s+keys\s*=\s*(\[[^\]]*\])\s*;', main)
    require(len(lists) == 1, 'APP_GATEWAY_KEYS_UNSUPPORTED')
    keys = []
    for token in lists[0][1:-1].split(','):
        if not token.strip():
            continue
        match = re.fullmatch(r'''\s*['"]([A-Z][A-Z0-9_]*)['"]\s*''', token)
        require(match is not None and match[1] not in keys, 'APP_GATEWAY_KEYS_UNSUPPORTED')
        keys.append(match[1])
    require({'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VK_APP_SECRET'} <= set(keys),
            'APP_GATEWAY_REQUIRED_KEYS')
    allowed = {prefix + '/routes.json', prefix + '/bos-report-env.json'}
    found = {name for name in context['inventory'] if name.startswith(prefix + '/') and name.endswith('.json')}
    require(found == allowed, 'APP_GATEWAY_JSON_UNSUPPORTED')
    routes = json_read(read_checked(context, read_file, prefix + '/routes.json'))
    require(isinstance(routes, dict) and 1 <= len(routes) <= 256
            and {'mini-app-api', 'password-session-api'} <= set(routes), 'APP_GATEWAY_ROUTES_REQUIRED')
    for slug, item in routes.items():
        require(isinstance(slug, str) and SLUG.fullmatch(slug) is not None, 'APP_GATEWAY_ROUTE_INVALID')
        entry = 'supabase/functions/' + slug + '/index.ts'
        if isinstance(item, str):
            require(item in (slug, entry, '/bos-src/' + slug + '/' + entry,
                             '/bos-bundles/' + slug + '.eszip'), 'APP_GATEWAY_ROUTE_INVALID')
        else:
            require(isinstance(item, dict) and set(item) == {
                'bundle_sha256', 'entrypoint', 'import_map', 'source_sha256', 'verify_jwt'},
                'APP_GATEWAY_ROUTE_INVALID')
            # These three layouts are present in the operator's verified
            # capture diagnostic. Resolve inside this route's own source root;
            # do not infer a nested path when a route explicitly names index.ts.
            entry = item['entrypoint']
            allowed_entries = {'index.ts', 'functions/' + slug + '/index.ts',
                               'supabase/functions/' + slug + '/index.ts'}
            require(isinstance(entry, str) and entry in allowed_entries
                    and type(item['verify_jwt']) is bool and isinstance(item['bundle_sha256'], str)
                    and DIGEST.fullmatch(item['bundle_sha256']) is not None, 'APP_GATEWAY_ROUTE_INVALID')
            import_map = item['import_map']
            require(import_map is None or (isinstance(import_map, str)
                    and import_map == str(PurePosixPath(entry).with_name('deno.json'))),
                    'APP_GATEWAY_IMPORT_MAP_INVALID')
            sources = item['source_sha256']
            require(isinstance(sources, dict) and entry in sources and 1 <= len(sources) <= 10000,
                    'APP_GATEWAY_SOURCE_HASH_INVALID')
            require(import_map is None or import_map in sources, 'APP_GATEWAY_IMPORT_MAP_INVALID')
            for source, digest in sources.items():
                path(source, False)
                require(isinstance(digest, str) and DIGEST.fullmatch(digest) is not None,
                        'APP_GATEWAY_SOURCE_HASH_INVALID')
    # A local worker endpoint deliberately has no handler; no production GAS URL/key is reused.
    captured_config = json_read(read_checked(context, read_file, prefix + '/bos-report-env.json'))
    public_origin = gateway_public_origin(captured_config)
    generated = {'gateway/routes.json': json_bytes(routes), 'gateway/bos-report-env.json': json_bytes({
        'version': 1, 'internal': 'http://127.0.0.1:9000', 'public': public_origin,
        'legacy': '', 'workerKey': secret, 'gas': 'http://127.0.0.1:18080/__bos_blocked/gas'})}
    return keys, generated


def executable(role, config):
    entry, cmd = config.get('Entrypoint') or [], config.get('Cmd') or []
    require(isinstance(entry, list) and isinstance(cmd, list)
            and all(isinstance(v, str) and '\x00' not in v for v in [*entry, *cmd]),
            'APP_COMMAND_INVALID')
    actual = [*entry, *cmd]
    if role == 'auth':
        require(len(actual) == 1 and actual[0] in ('auth', 'gotrue', '/usr/local/bin/auth', '/usr/local/bin/gotrue'),
                'APP_AUTH_COMMAND_UNSUPPORTED')
        return actual[0], []
    if role == 'storage':
        # Official Node entrypoint only dispatches the supplied executable. Bypass it.
        if actual and actual[0] in ('docker-entrypoint.sh', '/usr/local/bin/docker-entrypoint.sh'):
            actual = actual[1:]
        require(len(actual) == 2 and actual[0] in ('node', '/usr/local/bin/node')
                and actual[1] in ('dist/server.js', 'dist/start/server.js',
                                  '/app/dist/server.js', '/app/dist/start/server.js'),
                'APP_STORAGE_COMMAND_UNSUPPORTED')
        require(config.get('WorkingDir', '/app') in ('', '/', '/app')
                and (actual[1].startswith('/') or config.get('WorkingDir') == '/app'),
                'APP_STORAGE_WORKDIR_UNSUPPORTED')
        return actual[0], [actual[1] if actual[1].startswith('/') else '/app/' + actual[1]]
    return {'rest': 'postgrest', 'edge': 'edge-runtime', 'https': 'caddy'}[role], {
        'rest': [], 'edge': ['start', '--main-service', '/bos-main'],
        'https': ['run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']}[role]


def database_user(uri, database):
    require(isinstance(uri, str), 'APP_DATABASE_URI_INVALID')
    try:
        value = urlsplit(uri)
        username = unquote(value.username or '')
        require(value.scheme in ('postgres', 'postgresql') and value.hostname and value.port in (None, 5432)
                and unquote(value.path) == '/' + database and not value.query and not value.fragment
                and IDENT.fullmatch(username) is not None, 'APP_DATABASE_URI_INVALID')
    except ValueError:
        raise Stop('APP_DATABASE_URI_INVALID') from None
    return username


def structural(source, key, default, kind='ident'):
    value = source.get(key, default)
    require(isinstance(value, str), 'APP_STRUCTURAL_ENV_INVALID')
    patterns = {'ident': r'[A-Za-z_][A-Za-z0-9_]{0,62}',
                'schemas': r'[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*',
                'segment': r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}',
                'bool': r'true|false', 'int': r'[0-9]{1,10}'}
    require(re.fullmatch(patterns[kind], value) is not None, 'APP_STRUCTURAL_ENV_INVALID')
    return value


def auth_namespace(source):
    keys = ('GOTRUE_DB_DB_NAMESPACE', 'GOTRUE_DB_NAMESPACE', 'DB_NAMESPACE')
    values = [structural(source, key, 'auth') for key in keys if source.get(key)]
    require(len(set(values)) <= 1, 'APP_AUTH_NAMESPACE_CONFLICT')
    return values[0] if values else 'auth'


def auth_database_uri(uri, namespace):
    # Auth's migration ledger is unqualified. Its namespace setting does not
    # establish PostgreSQL search_path; the production role normally does.
    # Set it only for these connections, never on a possibly shared DB role.
    require(IDENT.fullmatch(namespace) is not None, 'APP_STRUCTURAL_ENV_INVALID')
    require(not urlsplit(uri).query and not urlsplit(uri).fragment, 'APP_DATABASE_URI_INVALID')
    return uri + '?search_path=' + quote('"' + namespace + '"', safe='')


CADDY = b'''{
    admin off
    auto_https off
}
http://127.0.0.1:18080 {
    bind 127.0.0.1
    header Cache-Control "no-store"
    header X-Content-Type-Options "nosniff"
    handle /__bos_blocked/* { 
        respond "External integrations disabled in restore test" 503
    }
    handle /api/gas-report* {
        respond "External integrations disabled in restore test" 503
    }
    handle_path /api/proxy/* {
        rewrite * /functions/v1{path}
        reverse_proxy 127.0.0.1:9000
    }
    handle /functions/v1/* {
        reverse_proxy 127.0.0.1:9000
    }
    handle_path /storage/v1/* {
        reverse_proxy 127.0.0.1:5000
    }
    handle_path /rest/v1/* {
        reverse_proxy 127.0.0.1:3000
    }
    handle_path /auth/v1/* {
        reverse_proxy 127.0.0.1:9999
    }
    handle {
        root * /srv
        file_server
    }
}
'''


def build_plan(context, read_file, origin):
    """Return roles, mapped mounts and generated config; never run the app here."""
    require(isinstance(context, dict) and isinstance(context.get('private'), dict), 'APP_CONTEXT_INVALID')
    try:
        by_role, roots, images = drill_files._private_layout(context['private'])
    except drill_files.Stop as exc:
        raise Stop(exc.reason_code) from None
    try:
        parsed = urlsplit(origin)
        require(parsed.scheme == 'http' and parsed.hostname == '127.0.0.1' and parsed.port
                and origin == 'http://127.0.0.1:' + str(parsed.port)
                and 1024 <= parsed.port <= 65535, 'APP_ORIGIN_INVALID')
    except (TypeError, ValueError):
        raise Stop('APP_ORIGIN_INVALID') from None
    require(isinstance(context.get('inventory'), dict), 'APP_CONTEXT_INVALID')
    envs = {role: environment(value['Config']) for role, value in by_role.items()}
    mounts = {}
    expected = {'https': ('/srv', '/etc/caddy', '/config'), 'edge': ('/bos-src', '/bos-bundles', '/bos-main')}
    prefixes = {}
    for role, targets in expected.items():
        for target in targets:
            found = [m for m in by_role[role]['Mounts'] if m.get('Destination') == target]
            require(len(found) == 1 and found[0].get('Type') in ('bind', 'volume'), 'APP_REQUIRED_MOUNT_MISSING')
            prefix = archive_path(found[0].get('Source'), roots)
            require(context['inventory'].get(prefix) == {'type': 'directory', 'bytes': 0},
                    'APP_MOUNT_DIRECTORY_MISSING')
            prefixes[(role, target)] = prefix
    try:
        storage_prefix = drill_files._storage_prefix(by_role['storage'], roots, context['inventory'])
    except drill_files.Stop as exc:
        raise Stop(exc.reason_code) from None
    secret = {'jwt': secrets.token_urlsafe(48), 'vk': secrets.token_urlsafe(48), 'worker': secrets.token_urlsafe(48)}
    secret.update(anon=jwt('anon', secret['jwt']), service=jwt('service_role', secret['jwt']))
    keys, generated = gateway(context, read_file, prefixes[('edge', '/bos-main')], origin, secret['worker'])
    # Only image ENV is inherited by a new container. Omit unapproved source
    # keys entirely instead of injecting empty strings into typed service flags.
    captured_gateway = json_read(read_checked(context, read_file,
        prefixes[('edge', '/bos-main')] + '/bos-report-env.json'))
    source_origins = set()
    if isinstance(captured_gateway, dict):
        for key in ('public', 'legacy'):
            value = captured_gateway.get(key)
            if not isinstance(value, str) or not value:
                continue
            try:
                parsed_source = urlsplit(value)
                if (parsed_source.scheme in ('http', 'https') and parsed_source.hostname
                        and not parsed_source.username and not parsed_source.password
                        and not parsed_source.query and not parsed_source.fragment):
                    source_origins.add(parsed_source.scheme + '://' + parsed_source.netloc)
            except ValueError:
                raise Stop('APP_CAPTURED_ORIGIN_INVALID') from None
    route_map = json_read(generated['gateway/routes.json'])
    for slug, route in route_map.items():
        source_root = prefixes[('edge', '/bos-src')] + '/' + slug + '/'
        entry = route['entrypoint'] if isinstance(route, dict) else 'supabase/functions/' + slug + '/index.ts'
        source_name = source_root + entry
        bundle_name = prefixes[('edge', '/bos-bundles')] + '/' + slug + '.eszip'
        source_record, bundle_record = context['inventory'].get(source_name), context['inventory'].get(bundle_name)
        require(isinstance(source_record, dict) and source_record.get('type') == 'file'
                and isinstance(bundle_record, dict) and bundle_record.get('type') == 'file'
                and bundle_record.get('bytes', 0) > 0, 'APP_ROUTE_PAYLOAD_MISSING')
        if isinstance(route, dict) and route['import_map'] is not None:
            # The manifest/inventory, not stale route hashes, authenticates the
            # copied local import map. Its path is adjacent to the entrypoint
            # and must already be declared in this route's source metadata.
            read_checked(context, read_file, source_root + route['import_map'])
        # These route hashes are historical release metadata, not the capture
        # integrity baseline. The successful server release documented stale
        # values after source/bundle updates (deploy/finance-export/README.md,
        # "Формат маршрута, подтверждённый на сервере"). Preserve them verbatim;
        # validate_bundle already verifies the actual payload and tar members
        # against the captured manifest/inventory before this planner is called.
    generated['caddy/Caddyfile'] = CADDY
    database = context['private']['database']['database']
    users = {role: database_user(envs[role].get(key), database) for role, key in (
        ('rest', 'PGRST_DB_URI'), ('auth', 'GOTRUE_DB_DATABASE_URL'), ('storage', 'DATABASE_URL'))}
    passwords = {user: secrets.token_urlsafe(36) for user in set(users.values())}
    uris = {role: 'postgresql://' + quote(user, safe='') + ':' + passwords[user]
            + '@127.0.0.1:5432/' + quote(database, safe='') for role, user in users.items()}
    output = {}
    for role in ('rest', 'auth', 'storage', 'edge', 'https'):
        config = by_role[role]['Config']
        # Docker retains image ENV unless explicitly overridden. Keep no opaque captured values.
        inherited = environment(images[by_role[role]['Image']].get('Config') or {})
        old = {**inherited, **envs[role]}
        env = {key: '' for key in inherited}
        env.update(PATH=SAFE_PATH, TZ='UTC', LANG='C.UTF-8', LC_ALL='C.UTF-8')
        entrypoint, cmd = executable(role, config)
        if role == 'rest':
            env.update(PGRST_DB_URI=uris[role], PGRST_JWT_SECRET=secret['jwt'],
                PGRST_DB_ANON_ROLE=structural(old, 'PGRST_DB_ANON_ROLE', 'anon'),
                PGRST_DB_SCHEMAS=structural(old, 'PGRST_DB_SCHEMAS', 'public', 'schemas'),
                PGRST_DB_EXTRA_SEARCH_PATH=structural(old, 'PGRST_DB_EXTRA_SEARCH_PATH', 'public,extensions', 'schemas'),
                PGRST_DB_CONFIG='false', PGRST_DB_CHANNEL_ENABLED='false', PGRST_DB_POOL='5',
                PGRST_SERVER_HOST='127.0.0.1', PGRST_SERVER_PORT='3000', PGRST_LOG_LEVEL='error')
        elif role == 'auth':
            namespace = auth_namespace(old)
            auth_uri = auth_database_uri(uris[role], namespace)
            env.update(GOTRUE_DB_DATABASE_URL=auth_uri, DATABASE_URL=auth_uri, GOTRUE_DB_DRIVER='postgres',
                GOTRUE_DB_NAMESPACE=namespace, GOTRUE_DB_DB_NAMESPACE=namespace, DB_NAMESPACE=namespace,
                GOTRUE_DB_MIGRATIONS_PATH='/usr/local/etc/auth/migrations', GOTRUE_DB_MAX_POOL_SIZE='3',
                GOTRUE_API_HOST='127.0.0.1', GOTRUE_API_PORT='9999', GOTRUE_SITE_URL=origin,
                API_EXTERNAL_URL=origin, GOTRUE_URI_ALLOW_LIST=origin, GOTRUE_JWT_SECRET=secret['jwt'],
                GOTRUE_JWT_AUD='authenticated', GOTRUE_JWT_ADMIN_ROLES='service_role',
                GOTRUE_JWT_DEFAULT_GROUP_NAME='authenticated', GOTRUE_JWT_EXP='3600',
                GOTRUE_DISABLE_SIGNUP='true', GOTRUE_EXTERNAL_EMAIL_ENABLED='false',
                GOTRUE_EXTERNAL_PHONE_ENABLED='false', GOTRUE_SMS_AUTOCONFIRM='false',
                GOTRUE_MAILER_AUTOCONFIRM='false', GOTRUE_TRACING_ENABLED='false',
                GOTRUE_METRICS_ENABLED='false', GOTRUE_SMTP_HOST='127.0.0.1', GOTRUE_SMTP_PORT='1', LOG_LEVEL='error')
            for key in old:
                if key.startswith(('GOTRUE_EXTERNAL_', 'GOTRUE_HOOK_')) and key.endswith('_ENABLED'):
                    env[key] = 'false'
        elif role == 'storage':
            env.update(DATABASE_URL=uris[role], DATABASE_POOL_URL=uris[role], DATABASE_POOL_SIZE='3',
                ANON_KEY=secret['anon'], SERVICE_KEY=secret['service'], PGRST_JWT_SECRET=secret['jwt'],
                AUTH_JWT_SECRET=secret['jwt'], JWT_SECRET=secret['jwt'], POSTGREST_URL='http://127.0.0.1:3000',
                STORAGE_BACKEND='file', FILE_STORAGE_BACKEND_PATH='/var/lib/storage',
                TENANT_ID=structural(old, 'TENANT_ID', 'stub', 'segment'),
                GLOBAL_S3_BUCKET=structural(old, 'GLOBAL_S3_BUCKET', 'stub', 'segment'),
                TUS_USE_FILE_VERSION_SEPARATOR=structural(old, 'TUS_USE_FILE_VERSION_SEPARATOR', 'false', 'bool'),
                FILE_SIZE_LIMIT=structural(old, 'FILE_SIZE_LIMIT', '52428800', 'int'),
                REGION='local', HOST='127.0.0.1', PORT='5000', IS_MULTITENANT='false',
                ENABLE_IMAGE_TRANSFORMATION='false', PG_QUEUE_ENABLE='false', ENABLE_QUEUE_EVENTS='false',
                PG_QUEUE_WORKERS_ENABLE='false', DB_INSTALL_ROLES='false', DB_ALLOW_MIGRATION_REFRESH='false',
                PUBLIC_URL=origin + '/storage/v1', LOG_LEVEL='error')
        elif role == 'edge':
            env.update({key: '' for key in keys})
            env.update(JWT_SECRET=secret['jwt'], VK_APP_SECRET=secret['vk'],
                SUPABASE_URL='http://127.0.0.1:9000', SUPABASE_ANON_KEY=secret['anon'],
                SUPABASE_SERVICE_ROLE_KEY=secret['service'], VERIFY_JWT='false')
            env.update({'BOS_' + name.upper() + '_ORIGIN': 'http://bos-release-probe-' + name + ':' + str(PORTS[name])
                        for name in ('rest', 'auth', 'storage')})
        output[role] = {'image': by_role[role]['Image'], 'env': env, 'entrypoint': entrypoint, 'cmd': cmd,
                        'user': '0:0', 'port': PORTS[role]}
    mounts['rest'] = []; mounts['auth'] = []
    mounts['storage'] = [{'source': storage_prefix, 'target': '/var/lib/storage', 'readonly': False}]
    mounts['edge'] = [{'source': prefixes[('edge', target)], 'target': target, 'readonly': True}
                      for target in ('/bos-src', '/bos-bundles')]
    mounts['edge'].append({'source': 'gateway', 'target': '/bos-main', 'readonly': True, 'generated': True})
    mounts['https'] = [{'source': prefixes[('https', '/srv')], 'target': '/srv', 'readonly': True},
                      {'source': 'caddy', 'target': '/etc/caddy', 'readonly': True, 'generated': True}]
    for role in output:
        output[role]['mounts'] = mounts[role]
    return {'roles': output, 'mounts': mounts, 'generated_files': generated, 'db_roles': passwords,
            'secrets': secret, 'aliases': dict(ALIASES), 'ports': dict(PORTS),
            'source_origins': sorted(source_origins),
            'logical_public_origin': json_read(generated['gateway/bos-report-env.json'])['public'],
            'gateway_archive_prefix': prefixes[('edge', '/bos-main')],
            'web_archive_prefix': prefixes[('https', '/srv')], 'storage_archive_prefix': storage_prefix,
            'application': 'NOT_RUN', 'disaster_recovery_ready': False}
