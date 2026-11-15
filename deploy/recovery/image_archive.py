"""Verify Docker/OCI save archives without extraction, execution, or a daemon."""
import hashlib
import json
from pathlib import PurePosixPath
import re
import tarfile

MIB = 1024 * 1024
MAX_MEMBERS = 500_000
MAX_JSON = 16 * MIB
MAX_JSON_TOTAL = 64 * MIB
MAX_DESCRIPTORS = 10_000
MAX_DEPTH = 8
DIGEST = re.compile(r'sha256:[0-9a-f]{64}')
INDEX_TYPES = {'application/vnd.oci.image.index.v1+json',
               'application/vnd.docker.distribution.manifest.list.v2+json'}
MANIFEST_TYPES = {'application/vnd.oci.image.manifest.v1+json',
                  'application/vnd.docker.distribution.manifest.v2+json'}
CONFIG_TYPES = {'application/vnd.oci.image.config.v1+json',
                'application/vnd.docker.container.image.v1+json'}
LAYER_TYPES = {
    'application/vnd.oci.image.layer.v1.tar',
    'application/vnd.oci.image.layer.v1.tar+gzip',
    'application/vnd.oci.image.layer.v1.tar+zstd',
    'application/vnd.oci.image.layer.nondistributable.v1.tar',
    'application/vnd.oci.image.layer.nondistributable.v1.tar+gzip',
    'application/vnd.oci.image.layer.nondistributable.v1.tar+zstd',
    'application/vnd.docker.image.rootfs.diff.tar',
    'application/vnd.docker.image.rootfs.diff.tar.gzip',
    'application/vnd.docker.image.rootfs.foreign.diff.tar.gzip',
}


class ImageArchiveError(Exception):
    def __init__(self, reason_code):
        super().__init__(reason_code)
        self.reason_code = reason_code


def require(condition, code):
    if not condition:
        raise ImageArchiveError(code)


def digest(value):
    return isinstance(value, str) and DIGEST.fullmatch(value) is not None


def member_name(value):
    if not isinstance(value, str) or not value or '\\' in value or '\x00' in value:
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and '..' not in path.parts and str(path) == value


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'IMAGE_JSON_INVALID')
        result[key] = value
    return result


def platform(value, inspect=False):
    require(isinstance(value, dict), 'IMAGE_PLATFORM_METADATA_INVALID')
    keys = ('Os', 'Architecture', 'Variant') if inspect else ('os', 'architecture', 'variant')
    result = tuple(value.get(key, '') for key in keys)
    require(all(isinstance(part, str) and len(part) <= 128 for part in result)
            and result[0] and result[1], 'IMAGE_PLATFORM_METADATA_INVALID')
    return result


def diff_ids(value, inspect=False):
    root = value.get('RootFS' if inspect else 'rootfs')
    require(isinstance(root, dict) and root.get('Type' if inspect else 'type') == 'layers',
            'IMAGE_CONFIG_INVALID')
    layers = root.get('Layers' if inspect else 'diff_ids')
    require(isinstance(layers, list) and len(layers) <= MAX_DESCRIPTORS
            and all(digest(item) for item in layers), 'IMAGE_CONFIG_INVALID')
    return layers


class Archive:
    def __init__(self, path):
        self.path, self.members, self.cache = path, {}, {}
        self.json_bytes = 0
        self.descriptors = 0
        with tarfile.open(path, 'r|') as archive:
            for item in archive:
                name = item.name.rstrip('/') if item.isdir() else item.name
                require(member_name(name) and name not in self.members
                        and len(self.members) < MAX_MEMBERS
                        and (item.isfile() or item.isdir()) and not item.sparse
                        and not any(key.startswith('GNU.sparse') for key in item.pax_headers),
                        'IMAGE_ARCHIVE_INVALID')
                if item.isdir():
                    self.members[name] = None
                    continue
                require(item.size >= 0, 'IMAGE_ARCHIVE_INVALID')
                stream, sha, count = archive.extractfile(item), hashlib.sha256(), 0
                for chunk in iter(lambda: stream.read(MIB), b''):
                    sha.update(chunk)
                    count += len(chunk)
                require(count == item.size, 'IMAGE_ARCHIVE_INVALID')
                self.members[name] = (item.offset_data, item.size, 'sha256:' + sha.hexdigest())

    def record(self, name, missing):
        require(member_name(name), 'IMAGE_ARCHIVE_INVALID')
        record = self.members.get(name)
        require(record is not None, missing)
        return record

    def read_json(self, name, missing='IMAGE_CONFIG_MISSING'):
        if name in self.cache:
            return self.cache[name]
        offset, size, _ = self.record(name, missing)
        require(size <= MAX_JSON and self.json_bytes + size <= MAX_JSON_TOTAL,
                'IMAGE_JSON_LIMIT')
        with open(self.path, 'rb') as stream:
            stream.seek(offset)
            raw = stream.read(size)
        require(len(raw) == size, 'IMAGE_ARCHIVE_INVALID')
        try:
            value = json.loads(raw, object_pairs_hook=unique_pairs)
        except (ValueError, UnicodeError, RecursionError):
            raise ImageArchiveError('IMAGE_JSON_INVALID') from None
        self.json_bytes += size
        self.cache[name] = value
        return value

    def descriptor(self, value, types, missing):
        self.descriptors += 1
        require(self.descriptors <= MAX_DESCRIPTORS, 'IMAGE_DESCRIPTOR_LIMIT')
        require(isinstance(value, dict) and digest(value.get('digest'))
                and type(value.get('size')) is int and value['size'] >= 0
                and isinstance(value.get('mediaType'), str)
                and value['mediaType'] in types, 'IMAGE_DESCRIPTOR_INVALID')
        name = 'blobs/sha256/' + value['digest'][7:]
        _, size, actual = self.record(name, missing)
        require(size == value['size'] and actual == value['digest'], 'IMAGE_DESCRIPTOR_MISMATCH')
        if value['mediaType'] in INDEX_TYPES | MANIFEST_TYPES:
            body = self.read_json(name, missing)
            require(isinstance(body, dict) and body.get('mediaType') == value['mediaType'],
                    'IMAGE_DESCRIPTOR_MISMATCH')
        return name

    def config(self, name, expected):
        value = self.read_json(name)
        require(isinstance(value, dict), 'IMAGE_CONFIG_INVALID')
        actual_platform, layers = platform(value), diff_ids(value)
        if expected is not None:
            require(actual_platform == platform(expected, inspect=True), 'IMAGE_PLATFORM_MISSING')
            require(layers == diff_ids(expected, inspect=True), 'IMAGE_CONFIG_MISMATCH')
        return layers

    def root(self, image_id):
        layout = self.read_json('oci-layout', 'IMAGE_MANIFEST_MISSING')
        require(isinstance(layout, dict) and layout.get('imageLayoutVersion') == '1.0.0',
                'IMAGE_MANIFEST_INVALID')
        index = self.read_json('index.json', 'IMAGE_MANIFEST_MISSING')
        require(isinstance(index, dict) and index.get('schemaVersion') == 2
                and isinstance(index.get('manifests'), list)
                and len(index['manifests']) <= MAX_DESCRIPTORS, 'IMAGE_MANIFEST_INVALID')
        roots = [entry for entry in index['manifests']
                 if isinstance(entry, dict) and entry.get('digest') == image_id]
        require(roots, 'IMAGE_ARCHIVE_MISMATCH')
        names = [self.descriptor(entry, INDEX_TYPES | MANIFEST_TYPES,
                                 'IMAGE_DESCRIPTOR_MISSING') for entry in roots]
        return names[0]

    def manifest(self, value, expected):
        require(isinstance(value, dict) and value.get('schemaVersion') == 2
                and isinstance(value.get('mediaType'), str)
                and value['mediaType'] in MANIFEST_TYPES, 'IMAGE_MANIFEST_INVALID')
        config = self.descriptor(value.get('config'), CONFIG_TYPES, 'IMAGE_CONFIG_MISSING')
        layers = value.get('layers')
        require(isinstance(layers, list) and len(layers) <= MAX_DESCRIPTORS, 'IMAGE_MANIFEST_INVALID')
        wanted = self.config(config, expected)
        require(len(layers) == len(wanted), 'IMAGE_CONFIG_MISMATCH')
        for layer, diff_id in zip(layers, wanted):
            self.descriptor(layer, LAYER_TYPES, 'IMAGE_LAYER_MISSING')
            if layer['mediaType'].endswith('.tar'):
                require(layer['digest'] == diff_id, 'IMAGE_CONTENT_MISMATCH')

    def tree(self, name, expected, stack=()):
        require(len(stack) < MAX_DEPTH and name not in stack, 'IMAGE_DESCRIPTOR_LIMIT')
        value = self.read_json(name, 'IMAGE_DESCRIPTOR_MISSING')
        require(isinstance(value, dict) and value.get('schemaVersion') == 2
                and isinstance(value.get('mediaType'), str),
                'IMAGE_MANIFEST_INVALID')
        if value.get('mediaType') in MANIFEST_TYPES:
            self.manifest(value, expected)
            return
        require(value.get('mediaType') in INDEX_TYPES, 'IMAGE_MANIFEST_INVALID')
        require(expected is not None, 'IMAGE_PLATFORM_METADATA_REQUIRED')
        entries = value.get('manifests')
        require(isinstance(entries, list) and 0 < len(entries) <= MAX_DESCRIPTORS,
                'IMAGE_MANIFEST_INVALID')
        selected = 0
        for entry in entries:
            require(isinstance(entry, dict), 'IMAGE_DESCRIPTOR_INVALID')
            declared = entry.get('platform')
            if declared is not None and platform(declared) != platform(expected, inspect=True):
                continue
            target = self.descriptor(entry, INDEX_TYPES | MANIFEST_TYPES, 'IMAGE_DESCRIPTOR_MISSING')
            self.tree(target, expected, (*stack, name))
            selected += 1
        require(selected > 0, 'IMAGE_PLATFORM_MISSING')


def verify_images(path, expected_ids, expected_images=None):
    """Validate each expected config/manifest/index identity and its saved graph."""
    require(isinstance(expected_ids, (list, tuple, set)) and expected_ids
            and len(expected_ids) <= MAX_DESCRIPTORS and all(digest(i) for i in expected_ids),
            'IMAGE_IDS_INVALID')
    expected = {}
    if expected_images is not None:
        require(isinstance(expected_images, list), 'IMAGE_PLATFORM_METADATA_INVALID')
        for item in expected_images:
            require(isinstance(item, dict) and item.get('Id') in expected_ids
                    and item['Id'] not in expected, 'IMAGE_PLATFORM_METADATA_INVALID')
            platform(item, inspect=True)
            diff_ids(item, inspect=True)
            expected[item['Id']] = item
        require(set(expected) == set(expected_ids), 'IMAGE_PLATFORM_METADATA_INVALID')
    try:
        archive = Archive(path)
        listing = archive.read_json('manifest.json', 'IMAGE_MANIFEST_MISSING')
        require(isinstance(listing, list) and len(listing) <= MAX_DESCRIPTORS,
                'IMAGE_MANIFEST_INVALID')
        classic = {}
        for item in listing:
            require(isinstance(item, dict) and member_name(item.get('Config')),
                    'IMAGE_MANIFEST_INVALID')
            _, _, config_hash = archive.record(item['Config'], 'IMAGE_CONFIG_MISSING')
            classic.setdefault(config_hash, []).append(item)
        for image_id in set(expected_ids):
            metadata = expected.get(image_id)
            if image_id in classic:
                for item in classic[image_id]:
                    layers = item.get('Layers')
                    require(isinstance(layers, list) and len(layers) <= MAX_DESCRIPTORS,
                            'IMAGE_MANIFEST_INVALID')
                    wanted = archive.config(item['Config'], metadata)
                    require(len(layers) == len(wanted), 'IMAGE_CONFIG_MISMATCH')
                    actual = [archive.record(name, 'IMAGE_LAYER_MISSING')[2] for name in layers]
                    require(actual == wanted, 'IMAGE_CONTENT_MISMATCH')
                continue
            name = archive.root(image_id)
            archive.tree(name, metadata)
    except (OSError, tarfile.TarError, EOFError):
        raise ImageArchiveError('IMAGE_ARCHIVE_INVALID') from None
