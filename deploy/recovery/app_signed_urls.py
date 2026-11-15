"""Translate verified captured download capabilities to the local signing key.

No permission is granted by object existence.  A captured token must first pass
HS256 verification, expiry/time checks, download scope and exact object binding.
Only then is its original encoded header.payload re-signed, without changing
claims or extending expiry.  Fresh local signatures pass unchanged to Storage.
Neither signing key, object name nor token may be logged or included in reports.

Compatibility is deliberately narrow: Storage's signObjectUrl emits ``url``,
``iat`` and ``exp``, with optional newer ``scope='download'``.  Upstream sources:
https://github.com/supabase/storage/blob/master/src/storage/object.ts
https://github.com/supabase/storage/blob/master/src/internal/auth/jwt.ts
Unknown schemes and legacy upload/service-role tokens are never converted.
"""
import base64
import hashlib
import hmac
import json
import math
import re
import time
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit


_SEGMENT = re.compile(r'[A-Za-z0-9_-]+')
_CONTROL = re.compile(r'[\x00-\x1f\x7f]')
_PREFIXES = ('/storage/v1/object/sign/', '/object/sign/')
_MAX_TOKEN = 8192
_MAX_TIME = (2 ** 53 - 1) // 1000


class Stop(Exception):
    def __init__(self, reason_code='APP_SIGNED_URL_REJECTED'):
        self.reason_code = reason_code
        super().__init__(reason_code)


def _require(condition, reason='APP_SIGNED_URL_REJECTED'):
    if not condition:
        raise Stop(reason)


def source_secret(context):
    """Read the original captured Storage key privately; never return to UI."""
    try:
        env = {}
        for item in context['containers_by_role']['storage']['Config']['Env']:
            _require(isinstance(item, str) and '=' in item, 'APP_SIGNED_URL_CONFIG_INVALID')
            key, value = item.split('=', 1)
            _require(key and key not in env, 'APP_SIGNED_URL_CONFIG_AMBIGUOUS')
            env[key] = value
        algorithms = [env[key] for key in ('AUTH_JWT_ALGORITHM', 'PGRST_JWT_ALGORITHM')
                      if env.get(key)]
        _require(not algorithms or set(algorithms) == {'HS256'},
                 'APP_SIGNED_URL_ALGORITHM_UNSUPPORTED')
        secrets = [env[key] for key in ('AUTH_JWT_SECRET', 'PGRST_JWT_SECRET') if env.get(key)]
        _require(bool(secrets), 'APP_SIGNED_URL_SOURCE_KEY_MISSING')
        _require(len(set(secrets)) == 1, 'APP_SIGNED_URL_CONFIG_AMBIGUOUS')
        _key(secrets[0])
        return secrets[0]
    except Stop:
        raise
    except (KeyError, TypeError, ValueError, AttributeError):
        raise Stop('APP_SIGNED_URL_CONFIG_INVALID') from None


def _key(value):
    _require(isinstance(value, str) and 0 < len(value) <= 4096 and '\x00' not in value,
             'APP_SIGNED_URL_KEY_INVALID')
    try:
        return value.encode('utf-8')
    except UnicodeError:
        raise Stop('APP_SIGNED_URL_KEY_INVALID') from None


def _json_object(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result)
        result[key] = value
    return result


def _decode(segment):
    _require(isinstance(segment, str) and _SEGMENT.fullmatch(segment))
    try:
        raw = base64.urlsafe_b64decode(segment + '=' * (-len(segment) % 4))
        _require(base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=') == segment)
        return raw
    except (ValueError, TypeError):
        raise Stop() from None


def _token(token):
    _require(isinstance(token, str) and 0 < len(token) <= _MAX_TOKEN)
    parts = token.split('.')
    _require(len(parts) == 3)
    try:
        header = json.loads(_decode(parts[0]).decode('utf-8'), object_pairs_hook=_json_object)
        claims = json.loads(_decode(parts[1]).decode('utf-8'), object_pairs_hook=_json_object)
        signature = _decode(parts[2])
        _require(isinstance(header, dict) and isinstance(claims, dict)
                 and set(header) <= {'alg', 'typ'} and header.get('alg') == 'HS256'
                 and header.get('typ', 'JWT') == 'JWT' and len(signature) == 32)
        return (parts[0] + '.' + parts[1]).encode('ascii'), claims, signature
    except Stop:
        raise
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise Stop() from None


def _canonical_object(value):
    _require(isinstance(value, str) and 0 < len(value) <= 8192
             and '\\' not in value and not _CONTROL.search(value))
    pieces = value.split('/')
    _require(len(pieces) >= 2 and all(part and part not in ('.', '..') for part in pieces))
    return value


def _number(value):
    return type(value) is int and 0 <= value <= _MAX_TIME


class SignedUrlAdapter:
    """Keep both keys in host memory; use only after full object verification."""
    __slots__ = ('_source_key', '_local_key', '_objects')

    def __init__(self, *, source_secret, local_secret, verified_objects):
        self._source_key, self._local_key = _key(source_secret), _key(local_secret)
        _require(not hmac.compare_digest(self._source_key, self._local_key),
                 'APP_SIGNED_URL_KEY_NOT_ROTATED')
        _require(isinstance(verified_objects, dict), 'APP_SIGNED_URL_OBJECT_INDEX_INVALID')
        self._objects = dict(verified_objects)
        for path, obj in self._objects.items():
            _canonical_object(path)
            bucket, name = getattr(obj, 'bucket_id', None), getattr(obj, 'name', None)
            _require(isinstance(bucket, str) and isinstance(name, str)
                     and path == bucket + '/' + name,
                     'APP_SIGNED_URL_OBJECT_INDEX_INVALID')

    def rewrite(self, method, path, *, now=None):
        """Return original/translated relative path; reject invalid old grants.

        Apply immediately before forwarding to the same captured Storage image.
        Catch Stop at the HTTP boundary and return a fixed 403 response.  This
        adapter does not fetch an object or substitute any Authorization header.
        HEAD and every non-download route are passed through unchanged.
        """
        if method != 'GET' or not isinstance(path, str):
            return path
        try:
            _require(len(path) <= 32768)
            parsed = urlsplit(path)
            prefix = next((item for item in _PREFIXES if parsed.path.startswith(item)), None)
            if prefix is None:
                return path
            _require(not parsed.scheme and not parsed.netloc and not parsed.fragment
                     and not _CONTROL.search(path) and '\\' not in path)
            # Reject malformed escapes before unquote (which otherwise preserves
            # them); decode exactly once so literal percent sequences stay data.
            _require(not re.search(r'%(?![0-9A-Fa-f]{2})', parsed.path))
            object_path = _canonical_object(unquote(parsed.path[len(prefix):], errors='strict'))
            query = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True,
                              encoding='utf-8', errors='strict', max_num_fields=4)
            token_values = [value for key, value in query if key == 'token']
            _require(len(token_values) == 1 and len(query) == len({key for key, _ in query})
                     and all(key in ('token', 'download') for key, _ in query)
                     and all(not _CONTROL.search(value) for _, value in query))
            token = token_values[0]
            signed, claims, signature = _token(token)
            if hmac.compare_digest(hmac.digest(self._local_key, signed, hashlib.sha256), signature):
                # Storage remains the authority for current local tokens,
                # including newly uploaded objects outside the original bundle.
                return path
            _require(hmac.compare_digest(hmac.digest(self._source_key, signed, hashlib.sha256), signature))
            obj = self._objects.get(object_path)
            _require(obj is not None)
            _require(set(claims) <= {'url', 'iat', 'exp', 'nbf', 'scope', 'versionId'}
                     and {'url', 'iat', 'exp'} <= set(claims)
                     and claims.get('scope', 'download') == 'download'
                     and claims['url'] == object_path)
            # Scope allowlist above also rejects role, owner, upsert, arbitrary
            # transformations, and every unknown permission-bearing claim.
            if 'versionId' in claims:
                _require(isinstance(claims['versionId'], str)
                         and claims['versionId'] == getattr(obj, 'version', None))
            clock = time.time() if now is None else now
            _require(type(clock) in (int, float) and math.isfinite(clock) and 0 <= clock <= _MAX_TIME)
            iat, exp, nbf = claims['iat'], claims['exp'], claims.get('nbf')
            _require(_number(iat) and _number(exp) and iat <= clock < exp and iat < exp)
            if nbf is not None:
                _require(_number(nbf) and nbf <= clock and nbf <= exp)
            elif 'nbf' in claims:
                raise Stop()
            signature = base64.urlsafe_b64encode(
                hmac.digest(self._local_key, signed, hashlib.sha256)).decode('ascii').rstrip('=')
            replacement = signed.decode('ascii') + '.' + signature
            output_query = urlencode([(key, replacement if key == 'token' else value)
                                      for key, value in query])
            return urlunsplit(('', '', parsed.path, output_query, ''))
        except Stop:
            raise
        except (ValueError, TypeError, UnicodeError, KeyError, AttributeError, OverflowError):
            raise Stop() from None
