#!/usr/bin/env python3
"""Print bounded, metadata-only deployment evidence; never mutate services/data.

Run from a separate audit checkout, not from an installer. No environment values,
customer rows, source bodies, configuration bodies or log bodies are printed.
Optional DB inspection reads only catalog metadata in a READ ONLY transaction.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

MAX_FILE = 128 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
SAFE_NAME = re.compile(r'^[A-Za-z0-9_.-]{1,160}$')
# No environment, command, labels, ports or logs are requested from Docker.
DOCKER_FORMAT = '{{json .Id}}\t{{json .Name}}\t{{json .Image}}\t{{json .Config.Image}}\t{{json .State.Status}}\t{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}\t{{json .Mounts}}'
SCHEMA_SQL = """BEGIN READ ONLY;
SET LOCAL statement_timeout='3s';
SELECT json_build_object(
 'server_version', current_setting('server_version'),
 'columns', (SELECT coalesce(json_agg(json_build_array(table_name,column_name,data_type)), '[]'::json)
   FROM information_schema.columns WHERE table_schema='public' AND table_name IN
   ('orders','business_staff','order_reports','order_claims','finance_expenses','bos_push_subscriptions','bos_push_deliveries')),
 'tables', (SELECT coalesce(json_agg(json_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity)), '[]'::json)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
   AND c.relname IN ('orders','business_staff','order_reports','order_claims','finance_expenses','bos_push_subscriptions','bos_push_deliveries')),
 'migration_table_present', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL);
ROLLBACK;"""
MIGRATION_SQL = """BEGIN READ ONLY; SET LOCAL statement_timeout='3s';
SELECT coalesce(json_agg(version ORDER BY version), '[]'::json)
FROM (SELECT version FROM supabase_migrations.schema_migrations
WHERE version ~ '^[0-9]{8,20}$' ORDER BY version DESC LIMIT 1000) v;
ROLLBACK;"""


class ProbeError(Exception):
    pass


def command(args):
    try:
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=20, check=False, shell=False)
    except (OSError, subprocess.TimeoutExpired):
        raise ProbeError('COMMAND_UNAVAILABLE_OR_TIMEOUT') from None
    if result.returncode:
        raise ProbeError('COMMAND_FAILED')
    if len(result.stdout) > 4 * 1024 * 1024:
        raise ProbeError('OUTPUT_LIMIT')
    return result.stdout.decode('utf-8', errors='strict').strip()


def guarded(fn):
    try:
        return fn()
    except ProbeError as error:
        code = str(error)
        return {'status': 'unavailable', 'reason': code if re.fullmatch(r'[A-Z0-9_]{1,60}', code) else 'PROBE_FAILED'}
    except (OSError, ValueError, TypeError, KeyError, UnicodeError):
        return {'status': 'unavailable', 'reason': 'INVALID_OR_UNREADABLE_METADATA'}


def safe_path(path):
    path = Path(path).absolute()
    if path.resolve() != path or not path.is_dir():
        raise ProbeError('UNSAFE_ROOT')
    return path


def hash_file(root, relative, budget):
    relative = Path(relative)
    if relative.is_absolute() or '..' in relative.parts or any(not SAFE_NAME.fullmatch(p) for p in relative.parts):
        raise ProbeError('UNSAFE_FILENAME')
    path = root / relative
    if path.resolve() != path or not path.is_file():
        raise ProbeError('MISSING_OR_SYMLINK')
    before = path.stat()
    if before.st_size > MAX_FILE or budget[0] + before.st_size > MAX_TOTAL:
        raise ProbeError('BYTE_LIMIT')
    hasher, size = hashlib.sha256(), 0
    with path.open('rb') as handle:
        while chunk := handle.read(64 * 1024):
            size += len(chunk)
            if size > MAX_FILE or budget[0] + size > MAX_TOTAL:
                raise ProbeError('BYTE_LIMIT')
            hasher.update(chunk)
    after = path.stat()
    if (before.st_ino, before.st_mtime_ns, before.st_size) != (after.st_ino, after.st_mtime_ns, size):
        raise ProbeError('FILE_CHANGED')
    budget[0] += size
    return {'sha256': hasher.hexdigest(), 'bytes': size}


def git_identity(repo):
    root = safe_path(repo)
    prefix = ['git', '--no-optional-locks', '-C', str(root)]
    commit = command(prefix + ['rev-parse', 'HEAD'])
    if not re.fullmatch(r'[a-f0-9]{40,64}', commit):
        raise ProbeError('INVALID_GIT_HEAD')
    raw = command(prefix + ['status', '--porcelain=v1', '-uno'])
    result = {'commit': commit, 'tracked_changes': len(raw.splitlines()) if raw else 0,
              'untracked_files': 'not_read'}
    try:
        remote = command(prefix + ['remote', 'get-url', 'origin'])
        url = urlsplit(remote)
        # Disclose only this project's recognized remote, never arbitrary URL credentials.
        result['expected_github_remote'] = url.hostname == 'github.com' and url.path.rstrip('/') in (
            '/zuev1ilya11-afk/business-os-vk', '/zuev1ilya11-afk/business-os-vk.git')
    except (ProbeError, ValueError):
        result['expected_github_remote'] = None
    return result


def web_identity(root, budget):
    root = safe_path(root)
    digest = hash_file(root, 'build-version.js', budget)
    if digest['bytes'] > 2 * 1024 * 1024:
        raise ProbeError('MANIFEST_LIMIT')
    raw = (root / 'build-version.js').read_text(encoding='utf-8')
    match = re.fullmatch(r'// Generated by npm run build\. Do not edit\.\nself\.BOS_BUILD=(\{.*\});\s*', raw, re.S)
    if not match:
        raise ProbeError('MANIFEST_FORMAT')
    meta = json.loads(match[1])
    build = meta.get('id', '')
    if not isinstance(build, str) or not re.fullmatch(r'[a-f0-9]{8,64}', build):
        raise ProbeError('BUILD_FORMAT')
    assets = meta.get('assets')
    if not isinstance(assets, dict) or len(assets) > 1024:
        raise ProbeError('ASSET_LIMIT')
    result = {'build_id': build, 'manifest': digest, 'assets_declared': len(assets),
              'assets_verified': 0, 'mismatches': []}
    for filename, expected in sorted(assets.items()):
        if not SAFE_NAME.fullmatch(filename) or not isinstance(expected, str) or not re.fullmatch(r'[a-f0-9]{64}', expected):
            raise ProbeError('ASSET_FORMAT')
        actual = guarded(lambda: hash_file(root, filename, budget))
        if actual.get('sha256') == expected:
            result['assets_verified'] += 1
        else:
            result['mismatches'].append({'asset': filename, 'status': 'missing_changed_or_unreadable'})
    shell = guarded(lambda: hash_file(root, 'index.html', budget))
    result['shell_matches'] = bool(shell.get('sha256')) and shell.get('sha256') == meta.get('shell')
    result['sw'] = guarded(lambda: hash_file(root, 'sw.js', budget))
    return result


def backend_identity(root, budget):
    root = safe_path(root)
    files = []
    # Only file identities are emitted, never contents; symlinks are rejected.
    for path in sorted(root.rglob('*')):
        if path.suffix not in ('.ts', '.js', '.mjs', '.eszip') or not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(not SAFE_NAME.fullmatch(p) for p in relative.parts):
            continue
        if len(files) >= 400:
            raise ProbeError('FILE_COUNT_LIMIT')
        files.append({'file': str(relative), **guarded(lambda p=relative: hash_file(root, p, budget))})
    return {'files': files, 'execution_matches_sources': 'not_established'}


def inspect_containers(budget):
    rows = command(['docker', 'ps', '--format', '{{.ID}}\t{{.Names}}']).splitlines()
    selected = []
    for row in rows:
        parts = row.split('\t')
        if len(parts) == 2 and re.fullmatch(r'[a-f0-9]{12,64}', parts[0]) and re.fullmatch(r'bos[-_][A-Za-z0-9_.-]{1,120}', parts[1]):
            selected.append(parts[0])
    result = []
    for cid in selected[:40]:
        row = command(['docker', 'inspect', '--format', DOCKER_FORMAT, cid])
        fields = [json.loads(s) for s in row.split('\t')]
        ident, name, image, image_ref, state, health, mounts = fields
        item = {'name': str(name).lstrip('/'), 'image_id': image, 'image_reference': image_ref,
                'state': state, 'health': health, 'mount_targets': []}
        if not isinstance(mounts, list) or len(mounts) > 100:
            raise ProbeError('MOUNT_LIMIT')
        for m in mounts:
            target = m.get('Destination', '')
            if target not in ('/srv', '/bos-src', '/bos-bundles', '/bos-main', '/etc/caddy'):
                continue
            item['mount_targets'].append({'target': target, 'type': m.get('Type'), 'writable': bool(m.get('RW'))})
            # Do not disclose arbitrary host paths or container configuration.
            if m.get('Type') != 'bind':
                continue
            source = m.get('Source', '')
            if target == '/srv':
                item['web'] = guarded(lambda: web_identity(source, budget))
            elif target in ('/bos-src', '/bos-bundles'):
                item[target.lstrip('/')] = guarded(lambda: backend_identity(source, budget))
            elif target == '/etc/caddy':
                item['caddyfile'] = guarded(lambda: hash_file(safe_path(source), 'Caddyfile', budget))
        result.append(item)
    return {'containers': result, 'matching_containers': len(selected), 'truncated': len(selected) > 40}


def database_identity(container, database):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,159}', container) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,62}', database):
        raise ProbeError('INVALID_DATABASE_SELECTOR')
    args = ['docker', 'exec', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-c']
    data = json.loads(command(args + [SCHEMA_SQL]))
    if data.get('migration_table_present'):
        data['migration_versions'] = guarded(lambda: json.loads(command(args + [MIGRATION_SQL])))
    data['business_rows_read'] = False
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default='.')
    parser.add_argument('--web-root')
    parser.add_argument('--db-container')
    parser.add_argument('--database', default='postgres')
    args = parser.parse_args(argv)
    budget = [0]
    result = {'schema': 1, 'collected_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'read_only': True, 'git': guarded(lambda: git_identity(args.repo)),
              'docker': guarded(lambda: inspect_containers(budget)),
              'database': {'status': 'not_requested'},
              'limitations': ['No production writes or service changes performed.',
                  'No customer rows, secrets, config bodies or log bodies read for output.',
                  'Backup restoration, live request flows, notifications and exact source-to-bundle correspondence are not established.']}
    if args.web_root:
        result['selected_web'] = guarded(lambda: web_identity(args.web_root, budget))
    if args.db_container:
        result['database'] = guarded(lambda: database_identity(args.db_container, args.database))
    result['files_hashed_bytes'] = budget[0]
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
