#!/usr/bin/env python3
"""Read-only, bounded diagnostic for order 7395762 on the existing RU host.

No database writes, downloads, restarts, report attachments or customer contacts.
Docker environment values are used privately to resolve the active DB route.
"""
import json
import gzip
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone
from urllib.parse import unquote, urlsplit

EDGE = 'bos-release-to2wblxf-edge'
SQL = """BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
WITH selected AS (
 SELECT o.id,to_jsonb(o) AS row FROM public.orders o
 WHERE o.order_number='7395762' OR o.external_id IN ('7395762','hands:7395762')
 LIMIT 5
)
SELECT json_build_object(
 'orders',coalesce((SELECT json_agg(json_build_object(
   'id',id,'status',row->'status','is_claim',row->'is_claim',
   'source',row->'source','created_at',row->'created_at',
   'completed_at',row->'completed_at','report_reviewed_at',row->'report_reviewed_at',
   'claim_opened_at',row->'claim_opened_at','claim_closed_at',row->'claim_closed_at',
   'claim_visit_no',row->'claim_visit_no','scheduled_date',row->'scheduled_date',
   'amount',row->'amount','master_payout',row->'master_payout',
   'extra_work_amount',row->'extra_work_amount','uncompleted_work_amount',row->'uncompleted_work_amount',
   'claim_revisit_payment',row->'claim_revisit_payment',
   'manual_dates',(SELECT coalesce(json_agg(v->'at'),'[]'::json)
     FROM jsonb_array_elements(coalesce(row->'manual_completion_history','[]'::jsonb)) v)
 )) FROM selected),'[]'::json),
 'claims',coalesce((SELECT json_agg(json_build_object(
   'id',c.id,'order_id',c.order_id,'status',c.status,'opened_at',c.opened_at,
   'closed_at',to_jsonb(c)->'closed_at','pay_revisit',to_jsonb(c)->'pay_revisit',
   'revisit_payment',to_jsonb(c)->'revisit_payment'
 )) FROM public.order_claims c WHERE c.order_id IN (SELECT id FROM selected)),'[]'::json),
 'history_columns',coalesce((SELECT json_agg(table_name||'.'||column_name)
   FROM information_schema.columns WHERE table_schema='public' AND
    ((table_name IN ('orders','order_claims') AND column_name ~ '(history|snapshot|original.*date|original.*completed|paid)')
     OR (table_name ~ '(audit|history)' AND column_name IN ('order_id','record_id','old_data','new_data','created_at')))),'[]'::json),
 'guard_resets_completion',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='guard_order_completion'
   AND position('new.completed_at := null' IN pg_get_functiondef(p.oid))>0)
);
ROLLBACK;"""


class Stop(Exception):
    pass


def command(args):
    return subprocess.run(args, check=True, capture_output=True, timeout=20).stdout


def variables(container):
    return dict(item.split('=', 1) for item in container.get('Config', {}).get('Env', []) if '=' in item)


def resolve(source, hostname, containers):
    matches = []
    for container in containers:
        for network in set(source['NetworkSettings']['Networks']) & set(container['NetworkSettings']['Networks']):
            info = container['NetworkSettings']['Networks'][network]
            if hostname in [container['Name'].lstrip('/'), info.get('IPAddress'), *(info.get('Aliases') or []), *(info.get('DNSNames') or [])]:
                matches.append(container)
                break
    if len(matches) != 1:
        raise Stop('DATABASE_ROUTE_NOT_UNIQUE')
    return matches[0]


def database():
    ids = command(['docker', 'ps', '-q']).decode().split()
    if not ids:
        raise Stop('CONTAINERS_NOT_FOUND')
    containers = json.loads(command(['docker', 'inspect', *ids]))
    matches = [c for c in containers if c['Name'].lstrip('/') == EDGE]
    if len(matches) != 1:
        raise Stop('EXPECTED_EDGE_NOT_FOUND')
    edge = matches[0]
    rest_url = urlsplit(variables(edge).get('BOS_REST_ORIGIN', ''))
    if rest_url.scheme not in ('http', 'https') or not rest_url.hostname or rest_url.username or rest_url.password or rest_url.query or rest_url.fragment or rest_url.path not in ('', '/'):
        raise Stop('REST_ROUTE_UNSUPPORTED')
    rest = resolve(edge, rest_url.hostname, containers)
    if (rest_url.port or (443 if rest_url.scheme == 'https' else 80)) != int(variables(rest).get('PGRST_SERVER_PORT', '3000')):
        raise Stop('REST_PORT_MISMATCH')
    uri = urlsplit(variables(rest).get('PGRST_DB_URI', ''))
    if uri.scheme not in ('postgres', 'postgresql') or not uri.hostname or uri.query or uri.fragment or uri.port not in (None, 5432):
        raise Stop('DATABASE_URI_UNSUPPORTED')
    name = unquote(uri.path.lstrip('/'))
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,63}', name):
        raise Stop('DATABASE_NAME_UNSUPPORTED')
    db = resolve(rest, uri.hostname, containers)
    return db['Id'], name


def read_report():
    db, name = database()
    data = json.loads(command(['docker', 'exec', db, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', name, '-c', SQL]))
    if len(data['orders']) != 1:
        raise Stop('ORDER_NOT_UNIQUE_' + str(len(data['orders'])))
    return data


def emit(data):
    o = data['orders'][0]
    print('CLAIM_CHECK_ONLY=true')
    print('ORDER=7395762 ID=' + str(o['id']) + ' STATUS=' + str(o['status']))
    for label, key in [('COMPLETED', 'completed_at'), ('REVIEWED', 'report_reviewed_at'), ('CLAIM_OPENED', 'claim_opened_at'), ('CLAIM_CLOSED', 'claim_closed_at'), ('SAVED_PAY', 'master_payout'), ('EXTRAS', 'extra_work_amount'), ('REVISIT_PAY', 'claim_revisit_payment')]:
        print(label + '=' + json.dumps(o.get(key), ensure_ascii=False))
    print('MANUAL_DATES=' + json.dumps(o.get('manual_dates'), ensure_ascii=False))
    print('CLAIMS=' + json.dumps(data['claims'][-3:], ensure_ascii=False, separators=(',', ':')))
    print('HISTORY_COLUMNS=' + json.dumps(data['history_columns'], ensure_ascii=False, separators=(',', ':')))
    print('GUARD_RESETS_COMPLETION=' + json.dumps(data['guard_resets_completion']))
    print('PRODUCTION_CHANGED=false')


def main():
    try:
        if sys.argv[1:]==['--backups']:
            backups()
        elif sys.argv[1:]==['--recover']:
            recover()
        elif sys.argv[1:]:
            raise Stop('UNKNOWN_OPTION')
        else:
            emit(read_report())
    except Exception as error:
        # Never emit database errors, command stderr, credentials or internal routes.
        print('CLAIM_CHECK_STOPPED=' + (str(error) if isinstance(error, Stop) else type(error).__name__))
        return 1
    return 0


def backups():
    found=[]
    roots=[Path('/opt/business-os'),Path('/var/backups'),Path('/root')]
    for root in roots:
        for current, dirs, files in os.walk(root, followlinks=False):
            here=Path(current)
            dirs[:]=[d for d in dirs if not d.startswith('.') and d not in ('web','edge','node_modules','postgres','data','storage') and len(here.relative_to(root).parts)<5]
            for name in files:
                if not re.search(r'\.(sql(?:\.gz)?|dump(?:\.gz)?|backup|bak)$',name,re.I):
                    continue
                p=here/name
                if p.is_symlink():
                    continue
                st=p.stat()
                if st.st_size<10000:
                    continue
                found.append({'path':str(p),'size':st.st_size,'mtime':st.st_mtime,'ino':st.st_ino,'dev':st.st_dev})
    found.sort(key=lambda r:r['mtime'],reverse=True)
    found=found[:30]
    path='/tmp/bos-claim-backups.json'
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as handle:
        os.chmod(path,0o600)
        json.dump(found,handle)
    print('BACKUPS_FOUND='+str(len(found)))
    for i,item in enumerate(found):
        stamp=datetime.fromtimestamp(item['mtime'],timezone.utc).strftime('%m-%d %H:%M')
        print(str(i)+' '+stamp+' '+str(round(item['size']/1048576,1))+'MB '+Path(item['path']).name[:65])
    print('PRODUCTION_CHANGED=false')


FINANCIAL_FIELDS = frozenset('id order_number external_id external_source source status completed_at report_reviewed_at scheduled_date created_at received_date master_agreed_at master_staff_id master_id master_name address city amount original_amount master_payout extra_work_amount extra_work_description uncompleted_work_amount uncompleted_work_description uncompleted_work_items work work_items manual_completion_history'.split())
JSON_FIELDS = frozenset(('work_items', 'uncompleted_work_items', 'manual_completion_history'))
NUMBER_FIELDS = frozenset(('id', 'amount', 'original_amount', 'master_payout', 'extra_work_amount', 'uncompleted_work_amount'))


def copy_value(value):
    if value == r'\N':
        return None
    escapes = {'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t', 'v': '\v', '\\': '\\'}
    return re.sub(r'\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)',
                  lambda m: chr(int(m[1][1:], 16)) if m[1].startswith('x') and len(m[1]) > 1 else
                  chr(int(m[1], 8)) if m[1][0] in '01234567' else escapes.get(m[1], m[1]), value)


def target_from_copy(stream):
    columns = None
    matches = []
    total = 0
    while True:
        raw = stream.readline(32 * 1024 * 1024 + 1)
        if not raw:
            break
        total += len(raw)
        if len(raw) > 32 * 1024 * 1024 or total > 512 * 1024 * 1024:
            raise Stop('BACKUP_READ_LIMIT')
        line = raw.decode('utf-8').rstrip('\r\n')
        header = re.fullmatch(r'COPY (?:public\.)?orders \(([^)]+)\) FROM stdin;', line)
        if header:
            columns = [c.strip().strip('"') for c in header[1].split(',')]
            continue
        if line == r'\.':
            columns = None
            continue
        if columns is None:
            continue
        values = line.split('\t')
        if len(values) != len(columns):
            raise Stop('BACKUP_COPY_COLUMNS')
        row = dict(zip(columns, values))
        if row.get('id') != '1769':
            continue
        row = {key: copy_value(value) for key, value in row.items()}
        if row.get('order_number') != '7395762' and row.get('external_id') not in ('7395762', 'hands:7395762'):
            raise Stop('BACKUP_ORDER_ID_MISMATCH')
        snapshot = {key: value for key, value in row.items() if key in FINANCIAL_FIELDS}
        for key in JSON_FIELDS & snapshot.keys():
            if snapshot[key] is not None:
                snapshot[key] = json.loads(snapshot[key])
        for key in NUMBER_FIELDS & snapshot.keys():
            if snapshot[key] is not None:
                snapshot[key] = int(snapshot[key]) if key == 'id' else float(snapshot[key])
        matches.append({'snapshot': snapshot, 'is_claim': row.get('is_claim') in ('t', 'true'), 'claim_opened_at': row.get('claim_opened_at')})
    if len(matches) > 1:
        raise Stop('BACKUP_ORDER_NOT_UNIQUE')
    return matches[0] if matches else None


def recover():
    # pg_restore is used only as an archive decoder, without -d or a connection.
    # Never execute SQL from a backup or copy it into the production database.
    live = read_report()
    if live['orders'][0]['id'] != 1769:
        raise Stop('CURRENT_ORDER_ID_MISMATCH')
    db, _ = database()
    inventory = json.loads(Path('/tmp/bos-claim-backups.json').read_text())
    recovered = []
    print('CLAIM_RECOVERY_READ_ONLY=true', flush=True)
    for index, item in enumerate(inventory[:12]):
        path = Path(item['path'])
        if not path.name.lower().endswith(('.dump', '.dump.gz', '.sql', '.sql.gz', '.backup')):
            continue
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as handle:
            st = os.fstat(handle.fileno())
            if any(getattr(st, 'st_' + key) != item[key] for key in ('size', 'mtime', 'ino', 'dev')):
                raise Stop('BACKUP_CHANGED_RESCAN')
            if st.st_size > 256 * 1024 * 1024:
                print('BACKUP=' + str(index) + ' SKIP=SIZE', flush=True)
                continue
            digest = hashlib.file_digest(handle, 'sha256').hexdigest()
            handle.seek(0)
            stream = gzip.GzipFile(fileobj=handle) if path.name.endswith('.gz') else handle
            magic = stream.read(5)
            stream.seek(0)
            if magic == b'PGDMP':
                # Temporary output has mode 0600, only orders, and is always deleted.
                import tempfile
                with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as archive:
                    while True:
                        block = stream.read(1024 * 1024)
                        if not block:
                            break
                        if archive.tell() + len(block) > 512 * 1024 * 1024:
                            raise Stop('BACKUP_EXPANDED_LIMIT')
                        archive.write(block)
                    archive.seek(0)
                    result = subprocess.run(['docker', 'exec', '-i', db, 'pg_restore', '--data-only', '--schema=public', '--table=orders', '--no-owner', '--no-privileges', '--file=-'], stdin=archive, stdout=output, stderr=subprocess.PIPE, timeout=60)
                    if result.returncode:
                        print('BACKUP=' + str(index) + ' SKIP=DECODER', flush=True)
                        continue
                    output.seek(0)
                    match = target_from_copy(output)
            else:
                match = target_from_copy(stream)
        if not match:
            print('BACKUP=' + str(index) + ' ORDER=ABSENT', flush=True)
            continue
        snapshot = match['snapshot']
        recovered.append({'backup': index, 'sha256': digest, 'mtime': item['mtime'], **match})
        print('BACKUP=' + str(index) + ' STATUS=' + str(snapshot.get('status')) + ' CLAIM=' + str(match['is_claim']).lower(), flush=True)
        print('DATE=' + str(snapshot.get('completed_at')) + ' PAY=' + str(snapshot.get('master_payout')), flush=True)
    target = '/tmp/bos-claim-recovery.json'
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as output:
        os.fchmod(output.fileno(), 0o600)
        json.dump({'current': live['orders'][0], 'candidates': recovered}, output, ensure_ascii=False)
    print('CANDIDATES=' + str(len(recovered)))
    print('PRODUCTION_CHANGED=false')


if __name__ == '__main__':
    raise SystemExit(main())
