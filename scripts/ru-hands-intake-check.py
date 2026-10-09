#!/usr/bin/env python3
"""Read-only Hands intake diagnosis on the RU Docker host (no apply mode).

Uses existing credentials in memory for GETs to the existing Hands API only.
No application/DB/provider mutations, imports, restarts or token changes.
Prints fixed categories/counts only; saves candidate IDs in a private host file.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tempfile
import time
import types
import urllib.error
import urllib.parse
import urllib.request

API_URL = 'https://api.hands.ru/api/v1/specialist/orders/'
DIAG_URL = ('https://raw.githubusercontent.com/zuev1ilya11-afk/business-os-vk/'
            '2c8585c3ae4ea39a1f3d21b66e49aa907a0c3f43/scripts/ru-check.py')
DIAG_SHA = '08ef726e1e081b578b1f782dc50b48583ecef531590fae9f3723ad68408d308d'
BASE = pathlib.Path('/opt/business-os/deploy')
MAX_BYTES = 8 * 1024 * 1024


class Stop(Exception):
    """Fixed, secret-free diagnostic code only."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def opener():
    # Never send existing credentials via a configured proxy or follow redirects.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def emit(key, value):
    print(key + '=' + json.dumps(value, ensure_ascii=True, separators=(',', ':')), flush=True)


def canonical(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise Stop('INVALID_EXTERNAL_ID')
    text = str(value)
    if text.startswith('hands:'):
        text = text[6:]
    if not re.fullmatch(r'[1-9][0-9]{0,19}', text):
        raise Stop('INVALID_EXTERNAL_ID')
    return 'hands:' + text


def integer(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise Stop('HANDS_PAGINATION_INVALID')
    return value


def collect_active(fetch_page, max_pages):
    """Require the observed explicit provider envelope; never silently truncate."""
    if not 1 <= max_pages <= 100:
        raise Stop('INVALID_PAGE_LIMIT')
    rows, identifiers, expected = [], set(), None
    for page in range(1, max_pages + 1):
        data = fetch_page(page)
        if not isinstance(data, dict) or not isinstance(data.get('orders'), list):
            raise Stop('HANDS_RESPONSE_INVALID')
        if not {'page', 'per_page', 'pages', 'total'}.issubset(data):
            raise Stop('HANDS_PAGINATION_REQUIRED')
        actual, size, pages, total = (integer(data[k]) for k in ('page', 'per_page', 'pages', 'total'))
        batch = data['orders']
        if actual != page or size < 1 or len(batch) > size or total > 10000:
            raise Stop('HANDS_PAGINATION_INVALID')
        metadata = (size, pages, total)
        if expected is not None and metadata != expected:
            raise Stop('HANDS_FEED_CHANGED')
        expected = metadata
        if not total:
            if page != 1 or batch or pages not in (0, 1):
                raise Stop('HANDS_PAGINATION_INVALID')
            return []
        if pages != (total + size - 1) // size or page > pages:
            raise Stop('HANDS_PAGINATION_INVALID')
        expected_count = min(size, total - (page - 1) * size)
        if len(batch) != expected_count:
            raise Stop('HANDS_FEED_CHANGED')
        for row in batch:
            if not isinstance(row, dict):
                raise Stop('HANDS_RESPONSE_INVALID')
            key = canonical(row.get('id'))
            if key in identifiers:
                raise Stop('HANDS_FEED_REPEATED_ID')
            identifiers.add(key)
            # Drop all customer payload fields immediately. No replay payload is saved.
            rows.append({'id': row['id'], 'creation_time': row.get('creation_time')})
        if page == pages:
            if len(rows) != total:
                raise Stop('HANDS_PAGINATION_INVALID')
            return rows
    raise Stop('HANDS_PAGE_LIMIT_REACHED')


def compare_ids(provider_rows, target_ids):
    counts = Counter(canonical(value) for value in target_ids)
    seen, missing = set(), []
    for row in provider_rows:
        key = canonical(row.get('id'))
        if key in seen:
            raise Stop('HANDS_FEED_REPEATED_ID')
        seen.add(key)
        if key not in counts:
            created = row.get('creation_time')
            # Keep only a parseable timestamp, never an arbitrary upstream string.
            if created is not None:
                try:
                    if not isinstance(created, str) or len(created) > 40:
                        raise ValueError()
                    datetime.fromisoformat(created.replace('Z', '+00:00'))
                except (ValueError, TypeError):
                    raise Stop('HANDS_CREATION_TIME_INVALID') from None
            missing.append({'external_id': key, 'creation_time': created})
    return {'upstream_active': len(seen), 'target_hands_rows': len(target_ids),
            'target_duplicate_groups': sum(n > 1 for n in counts.values()),
            'target_duplicate_extra_rows': sum(n - 1 for n in counts.values()),
            'missing': missing}


def fetch_json(url, headers, client=None, sleep=time.sleep):
    if urllib.parse.urlsplit(url)._replace(query='', fragment='').geturl() != API_URL:
        raise Stop('UNEXPECTED_HANDS_ORIGIN')
    client = client or opener()
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers=headers, method='GET')
            with client.open(request, timeout=15) as response:
                raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise Stop('HANDS_RESPONSE_TOO_LARGE')
                try:
                    return json.loads(raw)
                except (ValueError, UnicodeError):
                    raise Stop('HANDS_RESPONSE_NOT_JSON') from None
        except urllib.error.HTTPError as error:
            code = error.code
            error.close()
            if code not in (408, 429, 500, 502, 503, 504) or attempt == 2:
                raise Stop('HANDS_HTTP_' + str(code)) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt == 2:
                raise Stop('HANDS_TRANSPORT_FAILED') from None
        sleep(attempt + 1)
    raise Stop('HANDS_FETCH_FAILED')


def log_signals(text):
    patterns = {'db_staff': r'\bDB_STAFF\b', 'db_lookup': r'\bDB_LOOKUP\b',
                'db_insert': r'\bDB_INSERT\b', 'db_update': r'\bDB_UPDATE\b',
                'hands_key_missing': r'\bHANDS_API_KEY_NOT_CONFIGURED\b',
                'hands_auth': r'\bHANDS_(?:401|403)\b',
                'concurrent_change': r'\bORDER_CHANGED\b',
                'network': r'connection refused|network is unreachable|failed to lookup address',
                'bundle': r'invalid eszip|failed to deserialize|module not found'}
    return {name: len(re.findall(pattern, text, re.I)) for name, pattern in patterns.items()}


def save_manifest(base, data):
    folder = pathlib.Path(tempfile.mkdtemp(prefix='hands-intake-check-', dir=base))
    target = folder / 'candidates.json'
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(data, stream, ensure_ascii=True, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    return target


def load_diag():
    try:
        with opener().open(DIAG_URL, timeout=20) as response:
            data = response.read(100000)
        if hashlib.sha256(data).hexdigest() != DIAG_SHA:
            raise Stop('DIAGNOSTIC_DEPENDENCY_CHECKSUM')
    except Stop:
        raise
    except Exception:
        raise Stop('DIAGNOSTIC_DEPENDENCY_UNAVAILABLE') from None
    module = types.ModuleType('ru_check_pinned')
    exec(compile(data, 'ru-check-pinned.py', 'exec'), module.__dict__)
    return module


def context(diag):
    ids = diag.run(['docker', 'ps', '-q']).split()
    if not ids:
        raise Stop('NO_RUNNING_CONTAINERS')
    containers = json.loads(diag.run(['docker', 'inspect', *ids]))
    edges = [c for c in containers if diag.name(c).startswith('bos-release-') and diag.name(c).endswith('-edge')]
    if len(edges) != 1:
        raise Stop('ACTIVE_EDGE_AMBIGUOUS')
    edge = edges[0]
    prefix = diag.name(edge)[:-5]
    rests = [c for c in containers if diag.name(c) == prefix + '-rest']
    if len(rests) != 1:
        raise Stop('ACTIVE_REST_AMBIGUOUS')
    rest = rests[0]
    url = urllib.parse.urlsplit(diag.env(edge).get('BOS_REST_ORIGIN', ''))
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
        raise Stop('EDGE_REST_ROUTE_UNKNOWN')
    route_matches = set()
    for candidate in containers:
        for network in set(edge['NetworkSettings']['Networks']) & set(candidate['NetworkSettings']['Networks']):
            info = candidate['NetworkSettings']['Networks'][network]
            if url.hostname in [diag.name(candidate), info.get('IPAddress'), *(info.get('Aliases') or []), *(info.get('DNSNames') or [])]:
                route_matches.add(candidate['Id'])
    if route_matches != {rest['Id']}:
        raise Stop('EDGE_REST_ROUTE_MISMATCH')
    try:
        rest_port = int(diag.env(rest).get('PGRST_SERVER_PORT', '3000'))
        if not 1 <= rest_port <= 65535 or (url.port or (443 if url.scheme == 'https' else 80)) != rest_port:
            raise ValueError()
    except ValueError:
        raise Stop('EDGE_REST_PORT_MISMATCH') from None
    # The reused URI resolver deliberately handles only authority/path. Reject
    # libpq query overrides rather than certifying a different effective target.
    try:
        db_url = urllib.parse.urlsplit(diag.env(rest).get('PGRST_DB_URI', ''))
        if (db_url.scheme not in ('postgres', 'postgresql') or not db_url.hostname
                or db_url.query or db_url.fragment or db_url.port not in (None, 5432)):
            raise ValueError()
    except ValueError:
        raise Stop('REST_DATABASE_URI_UNSUPPORTED') from None
    db, dbname = diag.find_db(rest, containers)
    if diag.name(db) != prefix + '-db':
        raise Stop('REST_POINTS_TO_OTHER_DATABASE_CONTAINER')
    return edge, rest, db, dbname


def target_snapshot(diag, db, dbname):
    return diag.sql(db, dbname, "SELECT json_build_object('checked_at',now(),"
        "'hands_ids',(SELECT coalesce(json_agg(external_id),'[]'::json) FROM public.orders WHERE external_source='hands'),"
        "'orders_total',(SELECT count(*) FROM public.orders),"
        "'last_hands_created_at',(SELECT max(created_at) FROM public.orders WHERE external_source='hands'),"
        "'receipts',(SELECT count(*) FROM public.hands_webhook_deliveries),"
        "'last_receipt_at',(SELECT max(received_at) FROM public.hands_webhook_deliveries))")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--max-pages', type=int, default=20, choices=range(1, 101), metavar='1..100')
    args = parser.parse_args()
    emit('BOS_HANDS_INTAKE_CHECK', {'application_changes': False, 'scope': 'ACTIVE feed only'})
    diag = load_diag()
    edge, rest, db, dbname = context(diag)
    emit('runtime', {'release': diag.name(edge)[:-5], 'database_container': diag.name(db),
                     'edge_started_at': edge['State'].get('StartedAt'),
                     'edge_restart_policy': edge['HostConfig'].get('RestartPolicy', {}).get('Name'),
                     'database_route_metadata_matches': True})
    before = target_snapshot(diag, db, dbname)
    emit('target_before', {k: v for k, v in before.items() if k != 'hands_ids'})
    try:
        diag.sources(edge)
    except Exception:
        emit('source_metadata', 'UNAVAILABLE')
    try:
        result = subprocess.run(['docker', 'logs', '--since', '48h', '--tail', '500', edge['Id']],
                                capture_output=True, timeout=15)
        if result.returncode:
            raise Stop('LOGS_UNAVAILABLE')
        emit('bounded_log_signals', log_signals((result.stdout + result.stderr)[:MAX_BYTES].decode(errors='replace')))
        emit('log_limitations', 'last 500 lines only; handler may return errors without logging them')
    except Exception:
        emit('bounded_log_signals', 'UNAVAILABLE')
    try:
        cron = diag.sql(db, dbname, "SELECT json_build_object('jobs',count(*),'active',count(*) FILTER(WHERE active),"
            "'active_hands_api_jobs',count(*) FILTER(WHERE active AND command LIKE '%hands-api%'),"
            "'active_hands_report_jobs',count(*) FILTER(WHERE active AND command LIKE '%hands-report-api%')) FROM cron.job")
        emit('cron', cron)
        history = diag.sql(db, dbname, "SELECT json_build_object('last_success',max(end_time) FILTER(WHERE status='succeeded'),"
            "'last_failure',max(end_time) FILTER(WHERE status='failed'),'failures_48h',count(*) FILTER(WHERE status='failed')) "
            "FROM cron.job_run_details WHERE start_time > now()-interval '48 hours'")
        emit('cron_history_all_jobs', history)
    except Exception:
        emit('cron_history', 'UNAVAILABLE')
    key = diag.env(edge).get('HANDS_API_KEY', '')
    emit('hands_api_key_configured_on_edge', bool(key))
    if not key:
        raise Stop('HANDS_API_KEY_NOT_CONFIGURED_ON_EDGE')
    started = datetime.now(timezone.utc).isoformat()
    def page(number):
        query = urllib.parse.urlencode({'status': 'ACTIVE', 'per_page': 100, 'page': number})
        return fetch_json(API_URL + '?' + query, {'X-Api-Key': key, 'Accept': 'application/json'})
    rows = collect_active(page, args.max_pages)
    after = target_snapshot(diag, db, dbname)
    current = context(diag)
    if [c['Id'] for c in current[:3]] != [c['Id'] for c in (edge, rest, db)] or current[3] != dbname or current[0]['State'].get('StartedAt') != edge['State'].get('StartedAt'):
        raise Stop('ACTIVE_RUNTIME_CHANGED_RETRY_CHECK')
    result = compare_ids(rows, after['hands_ids'])
    missing = result.pop('missing')
    summary = {**result, 'missing_active_candidates': len(missing), 'imported': 0,
               'target_checked_at': after['checked_at'], 'last_receipt_at': after['last_receipt_at']}
    manifest = {'schema': 1, 'scope': 'ACTIVE feed only; not a full cutover-window comparison',
                'apply_supported': False, 'provider_read_from': started, 'summary': summary,
                'runtime': {'edge_id': edge['Id'], 'rest_id': rest['Id'], 'db_id': db['Id']},
                'missing': missing, 'limitations': [
                    'No payloads saved; not suitable for blind inserts or replay.',
                    'Provider feed is not a transactional snapshot; refresh before any recovery.',
                    'Host API GET does not prove edge egress or inbound provider delivery.',
                    'Completed/cancelled/deleted orders and old-source-only events require separate reconciliation.']}
    path = save_manifest(BASE, manifest)
    emit('reconciliation', summary)
    emit('private_candidate_manifest', str(path))
    emit('BOS_HANDS_INTAKE_CHECK_DONE', 'READ_ONLY; intake recovery remains unverified')


if __name__ == '__main__':
    try:
        main()
    except Stop as error:
        emit('CHECK_STOPPED', str(error))
        raise SystemExit(1)
    except Exception as error:
        # Never print exception text, traceback, request URLs, headers or DB data.
        emit('CHECK_STOPPED', type(error).__name__)
        raise SystemExit(1)
