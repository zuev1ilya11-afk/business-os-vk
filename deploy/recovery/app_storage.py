"""Private Storage object mapping and bounded, aggregate-only HTTP verification.

The caller passes an already verified ``drill_files.validate_bundle`` context.
Only the captured file-backend configuration selects a path; no alternative
tenant, bucket, basename, or version path is searched.  The historical default
version separator '/' remains a candidate until every object is fetched through
the exact captured Storage image and its bytes match the inventory.

This module never restores xattrs or changes the bundle, database, or files.
Object names, paths, hashes, metadata and HTTP bodies must remain private.
"""
from collections.abc import Mapping
from dataclasses import dataclass, field
import hashlib
from pathlib import PurePosixPath
import re
from urllib.parse import quote


MAX_OBJECT_BYTES = 32 * 1024 * 1024
MAX_OBJECTS = 100_000
_SHA256 = re.compile(r'[0-9a-f]{64}')
_TOKEN = re.compile(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+")
_CONTROL = re.compile(r'[\x00-\x1f\x7f]')

# Both statements are read-only and contain no interpolated identifiers.  The
# version lookup through to_jsonb accommodates an older schema without that
# column, while the separately returned schema facts distinguish this case.
SCHEMA_SQL = """
SELECT jsonb_build_object(
 'objects_exists',to_regclass('storage.objects') IS NOT NULL,
 'columns',COALESCE((SELECT jsonb_agg(a.attname ORDER BY a.attname)
   FROM pg_attribute a WHERE a.attrelid=to_regclass('storage.objects')
   AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb));
"""
OBJECTS_SQL = """
SELECT COALESCE(jsonb_agg(jsonb_build_object(
 'id',o.id::text,'bucket_id',o.bucket_id,'name',o.name,
 'version',to_jsonb(o)->'version',
 'metadata',jsonb_build_object(
   'size',o.metadata->'size','mimetype',o.metadata->'mimetype',
   'cacheControl',o.metadata->'cacheControl',
   'contentEncoding',o.metadata->'contentEncoding')) ORDER BY o.id),'[]'::jsonb)
FROM storage.objects o;
"""


class Stop(Exception):
    """Only fixed public-safe reason codes leave the mapping boundary."""
    def __init__(self, reason_code):
        self.reason_code = reason_code
        super().__init__(reason_code)


def _require(condition, reason):
    if not condition:
        raise Stop(reason)


@dataclass(frozen=True)
class MappedObject:
    """Private verification inputs.  repr intentionally contains no values."""
    object_id: str = field(repr=False)
    bucket_id: str = field(repr=False)
    name: str = field(repr=False)
    version: str | None = field(repr=False)
    archive_path: str = field(repr=False)
    http_path: str = field(repr=False)
    expected_bytes: int = field(repr=False)
    expected_sha256: str = field(repr=False)
    mimetype: str | None = field(repr=False)
    cache_control: str | None = field(repr=False)
    content_encoding: str | None = field(repr=False)


def _path(value, *, component=False):
    _require(isinstance(value, str) and 0 < len(value) <= 4096
             and not _CONTROL.search(value) and '\\' not in value,
             'APP_STORAGE_PATH_INVALID')
    parts = value.split('/')
    _require(all(part and part not in ('.', '..') for part in parts)
             and (not component or len(parts) == 1)
             and str(PurePosixPath(value)) == value,
             'APP_STORAGE_PATH_INVALID')
    return value


def _environment(storage):
    values = storage.get('Config', {}).get('Env')
    _require(isinstance(values, list), 'APP_STORAGE_CONFIG_INVALID')
    env = {}
    for item in values:
        _require(isinstance(item, str) and '=' in item,
                 'APP_STORAGE_CONFIG_INVALID')
        key, value = item.split('=', 1)
        _require(key and key not in env, 'APP_STORAGE_CONFIG_AMBIGUOUS')
        env[key] = value
    return env


def _alias(env, names, missing):
    values = [env[name] for name in names if env.get(name)]
    _require(bool(values), missing)
    _require(len(set(values)) == 1, 'APP_STORAGE_CONFIG_AMBIGUOUS')
    return _path(values[0], component=True)


def _header(value):
    if value is None:
        return None
    _require(isinstance(value, str) and len(value) <= 2048
             and not _CONTROL.search(value)
             and all(ord(c) < 127 for c in value),
             'APP_STORAGE_METADATA_INVALID')
    return value or None


def _mime(value):
    value = _header(value)
    if value is None:
        return None
    media = value.split(';', 1)[0].strip()
    pieces = media.split('/')
    _require(len(pieces) == 2 and all(_TOKEN.fullmatch(x) for x in pieces),
             'APP_STORAGE_METADATA_INVALID')
    return value


def map_objects(context, rows, *, max_object_bytes=MAX_OBJECT_BYTES):
    """Map private DB rows to one captured path; HTTP must prove the mapping.

    ``context`` must come from successful bundle validation.  Missing tenant or
    global bucket is not guessed.  Alias conflicts and malformed path components
    stop before any request.  The caller must keep the returned objects private.
    """
    _require(type(max_object_bytes) is int and 0 < max_object_bytes <= 256 * 1024 * 1024,
             'APP_STORAGE_LIMIT_INVALID')
    try:
        _require(isinstance(context, dict) and isinstance(rows, list)
                 and len(rows) <= MAX_OBJECTS, 'APP_STORAGE_INPUT_INVALID')
        storage = context['containers_by_role']['storage']
        env = _environment(storage)
        _require(env.get('STORAGE_BACKEND') == 'file'
                 and env.get('IS_MULTITENANT', 'false') == 'false',
                 'APP_STORAGE_BACKEND_UNSUPPORTED')
        global_bucket = _alias(env, ('STORAGE_S3_BUCKET', 'GLOBAL_S3_BUCKET'),
                               'APP_STORAGE_GLOBAL_BUCKET_UNKNOWN')
        tenant = _alias(env, ('PROJECT_REF', 'TENANT_ID'),
                        'APP_STORAGE_TENANT_UNKNOWN')
        flag = env.get('TUS_USE_FILE_VERSION_SEPARATOR', 'false')
        _require(flag in ('true', 'false'), 'APP_STORAGE_CONFIG_INVALID')
        separator = '-$v-' if flag == 'true' else '/'
        prefix = _path(context['storage_archive_prefix'])
        inventory = context['inventory']
        _require(isinstance(inventory, dict)
                 and prefix.split('/')[0] in context['archive_roots'],
                 'APP_STORAGE_ARCHIVE_ROOT_INVALID')
        _require(inventory.get(prefix) == {'type': 'directory', 'bytes': 0},
                 'APP_STORAGE_ARCHIVE_ROOT_INVALID')
        mapped, seen_ids, seen_keys, seen_paths = [], set(), set(), set()
        for row in rows:
            _require(isinstance(row, dict), 'APP_STORAGE_ROW_INVALID')
            object_id = row.get('id')
            _require(isinstance(object_id, str) and 0 < len(object_id) <= 128
                     and not _CONTROL.search(object_id), 'APP_STORAGE_ROW_INVALID')
            bucket, name = _path(row.get('bucket_id'), component=True), _path(row.get('name'))
            version = row.get('version')
            if version is not None:
                version = _path(version, component=True)
            metadata = row.get('metadata')
            _require(metadata is None or isinstance(metadata, dict), 'APP_STORAGE_METADATA_INVALID')
            metadata = metadata or {}
            suffix = name + (separator + version if version is not None else '')
            archive_path = _path('/'.join((prefix, global_bucket, tenant, bucket, suffix)))
            key = (bucket, name)
            _require(object_id not in seen_ids and key not in seen_keys
                     and archive_path not in seen_paths, 'APP_STORAGE_OBJECT_AMBIGUOUS')
            seen_ids.add(object_id)
            seen_keys.add(key)
            seen_paths.add(archive_path)
            entry = inventory.get(archive_path)
            _require(isinstance(entry, dict) and entry.get('type') == 'file',
                     'APP_STORAGE_OBJECT_FILE_MISSING')
            size, digest = entry.get('bytes'), entry.get('sha256')
            _require(type(size) is int and size >= 0 and isinstance(digest, str)
                     and _SHA256.fullmatch(digest), 'APP_STORAGE_INVENTORY_INVALID')
            _require(size <= max_object_bytes, 'APP_STORAGE_OBJECT_TOO_LARGE')
            for parent in PurePosixPath(archive_path).parents:
                if str(parent) != '.':
                    _require(inventory.get(str(parent)) == {'type': 'directory', 'bytes': 0},
                             'APP_STORAGE_PARENT_INVALID')
            reported_size = metadata.get('size')
            if reported_size is not None:
                _require((type(reported_size) is int and reported_size >= 0)
                         or (isinstance(reported_size, str)
                             and re.fullmatch(r'[0-9]{1,20}', reported_size)),
                         'APP_STORAGE_METADATA_INVALID')
                _require(int(reported_size) == size, 'APP_STORAGE_METADATA_SIZE_MISMATCH')
            mapped.append(MappedObject(
                object_id=object_id, bucket_id=bucket, name=name, version=version,
                archive_path=archive_path,
                http_path='/object/authenticated/' + quote(bucket, safe='') + '/' + quote(name, safe='/'),
                expected_bytes=size, expected_sha256=digest,
                mimetype=_mime(metadata.get('mimetype')),
                cache_control=_header(metadata.get('cacheControl')),
                content_encoding=_header(metadata.get('contentEncoding'))))
        return mapped
    except Stop:
        raise
    except (KeyError, TypeError, ValueError, AttributeError, UnicodeError):
        raise Stop('APP_STORAGE_INPUT_INVALID') from None


def verify_objects(mapped, fetch_object, *, max_object_bytes=MAX_OBJECT_BYTES):
    """Fetch all objects through the captured image; return public-safe counts.

    ``fetch_object(MappedObject)`` returns ``(status, headers, body_bytes)``.
    The caller must disable redirects, decompression and external routing, use
    the local service JWT, and bound reads to expected_bytes + 1 (and the cap).
    This catches oversized responses without first buffering arbitrary bodies.

    ``bytes_status == VERIFIED`` proves all object bytes through this API.
    ``status == VERIFIED`` additionally requires every supplied MIME to match.
    A gateway may supply verified per-object MIME metadata when content_type is
    OVERRIDE_REQUIRED, but must not relabel that as restored filesystem metadata.
    Callback exceptions are counted without exposing messages, URLs or bodies.
    """
    _require(isinstance(mapped, list) and len(mapped) <= MAX_OBJECTS
             and callable(fetch_object), 'APP_STORAGE_INPUT_INVALID')
    _require(type(max_object_bytes) is int and 0 < max_object_bytes <= 256 * 1024 * 1024,
             'APP_STORAGE_LIMIT_INVALID')
    _require(all(isinstance(obj, MappedObject) and obj.expected_bytes <= max_object_bytes
                 for obj in mapped), 'APP_STORAGE_OBJECT_TOO_LARGE')
    counts = dict(objects=len(mapped), checked=0, verified_objects=0,
                  verified_bytes=0, http_failures=0, fetch_failures=0,
                  invalid_responses=0, size_mismatch=0, sha256_mismatch=0,
                  mime_checked=0, mime_mismatch=0, mime_missing=0)
    for obj in mapped:
        counts['checked'] += 1
        try:
            result = fetch_object(obj)
        except Exception:
            counts['fetch_failures'] += 1
            continue
        if not isinstance(result, (tuple, list)) or len(result) != 3:
            counts['invalid_responses'] += 1
            continue
        status, headers, body = result
        if type(status) is not int or not isinstance(headers, Mapping) or not isinstance(body, bytes):
            counts['invalid_responses'] += 1
            continue
        if status != 200:
            counts['http_failures'] += 1
            continue
        if len(body) > max_object_bytes or len(body) != obj.expected_bytes:
            counts['size_mismatch'] += 1
            continue
        if hashlib.sha256(body).hexdigest() != obj.expected_sha256:
            counts['sha256_mismatch'] += 1
            continue
        counts['verified_objects'] += 1
        counts['verified_bytes'] += len(body)
        if obj.mimetype is not None:
            counts['mime_checked'] += 1
            values = [v for k, v in headers.items()
                      if isinstance(k, str) and k.lower() == 'content-type']
            if not values:
                counts['mime_missing'] += 1
            elif len(values) != 1 or not isinstance(values[0], str):
                counts['mime_mismatch'] += 1
            else:
                try:
                    actual = _mime(values[0])
                except Stop:
                    actual = None
                if actual is None or (actual.split(';', 1)[0].strip().lower()
                                      != obj.mimetype.split(';', 1)[0].strip().lower()):
                    counts['mime_mismatch'] += 1
    bytes_ok = counts['verified_objects'] == counts['objects']
    mime_ok = counts['mime_mismatch'] + counts['mime_missing'] == 0
    return {
        'status': 'VERIFIED' if bytes_ok and mime_ok else 'FAILED',
        'bytes_status': 'VERIFIED' if bytes_ok else 'FAILED',
        'method': 'CAPTURED_CONFIG_PLUS_HTTP_VERIFIED' if bytes_ok else 'CAPTURED_CONFIG_HTTP_INCOMPLETE',
        'content_type': ('MATCH' if counts['mime_checked'] else 'NOT_PROVIDED')
                        if mime_ok else 'OVERRIDE_REQUIRED',
        'filesystem_metadata': 'NOT_PROVEN', 'xattrs': 'NOT_CAPTURED', **counts,
    }
