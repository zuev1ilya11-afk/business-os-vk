# Exact dependency graph/lock checks reused from report deployment 800b057.
import json
import posixpath
import re
import urllib.parse
import urllib.request
import eszip
from common import require, Stop

def split_package(identifier):
    match = re.fullmatch(r'((?:@[a-z0-9._-]+/)?[a-z0-9._-]+)@([0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9._-]+)?)', identifier)
    require(match is not None, 'UNSUPPORTED_NPM_PACKAGE_ID')
    return match.group(1), match.group(2)


def integrity(identifier):
    name, version = split_package(identifier)
    url = 'https://registry.npmjs.org/' + urllib.parse.quote(name, safe='@') + '/' + version
    try:
        with urllib.request.urlopen(url, timeout=40) as response:
            require(response.status == 200, 'NPM_METADATA_HTTP')
            data = response.read(2_000_001)
        require(len(data) <= 2_000_000, 'NPM_METADATA_SIZE')
        info = json.loads(data)
        require(info.get('name') == name and info.get('version') == version, 'NPM_METADATA_IDENTITY')
        value = info.get('dist', {}).get('integrity', '')
        require(re.fullmatch(r'sha(?:256|384|512)-[A-Za-z0-9+/]{40,172}={0,2}', value) is not None, 'NPM_INTEGRITY_MISSING')
        return identifier, value
    except Stop:
        raise
    except Exception:
        raise Stop('NPM_METADATA_DOWNLOAD_FAILED') from None


def lockfile(bundle, integrities):
    counts = {}
    for identifier in bundle['npm']:
        name, _ = split_package(identifier)
        counts[name] = counts.get(name, 0) + 1
    lock = {'version': '4', 'specifiers': {}, 'npm': {}}
    for request, identifier in sorted(bundle['npm_roots'].items()):
        name, version = split_package(identifier)
        require(request.startswith(name + '@'), 'NPM_ROOT_ALIAS_UNSUPPORTED')
        lock['specifiers']['npm:' + request] = version
    for identifier, dependencies in sorted(bundle['npm'].items()):
        value = {'integrity': integrities[identifier]}
        resolved = []
        for alias, target in sorted(dependencies.items()):
            name, _ = split_package(target)
            require(alias == name and target in bundle['npm'], 'NPM_ALIAS_UNSUPPORTED')
            resolved.append(name if counts[name] == 1 else target)
        if resolved:
            value['dependencies'] = resolved
        lock['npm'][identifier] = value
    return lock


def options(data):
    reader = eszip.Reader(data)
    magic = reader.take(8)
    return reader.take(reader.uint()) if magic in eszip.MAGICS[2:] else b''


def equal_baseline(before_data, after_data):
    # Compare every parsed module, including opaque data and source maps, by its
    # exact specifier. Only serialization order/offsets are immaterial.
    before, after = eszip.parse(before_data), eszip.parse(after_data)
    fields = ('magic', 'modules', 'maps', 'redirects', 'npm', 'npm_roots', 'checksum_kind', 'trailer')
    return (options(before_data) == options(after_data) and
            before['checksum_kind'] in (0, 1) and
            all(before[field] == after[field] for field in fields))


def executable_modules(bundle, relative):
    """Resolve eszip-relative paths against the known mounted entrypoint.

    Adding ../_shared can move the common archive root up one directory.
    The source file is still the same /bos-src/<relative>/index.ts.
    """
    entries = [name for name, (kind, _) in bundle['modules'].items()
               if kind == 0 and (name == 'index.ts' or name.endswith('/index.ts'))]
    require(len(entries) == 1, 'PATCHED_ENTRYPOINT_NOT_UNIQUE')
    require(not relative.startswith('/') and all(p not in ('', '.', '..') for p in relative.split('/')), 'UNSAFE_SOURCE_ENTRYPOINT')
    logical_entry = '/bos-src/' + relative
    entry_name = entries[0]
    entry_url = urllib.parse.urlsplit(entry_name)
    if entry_url.scheme:
        require(entry_url.scheme == 'file' and not entry_url.netloc and not entry_url.query and not entry_url.fragment,
                  'UNSUPPORTED_ENTRYPOINT_URL')
        require(urllib.parse.unquote(entry_url.path) == logical_entry, 'ABSOLUTE_ENTRYPOINT_CHANGED')
        root = '/bos-src'
    else:
        require(not entry_name.startswith('/') and all(p not in ('', '.', '..') for p in entry_name.split('/')),
                  'UNSAFE_ARCHIVE_ENTRYPOINT')
        require(logical_entry.endswith('/' + entry_name), 'ARCHIVE_ENTRYPOINT_SUFFIX_CHANGED')
        # The bundler can choose the filesystem root as the archive root.
        # For bos-src/<relative>, stripping the separator must preserve '/':
        # an empty string would turn every subsequent join into a relative path.
        root = logical_entry[:-len(entry_name)].rstrip('/') or '/'

    def canonical(name):
        url = urllib.parse.urlsplit(name)
        if url.scheme and url.scheme != 'file':
            return name
        if url.scheme == 'file':
            require(not url.netloc and not url.query and not url.fragment, 'UNSAFE_FILE_SPECIFIER')
            path = urllib.parse.unquote(url.path)
        else:
            require(not name.startswith('/') and not url.query and not url.fragment, 'UNSAFE_RELATIVE_SPECIFIER')
            path = posixpath.join(root, urllib.parse.unquote(name))
        normalized = posixpath.normpath(path)
        require(normalized.startswith('/bos-src/'), 'MODULE_OUTSIDE_STAGED_SOURCE')
        return normalized

    modules = {}
    for name, value in bundle['modules'].items():
        if value[0] == 3:
            continue
        key = canonical(name)
        require(key not in modules, 'DUPLICATE_CANONICAL_MODULE')
        modules[key] = value
    redirects = {}
    for name, target in bundle['redirects'].items():
        key = canonical(name)
        require(key not in redirects, 'DUPLICATE_CANONICAL_REDIRECT')
        redirects[key] = canonical(target)
    require(logical_entry in modules, 'LOGICAL_ENTRYPOINT_MISSING')
    return modules, redirects, logical_entry
