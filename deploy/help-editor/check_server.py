#!/usr/bin/env python3
"""Read-only RU help-editor preflight. Never installs, restarts, or prints secrets."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import urllib.parse

RU_MEMO_SHA = '5825b23c65e501bced7e7fe3bfe4bbc173e1bea3908365c39f43920acff0ec75'
BASE_MEMO_SHA = '0871ad305c9e245d4af7c0de70d67ef6c26140c9ad1a928a5a3165d17f36c4f4'
SQL = """BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT json_build_object(
 'version', current_setting('server_version'),
 'help_table_exists', to_regclass('public.master_help_materials') IS NOT NULL,
 'active_roles', (SELECT json_agg(r.role) FROM (SELECT DISTINCT role FROM public.business_staff WHERE is_active=true ORDER BY role) r),
 'columns', (SELECT json_agg(c) FROM (SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('master_help_materials','master_memo_materials') ORDER BY table_name,ordinal_position) c));
ROLLBACK;"""


class ReadFailure(RuntimeError):
    def __init__(self, message, code='COMMAND_FAILED'):
        super().__init__(message)
        self.code=code


def run(args):
    try:
        return subprocess.run(args, check=True, capture_output=True, timeout=25).stdout.decode()
    except (OSError, subprocess.SubprocessError) as error:
        raw=getattr(error,'stderr',b'') or b''
        if isinstance(raw,bytes):raw=raw.decode(errors='replace')
        # Export only a PostgreSQL SQLSTATE, never arbitrary stderr or credentials.
        state=re.search(r'(?:ERROR|FATAL):\s+([0-9A-Z]{5})(?:\s|$)',raw)
        code='SQLSTATE_'+state[1] if state else ('TIMEOUT' if isinstance(error,subprocess.TimeoutExpired) else 'COMMAND_FAILED')
        raise ReadFailure('Read-only command failed: ' + ' '.join(args[:2]),code) from None


def digest(data):
    return hashlib.sha256(data).hexdigest()


def container_env(container):
    return dict(x.split('=',1) for x in container['Config'].get('Env',[]) if '=' in x)


def route_targets(source, hostname, containers):
    """Resolve only names/IPs on the source container's Docker networks."""
    networks=source.get('NetworkSettings',{}).get('Networks',{})
    found=set()
    for candidate in containers:
        target=candidate.get('NetworkSettings',{}).get('Networks',{})
        for network in set(networks) & set(target):
            net=target[network]
            names=[candidate['Name'].lstrip('/'),net.get('IPAddress'),
                   *(net.get('Aliases') or []),*(net.get('DNSNames') or [])]
            if hostname in names:found.add(candidate['Id'])
    return found


def database_report(containers, command=run):
    # RU containers can use image IDs/custom tags. Follow the established release
    # names and verified edge/REST network route, as ru-hands-intake-check.py does.
    # Never fall back to POSTGRES_DB: it can be an empty bootstrap database.
    edges=[c for c in containers if re.fullmatch(r'/bos-release-.+-edge',c['Name'])]
    if len(edges)!=1:return {'status':'ACTIVE_EDGE_NOT_UNIQUE'}
    edge=edges[0];prefix=edge['Name'][:-5]
    rests=[c for c in containers if c['Name']==prefix+'-rest']
    if len(rests)!=1:return {'status':'ACTIVE_REST_NOT_UNIQUE'}
    rest=rests[0]
    try:
        route=urllib.parse.urlsplit(container_env(edge).get('BOS_REST_ORIGIN',''))
        if (route.scheme not in ('http','https') or not route.hostname or route.username
                or route.password or route.query or route.fragment or route.path not in ('','/')):
            return {'status':'EDGE_REST_ROUTE_UNAVAILABLE'}
        if route_targets(edge,route.hostname,containers)!={rest['Id']}:
            return {'status':'EDGE_REST_ROUTE_NOT_MAPPED'}
        port=int(container_env(rest).get('PGRST_SERVER_PORT','3000'))
        if not 1<=port<=65535 or (route.port or (443 if route.scheme=='https' else 80))!=port:
            return {'status':'EDGE_REST_PORT_MISMATCH'}
    except ValueError:return {'status':'EDGE_REST_ROUTE_UNAVAILABLE'}
    try:
        parsed=urllib.parse.urlsplit(container_env(rest).get('PGRST_DB_URI',''))
        if (parsed.scheme not in ('postgres','postgresql') or not parsed.hostname
                or parsed.query or parsed.fragment or parsed.port not in (None,5432)):
            return {'status':'POSTGREST_URI_UNAVAILABLE'}
        database=urllib.parse.unquote(parsed.path.lstrip('/'))
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,63}',database):
            return {'status':'POSTGREST_DATABASE_NAME_UNAVAILABLE'}
    except ValueError:return {'status':'POSTGREST_URI_UNAVAILABLE'}
    databases=[c for c in containers if c['Name']==prefix+'-db']
    if len(databases)!=1:return {'status':'ACTIVE_DATABASE_NOT_UNIQUE'}
    db=databases[0]
    if route_targets(rest,parsed.hostname,containers)!={db['Id']}:
        return {'status':'POSTGREST_DATABASE_HOST_NOT_MAPPED'}
    source='verified active release'
    shell='export PGPASSWORD="${PGPASSWORD:-$POSTGRES_PASSWORD}"; exec psql -X -w -U "${POSTGRES_USER:-postgres}" -d "$1" -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -c "$2"'
    try:
        raw=command(['docker','exec',db['Id'],'sh','-c',shell,'help-metadata',database,SQL])
        result=json.loads(raw.strip())
        if not isinstance(result,dict):raise ValueError('Expected object')
        return {**result,'status':'OK','target_source':source}
    except (RuntimeError,ValueError) as error:
        return {'status':getattr(error,'code','QUERY_OR_JSON_FAILED'),'target_source':source}


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
    result['memo_matches_verified_ru_source'] = digest(src) == RU_MEMO_SHA
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
    result['database']=database_report(containers,command)
    result['next'] = 'Review this output before preparing the matching RU installer. This check does not approve deployment.'
    return result


def main():
    ids = run(['docker', 'ps', '-q']).split()
    if not ids:
        raise RuntimeError('No running containers')
    result = report(json.loads(run(['docker', 'inspect', *ids])))
    if '--brief' in sys.argv:
        print('MODE=READ_ONLY; application and data unchanged')
        print('MEMO_VERIFIED=' + str(result.get('memo_matches_verified_ru_source', False)))
        print('WEB_BUILD=' + result.get('web_build', 'unknown'))
        db=result.get('database')
        if isinstance(db,dict):
            print('DB_STATUS=' + str(db.get('status')))
            print('DB_TARGET=' + str(db.get('target_source','unknown')))
        if isinstance(db, dict) and db.get('status')=='OK':
            print('DB_VERSION=' + str(db.get('version')))
            print('HELP_TABLE_EXISTS=' + str(db.get('help_table_exists')))
            print('ACTIVE_ROLES=' + ','.join(db.get('active_roles') or []))
            print('MEMO_COLUMNS=' + ','.join(c['column_name']+':'+c['data_type'] for c in (db.get('columns') or []) if c['table_name']=='master_memo_materials'))
        elif not isinstance(db,dict): print('DB_STATUS=' + str(db))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, KeyError, ValueError, IndexError):
        print('CHECK_INCOMPLETE: unable to read the expected server layout. No application files or services changed.', file=sys.stderr)
        sys.exit(1)
