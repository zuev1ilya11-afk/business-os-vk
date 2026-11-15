"""Read-only, portable validation of a captured recovery bundle.

The source paths in private-config.json are Linux paths from another machine:
they are compared lexically, never resolved or opened on the drill host. File
extraction belongs in a new Linux volume, not on a case-insensitive Windows
filesystem. This module does not execute Docker, SQL, or archive content.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile

import backup
import discovery
import image_archive


PAYLOADS = frozenset(backup.PAYLOADS)
MAX_JSON = 128 * 1024 * 1024
MAX_FILES = backup.MAX_FILES
SHA256 = re.compile(r'[0-9a-f]{64}')
IMAGE_ID = re.compile(r'sha256:[0-9a-f]{64}')
CONTAINER_ID = re.compile(r'[0-9a-f]{64}')
ROOT_NAME = re.compile(r'root-[0-9]{3,}')
MIB = 1024 * 1024


class Stop(Exception):
    """Only a fixed code, never paths, credentials, SQL, or object names."""
    def __init__(self, reason_code):
        super().__init__(reason_code)
        self.reason_code = reason_code


def require(condition, code):
    if not condition:
        raise Stop(code)


def _reparse(s):
    return bool(getattr(s, 'st_file_attributes', 0)
                & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400))


def _safe_components(path):
    for component in [*reversed(path.parents), path]:
        s = component.lstat()
        require(not stat.S_ISLNK(s.st_mode) and not _reparse(s), 'BUNDLE_LINK_UNSUPPORTED')


def _regular(path):
    _safe_components(path)
    s = path.lstat()
    require(stat.S_ISREG(s.st_mode), 'BUNDLE_FILE_TYPE_UNSUPPORTED')
    require(s.st_nlink == 1, 'BUNDLE_HARDLINK_UNSUPPORTED')
    return s


def _signature(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_nlink, s.st_size,
            s.st_mtime_ns, s.st_ctime_ns, getattr(s, 'st_file_attributes', 0))


def _read(path, *, limit=None, collect=False):
    before = _regular(path)
    require(limit is None or before.st_size <= limit, 'BUNDLE_JSON_LIMIT')
    flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0)
    h, chunks, total = hashlib.sha256(), [], 0
    with os.fdopen(os.open(path, flags), 'rb') as stream:
        require(_signature(before) == _signature(os.fstat(stream.fileno())),
                'BUNDLE_CHANGED')
        for chunk in iter(lambda: stream.read(MIB), b''):
            total += len(chunk)
            require(limit is None or total <= limit, 'BUNDLE_JSON_LIMIT')
            h.update(chunk)
            if collect:
                chunks.append(chunk)
        require(_signature(before) == _signature(os.fstat(stream.fileno())),
                'BUNDLE_CHANGED')
    require(_signature(before) == _signature(_regular(path)), 'BUNDLE_CHANGED')
    result = {'sha256': h.hexdigest(), 'bytes': total}
    return (b''.join(chunks), result) if collect else result


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'BUNDLE_JSON_INVALID')
        result[key] = value
    return result


def _json(path, expected=None):
    data, hashed = _read(path, limit=MAX_JSON, collect=True)
    require(expected is None or hashed == expected, 'PAYLOAD_HASH_MISMATCH')
    try:
        return json.loads(data, object_pairs_hook=_unique_pairs)
    except (UnicodeError, ValueError):
        raise Stop('BUNDLE_JSON_INVALID') from None


def _clean_string(value):
    return (isinstance(value, str) and value
            and all(ord(c) >= 32 and ord(c) != 127 for c in value))


def _source_path(value):
    require(_clean_string(value) and len(value) <= 32768 and '\\' not in value,
            'SOURCE_PATH_INVALID')
    path = PurePosixPath(value)
    require(path.is_absolute() and not value.startswith('//')
            and str(path) == value and '..' not in path.parts
            and path != PurePosixPath('/'), 'SOURCE_PATH_INVALID')
    return path


def _member_name(name):
    if not _clean_string(name) or len(name) > 32768 or '\\' in name:
        return False
    path = PurePosixPath(name)
    return (0 < len(path.parts) <= 256 and not path.is_absolute() and '..' not in path.parts
            and str(path) == name and ROOT_NAME.fullmatch(path.parts[0]) is not None)


def _inventory(records, roots):
    require(isinstance(records, dict) and 0 < len(records) <= MAX_FILES,
            'INVENTORY_INVALID')
    root_names = ['root-' + str(i).zfill(3) for i in range(len(roots))]
    root_set = set(root_names)
    require(set(root_names) <= records.keys(), 'INVENTORY_ROOT_MISSING')
    for name, record in records.items():
        require(_member_name(name) and PurePosixPath(name).parts[0] in root_set,
                'INVENTORY_PATH_INVALID')
        require(isinstance(record, dict), 'INVENTORY_INVALID')
        if record.get('type') == 'directory':
            require(record == {'type': 'directory', 'bytes': 0}
                    and type(record.get('bytes')) is int, 'INVENTORY_INVALID')
        else:
            require(set(record) == {'type', 'bytes', 'sha256'}
                    and record.get('type') == 'file'
                    and type(record.get('bytes')) is int and record['bytes'] >= 0
                    and isinstance(record.get('sha256'), str)
                    and SHA256.fullmatch(record['sha256']) is not None,
                    'INVENTORY_INVALID')
        for parent in PurePosixPath(name).parents:
            if str(parent) != '.':
                require(records.get(str(parent)) == {'type': 'directory', 'bytes': 0},
                        'INVENTORY_PARENT_INVALID')
    return root_names


def _environment(container):
    config = container.get('Config')
    require(isinstance(config, dict) and isinstance(config.get('Env'), list)
            and len(config['Env']) <= 4096,
            'CONTAINER_CONFIG_INVALID')
    result = {}
    for entry in config['Env']:
        require(isinstance(entry, str) and '=' in entry and '\x00' not in entry,
                'CONTAINER_CONFIG_INVALID')
        key, value = entry.split('=', 1)
        require(key and key not in result, 'CONTAINER_CONFIG_INVALID')
        result[key] = value
    return result


def _private_layout(private):
    require(isinstance(private, dict) and private.get('contains_secrets') is True,
            'PRIVATE_CONFIG_INVALID')
    containers = private.get('containers')
    require(isinstance(containers, list) and len(containers) == len(discovery.ROLES),
            'CONTAINER_SET_INVALID')
    by_role, ids = {}, set()
    expected_names = {'/' + discovery.PREFIX + '-' + role: role for role in discovery.ROLES}
    for container in containers:
        require(isinstance(container, dict), 'CONTAINER_SET_INVALID')
        name, identifier, image = container.get('Name'), container.get('Id'), container.get('Image')
        require(isinstance(name, str) and name in expected_names
                and isinstance(identifier, str) and CONTAINER_ID.fullmatch(identifier)
                and identifier not in ids and isinstance(image, str)
                and IMAGE_ID.fullmatch(image), 'CONTAINER_SET_INVALID')
        role = expected_names[name]
        require(role not in by_role, 'CONTAINER_SET_INVALID')
        _environment(container)
        require(isinstance(container.get('Mounts'), list) and len(container['Mounts']) <= 4096,
                'CONTAINER_CONFIG_INVALID')
        by_role[role], ids = container, ids | {identifier}
    metadata = private.get('database')
    require(isinstance(metadata, dict) and metadata.get('database') == discovery.DATABASE
            and type(metadata.get('version')) is int and 170000 <= metadata['version'] < 180000
            and type(metadata.get('bytes')) is int and metadata['bytes'] > 0,
            'DATABASE_METADATA_INVALID')
    extensions = metadata.get('extensions')
    require(isinstance(extensions, list) and len(extensions) <= 1000,
            'DATABASE_METADATA_INVALID')
    extension_names = set()
    for extension in extensions:
        require(isinstance(extension, list) and len(extension) == 2
                and all(_clean_string(x) and len(x) <= 128 for x in extension)
                and extension[0] not in extension_names, 'DATABASE_METADATA_INVALID')
        extension_names.add(extension[0])
    require(private.get('database_user') in ('postgres', 'supabase_admin'),
            'DATABASE_METADATA_INVALID')
    roots = private.get('roots')
    require(isinstance(roots, list) and 0 < len(roots) <= 4096,
            'SOURCE_ROOTS_INVALID')
    paths = [_source_path(root) for root in roots]
    require(paths == sorted(set(paths)), 'SOURCE_ROOTS_INVALID')
    for i, path in enumerate(paths):
        require(not any(other in path.parents for other in paths[:i]), 'SOURCE_ROOTS_OVERLAP')
    images = private.get('images')
    require(isinstance(images, list) and 0 < len(images) <= len(discovery.ROLES),
            'IMAGE_METADATA_INVALID')
    by_image = {}
    for image in images:
        require(isinstance(image, dict) and isinstance(image.get('Id'), str)
                and IMAGE_ID.fullmatch(image['Id']) and image['Id'] not in by_image
                and image.get('Os') == 'linux' and image.get('Architecture') in ('amd64', 'arm64')
                and type(image.get('Size')) is int and image['Size'] > 0,
                'IMAGE_METADATA_INVALID')
        by_image[image['Id']] = image
    require(set(by_image) == {c['Image'] for c in containers}, 'IMAGE_METADATA_INVALID')
    return by_role, paths, by_image


def _storage_prefix(storage, roots, inventory):
    env = _environment(storage)
    require(env.get('STORAGE_BACKEND') == 'file', 'STORAGE_BACKEND_UNSUPPORTED')
    base = _source_path(env.get('FILE_STORAGE_BACKEND_PATH'))
    matches = []
    for mount in storage['Mounts']:
        require(isinstance(mount, dict), 'STORAGE_MOUNT_INVALID')
        destination = _source_path(mount.get('Destination'))
        if base == destination or destination in base.parents:
            require(mount.get('Type') in ('bind', 'volume'), 'STORAGE_MOUNT_INVALID')
            source = _source_path(mount.get('Source'))
            matches.append(source / base.relative_to(destination))
    require(len(matches) == 1, 'STORAGE_MOUNT_NOT_UNIQUE')
    source = matches[0]
    candidates = [(i, root) for i, root in enumerate(roots)
                  if source == root or root in source.parents]
    require(len(candidates) == 1, 'STORAGE_ARCHIVE_ROOT_NOT_UNIQUE')
    index, root = candidates[0]
    relative = source.relative_to(root)
    prefix = str(PurePosixPath('root-' + str(index).zfill(3)) / relative)
    require(inventory.get(prefix) == {'type': 'directory', 'bytes': 0},
            'STORAGE_ARCHIVE_DIRECTORY_MISSING')
    return prefix


def _tar_headers(path):
    """Extra checks before GNU tar extraction; backup.verify_tar checks bytes."""
    with tarfile.open(path, 'r|') as archive:
        for item in archive:
            require(_member_name(item.name), 'ARCHIVE_MEMBER_INVALID')
            require(item.isfile() or item.isdir(), 'ARCHIVE_MEMBER_INVALID')
            require(not item.issparse() and not item.linkname, 'ARCHIVE_MEMBER_INVALID')
            require(not (item.mode & 0o7000), 'ARCHIVE_SPECIAL_MODE_UNSUPPORTED')
            require(all(key in ('path', 'mtime', 'atime', 'ctime') for key in item.pax_headers),
                    'ARCHIVE_METADATA_UNSUPPORTED')


def verify_payloads(bundle, expected_manifest=None):
    """Re-hash the untouched source after a drill, without reparsing both tars."""
    try:
        root = Path(os.path.abspath(bundle))
        _safe_components(root)
        require(root.is_dir(), 'BUNDLE_DIRECTORY_REQUIRED')
        require(set(p.name for p in root.iterdir()) == PAYLOADS | {'manifest.json'},
                'BUNDLE_CONTENTS_INVALID')
        manifest = _json(root / 'manifest.json')
        require(expected_manifest is None or manifest == expected_manifest, 'BUNDLE_CHANGED')
        require(isinstance(manifest, dict) and manifest.get('format') == 1
                and type(manifest.get('format')) is int and manifest.get('capture') == 'COMPLETE'
                and manifest.get('build') == discovery.BUILD, 'MANIFEST_INVALID')
        payloads = manifest.get('payloads')
        require(isinstance(payloads, dict) and set(payloads) == PAYLOADS, 'MANIFEST_INVALID')
        for name, expected in payloads.items():
            require(isinstance(expected, dict) and set(expected) == {'bytes', 'sha256'}
                    and type(expected.get('bytes')) is int and expected['bytes'] >= 0
                    and isinstance(expected.get('sha256'), str)
                    and SHA256.fullmatch(expected['sha256']), 'MANIFEST_INVALID')
            require(_read(root / name) == expected, 'PAYLOAD_HASH_MISMATCH')
        require(_json(root / 'manifest.json') == manifest, 'BUNDLE_CHANGED')
        return manifest
    except Stop:
        raise
    except (OSError, ValueError, TypeError, KeyError):
        raise Stop('BUNDLE_VALIDATION_FAILED') from None


def validate_bundle(bundle):
    """Validate immutable input and return private in-memory orchestration data.

    Only storage_archive_prefix is established here. No assumption about tenant,
    bucket, object version, filesystem xattrs, or Storage HTTP semantics is made.
    """
    try:
        root = Path(os.path.abspath(bundle))
        manifest = verify_payloads(root)
        payloads = manifest['payloads']
        private = _json(root / 'private-config.json', payloads['private-config.json'])
        inventory = _json(root / 'inventory.json', payloads['inventory.json'])
        by_role, roots, by_image = _private_layout(private)
        archive_roots = _inventory(inventory, roots)
        storage_prefix = _storage_prefix(by_role['storage'], roots, inventory)
        _tar_headers(root / 'files.tar')
        backup.verify_tar(root / 'files.tar', inventory)
        image_archive.verify_images(root / 'images.tar', sorted(by_image), private['images'])
        with (root / 'database.dump').open('rb') as dump:
            require(dump.read(5) == b'PGDMP', 'DUMP_FORMAT_INVALID')
        # Detect files replaced or modified while the archive validators ran.
        verify_payloads(root, manifest)
        return {'bundle': root, 'manifest': manifest, 'private': private,
                'inventory': inventory, 'storage_archive_prefix': storage_prefix,
                'storage_layout_status': 'ARCHIVE_ROOT_VERIFIED_OBJECT_LAYOUT_UNVERIFIED',
                'db_image': by_role['db']['Image'],
                'db_image_meta': by_image[by_role['db']['Image']],
                'containers_by_role': by_role, 'archive_roots': archive_roots,
                'file_bytes': sum(x['bytes'] for x in inventory.values()),
                'file_count': sum(x['type'] == 'file' for x in inventory.values())}
    except Stop:
        raise
    except backup.Stop as exc:
        raise Stop(exc.reason_code) from None
    except image_archive.ImageArchiveError as exc:
        raise Stop(exc.reason_code) from None
    except (OSError, ValueError, TypeError, KeyError, tarfile.TarError):
        raise Stop('BUNDLE_VALIDATION_FAILED') from None


def verify_reexport(path, inventory):
    """Check bytes/types from a fresh Linux-volume export against the inventory.

    path may also be an already-open readable binary stream (for docker exec
    stdout); streams are consumed without being copied to the Windows host.
    GNU tar may add one './' prefix and a slash on directory entries. An optional
    single './' directory is the export's wrapper, not an archived payload.
    No other path normalization, links, or extra members are accepted.
    """
    seen, wrapper, total, files, directories = set(), False, 0, 0, 0
    try:
        streaming = hasattr(path, 'read')
        before = None if streaming else _regular(Path(path))
        options = {'fileobj': path} if streaming else {'name': path}
        with tarfile.open(mode='r|', **options) as archive:
            for item in archive:
                name = item.name
                if name in ('.', './') and item.isdir():
                    require(not wrapper, 'REEXPORT_MEMBER_INVALID')
                    wrapper = True
                    continue
                if name.startswith('./'):
                    name = name[2:]
                if item.isdir() and name.endswith('/'):
                    name = name[:-1]
                require(_member_name(name) and name not in seen and name in inventory,
                        'REEXPORT_MEMBER_INVALID')
                require(not item.issparse() and not item.linkname,
                        'REEXPORT_MEMBER_INVALID')
                seen.add(name)
                record = inventory[name]
                if item.isdir():
                    require(record == {'type': 'directory', 'bytes': 0},
                            'REEXPORT_MEMBER_INVALID')
                    directories += 1
                    continue
                require(item.isfile() and record.get('type') == 'file'
                        and item.size == record.get('bytes'), 'REEXPORT_MEMBER_INVALID')
                h, stream, size = hashlib.sha256(), archive.extractfile(item), 0
                require(stream is not None, 'REEXPORT_MEMBER_INVALID')
                for chunk in iter(lambda: stream.read(MIB), b''):
                    size += len(chunk)
                    h.update(chunk)
                require(size == record['bytes'] and h.hexdigest() == record['sha256'],
                        'REEXPORT_CONTENT_MISMATCH')
                total += size
                files += 1
        require(seen == set(inventory), 'REEXPORT_INCOMPLETE')
        if not streaming:
            require(_signature(before) == _signature(_regular(Path(path))), 'REEXPORT_CHANGED')
        return {'files': files, 'directories': directories, 'bytes': total,
                'integrity': 'VERIFIED', 'filesystem_metadata': 'NOT_PROVEN'}
    except Stop:
        raise
    except (OSError, ValueError, TypeError, KeyError, tarfile.TarError):
        raise Stop('REEXPORT_VALIDATION_FAILED') from None
