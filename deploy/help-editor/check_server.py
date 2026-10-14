#!/usr/bin/env python3
"""Read-only RU help-editor preflight. Never installs, restarts, or prints secrets."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

BASE_MEMO_SHA = '0871ad305c9e245d4af7c0de70d67ef6c26140c9ad1a928a5a3165d17f36c4f4'
SQL = """BEGIN READ ONLY;
SELECT json_build_object(
 'version', current_setting('server_version'),
 'help_table_exists', to_regclass('public.master_help_materials') IS NOT NULL,
 'active_roles', (SELECT json_agg(r.role) FROM (SELECT DISTINCT role FROM public.business_staff WHERE is_active=true ORDER BY role) r),
 'columns', (SELECT json_agg(c) FROM (SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('master_help_materials','master_memo_materials') ORDER BY table_name,ordinal_position) c));
ROLLBACK;"""


def run(args):
    try:
        return subprocess.run(args, check=True, capture_output=True, timeout=25).stdout.decode()
    except (OSError, subprocess.SubprocessError):
        raise RuntimeError('Read-only command failed: ' + ' '.join(args[:2])) from None


def digest(data):
    return hashlib.sha256(data).hexdigest()


def report(containers, command=run):
    result = {'mode': 'READ_ONLY', 'production_changed': False}
    result['containers'] = [{'name': c['Name'].lstrip('/'), 'image': c['Config']['Image']} for c in containers]
    edges = [c for c in containers if re.fullmatch(r'/bos-release-.+-edge', c['Name'])]
    if len(edges) != 1:
        result['stop'] = 'Expected one active bos-release edge container'
        return result
    edge = edges[0]
    sources = [m['Source'] for m in edge['Mounts'] if m['Destination'] == '/bos-src' and m['Type'] == 'bind']
    if len(sources) != 1:
        result['stop'] = 'Expected existing /bos-src bind'
        return result
    # Read only named help files through the running container; never export source or environment.
    src = command(['docker', 'exec', edge['Id'], 'cat', '/bos-src/master-memo-api/index.ts']).encode()
    result['memo_source_sha256'] = digest(src)
    result['memo_matches_repository_base'] = digest(src) == BASE_MEMO_SHA
    result['edge_image_id'] = edge['Image']
    result['memo_bundle_sha256'] = command(['docker', 'exec', edge['Id'], 'sha256sum', '/bos-bundles/master-memo-api.eszip']).split()[0]
    release = Path(sources[0]).parent.parent
    webs = [c for c in containers if any(m['Destination'] == '/srv' and m['Type'] == 'bind' and Path(m['Source']) == release/'web' for m in c['Mounts'])]
    if len(webs) == 1:
        web = webs[0]
        data = command(['docker', 'exec', web['Id'], 'cat', '/srv/build-version.js'])
        match = re.search(r'"id"\s*:\s*"([a-f0-9]{20})"', data)
        result['web_build'] = match[1] if match else 'unknown'
        result['web_container'] = web['Name'].lstrip('/')
        hashes = {}
        for name in ('index.html', 'startup-shell.bundle.js', 'master-help-data.js', 'master-help-entry.js', 'master-help.js', 'master-help.css'):
            value = command(['docker', 'exec', web['Id'], 'sha256sum', '/srv/'+name]).split()[0]
            hashes[name] = value
        result['web_hashes'] = hashes
    databases = [c for c in containers if re.search(r'(?:^|/)postgres(?::|@)', c['Config']['Image'])]
    if len(databases) == 1:
        try:
            raw = command(['docker', 'exec', databases[0]['Id'], 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', SQL])
            result['database'] = json.loads(raw.strip())
        except (RuntimeError, ValueError):
            result['database'] = 'Metadata unavailable; no write attempted'
    else:
        result['database'] = 'Cannot uniquely identify PostgreSQL; no query attempted'
    result['next'] = 'Review this output before preparing the matching RU installer. This check does not approve deployment.'
    return result


def main():
    ids = run(['docker', 'ps', '-q']).split()
    if not ids:
        raise RuntimeError('No running containers')
    result = report(json.loads(run(['docker', 'inspect', *ids])))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, KeyError, ValueError, IndexError):
        print('CHECK_INCOMPLETE: unable to read the expected server layout. No application files or services changed.', file=sys.stderr)
        sys.exit(1)
