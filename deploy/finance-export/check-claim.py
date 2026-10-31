#!/usr/bin/env python3
"""Read-only, bounded diagnostic for order 7395762 on the existing RU host.

No database writes, downloads, restarts, report attachments or customer contacts.
Docker environment values are used privately to resolve the active DB route.
"""
import json
import re
import subprocess
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


def read_report():
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
    data = json.loads(command(['docker', 'exec', db['Id'], 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', name, '-c', SQL]))
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
        emit(read_report())
    except Exception as error:
        # Never emit database errors, command stderr, credentials or internal routes.
        print('CLAIM_CHECK_STOPPED=' + (str(error) if isinstance(error, Stop) else type(error).__name__))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
