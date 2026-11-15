"""Read-only structural diagnosis. Never executes Docker, SQL or archive code."""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
import uuid

import app_cli
import app_plan as plan
import drill_files as files

CODE_SUFFIXES = ('.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.jsonc', '.eszip')
ROUTE_FIELDS = frozenset(('bundle_sha256', 'entrypoint', 'import_map', 'source_sha256',
    'verify_jwt', 'entryPoint', 'importMap', 'importMapPath', 'verifyJwt', 'verifyJWT',
    'path', 'servicePath', 'bundlePath', 'eszipPath', 'bundle', 'source', 'sourcePath',
    'memoryLimitMb', 'workerTimeoutMs', 'forceCreate', 'enableModuleCache', 'envVars'))


def check(operation):
    try:
        operation()
        return 'SUPPORTED'
    except Exception as error:
        return app_cli.safe_code(error)


def selected_gateway(bundle, inventory, names):
    """Read only selected regular members, verify their captured size and hash."""
    archive_path = bundle / 'files.tar'
    before = files._regular(archive_path)
    output, count = {}, 0
    with tarfile.open(archive_path, mode='r:') as archive:
        for member in archive:
            count += 1
            plan.require(count <= files.MAX_FILES, 'DIAGNOSTIC_ARCHIVE_LIMIT')
            if member.name not in names:
                continue
            plan.require(member.name not in output and member.isfile()
                         and 0 <= member.size <= 4 * 1024 * 1024,
                         'DIAGNOSTIC_GATEWAY_MEMBER_INVALID')
            stream = archive.extractfile(member)
            plan.require(stream is not None, 'DIAGNOSTIC_GATEWAY_MEMBER_INVALID')
            with stream:
                data = stream.read(4 * 1024 * 1024 + 1)
            output[member.name] = data
            plan.read_checked({'inventory': inventory}, output.__getitem__, member.name)
    plan.require(files._signature(before) == files._signature(files._regular(archive_path)),
                 'BUNDLE_CHANGED')
    plan.require(set(output) == set(names), 'DIAGNOSTIC_GATEWAY_FILE_MISSING')
    return output


def load_metadata(bundle, successful):
    raw, manifest_hash = files._read(bundle / 'manifest.json', limit=1024 * 1024, collect=True)
    plan.require(manifest_hash['sha256'] == successful['source_manifest_sha256'],
                 'DIAGNOSTIC_WRONG_BUNDLE')
    manifest = plan.json_read(raw)
    plan.require(isinstance(manifest, dict) and manifest.get('capture') == 'COMPLETE',
                 'MANIFEST_INVALID')
    payloads = manifest['payloads']
    private = files._json(bundle / 'private-config.json', payloads['private-config.json'])
    inventory = files._json(bundle / 'inventory.json', payloads['inventory.json'])
    roles, roots, images = files._private_layout(private)
    files._inventory(inventory, roots)
    prefixes = {}
    for destination in ('/bos-main', '/bos-src', '/bos-bundles'):
        matches = [m for m in roles['edge']['Mounts'] if m.get('Destination') == destination]
        plan.require(len(matches) == 1, 'APP_REQUIRED_MOUNT_MISSING')
        prefixes[destination] = plan.archive_path(matches[0]['Source'], roots)
    main = prefixes['/bos-main']
    contents = selected_gateway(bundle, inventory, {
        main + '/' + name for name in ('index.ts', 'routes.json', 'bos-report-env.json')})
    return {'private': private, 'inventory': inventory}, contents, roles, images, prefixes


def safe_code_path(value, slug, prefix, inventory):
    """Reveal only a bounded code filename that is present in this function tree."""
    if not isinstance(value, str) or len(value) > 240:
        return None
    candidate = value
    if candidate.startswith('file://'):
        candidate = candidate[7:]
    absolute_prefix = '/bos-src/' + slug + '/'
    if candidate.startswith(absolute_prefix):
        candidate = candidate[len(absolute_prefix):]
    if (not re.fullmatch(r'[A-Za-z0-9_./-]+', candidate)
            or not candidate.endswith(CODE_SUFFIXES)):
        return None
    path = PurePosixPath(candidate)
    if path.is_absolute() or '..' in path.parts or str(path) != candidate:
        return None
    record = inventory.get(prefix + '/' + slug + '/' + candidate)
    return candidate if isinstance(record, dict) and record.get('type') == 'file' else None


def describe(value, slug, prefix, inventory, field=None, depth=0):
    """No arbitrary values, URLs, source bodies or environment values leave memory."""
    if depth > 4:
        return {'type': 'depth_limit'}
    if value is None:
        return {'type': 'null'}
    if type(value) is bool:
        result = {'type': 'boolean'}
        if field in ('verify_jwt', 'verifyJwt', 'verifyJWT'):
            result['value'] = value
        return result
    if isinstance(value, str):
        result = {'type': 'string', 'length': len(value)}
        code = safe_code_path(value, slug, prefix, inventory)
        if field in ('entrypoint', 'entryPoint', 'import_map', 'importMap', 'path') and code:
            result['captured_code_path'] = code
            result['path_form'] = ('file_url' if value.startswith('file://') else
                                   'absolute' if value.startswith('/') else 'relative')
        elif field in ('bundle_sha256', 'source_digest'):
            result['sha256_format'] = bool(plan.DIGEST.fullmatch(value))
        elif field == 'route':
            accepted = (slug, 'supabase/functions/' + slug + '/index.ts',
                        '/bos-src/' + slug + '/supabase/functions/' + slug + '/index.ts',
                        '/bos-bundles/' + slug + '.eszip')
            result['known_string_form'] = next((i for i, item in enumerate(accepted) if value == item), None)
        return result
    if isinstance(value, dict):
        result = {'type': 'object', 'count': len(value), 'fields': {}}
        for index, (key, child) in enumerate(value.items()):
            if index >= 300:
                result['truncated'] = True
                break
            if field == 'source_sha256':
                label = safe_code_path(key, slug, prefix, inventory) or 'unrecognized_source_' + str(index)
                result['fields'][label] = describe(child, slug, prefix, inventory, 'source_digest', depth + 1)
            else:
                label = key if key in ROUTE_FIELDS else 'unrecognized_field_' + str(index)
                result['fields'][label] = describe(child, slug, prefix, inventory, key, depth + 1)
                if key not in ROUTE_FIELDS:
                    result['fields'][label]['field_name_length'] = len(key)
        return result
    if isinstance(value, list):
        return {'type': 'array', 'count': len(value)}
    return {'type': 'number' if type(value) in (int, float) else 'unsupported'}


def collect(context, contents, roles, images, prefixes):
    main, source, bundles = (prefixes[k] for k in ('/bos-main', '/bos-src', '/bos-bundles'))
    route_name = main + '/routes.json'
    routes = plan.json_read(contents[route_name])
    plan.require(isinstance(routes, dict) and len(routes) <= 256, 'APP_GATEWAY_ROUTES_REQUIRED')
    inventory = context['inventory']
    output = {'format': 1, 'status': 'DIAGNOSTIC_COMPLETE', 'docker_called': False,
              'backup_modified': False, 'scope': 'METADATA_AND_SELECTED_GATEWAY_BYTES',
              'full_backup_reverification': 'NOT_RUN', 'disaster_recovery_ready': False,
              'routes': [], 'service_checks': {}}
    for index, (slug, route) in enumerate(routes.items()):
        valid_name = isinstance(slug, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,80}', slug)
        label = slug if valid_name else 'unrecognized_route_' + str(index)
        sample = {'mini-app-api': 'mini-app-api', 'password-session-api': 'password-session-api'}
        sample[slug] = route
        encoded = plan.json_bytes(sample)
        isolated = copy.deepcopy(context)
        isolated['inventory'][route_name] = {'type': 'file', 'bytes': len(encoded),
                                            'sha256': hashlib.sha256(encoded).hexdigest()}
        reader = lambda name: encoded if name == route_name else contents[name]
        status = check(lambda: plan.gateway(isolated, reader, main, 'http://127.0.0.1:18701', 'diagnostic-only'))
        candidates = {'root_index': source + '/' + slug + '/index.ts',
                      'nested_index': source + '/' + slug + '/supabase/functions/' + slug + '/index.ts',
                      'root_deno_json': source + '/' + slug + '/deno.json',
                      'bundle': bundles + '/' + slug + '.eszip'}
        output['routes'].append({'name': label, 'v1_route_contract': status,
            'shape': describe(route, slug, source, inventory, 'route'),
            'captured_payloads': {key: isinstance(inventory.get(name), dict)
                and inventory[name].get('type') == 'file' for key, name in candidates.items()}})
    for role in ('rest', 'auth', 'storage', 'edge', 'https'):
        config = roles[role]['Config']
        checks = {'command': check(lambda: plan.executable(role, config))}
        try:
            env = {**plan.environment(images[roles[role]['Image']].get('Config') or {}),
                   **plan.environment(config)}
            checks['environment_shape'] = 'SUPPORTED'
            uri = {'rest': 'PGRST_DB_URI', 'auth': 'GOTRUE_DB_DATABASE_URL', 'storage': 'DATABASE_URL'}.get(role)
            if uri:
                checks['database_uri'] = check(lambda: plan.database_user(env.get(uri), context['private']['database']['database']))
            options = {'rest': [('PGRST_DB_ANON_ROLE', 'anon', 'ident'), ('PGRST_DB_SCHEMAS', 'public', 'schemas'),
                               ('PGRST_DB_EXTRA_SEARCH_PATH', 'public,extensions', 'schemas')],
                       'auth': [('GOTRUE_DB_NAMESPACE', 'auth', 'ident')],
                       'storage': [('TENANT_ID', 'stub', 'segment'), ('GLOBAL_S3_BUCKET', 'stub', 'segment'),
                                   ('TUS_USE_FILE_VERSION_SEPARATOR', 'false', 'bool'),
                                   ('FILE_SIZE_LIMIT', '52428800', 'int')]}.get(role, [])
            for key, default, kind in options:
                checks[key] = check(lambda: plan.structural(env, key, default, kind))
        except Exception as error:
            checks['environment_shape'] = app_cli.safe_code(error)
        output['service_checks'][role] = checks
    output['plan_result'] = check(lambda: plan.build_plan(context, contents.__getitem__, 'http://127.0.0.1:18701'))
    return output


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--package-dir', required=True)
    parser.add_argument('--bundle')
    parser.add_argument('--report')
    args = parser.parse_args(argv)
    try:
        work = Path(args.package_dir).resolve(strict=True)
        successful = app_cli.read_report(Path(args.report) if args.report else work / 'restore-report.json')
        bundle = app_cli.select_bundle(args.bundle, successful, work)
        plan.require(work != bundle and bundle not in work.parents, 'DIAGNOSTIC_OUTPUT_INSIDE_BACKUP')
        context, contents, roles, images, prefixes = load_metadata(bundle, successful)
        result = collect(context, contents, roles, images, prefixes)
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        output = work / ('BOS-App-Diagnostic-' + stamp + '-' + uuid.uuid4().hex[:8] + '.json')
        app_cli.write_report(output, result)
        bad = sum(r['v1_route_contract'] != 'SUPPORTED' for r in result['routes'])
        print(json.dumps({'status': 'DIAGNOSTIC_COMPLETE', 'unsupported_routes': bad, 'report': str(output)}))
        return 0
    except Exception as error:
        print(json.dumps({'status': 'DIAGNOSTIC_STOPPED', 'reason': app_cli.safe_code(error)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
