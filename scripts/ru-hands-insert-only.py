#!/usr/bin/env python3
"""Exact, insert-only intake patch for the reviewed private v11 Hands handler.

Imported by the guarded RU staging/recovery runner. No actions at import time.
The tracked public full handler must never replace the private production file.
"""
import hashlib


class Stop(Exception):
    pass


IMPORT_SHA = '3fcb8d9383adf456d8396fd46e24a52550fc602e21d52dae93ff206f118dea24'
WEBHOOK_SHA = '4a99cece8a2c11dfd70364dd6a15238297efe4465be13915a344395acadb017a'
MARKER = '// BOS_HANDS_INSERT_ONLY_V1\n'


def once(source, old, new):
    if source.count(old) != 1:
        raise Stop('PRIVATE_INTAKE_DRIFT')
    return source.replace(old, new, 1)


def function_line(source, name, expected):
    marker = 'async function ' + name + '('
    if source.count(marker) != 1:
        raise Stop('PRIVATE_INTAKE_DRIFT')
    start = source.index(marker)
    end = source.find('\n', start)
    end = len(source) if end < 0 else end
    value = source[start:end].rstrip()
    if hashlib.sha256(value.encode()).hexdigest() != expected:
        raise Stop('PRIVATE_INTAKE_DRIFT')
    return value


def patch_source(source):
    if MARKER in source:
        raise Stop('INTAKE_ALREADY_PATCHED')
    original = function_line(source, 'importOrder', IMPORT_SHA)
    webhook = function_line(source, 'webhook', WEBHOOK_SHA)
    new = once(original, 'map:Map<string,any>){',
               'map:Map<string,any>,onlyNew=false,createdAt:string|null=null){')
    new = once(new, "const prev=await db.from('orders').select(",
               "const lookup=db.from('orders').select(")
    new = once(new, ".eq('external_source','hands').eq('external_id',localExternalId(id)).maybeSingle();",
               ".eq('external_source','hands');const prev=await (onlyNew?lookup.in('external_id',[localExternalId(id),id]):lookup.eq('external_id',localExternalId(id))).maybeSingle();")
    new = once(new, "if(prev.error)throw new Error(`DB_LOOKUP: ${errText(prev.error)}`);",
               "if(prev.error)throw new Error(onlyNew?'DB_LOOKUP':`DB_LOOKUP: ${errText(prev.error)}`);if(onlyNew&&prev.data)return{ok:true,id:prev.data.id,created:false,skipped:true};")
    new = once(new, "const q=await db.from('orders').insert(",
               "if(onlyNew&&createdAt)base.created_at=createdAt;const q=await db.from('orders').insert(")
    new = once(new, "if(q.error)throw new Error(`DB_INSERT: ${errText(q.error)}`);",
               "if(q.error){if(onlyNew&&q.error.code==='23505'){const winner=await db.from('orders').select('id').eq('external_source','hands').in('external_id',[localExternalId(id),id]).maybeSingle();if(!winner.error&&winner.data)return{ok:true,id:winner.data.id,created:false,skipped:true}}throw new Error(onlyNew?'DB_INSERT':`DB_INSERT: ${errText(q.error)}`)}")
    changed = once(webhook, "const r=await importOrder(db,order,await staffMap(db));",
        "let createdAt:string|null=null;if(Object.prototype.hasOwnProperty.call(body,'recovery_created_at')){const value=(body as any).recovery_created_at;if(typeof value!=='string'||!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)return json({ok:false,error:'INVALID_RECOVERY_DATE'},400);createdAt=value}const r=await importOrder(db,order,await staffMap(db),true,createdAt);")
    changed = once(changed, "await db.from('hands_webhook_deliveries').insert({delivery_id:delivery,order_external_id:externalId(order.id)});",
        "const receipt=await db.from('hands_webhook_deliveries').insert({delivery_id:delivery,order_external_id:externalId(order.id)});if(receipt.error&&receipt.error.code!=='23505')throw new Error('WEBHOOK_RECEIPT_FAILED');")
    changed = once(changed, "created:!!r.created,order_id:r.id",
                   "created:!!r.created,skipped:!!r.skipped,order_id:r.id")
    return MARKER + once(once(source, original, new), webhook, changed)


# All deployment primitives below are the already reviewed, immutable helpers
# from #278; only their generic build/atomic-install operations are reused.
BASE_PATH = '/opt/business-os/deploy'
DEPENDENCIES = {
    'stage': ('2c8585c3ae4ea39a1f3d21b66e49aa907a0c3f43', 'ru-hands-stage.py',
              'b45ccf6eb4815c5b0545f63a3175885cb4545ca54b7c447f62ad38d2310461b9'),
    'act': ('2c8585c3ae4ea39a1f3d21b66e49aa907a0c3f43', 'ru-hands-activate.py',
            '1a63f70581aa78534eb1d46ff27cbac7196725068e587056820e7ce0edaca946'),
    'token': ('2c8585c3ae4ea39a1f3d21b66e49aa907a0c3f43', 'ru-hands-token.py',
              '3a550544b95deca050a1d4c0341d9943280667ebe4a32a3402f52f9f0bf21c82'),
    'intake': ('f71fd2fe7d29332ee41dc0c8b5d3dabdeb611f96', 'ru-hands-intake-check.py',
               '24abb6e5b4d9a9ec777a2fc8c59c98d1c772b1e00741956f0164cc1e11c08e39'),
}


def dependencies():
    import types
    import urllib.request
    loaded = {}
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for key, (commit, name, checksum) in DEPENDENCIES.items():
        url = 'https://raw.githubusercontent.com/zuev1ilya11-afk/business-os-vk/' + commit + '/scripts/' + name
        with client.open(url, timeout=20) as response:
            data = response.read(100000)
        if hashlib.sha256(data).hexdigest() != checksum:
            raise Stop('HELPER_CHECKSUM_MISMATCH')
        module = types.ModuleType('pinned_' + key)
        exec(compile(data, name, 'exec'), module.__dict__)
        loaded[key] = module
    return loaded


def current(deps):
    intake, helper, act = (deps[k] for k in ('intake', 'stage', 'act'))
    diag = intake.load_diag()
    edge, rest, db, dbname = intake.context(diag)
    unique = diag.sql(db, dbname,
        "SELECT to_json(EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid='public.orders'::regclass "
        "AND i.indisunique AND i.indisvalid AND i.indisready "
        "AND pg_get_indexdef(i.indexrelid) LIKE '% USING btree (external_source, external_id)%' "
        "AND (i.indpred IS NULL OR pg_get_expr(i.indpred,i.indrelid)='(external_id IS NOT NULL)')))")
    if unique is not True:
        raise Stop('EXTERNAL_ID_UNIQUENESS_NOT_CONFIRMED')
    if not act.client_target_ok(edge, diag.env(edge).get('SUPABASE_URL', ''), helper):
        raise Stop('CLIENT_TARGET_NOT_RU')
    roots = [helper.mount_path(edge, destination) for destination in ('/bos-src', '/bos-bundles', '/bos-main')]
    if len({p.parent for p in roots}) != 1:
        raise Stop('RELEASE_MOUNTS_DISAGREE')
    source = roots[0] / 'hands-api/index.ts'
    bundle = roots[1] / 'hands-api.eszip'
    token = helper.token_from(act.read(source))
    act.public_check(token)  # Empty POST: MISSING_DELIVERY, before any DB access.
    return diag, edge, rest, db, dbname, roots, source, bundle, token


def verify_saved(deps, root, state, *, installed):
    import json
    act = deps['act']
    diag, edge, rest, db, dbname, roots, source, bundle, token = current(deps)
    saved = json.loads(act.read(root / 'runtime.json'))
    deps['token'].private_directory(root)
    if act.identity(edge) != act.identity(saved):
        raise Stop('RUNTIME_CONFIGURATION_CHANGED')
    act.validate_manifest_target(state, saved)
    original = act.read(root / 'backup/index.ts').decode()
    if act.read(root / 'sources/hands-api/index.ts').decode() != patch_source(original):
        raise Stop('PATCH_NOT_EXACT')
    for before, target, old, new in (
        ('source', source, root / 'backup/index.ts', root / 'sources/hands-api/index.ts'),
        ('bundle', bundle, root / 'backup/hands-api.eszip', root / 'bundles/hands-api.eszip'),
    ):
        if act.digest(old) != state[before + '_before'] or act.digest(new) != state[before + '_after']:
            raise Stop('PATCH_OR_BACKUP_CHANGED')
        if act.digest(target) != state[before + ('_after' if installed else '_before')]:
            raise Stop('LIVE_FILES_CHANGED')
    if act.digest(root / 'output/hands-api.eszip') != state['bundle_after']:
        raise Stop('COMPILER_OUTPUT_CHANGED')
    for live, name, exceptions in zip(roots, ('sources', 'bundles', 'main'),
                                      ({'hands-api/index.ts'}, {'hands-api.eszip'}, set())):
        a, b = act.tree_hashes(live), act.tree_hashes(root / name)
        if {k:v for k,v in a.items() if k not in exceptions} != {k:v for k,v in b.items() if k not in exceptions}:
            raise Stop('DEPENDENCIES_CHANGED')
    return diag, edge, rest, db, dbname, token


def rollback_patch(deps, root):
    import json
    act, helper, intake = deps['act'], deps['stage'], deps['intake']
    deps['token'].private_directory(root)
    state = json.loads(act.read(root / 'manifest.json'))
    saved = json.loads(act.read(root / 'runtime.json'))
    journal = json.loads(act.read(root / 'activation.json'))
    act.validate_manifest_target(state, saved)
    deps['token'].validate_journal(root, state, journal)
    # Rollback must also work when the failed edge is stopped or fails HTTPS.
    edge = act.inspect(saved['Id'], root)
    if act.identity(edge) != act.identity(saved):
        raise Stop('RUNTIME_CONFIGURATION_CHANGED')
    if journal.get('state') == 'rolled_back':
        raise Stop('ALREADY_ROLLED_BACK')
    original = act.read(root / 'backup/index.ts')
    if act.read(root / 'sources/hands-api/index.ts') != patch_source(original.decode()).encode():
        raise Stop('PATCH_NOT_EXACT')
    for destination, directory, exceptions in (
        ('/bos-src', 'sources', {'hands-api/index.ts'}),
        ('/bos-bundles', 'bundles', {'hands-api.eszip'}), ('/bos-main', 'main', set())
    ):
        a, b = act.tree_hashes(helper.mount_path(edge, destination)), act.tree_hashes(root / directory)
        if {k:v for k,v in a.items() if k not in exceptions} != {k:v for k,v in b.items() if k not in exceptions}:
            raise Stop('DEPENDENCIES_CHANGED')
    act.validate_items(journal['items'], ('before', 'after'))
    token = helper.token_from(original)
    act.recover(root, lambda: act.restart_and_check(root, saved, token))
    print('BOS_HANDS_FILES_ROLLED_BACK; application data was not rolled back', flush=True)


def isolated(deps, root, saved, token):
    import json
    import time
    import uuid
    import sys
    act, helper = deps['act'], deps['stage']
    gateway = '\n'.join(p.read_text() for p in (root / 'main').rglob('*.ts'))
    helper.check_gateway(gateway)
    env = dict(entry.split('=', 1) for entry in saved['Config']['Env'] if '=' in entry)
    values = helper.candidate_environment(gateway, env)
    name = 'bos-hands-insert-test-' + uuid.uuid4().hex
    args = ['docker', 'run', '-d', '--pull=never', '--network', 'none', '--name', name, *helper.RESOURCE_LIMITS]
    for key, value in values.items():
        args += ['-e', key + '=' + value]
    for directory, target in (('sources', '/bos-src'), ('bundles', '/bos-bundles'), ('main', '/bos-main')):
        args += ['--mount', 'type=bind,src=' + str(root / directory) + ',dst=' + target + ',readonly']
    entry = saved['Config'].get('Entrypoint')
    if entry:
        if len(entry) != 1:
            raise Stop('ENTRYPOINT_NOT_REVIEWED')
        args += ['--entrypoint', entry[0]]
    args += [saved['Image'], *(saved['Config'].get('Cmd') or [])]
    try:
        act.command(args, root, 'isolated-start')
        for attempt in range(6):
            info = act.inspect(name, root)
            if not isolated_network(info):
                raise Stop('ISOLATION_FAILED')
            interfaces = helper.command(['nsenter', '-t', str(info['State']['Pid']), '-n', sys.executable,
                '-c', 'import socket,json;print(json.dumps([n for _,n in socket.if_nameindex()]))'],
                root, 'isolated-interfaces')
            if json.loads(interfaces) != ['lo']:
                raise Stop('ISOLATION_FAILED')
            checks = helper.probe(['/hands-api', '/functions/v1/hands-api'], token, root,
                                  'isolated-probe', pid=info['State']['Pid'])
            if any(x['ok'] for x in checks):
                return
            time.sleep(1)
        raise Stop('ISOLATED_WEBHOOK_FAILED')
    finally:
        act.command(['docker', 'rm', '-f', name], root, 'isolated-cleanup')


def isolated_network(info):
    return (info['State']['Running'] is True and info['HostConfig']['NetworkMode'] == 'none'
            and set(info['NetworkSettings']['Networks']).issubset({'none'}))


def install_patch(deps, root):
    import json
    import shutil
    import uuid
    act, helper = deps['act'], deps['stage']
    if root.exists():
        state = json.loads(act.read(root / 'manifest.json'))
        journal = json.loads(act.read(root / 'activation.json'))
        if journal.get('state') != 'activated':
            raise Stop('PREVIOUS_ATTEMPT_REQUIRES_REVIEW')
        verify_saved(deps, root, state, installed=True)
        print('BOS_HANDS_INSERT_ONLY_ALREADY_ACTIVE', flush=True)
        return
    diag, edge, rest, db, dbname, roots, source, bundle, token = current(deps)
    helper.require_memory(__import__('pathlib').Path('/proc/meminfo').read_text())
    total = sum(helper.tree_size(p) for p in roots)
    if total > 512 * 1024 * 1024 or shutil.disk_usage(root.parent).free < max(1024**3, total * 3):
        raise Stop('STAGING_SPACE_REQUIRED')
    original = act.read(source)
    after = patch_source(original.decode()).encode()
    root.mkdir(mode=0o700)
    act.write_json(root / 'runtime.json', edge)
    for directory, old in zip(('sources', 'bundles', 'main'), roots):
        shutil.copytree(old, root / directory)
    (root / 'backup').mkdir()
    (root / 'backup/index.ts').write_bytes(original)
    (root / 'backup/hands-api.eszip').write_bytes(act.read(bundle))
    state = {'source':str(source), 'bundle':str(bundle), 'edge_id':edge['Id'], 'image':edge['Image'],
             'source_before':act.sha(original), 'source_after':act.sha(after), 'bundle_before':act.digest(bundle)}
    act.write_json(root / 'manifest.json', state)
    print('BACKUP_OK; reproducing current bundle, then building the isolated patch', flush=True)
    deps['token'].build_bundle(act, helper, root, state, after, uuid.uuid4().hex)
    state['bundle_after'] = act.digest(root / 'bundles/hands-api.eszip')
    act.write_json(root / 'manifest.json', state)
    isolated(deps, root, edge, token)
    verify_saved(deps, root, state, installed=False)
    items = [act.file_item(source, root / 'sources/hands-api/index.ts', root / 'backup/index.ts'),
             act.file_item(bundle, root / 'bundles/hands-api.eszip', root / 'backup/hands-api.eszip')]
    print('ISOLATED_CHECK_OK; restarting the existing API with automatic file rollback', flush=True)
    act.install(root, items, lambda: act.restart_and_check(root, edge, token),
                lambda: act.restart_and_check(root, edge, token))
    verify_saved(deps, root, state, installed=True)
    print('BOS_HANDS_INSERT_ONLY_ACTIVE; no orders imported', flush=True)


def creation_date(value, zone_name):
    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo
    if not isinstance(value, str):
        raise Stop('CREATION_TIME_REQUIRED')
    try:
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if value.tzinfo is None:
            if not zone_name:
                raise Stop('HANDS_TIMEZONE_REQUIRED')
            zone = ZoneInfo(zone_name)
            a, b = value.replace(tzinfo=zone, fold=0), value.replace(tzinfo=zone, fold=1)
            if a.utcoffset() != b.utcoffset():
                raise Stop('AMBIGUOUS_CREATION_TIME')
            value = a
        return value.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    except Stop:
        raise
    except Exception:
        raise Stop('CREATION_TIME_INVALID') from None


def send_recovery(intake, token, row, created, sleep=None):
    import json
    import time
    import urllib.error
    import urllib.parse
    import urllib.request
    import uuid
    sleep = sleep or time.sleep
    order_id = intake.canonical(row.get('id'))
    delivery = str(uuid.uuid5(uuid.NAMESPACE_URL, 'bos-hands-recovery-v1/' + order_id))
    data = json.dumps({'event':'CREATED', 'order':row, 'recovery_created_at':created}).encode()
    url = 'https://139.100.237.167/functions/v1/hands-api?' + urllib.parse.urlencode({'token':token})
    for attempt in range(3):
        request = urllib.request.Request(url, data=data, headers={
            'Content-Type':'application/json', 'x-hands-delivery':delivery, 'x-hands-event':'CREATED'})
        try:
            with intake.opener().open(request, timeout=15) as response:
                result = json.loads(response.read(8192))
            if result.get('ok') is not True:
                raise Stop('RECOVERY_RESPONSE_REJECTED')
            return {k:bool(result.get(k)) for k in ('created', 'skipped', 'duplicate')}
        except urllib.error.HTTPError as error:
            code = error.code
            error.close()
            if code not in (408, 429, 500, 502, 503, 504) or attempt == 2:
                raise Stop('RECOVERY_HTTP_' + str(code)) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt == 2:
                raise Stop('RECOVERY_TRANSPORT_FAILED') from None
        sleep(attempt + 1)
    raise Stop('RECOVERY_FAILED')


def recover_orders(deps, root, zone_name):
    import json
    import uuid
    import urllib.parse
    from datetime import datetime, timezone
    act, intake = deps['act'], deps['intake']
    state = json.loads(act.read(root / 'manifest.json'))
    if json.loads(act.read(root / 'activation.json')).get('state') != 'activated':
        raise Stop('INSERT_ONLY_NOT_ACTIVE')
    diag, edge, rest, db, dbname, token = verify_saved(deps, root, state, installed=True)
    before = intake.target_snapshot(diag, db, dbname)
    target = {intake.canonical(x) for x in before['hands_ids']}
    payloads = {}
    key = diag.env(edge).get('HANDS_API_KEY')
    if not key:
        raise Stop('HANDS_API_KEY_REQUIRED')
    def page(number):
        query = urllib.parse.urlencode({'status':'ACTIVE', 'per_page':100, 'page':number})
        result = intake.fetch_json(intake.API_URL + '?' + query, {'X-Api-Key':key, 'Accept':'application/json'})
        for row in result.get('orders', []):
            if intake.canonical(row.get('id')) not in target:
                payloads[intake.canonical(row['id'])] = row
        return result
    rows = intake.collect_active(page, 20)
    snapshot = intake.target_snapshot(diag, db, dbname)
    comparison = intake.compare_ids(rows, snapshot['hands_ids'])
    if comparison['target_duplicate_groups']:
        raise Stop('TARGET_DUPLICATES_REQUIRE_REVIEW')
    if rows and not any(intake.canonical(row['id']) in target for row in rows):
        raise Stop('API_ACCOUNT_OVERLAP_NOT_CONFIRMED')
    if len(comparison['missing']) > 20:
        raise Stop('RECOVERY_BATCH_REQUIRES_REVIEW')
    # Validate all dates before the first import; raw customer payloads stay in RAM.
    batch = [(item['external_id'], creation_date(item['creation_time'], zone_name)) for item in comparison['missing']]
    if not {key for key,_ in batch}.issubset(payloads):
        raise Stop('TARGET_CHANGED_DURING_ENUMERATION')
    verify_saved(deps, root, state, installed=True)
    record = {'started_at':datetime.now(timezone.utc).isoformat(), 'scope':'ACTIVE',
              'timezone_for_naive_dates':zone_name, 'candidates':[k for k,_ in batch], 'results':[]}
    journal = root / ('recovery-' + uuid.uuid4().hex + '.json')
    act.write_json(journal, record)
    for identifier, created in batch:
        # Each request uses the same existing importer, now guaranteed insert-only.
        result = send_recovery(intake, token, payloads[identifier], created)
        record['results'].append({'external_id':identifier, **result})
        act.write_json(journal, record)
    after = intake.target_snapshot(diag, db, dbname)
    final = intake.compare_ids(rows, after['hands_ids'])
    record.update(finished_at=datetime.now(timezone.utc).isoformat(),
                  candidate_count=len(batch),
                  confirmed_present=sum(identifier in {intake.canonical(x) for x in after['hands_ids']} for identifier,_ in batch),
                  acknowledged_created=sum(x['created'] for x in record['results']),
                  acknowledged_skipped_or_duplicate=sum(x['skipped'] or x['duplicate'] for x in record['results']),
                  remaining_missing=len(final['missing']), duplicate_groups=final['target_duplicate_groups'],
                  last_receipt_at=after['last_receipt_at'])
    act.write_json(journal, record)
    act.write_json(root / 'recovery-last.json', {'journal':str(journal), **record})
    print('BOS_HANDS_RECOVERY=' + json.dumps({k:record[k] for k in (
        'scope', 'candidate_count', 'confirmed_present', 'acknowledged_created',
        'acknowledged_skipped_or_duplicate', 'remaining_missing', 'duplicate_groups', 'last_receipt_at')}), flush=True)
    if final['missing'] or final['target_duplicate_groups']:
        raise Stop('RECOVERY_RECONCILIATION_FAILED')
    act.write_json(root / 'health.json', {'last_successful_active_reconciliation':record['finished_at'],
                                        'remaining_missing':0, 'duplicate_groups':0})
    print('BOS_HANDS_ACTIVE_RECONCILED; real provider delivery still requires verification', flush=True)


def main():
    import argparse
    import fcntl
    import os
    import pathlib
    import signal
    import sys
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--check', action='store_true')
    group.add_argument('--apply', action='store_true')
    group.add_argument('--recover', action='store_true')
    group.add_argument('--rollback', action='store_true')
    parser.add_argument('--timezone', help='Confirmed timezone of naive Hands creation_time values')
    args = parser.parse_args()
    base = pathlib.Path(BASE_PATH)
    if os.geteuid() != 0 or not base.is_dir():
        raise Stop('RUN_AS_ROOT_ON_RU_HOST')
    os.umask(0o077)
    sys.dont_write_bytecode = True
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    deps = dependencies()
    root = base / 'hands-insert-only-v1'
    deps['act'].safe_path(root)
    lock = deps['act'].safe_path(base / '.hands-activation.lock')
    with lock.open('a') as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Stop('OTHER_HANDS_OPERATION_RUNNING') from None
        if args.apply:
            install_patch(deps, root)
        elif args.recover:
            recover_orders(deps, root, args.timezone)
        elif args.rollback:
            rollback_patch(deps, root)
        else:
            diag, edge, rest, db, dbname, roots, source, bundle, token = current(deps)
            print('BOS_HANDS_TOKEN_ACCEPTED; empty request rejected before order processing', flush=True)
            print('INSERT_ONLY_PATCH_PRESENT=' + str(MARKER in deps['act'].read(source).decode()), flush=True)
            snapshot = deps['intake'].target_snapshot(diag, db, dbname)
            deps['intake'].emit('receipts', {k:snapshot[k] for k in ('checked_at', 'receipts', 'last_receipt_at')})


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        # No URLs, customer payloads, source lines, credentials or provider errors.
        print('BOS_HANDS_STOPPED=' + (str(error) if isinstance(error, Stop) else type(error).__name__), flush=True)
        raise SystemExit(1)
