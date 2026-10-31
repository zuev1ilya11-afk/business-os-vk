#!/usr/bin/env python3
"""Read unresolved claim history after deployment. Never changes the database."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

PACKAGE = Path('/tmp/bos-master.pyz')
PACKAGE_SHA = 'fe03bb275c1a78a71d850f7596b6a21b85e2b197f6c211a22ee469f950cb7cde'
SQL = """BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
SELECT coalesce(json_agg(json_build_object(
 'id',o.id,'order_number',o.order_number,'external_id',o.external_id,
 'status',o.status,'is_claim',o.is_claim,'created_at',o.created_at,
 'completed_at',o.completed_at,'master_payout',o.master_payout,
 'extra_work_amount',o.extra_work_amount,'claim_revisit_payment',o.claim_revisit_payment,
 'first_claim',coalesce((SELECT min(c.opened_at) FROM public.order_claims c WHERE c.order_id=o.id),o.claim_opened_at)
) ORDER BY o.id),'[]'::json)
FROM public.orders o LEFT JOIN public.order_financial_snapshots s ON s.order_id=o.id
WHERE (o.is_claim IS TRUE OR o.status='Рекламация') AND s.order_id IS NULL;
ROLLBACK;"""


class Stop(Exception): pass


def require(value, code):
    if not value: raise Stop(code)


def parse_copy(stream, targets, codec):
    columns = None; result = {}; total = 0
    while True:
        raw = stream.readline(32 * 1024 * 1024 + 1)
        if not raw: break
        total += len(raw)
        require(len(raw) <= 32 * 1024 * 1024 and total <= 512 * 1024 * 1024, 'BACKUP_READ_LIMIT')
        line = raw.decode('utf-8').rstrip('\r\n')
        header = re.fullmatch(r'COPY (?:public\.)?orders \(([^)]+)\) FROM stdin;', line)
        if header:
            columns = [c.strip().strip('"') for c in header[1].split(',')]; continue
        if line == r'\.': columns = None; continue
        if columns is None: continue
        values = line.split('\t'); require(len(values) == len(columns), 'BACKUP_COLUMNS')
        row = dict(zip(columns, values)); key = row.get('id')
        if key not in targets: continue
        row = {k: codec.copy_value(v) for k, v in row.items()}
        current = targets[key]
        same_number = bool(current.get('order_number')) and row.get('order_number') == str(current['order_number'])
        same_external = bool(current.get('external_id')) and row.get('external_id') == current['external_id']
        require(same_number or same_external, 'BACKUP_ORDER_IDENTITY_CHANGED')
        require(key not in result, 'BACKUP_DUPLICATE_ORDER')
        snapshot = {k: v for k, v in row.items() if k in codec.FINANCIAL_FIELDS}
        for k in codec.JSON_FIELDS & snapshot.keys():
            if snapshot[k] is not None: snapshot[k] = json.loads(snapshot[k])
        for k in codec.NUMBER_FIELDS & snapshot.keys():
            if snapshot[k] is not None: snapshot[k] = int(snapshot[k]) if k == 'id' else float(snapshot[k])
        result[key] = {'snapshot': snapshot, 'is_claim': {'t': True, 'true': True, 'f': False, 'false': False}.get(row.get('is_claim'))}
    return result


def archive_rows(item, targets, codec, container):
    path = Path(item['path'])
    require(any(path.is_relative_to(Path(root)) for root in ('/opt/business-os', '/var/backups', '/root')) and path.resolve() == path, 'BACKUP_PATH')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as handle:
        st = os.fstat(handle.fileno())
        require(all(getattr(st, 'st_' + k) == item[k] for k in ('size', 'mtime', 'ino', 'dev')), 'BACKUP_CHANGED')
        require(st.st_size <= 256 * 1024 * 1024, 'BACKUP_SIZE_LIMIT')
        digest = hashlib.sha256()
        for block in iter(lambda: handle.read(65536), b''): digest.update(block)
        handle.seek(0); compressed = handle.read(2) == b'\x1f\x8b'; handle.seek(0)
        stream = gzip.GzipFile(fileobj=handle) if compressed else handle
        magic = stream.read(5); stream.seek(0)
        if magic == b'PGDMP':
            with tempfile.TemporaryFile() as source, tempfile.TemporaryFile() as output:
                for block in iter(lambda: stream.read(65536), b''):
                    require(source.tell() + len(block) <= 512 * 1024 * 1024, 'EXPANDED_BACKUP_LIMIT')
                    source.write(block)
                source.seek(0)
                process = subprocess.run(['docker', 'exec', '-i', container, 'pg_restore', '--data-only', '--schema=public', '--table=orders', '--no-owner', '--no-privileges', '--file=-'], stdin=source, stdout=output, stderr=subprocess.PIPE, timeout=60)
                if process.returncode: return None, digest.hexdigest()
                output.seek(0); rows = parse_copy(output, targets, codec)
        else:
            rows = parse_copy(stream, targets, codec)
    return rows, digest.hexdigest()


def main():
    require(not sys.argv[1:], 'UNKNOWN_OPTION')
    require(PACKAGE.is_file() and PACKAGE.resolve() == PACKAGE and PACKAGE.stat().st_size < 1_000_000, 'INSTALLED_PACKAGE_MISSING')
    require(hashlib.sha256(PACKAGE.read_bytes()).hexdigest() == PACKAGE_SHA, 'INSTALLED_PACKAGE_HASH')
    sys.path.insert(0, str(PACKAGE))
    import database
    import claim_check
    from common import atomic, read
    target = database.route()
    remaining = json.loads(database.query(SQL, target=target))
    require(len(remaining) <= 10, 'TOO_MANY_UNRESOLVED_CLAIMS')
    print('REMAINING_CLAIMS=' + str(len(remaining)), flush=True)
    targets = {str(row['id']): row for row in remaining}
    for row in remaining:
        number = row.get('order_number') or row.get('external_id') or row['id']
        print('ORDER=' + str(number) + ' ID=' + str(row['id']) + ' STATUS=' + str(row['status']), flush=True)
        print('PAY=' + str(row['master_payout']) + ' FIRST_CLAIM=' + str(row['first_claim']), flush=True)
    candidates = []
    if targets:
        inventory = json.loads(read(Path('/tmp/bos-claim-backups.json'), 100000))
        for index, item in enumerate(inventory[:12]):
            rows, digest = archive_rows(item, targets, claim_check, target[0])
            if rows is None:
                print('BACKUP=' + str(index) + ' DECODER=UNAVAILABLE', flush=True); continue
            for key, match in rows.items():
                s = match['snapshot']
                candidates.append({'backup': index, 'sha256': digest, 'mtime': item['mtime'], **match})
        groups = {}
        for candidate in candidates:
            s = candidate['snapshot']
            key = (s['id'], s.get('status'), candidate['is_claim'], s.get('completed_at'), s.get('master_payout'))
            groups.setdefault(key, []).append(candidate['backup'])
        for (order_id, status, is_claim, date, pay), indices in list(groups.items())[:5]:
            print('BACKUPS=' + ','.join(map(str, indices)) + ' ID=' + str(order_id) + ' STATUS=' + str(status) + ' CLAIM=' + str(is_claim).lower())
            print('DATE=' + str(date) + ' PAY=' + str(pay))
        if len(groups) > 5: print('OTHER_GROUPS_SAVED=' + str(len(groups) - 5))
    atomic(Path('/tmp/bos-remaining-recovery.json'), json.dumps({'current': remaining, 'candidates': candidates}, ensure_ascii=False, allow_nan=False).encode())
    print('CANDIDATES=' + str(len(candidates)))
    print('PRODUCTION_CHANGED=false')


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('REMAINING_CHECK_STOPPED=' + (str(error) if isinstance(error, Stop) else type(error).__name__))
        raise SystemExit(1)
