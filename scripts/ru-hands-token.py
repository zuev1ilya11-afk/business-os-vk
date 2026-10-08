#!/usr/bin/env python3
"""Rotate only the private Hands webhook token using hidden terminal input.

Requires the successful guarded Hands activation. Reuses its immutable reviewed
transaction helper. No DB writes, recovery imports, API-key or provider changes.
"""
import fcntl
import getpass
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import shutil
import signal
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import warnings

BASE = pathlib.Path('/opt/business-os/deploy')
ACT_PIN = 'c8cc5b94a366a3f3e4fe8818d664f2165e90740f'
ACT_SHA = '1a63f70581aa78534eb1d46ff27cbac7196725068e587056820e7ce0edaca946'
TOKEN = re.compile(rb'\bWEBHOOK_TOKEN\s*=\s*([\'"])([A-Za-z0-9._~+/=\-]{16,512})\1')
FORMAT = 'BOS_HANDS_WEBHOOK_TOKEN_V1'


class Stop(Exception):
    pass


TRUSTED_ERRORS = [Stop]


def token_match(source):
    matches = list(TOKEN.finditer(source))
    if len(matches) != 1 or len(re.findall(rb'\bWEBHOOK_TOKEN\s*=', source)) != 1:
        raise Stop('unique reviewed webhook token declaration required')
    return matches[0]


def token_value(source):
    return token_match(source)[2].decode('ascii')


def mask_token(source):
    match = token_match(source)
    return source[:match.start(1)] + b'"<WEBHOOK_TOKEN>"' + source[match.end():]


def replace_token(source, value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9._~+/=\-]{16,512}', value):
        raise Stop('enter only the webhook token: 16-512 ASCII token characters, no spaces or URL')
    match = token_match(source)
    if value == token_value(source):
        raise Stop('new token equals current token; nothing changed')
    return source[:match.start(1)] + json.dumps(value).encode('ascii') + source[match.end():]


def read_new_token():
    if not sys.stdin.isatty():
        raise Stop('interactive terminal required for hidden token input')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            value = getpass.getpass('NEW_WEBHOOK_TOKEN (hidden): ')
    except (getpass.GetPassWarning, EOFError, KeyboardInterrupt):
        raise Stop('hidden token input unavailable or cancelled; nothing changed') from None
    return value


def safe(path):
    path = pathlib.Path(path)
    if not path.is_absolute() or '..' in path.parts or any(p.is_symlink() for p in (path, *path.parents)):
        raise Stop('unexpected linked/noncanonical private path')
    return path


def read(path, limit=8 * 1024 * 1024):
    path = safe(path)
    if not path.is_file() or path.stat().st_size > limit:
        raise Stop('required private file missing or too large')
    return path.read_bytes()


def private_directory(path):
    info = safe(path).stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
        raise Stop('private stage ownership or permissions changed')


def original_stage():
    found = []
    for folder in BASE.glob('hands-stage-*'):
        if not (folder / 'activation.json').exists():
            continue
        private_directory(folder)
        if json.loads(read(folder / 'activation.json')).get('state') == 'activated':
            found.append(folder)
    if len(found) != 1:
        raise Stop('one successful Hands activation stage required')
    return found[0]


def load_activation(root):
    path = safe(root / 'token-activation-helper.py')
    if not path.exists():
        url = 'https://raw.githubusercontent.com/zuev1ilya11-afk/business-os-vk/' + ACT_PIN + '/scripts/ru-hands-activate.py'
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                content = response.read(100000)
        except Exception:
            raise Stop('cannot download pinned activation helper') from None
        if hashlib.sha256(content).hexdigest() != ACT_SHA:
            raise Stop('activation helper checksum mismatch')
        with path.open('xb') as stream:
            stream.write(content)
    if hashlib.sha256(read(path)).hexdigest() != ACT_SHA:
        raise Stop('activation helper checksum mismatch')
    spec = importlib.util.spec_from_file_location('token_activation', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def expected_items(work, manifest):
    return [
        (pathlib.Path(manifest['source']), work / 'sources/hands-api/index.ts', work / 'backup/index.ts',
         manifest['source_before'], manifest['source_after']),
        (pathlib.Path(manifest['bundle']), work / 'bundles/hands-api.eszip', work / 'backup/hands-api.eszip',
         manifest['bundle_before'], manifest['bundle_after']),
    ]


def validate_journal(work, manifest, journal):
    items = journal.get('items', [])
    if len(items) != 2:
        raise Stop('rotation journal must contain exactly source and bundle')
    for item, expected in zip(items, expected_items(work, manifest)):
        target, new, backup, before, after = expected
        if tuple(item.get(k) for k in ('target', 'new', 'backup', 'before', 'after')) != (
                str(target), str(new), str(backup), before, after):
            raise Stop('rotation journal paths/checksums changed')
        if any(type(item.get(k)) is not int or item[k] < 0 for k in ('uid', 'gid', 'mode')) or item['mode'] > 0o777:
            raise Stop('rotation journal permissions invalid')


def verify_payload(act, work, manifest, *, compiler_output=True):
    for _, staged, backup, before, after in expected_items(work, manifest):
        if act.digest(staged) != after or act.digest(backup) != before:
            raise Stop('rotation payload or original backup changed')
    if compiler_output and act.digest(work / 'output/hands-api.eszip') != manifest['bundle_after']:
        raise Stop('rotated bundle differs from exact compiler output')


def check_scope(act, helper, root, manifest, edge):
    source = pathlib.Path(manifest['source'])
    if mask_token(act.read(source)) != mask_token(act.read(root / 'sources/hands-api/index.ts')):
        raise Stop('live source changed outside the webhook token')
    for target, folder, excluded in (
        ('/bos-src', 'sources', {'hands-api/index.ts'}),
        ('/bos-bundles', 'bundles', {'hands-api.eszip'}), ('/bos-main', 'main', set()),
    ):
        live = act.tree_hashes(helper.mount_path(edge, target))
        original = act.tree_hashes(root / folder)
        if {k: v for k, v in live.items() if k not in excluded} != {k: v for k, v in original.items() if k not in excluded}:
            raise Stop('release helper/dependency/gateway files changed')


def cleanup_orphans(act, work):
    path = work / 'temporary-containers.json'
    if not path.exists():
        return
    nonce = json.loads(act.read(path)).get('nonce', '')
    if not re.fullmatch(r'[a-f0-9]{32}', nonce):
        raise Stop('temporary container marker invalid')
    ids = act.command(['docker', 'ps', '-aq', '--filter', 'label=bos.hands.token=' + nonce], work, 'token-cleanup-list').decode().split()
    if ids:
        act.command(['docker', 'rm', '-f', *ids], work, 'token-cleanup-orphans')


def build_bundle(act, helper, work, manifest, after, nonce):
    output = work / 'output'
    output.mkdir()
    name = 'bos-hands-token-build-' + nonce
    cid = None
    try:
        cid = act.command(['docker', 'run', '-d', '--pull=never', '--network', 'bridge',
                           '--label', 'bos.hands.token=' + nonce, '--name', name,
                           *helper.RESOURCE_LIMITS, '--entrypoint', '/bin/sh',
                           '--mount', 'type=bind,src=' + str(work / 'sources') + ',dst=/bos-src,readonly',
                           '--mount', 'type=bind,src=' + str(output) + ',dst=/bos-output',
                           manifest['image'], '-c', 'while :; do sleep 1; done'],
                          work, 'token-build-start').decode().strip()
        build = ['docker', 'exec', cid, 'edge-runtime', 'bundle', '--entrypoint', '/bos-src/hands-api/index.ts',
                 '--output', '/bos-output/hands-api.eszip', '--quiet', '--timeout', '90']
        act.command(build, work, 'token-baseline-build', timeout=120)
        if act.digest(output / 'hands-api.eszip') != manifest['bundle_before']:
            raise Stop('current bundle rebuild differs; token not replaced')
        act.command(['docker', 'network', 'disconnect', 'bridge', cid], work, 'token-build-disconnect')
        info = act.inspect(cid, work)
        if info['NetworkSettings']['Networks'] or not info['State']['Running']:
            raise Stop('offline compiler isolation failed')
        interfaces = act.command(['nsenter', '-t', str(info['State']['Pid']), '-n', sys.executable, '-c',
                                  'import socket,json; print(json.dumps([n for _,n in socket.if_nameindex()]))'],
                                 work, 'token-offline-interfaces')
        if json.loads(interfaces) != ['lo']:
            raise Stop('offline compiler still has an external interface')
        (work / 'sources/hands-api/index.ts').write_bytes(after)
        (output / 'hands-api.eszip').unlink()
        act.command(build, work, 'token-patched-build', timeout=120)
        if (output / 'hands-api.eszip').stat().st_size < 64:
            raise Stop('rotated bundle missing or empty')
        shutil.copyfile(output / 'hands-api.eszip', work / 'bundles/hands-api.eszip')
    finally:
        try:
            act.command(['docker', 'rm', '-f', cid or name], work, 'token-build-cleanup')
        except Exception:
            print('TOKEN_BUILD_CLEANUP_REQUIRED', flush=True)


PROBE = r'''
import json,sys,urllib.request,urllib.error,urllib.parse
d=json.load(sys.stdin)
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
request=urllib.request.Request('http://127.0.0.1:9000'+d['path']+'?'+urllib.parse.urlencode({'token':d['token']}),data=b'{}',headers={'Content-Type':'application/json'})
try:
    try: response=opener.open(request,timeout=4)
    except urllib.error.HTTPError as e: response=e
    with response: good=response.status==d['status'] and json.loads(response.read(8192)).get('error')==d['error']
except Exception: good=False
print(json.dumps(good))
'''


def private_probe(helper, work, pid, path, token, status, error):
    if type(pid) is not int or pid <= 0:
        raise Stop('running isolated namespace required')
    data = json.dumps({'path': path, 'token': token, 'status': status, 'error': error}).encode()
    output = helper.command(['nsenter', '-t', str(pid), '-n', sys.executable, '-c', PROBE],
                            work, 'token-probe-' + str(status), timeout=10, input_data=data)
    return json.loads(output) is True


def isolated_check(act, helper, work, saved, old, new, nonce):
    helper.require_memory(pathlib.Path('/proc/meminfo').read_text())
    gateway_text = '\n'.join(p.read_text() for p in (work / 'main').rglob('*.ts'))
    helper.check_gateway(gateway_text)
    origins = dict(entry.split('=', 1) for entry in saved['Config']['Env'] if '=' in entry)
    values = helper.candidate_environment(gateway_text, origins)
    name = 'bos-hands-token-test-' + nonce
    args = ['docker', 'run', '-d', '--pull=never', '--network', 'none', '--name', name,
            '--label', 'bos.hands.token=' + nonce, *helper.RESOURCE_LIMITS]
    for key, value in values.items():
        args += ['-e', key + '=' + value]
    for folder, destination in (('sources', '/bos-src'), ('bundles', '/bos-bundles'), ('main', '/bos-main')):
        args += ['--mount', 'type=bind,src=' + str(work / folder) + ',dst=' + destination + ',readonly']
    entry = saved['Config'].get('Entrypoint')
    if entry:
        if len(entry) != 1:
            raise Stop('compound runtime entrypoint requires review')
        args += ['--entrypoint', entry[0]]
    args += [saved['Image'], *(saved['Config'].get('Cmd') or [])]
    cid = None
    try:
        cid = act.command(args, work, 'token-candidate-start').decode().strip()
        for _ in range(6):
            info = act.inspect(cid, work)
            if not info['State']['Running']:
                raise Stop('isolated token candidate exited')
            for path in ('/hands-api', '/functions/v1/hands-api'):
                if private_probe(helper, work, info['State']['Pid'], path, new, 400, 'MISSING_DELIVERY'):
                    if not private_probe(helper, work, info['State']['Pid'], path, old, 404, 'NOT_FOUND'):
                        raise Stop('isolated candidate still accepts old token')
                    return
            time.sleep(1)
        raise Stop('isolated new token validation failed')
    except Exception:
        helper.report_candidate_failure(cid or name, work, gateway_text)
        raise
    finally:
        try:
            act.command(['docker', 'rm', '-f', cid or name], work, 'token-candidate-cleanup')
        except Exception:
            print('TOKEN_CANDIDATE_CLEANUP_REQUIRED', flush=True)


def reject_old(act, token):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), act.NoRedirect())
    request = urllib.request.Request(act.PUBLIC + '/functions/v1/hands-api?' + urllib.parse.urlencode({'token': token}),
                                     data=b'{}', headers={'Content-Type': 'application/json'})
    try:
        try:
            response = opener.open(request, timeout=8)
        except urllib.error.HTTPError as failure:
            response = failure
        with response:
            if response.status != 404 or json.loads(response.read(8192)).get('error') != 'NOT_FOUND':
                raise ValueError()
    except Exception:
        raise Stop('old webhook token rejection could not be verified') from None


def main():
    if os.geteuid() != 0 or len(sys.argv) != 1 or not BASE.is_dir():
        raise Stop('run without arguments as root on the RU host; never put tokens in commands')
    os.umask(0o077)
    sys.dont_write_bytecode = True
    with safe(BASE / '.hands-activation.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Stop('another Hands activation/rotation is running') from None
        root = original_stage()
        act = load_activation(root)
        TRUSTED_ERRORS.append(act.Stop)
        helper = act.get_helpers(root)
        TRUSTED_ERRORS.append(helper.Stop)
        manifest = json.loads(act.read(root / 'manifest.json'))
        original_journal = json.loads(act.read(root / 'activation.json'))
        act.validate_journal(root, manifest, original_journal)
        metadata = json.loads(act.read(root / 'container-metadata.log'))
        matches = [item for item in metadata if item['Id'] == manifest['edge_id']]
        if len(matches) != 1:
            raise Stop('original edge metadata missing')
        saved = matches[0]
        act.validate_manifest_target(manifest, saved)
        if act.identity(act.inspect(saved['Id'], root)) != act.identity(saved):
            raise Stop('live edge configuration changed')
        work = root / 'webhook-token-rotation'
        if work.exists():
            private_directory(work)
            cleanup_orphans(act, work)
            if (work / 'activation.json').exists():
                rotation = json.loads(act.read(work / 'rotation.json'))
                if (rotation.get('format') != FORMAT or any(rotation.get(k) != manifest[k] for k in ('source', 'bundle', 'image', 'edge_id'))
                        or rotation.get('source_before') != manifest['source_after'] or rotation.get('bundle_before') != manifest['bundle_after']):
                    raise Stop('rotation receipt is not tied to the original active deployment')
                journal = json.loads(act.read(work / 'activation.json'))
                validate_journal(work, rotation, journal)
                verify_payload(act, work, rotation, compiler_output=False)
                if journal['state'] == 'activated':
                    edge = act.validate_environment(root, helper, saved, manifest)
                    check_scope(act, helper, root, manifest, edge)
                    act.validate_items(journal['items'], ('after',))
                    act.public_check(token_value(act.read(pathlib.Path(manifest['source']))))
                    reject_old(act, token_value(act.read(work / 'backup/index.ts')))
                    print('BOS_HANDS_WEBHOOK_TOKEN_ALREADY_UPDATED', flush=True)
                    return
                if journal['state'] == 'rolled_back':
                    raise Stop('previous token attempt rolled back; review its cause before retrying')
                act.recover(work, lambda: act.restart_and_check(work, saved, token_value(act.read(work / 'backup/index.ts'))))
                print('TOKEN_INTERRUPTION_ROLLED_BACK; previous server token restored; provider unchanged', flush=True)
                return
            # Failed before installation: retain private evidence, start clean.
            work.rename(root / ('webhook-token-failed-' + uuid.uuid4().hex))
        edge = act.validate_environment(root, helper, saved, manifest)
        act.validate_items(original_journal['items'], ('after',))
        check_scope(act, helper, root, manifest, edge)
        source = pathlib.Path(manifest['source'])
        bundle = pathlib.Path(manifest['bundle'])
        before = act.read(source)
        old = token_value(before)
        act.public_check(old)
        new = read_new_token()
        after = replace_token(before, new)
        if mask_token(before) != mask_token(after):
            raise Stop('token patch changed unrelated source')
        helper.require_memory(pathlib.Path('/proc/meminfo').read_text())
        roots = [helper.mount_path(edge, path) for path in ('/bos-src', '/bos-bundles', '/bos-main')]
        total = sum(helper.tree_size(path) for path in roots)
        if total > 512 * 1024 * 1024 or shutil.disk_usage(root).free < max(1024 * 1024 * 1024, total * 3):
            raise Stop('insufficient staging disk space')
        work.mkdir(mode=0o700)
        nonce = uuid.uuid4().hex
        act.write_json(work / 'temporary-containers.json', {'nonce': nonce})
        for name, path in zip(('sources', 'bundles', 'main'), roots):
            shutil.copytree(path, work / name)
        (work / 'backup').mkdir()
        (work / 'backup/index.ts').write_bytes(before)
        (work / 'backup/hands-api.eszip').write_bytes(act.read(bundle))
        rotation = {key: manifest[key] for key in ('source', 'bundle', 'edge_id', 'image')}
        rotation.update(format=FORMAT, source_before=act.sha(before), bundle_before=act.digest(bundle), source_after=act.sha(after))
        act.write_json(work / 'rotation.json', rotation)
        print('TOKEN_BACKUP_OK; validating the new bundle', flush=True)
        build_bundle(act, helper, work, rotation, after, nonce)
        rotation['bundle_after'] = act.digest(work / 'bundles/hands-api.eszip')
        act.write_json(work / 'rotation.json', rotation)
        verify_payload(act, work, rotation)
        isolated_check(act, helper, work, saved, old, new, nonce)
        verify_payload(act, work, rotation)
        edge = act.validate_environment(root, helper, saved, manifest)
        act.validate_items(original_journal['items'], ('after',))
        check_scope(act, helper, root, manifest, edge)
        verify_payload(act, work, rotation)
        items = [act.file_item(target, staged, backup) for target, staged, backup, _, _ in expected_items(work, rotation)]
        validate_journal(work, rotation, {'items': items})
        def verified():
            act.restart_and_check(work, saved, new)
            reject_old(act, old)
        print('TOKEN_VALIDATED; restarting only the active API', flush=True)
        act.install(work, items, verified, lambda: act.restart_and_check(work, saved, old))
        print('BOS_HANDS_WEBHOOK_TOKEN_UPDATED', flush=True)
        print('New token accepted; old token rejected. No orders imported or provider settings changed.', flush=True)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    try:
        main()
    except BaseException as error:
        # Only our own bounded diagnostic messages are printed. Imported helpers'
        # unexpected errors and URLs must never expose the input token.
        message = str(error) if isinstance(error, tuple(TRUSTED_ERRORS)) else type(error).__name__ + '; private evidence retained'
        if type(error).__name__ == 'Stop' and str(error).startswith('ACTIVATION_ROLLED_BACK'):
            message = 'previous server token/files restored; provider token was not changed'
        print('WEBHOOK_TOKEN_STOPPED: ' + message, flush=True)
        sys.exit(1)
