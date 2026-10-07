#!/usr/bin/env python3
"""Server-only encrypted recovery; requires explicit temporary-function approval.

Dependency: Ubuntu python3-cryptography. PAT: project-scoped Edge Functions
Read/write and Edge Function Secrets Read. Never put credentials in arguments.
Only the randomly named temporary function is created/invoked/deleted.
"""
import argparse
import base64
from email.utils import parsedate_to_datetime
import getpass
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import signal
import stat
import sys
import tempfile
import time
import warnings
from urllib.error import HTTPError
from urllib.request import build_opener, ProxyHandler, Request

from backup_functions import decode_multipart, fingerprint, validate_inventory
from stage_runtime_secrets import NAMES, PROJECT, save_secrets, valid_value
from verify_runtime_secrets import (NoRedirect, compare, load_secrets, parse_digests,
                                    private_bytes, save_receipt)

PARENT = Path('/opt/business-os/deploy')
ORIGIN = 'https://api.supabase.com/v1/projects/' + PROJECT
LIMIT = 1024 * 1024
SLUG = re.compile(r'bos-migration-export-[a-f0-9]{32}')


class CleanupRequired(Exception):
    pass


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key')
        result[key] = value
    return result


def read_json(data):
    return json.loads(data, object_pairs_hook=unique_object)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + '\n').encode()


def private_dir(path):
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise ValueError('Expected private owned directory')


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_private(root, name, data):
    # The fixed filenames below are never constructed from remote input.
    fd, temporary = tempfile.mkstemp(prefix='.write-', dir=root)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, root / name)
        sync_dir(root)
        if private_bytes(root / name) != data:
            raise ValueError('Private file reread failed')
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def journal(root, state):
    write_private(root, 'run.json', json_bytes(state))


def function_source(config):
    # Fixed recipient and whitelist. No network calls, console logging or imports.
    return ("const C = " + json.dumps(config, ensure_ascii=True) + ";\nconst NAMES = "
            + json.dumps(NAMES) + ";\n" + r'''
const enc = new TextEncoder();
const aad = enc.encode(`BOS_RUNTIME_EXPORT_V1\n${C.project}\n${C.run_id}`);
const from64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const to64 = a => {let s=''; for (const b of new Uint8Array(a)) s+=String.fromCharCode(b); return btoa(s);};
const response = (status, body) => new Response(JSON.stringify(body), {
  status, headers:{'Content-Type':'application/json', 'Cache-Control':'no-store'}
});
Deno.serve(async req => {
  try {
    if (req.method !== 'POST') return response(405, {error:'method'});
    if (Date.now() >= C.expires_ms) return response(410, {error:'expired'});
    const token = req.headers.get('X-BOS-Migration-Token') || '';
    if (!/^[a-f0-9]{64}$/.test(token)) return response(401, {error:'auth'});
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(token)));
    const expected = C.token_hash.match(/../g).map(x => parseInt(x,16));
    let different = 0; for(let i=0;i<32;i++) different |= hash[i] ^ expected[i];
    if (different) return response(401, {error:'auth'});
    const values = {};
    for (const name of NAMES) {
      const value = Deno.env.get(name);
      if (typeof value !== 'string' || value.length === 0 || value.length > 32768)
        return response(409, {error:'missing_or_invalid'});
      values[name] = value;
    }
    const bytes = enc.encode(JSON.stringify({format:1, project:C.project, run_id:C.run_id, values}));
    if (bytes.length > 500000) return response(409, {error:'size'});
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aes = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
    const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:aad, tagLength:128}, aes, bytes);
    const rsa = await crypto.subtle.importKey('spki', from64(C.public_key), {name:'RSA-OAEP', hash:'SHA-256'}, false, ['encrypt']);
    const wrapped = await crypto.subtle.encrypt({name:'RSA-OAEP'}, rsa, rawKey);
    rawKey.fill(0); bytes.fill(0);
    if (Date.now() >= C.expires_ms) return response(410, {error:'expired'});
    return response(200, {format:1, run_id:C.run_id, wrapped_key:to64(wrapped), iv:to64(iv), ciphertext:to64(ciphertext)});
  } catch (_) { return response(500, {error:'export_failed'}); }
});
''').encode()


def decrypt(envelope, key, config):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if (not isinstance(envelope, dict)
            or set(envelope) != {'format', 'run_id', 'wrapped_key', 'iv', 'ciphertext'}
            or envelope['format'] != 1 or envelope['run_id'] != config['run_id']):
        raise ValueError('Unexpected encrypted envelope')
    parts = {}
    for name in ('wrapped_key', 'iv', 'ciphertext'):
        value = envelope[name]
        if not isinstance(value, str) or len(value) > 700000:
            raise ValueError('Unexpected encrypted field')
        parts[name] = base64.b64decode(value, validate=True)
    if len(parts['wrapped_key']) != 384 or len(parts['iv']) != 12 or not 16 <= len(parts['ciphertext']) <= 500016:
        raise ValueError('Unexpected encrypted sizes')
    raw_key = key.decrypt(parts['wrapped_key'], padding.OAEP(
        mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    if len(raw_key) != 32:
        raise ValueError('Unexpected AES key')
    aad = ('BOS_RUNTIME_EXPORT_V1\n' + PROJECT + '\n' + config['run_id']).encode()
    payload = read_json(AESGCM(raw_key).decrypt(parts['iv'], parts['ciphertext'], aad))
    if (not isinstance(payload, dict) or set(payload) != {'format', 'project', 'run_id', 'values'}
            or payload['format'] != 1 or payload['project'] != PROJECT or payload['run_id'] != config['run_id']):
        raise ValueError('Unexpected decrypted context')
    values = payload['values']
    if not isinstance(values, dict) or set(values) != set(NAMES) or not all(valid_value(v) for v in values.values()):
        raise ValueError('Unexpected decrypted secret set')
    return values


class Client:
    def __init__(self, token, slug):
        if not re.fullmatch(r'sbp_[A-Za-z0-9_-]+', token) or not SLUG.fullmatch(slug):
            raise ValueError('Invalid access token or temporary slug')
        self.token, self.slug = token, slug
        self.opener = build_opener(ProxyHandler({}), NoRedirect())
        self.server_time = None

    def request(self, method, path, data=None, content_type=None, accept='application/json'):
        allowed = {('GET', '/functions'), ('GET', '/secrets'),
                   ('GET', '/functions/' + self.slug), ('GET', '/functions/' + self.slug + '/body'),
                   ('DELETE', '/functions/' + self.slug),
                   ('POST', '/functions/deploy?slug=' + self.slug)}
        if (method, path) not in allowed:
            raise ValueError('Forbidden Management API operation')
        headers = {'Authorization': 'Bearer ' + self.token, 'Accept': accept,
                   'Accept-Encoding': 'identity', 'User-Agent': 'BusinessOS-SecretRecovery/1'}
        if content_type:
            headers['Content-Type'] = content_type
        return Request(ORIGIN + path, headers=headers, data=data, method=method)

    def invoke_request(self, token):
        if not re.fullmatch(r'[a-f0-9]{64}', token):
            raise ValueError('Invalid export token')
        return Request('https://' + PROJECT + '.supabase.co/functions/v1/' + self.slug,
                       headers={'X-BOS-Migration-Token': token, 'Accept': 'application/json',
                                'Accept-Encoding': 'identity', 'Content-Type': 'application/json'},
                       data=b'{}', method='POST')

    def send(self, request):
        try:
            with self.opener.open(request, timeout=60) as response:
                if response.status not in (200, 201, 204) or response.headers.get('Content-Encoding', 'identity') != 'identity':
                    raise ValueError('Unexpected HTTP response')
                data = response.read(LIMIT + 1)
                if len(data) > LIMIT:
                    raise ValueError('Response too large')
                if request.host == 'api.supabase.com':
                    self.server_time = parsedate_to_datetime(response.headers['Date']).timestamp()
                return response.headers.get('Content-Type', ''), data
        except HTTPError as error:
            error.close()
            raise

    def json(self, request):
        kind, data = self.send(request)
        if kind.split(';')[0].strip() != 'application/json':
            raise ValueError('Expected JSON response')
        return read_json(data)

    def inventory(self):
        rows = self.json(self.request('GET', '/functions'))
        validate_inventory(rows, 35)
        return rows

    def digests(self):
        return parse_digests(self.json(self.request('GET', '/secrets')))

    def describe(self):
        try:
            return self.json(self.request('GET', '/functions/' + self.slug))
        except HTTPError as error:
            if error.code == 404:
                return None
            raise

    def source_files(self):
        kind, data = self.send(self.request('GET', '/functions/' + self.slug + '/body', accept='multipart/form-data'))
        return decode_multipart(kind, data)[1]

    def deploy(self, source):
        boundary = 'bos' + secrets.token_hex(24)
        metadata = {'name': self.slug, 'verify_jwt': False, 'entrypoint_path': 'index.ts',
                    'import_map_path': '', 'static_patterns': []}
        body = (('--' + boundary + '\r\nContent-Disposition: form-data; name="metadata"\r\n'
                 'Content-Type: application/json\r\n\r\n').encode() + json_bytes(metadata)
                + ('\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="index.ts"\r\n'
                   'Content-Type: application/typescript\r\n\r\n').encode() + source
                + ('\r\n--' + boundary + '--\r\n').encode())
        # No automatic retry: an uncertain response may already have created it.
        return self.json(self.request('POST', '/functions/deploy?slug=' + self.slug, body,
                                      'multipart/form-data; boundary=' + boundary))

    def invoke(self, token):
        for attempt in range(8):
            try:
                return self.json(self.invoke_request(token))
            except HTTPError as error:
                if error.code not in (404, 502, 503) or attempt == 7:
                    raise
            time.sleep(2)

    def delete(self):
        self.send(self.request('DELETE', '/functions/' + self.slug))

    def check_clock(self):
        if self.server_time is None or abs(time.time() - self.server_time) > 60:
            raise ValueError('Server clock differs from API clock')


def cleanup(api, state, source, root):
    try:
        current = api.describe()
        if current is None:
            if state['acknowledged']:
                return
            raise CleanupRequired('Deployment outcome unknown; absence is insufficient')
        if (not isinstance(current, dict) or current.get('slug') != state['slug']
                or not current.get('id')
                or (state['function_id'] is not None and current['id'] != state['function_id'])):
            raise CleanupRequired('Temporary function identity changed')
        files = api.source_files()
        if len(files) != 1 or files[0][1] != source:
            raise CleanupRequired('Temporary function source changed')
        # Resolve an ambiguous deploy durably before attempting deletion. If its
        # response is then lost, a resumed run can safely recognize absence.
        state['function_id'], state['acknowledged'] = current['id'], True
        journal(root, state)
        api.delete()
        if api.describe() is not None:
            raise CleanupRequired('Deletion not confirmed')
    except BaseException as error:
        raise CleanupRequired('Cleanup requires follow-up') from None


def verify_and_save(api, root, state, values):
    if not state.get('cleaned'):
        raise CleanupRequired('Cleanup must be confirmed first')
    result = compare(values, api.digests())
    if not compare(values, state['digests'])['all_match'] or not result['all_match']:
        raise ValueError('Source secret digest mismatch')
    if fingerprint(api.inventory()) != fingerprint(state['baseline']):
        raise ValueError('Original function inventory changed')
    destination = save_secrets(root.parent, values)
    _, digest = load_secrets(destination)
    save_receipt(destination, digest, result)
    state['destination'] = str(destination)
    journal(root, state)
    return destination


def execute(api, root, state, key, token):
    source = function_source(state['config'])
    if api.describe() is not None or fingerprint(api.inventory()) != fingerprint(state['baseline']):
        raise ValueError('Source changed before deployment')
    api.check_clock()
    if time.time() * 1000 >= state['config']['expires_ms'] - 120000:
        raise ValueError('Insufficient export window')
    state['attempted'] = True
    journal(root, state)  # Durable cleanup information BEFORE any source mutation.
    try:
        deployed = api.deploy(source)
        if (not isinstance(deployed, dict) or deployed.get('slug') != state['slug']
                or not deployed.get('id') or deployed.get('verify_jwt') is not False):
            raise ValueError('Unexpected deployment identity')
        state['function_id'], state['acknowledged'] = deployed['id'], True
        journal(root, state)
        envelope = api.invoke(token)
        write_private(root, 'envelope.json', json_bytes(envelope))
        values = decrypt(envelope, key, state['config'])
        if not compare(values, state['digests'])['all_match']:
            raise ValueError('Runtime keys differ from initial source digests')
    finally:
        cleanup(api, state, source, root)
        state['cleaned'] = True
        journal(root, state)
    return verify_and_save(api, root, state, values)


def prepare(parent, slug, baseline, digests):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    private_dir(parent)
    if set(name for name in digests if not name.startswith('SUPABASE_')) != set(NAMES):
        raise ValueError('Source custom secret inventory differs')
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    public = base64.b64encode(key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)).decode()
    token = secrets.token_hex(32)
    config = {'project': PROJECT, 'run_id': secrets.token_hex(16), 'public_key': public,
              'token_hash': hashlib.sha256(token.encode()).hexdigest(),
              'expires_ms': int((time.time() + 900) * 1000)}
    state = {'format': 1, 'slug': slug, 'config': config, 'baseline': baseline, 'digests': digests,
             'attempted': False, 'acknowledged': False, 'function_id': None, 'cleaned': False}
    root = Path(tempfile.mkdtemp(prefix='runtime-recovery-', dir=parent))
    sync_dir(parent)
    write_private(root, 'private-key.pem', key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    write_private(root, 'index.ts', function_source(config))
    journal(root, state)
    return root, state, key, token


def load_recovery(root):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    private_dir(root)
    state = read_json(private_bytes(root / 'run.json'))
    cfg = state['config']
    if (state.get('format') != 1 or not SLUG.fullmatch(state['slug']) or cfg['project'] != PROJECT
            or not re.fullmatch(r'[a-f0-9]{32}', cfg['run_id'])
            or not re.fullmatch(r'[a-f0-9]{64}', cfg['token_hash'])
            or type(cfg['expires_ms']) is not int
            or any(type(state[name]) is not bool for name in ('attempted', 'acknowledged', 'cleaned'))):
        raise ValueError('Invalid recovery context')
    validate_inventory(state['baseline'], 35)
    if any(row['slug'] == state['slug'] for row in state['baseline']):
        raise ValueError('Temporary slug collides with baseline')
    key = serialization.load_pem_private_key(private_bytes(root / 'private-key.pem'), password=None)
    if not isinstance(key, rsa.RSAPrivateKey) or key.key_size != 3072:
        raise ValueError('Unexpected recovery key')
    public = base64.b64encode(key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)).decode()
    if not hmac.compare_digest(public, cfg['public_key']) or private_bytes(root / 'index.ts') != function_source(cfg):
        raise ValueError('Recovery source or public key changed')
    return state, key


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--approve-temporary-source-function', action='store_true')
    group.add_argument('--cleanup', type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('Run as root')
    # Preflight before token collection or any source request.
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: F401
    os.umask(0o077)
    private_dir(PARENT)
    def interrupt(signum, frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupt)
    if args.cleanup:
        root = args.cleanup
        if root.parent != PARENT or not re.fullmatch(r'runtime-recovery-[A-Za-z0-9_-]+', root.name):
            raise ValueError('Unexpected cleanup directory')
        state, key = load_recovery(root)
        slug = state['slug']
    else:
        slug = 'bos-migration-export-' + secrets.token_hex(16)
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        token = getpass.getpass('PAT: Edge Functions Read/write + Secrets Read (скрытый ввод): ')
    api = Client(token, slug)
    del token
    if args.cleanup:
        if state['attempted']:
            cleanup(api, state, function_source(state['config']), root)
        state['cleaned'] = True
        journal(root, state)
        if not (root / 'envelope.json').exists():
            print('Временная функция отсутствует; ключи ещё не восстановлены.')
            print('BOS_RUNTIME_RECOVERY_CLEANED', flush=True)
            return
        values = decrypt(read_json(private_bytes(root / 'envelope.json')), key, state['config'])
        destination = verify_and_save(api, root, state, values)
    else:
        baseline, digests = api.inventory(), api.digests()
        api.check_clock()
        root, state, key, export_token = prepare(PARENT, slug, baseline, digests)
        print('Каталог восстановления: ' + str(root), flush=True)
        print('Временная функция: ' + slug, flush=True)
        destination = execute(api, root, state, key, export_token)
    print('Совпало ключей: 5/5; временная функция удалена.')
    print('Каталог: ' + str(destination))
    print('BOS_RUNTIME_SECRETS_RECOVERED', flush=True)


if __name__ == '__main__':
    try:
        main()
    except CleanupRequired:
        print('BOS_RUNTIME_RECOVERY_CLEANUP_REQUIRED', flush=True)
        print('Удаление не подтверждено. Сохраните каталог и имя функции; используйте --cleanup КАТАЛОГ.')
        sys.exit(2)
    except KeyboardInterrupt:
        print('BOS_RUNTIME_RECOVERY_FAILED category=interrupted', flush=True)
        sys.exit(130)
    except Exception as error:
        category = ('http_' + str(error.code)) if isinstance(error, HTTPError) else type(error).__name__
        print('BOS_RUNTIME_RECOVERY_FAILED category=' + category, flush=True)
        sys.exit(1)
