"""Read-only discovery for the observed release; never prints private values."""
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
from urllib.parse import unquote, urlsplit

RELEASE = Path('/opt/business-os/deploy/release-to2wblxf')
PREFIX = 'bos-release-to2wblxf'
BUILD = 'f78221901b3b47887fa7'
DATABASE = 'bos_restore_check'
ROLES = ('db', 'rest', 'auth', 'storage', 'edge', 'https')
CONFIG_FILES = ('auth.env', 'db.env', 'rest.env', 'source.env', 'storage.env', 'images.json')
DATABASE_CONFIG_NAMES = frozenset(('postgres.conf', 'postgresql.conf', 'pg_hba.conf',
                                  'pg_ident.conf', 'postgresql.auto.conf'))
IMAGE = re.compile(r'sha256:[0-9a-f]{64}')
MAX_CONTAINERS = 512
INSPECT_LIMIT = 16 * 1024 * 1024


class Stop(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Stop(code)


def inside(path, parent):
    return path == parent or parent in path.parents


def checked_path(value):
    require(isinstance(value, (str, Path)), 'SOURCE_PATH_UNSAFE')
    path = Path(value)
    require(path.is_absolute() and path != Path('/') and
            '..' not in path.parts, 'SOURCE_PATH_UNSAFE')
    try:
        require(path.resolve(strict=True) == path, 'SOURCE_PATH_SYMLINK')
        mode = path.lstat().st_mode
    except OSError:
        raise Stop('SOURCE_PATH_UNAVAILABLE') from None
    require(stat.S_ISDIR(mode) or stat.S_ISREG(mode), 'SOURCE_TYPE_UNSUPPORTED')
    return path, stat.S_ISDIR(mode)


def read_file(path, limit=8 * 1024 * 1024):
    path, directory = checked_path(path)
    require(not directory, 'CONFIG_NOT_REGULAR')
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as handle:
            before = os.fstat(handle.fileno())
            require(stat.S_ISREG(before.st_mode) and before.st_size <= limit,
                    'CONFIG_READ_LIMIT')
            data = handle.read(limit + 1)
            after = os.fstat(handle.fileno())
        require(len(data) <= limit, 'CONFIG_READ_LIMIT')
        require((before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_ino, len(data), after.st_mtime_ns, after.st_ctime_ns),
                'CONFIG_CHANGED_DURING_READ')
        return data
    except OSError:
        raise Stop('CONFIG_UNREADABLE') from None


def json_data(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'JSON_DUPLICATE_KEY')
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, UnicodeError):
        raise Stop('JSON_INVALID') from None


def environment(container):
    result = {}
    entries = container.get('Config', {}).get('Env') or []
    require(isinstance(entries, list), 'ENV_LAYOUT_UNSUPPORTED')
    for entry in entries:
        require(isinstance(entry, str) and '=' in entry, 'ENV_LAYOUT_UNSUPPORTED')
        key, value = entry.split('=', 1)
        require(key not in result, 'ENV_DUPLICATE_KEY')
        result[key] = value
    return result


def parsed_url(raw, scheme):
    require(isinstance(raw, str) and raw and not any(c.isspace() for c in raw),
            'ROUTE_URI_UNSUPPORTED')
    try:
        value = urlsplit(raw)
        require(value.scheme in scheme and value.hostname and
                '?' not in raw and '#' not in raw, 'ROUTE_URI_UNSUPPORTED')
        require(value.port is None or 1 <= value.port <= 65535, 'ROUTE_PORT_UNSUPPORTED')
        return value
    except ValueError:
        raise Stop('ROUTE_URI_UNSUPPORTED') from None


def resolve(source, hostname, containers):
    networks = source.get('NetworkSettings', {}).get('Networks')
    require(isinstance(networks, dict), 'NETWORK_LAYOUT_UNSUPPORTED')
    matches = []
    for candidate in containers:
        other = candidate.get('NetworkSettings', {}).get('Networks')
        require(isinstance(other, dict), 'NETWORK_LAYOUT_UNSUPPORTED')
        for network in networks.keys() & other.keys():
            info = other[network]
            aliases = [candidate['Name'].lstrip('/'), info.get('IPAddress'),
                       *(info.get('Aliases') or []), *(info.get('DNSNames') or [])]
            if hostname in aliases:
                matches.append(candidate)
                break
    require(len(matches) == 1, 'ROUTE_NOT_UNIQUE')
    return matches[0]


def http_route(edge, key, expected, containers):
    uri = parsed_url(environment(edge).get(key), ('http', 'https'))
    require(uri.username is None and uri.password is None and uri.path in ('', '/'),
            'HTTP_ROUTE_UNSUPPORTED')
    require(resolve(edge, uri.hostname, containers)['Id'] == expected['Id'],
            'HTTP_ROUTE_CHANGED')
    return uri.port or (443 if uri.scheme == 'https' else 80)


def database_route(source, key, db, containers):
    uri = parsed_url(environment(source).get(key), ('postgres', 'postgresql'))
    require(uri.port in (None, 5432), 'DATABASE_PORT_UNSUPPORTED')
    database = unquote(uri.path[1:]) if uri.path.startswith('/') else ''
    require(re.fullmatch(r'[A-Za-z0-9_-]{1,63}', database) is not None,
            'DATABASE_NAME_UNSUPPORTED')
    require(database == DATABASE and
            resolve(source, uri.hostname, containers)['Id'] == db['Id'],
            'DATABASE_ROUTE_CHANGED')


def mounts(container):
    entries = container.get('Mounts')
    require(isinstance(entries, list), 'MOUNT_LAYOUT_UNSUPPORTED')
    result = []
    for entry in entries:
        require(isinstance(entry, dict), 'MOUNT_LAYOUT_UNSUPPORTED')
        destination = entry.get('Destination')
        require(isinstance(destination, str), 'MOUNT_TARGET_UNSAFE')
        target = PurePosixPath(destination)
        require(target.is_absolute() and '..' not in target.parts,
                'MOUNT_TARGET_UNSAFE')
        # A volatile tmpfs has no persistent host source to archive.
        if entry.get('Type') == 'tmpfs':
            require(not entry.get('Source'), 'TMPFS_SOURCE_UNSUPPORTED')
            result.append((None, target, True))
            continue
        require(entry.get('Type') == 'bind' or
                (entry.get('Type') == 'volume' and entry.get('Driver') == 'local'),
                'MOUNT_TYPE_UNSUPPORTED')
        source, directory = checked_path(entry.get('Source'))
        result.append((source, target, directory))
    for index, (_, target, _) in enumerate(result):
        for _, other, _ in result[index + 1:]:
            require(not inside(target, other) and not inside(other, target),
                    'NESTED_MOUNT_TARGET')
    return result


def protected_mounts(run, required_ids):
    """Include other and stopped containers without requesting their Env/Config."""
    id_limit = MAX_CONTAINERS * 65 + 1
    try:
        raw = run(['ps', '-aq', '--no-trunc'], timeout=30, limit=id_limit)
    except Exception:
        raise Stop('MOUNT_INVENTORY_FAILED') from None
    require(isinstance(raw, bytes) and len(raw) <= id_limit, 'MOUNT_INVENTORY_LIMIT')
    try:
        ids = raw.decode('ascii').splitlines()
    except UnicodeError:
        raise Stop('MOUNT_CONTAINER_ID_UNSUPPORTED') from None
    require(1 <= len(ids) <= MAX_CONTAINERS, 'MOUNT_INVENTORY_LIMIT')
    require(len(set(ids)) == len(ids) and all(re.fullmatch(r'[0-9a-f]{64}', item) for item in ids),
            'MOUNT_CONTAINER_ID_UNSUPPORTED')
    require(set(required_ids) <= set(ids), 'CONTAINER_INVENTORY_CHANGED')
    try:
        raw = run(['inspect', '--format', '{{json .Mounts}}', *ids],
                  timeout=30, limit=INSPECT_LIMIT)
    except Exception:
        raise Stop('MOUNT_INVENTORY_FAILED') from None
    require(isinstance(raw, bytes) and len(raw) <= INSPECT_LIMIT, 'MOUNT_INVENTORY_LIMIT')
    lines = raw.splitlines()
    require(len(lines) == len(ids), 'MOUNT_INVENTORY_LAYOUT_UNSUPPORTED')
    protected = set()
    for line in lines:
        entries = json_data(line)
        require(isinstance(entries, list), 'MOUNT_INVENTORY_LAYOUT_UNSUPPORTED')
        for entry in entries:
            require(isinstance(entry, dict), 'MOUNT_INVENTORY_LAYOUT_UNSUPPORTED')
            if entry.get('Type') == 'tmpfs':
                require(not entry.get('Source'), 'MOUNT_INVENTORY_LAYOUT_UNSUPPORTED')
                continue
            require(entry.get('Type') in ('bind', 'volume') and
                    isinstance(entry.get('Source'), str) and entry['Source'],
                    'MOUNT_INVENTORY_LAYOUT_UNSUPPORTED')
            path = Path(entry['Source'])
            require(path.is_absolute() and '..' not in path.parts,
                    'MOUNT_INVENTORY_PATH_UNSAFE')
            try:
                # Missing stopped-container paths still protect future destinations.
                for part in [path, *path.parents]:
                    try:
                        mode = part.lstat().st_mode
                    except FileNotFoundError:
                        continue
                    require(not stat.S_ISLNK(mode), 'MOUNT_INVENTORY_PATH_UNSAFE')
                require(path.resolve(strict=False) == path, 'MOUNT_INVENTORY_PATH_UNSAFE')
            except (OSError, RuntimeError):
                raise Stop('MOUNT_INVENTORY_PATH_UNSAFE') from None
            # '/' deliberately remains protected: core must reject every output.
            protected.add(path)
    return protected


def discover(run):
    """Return private layout; run accepts Docker arguments WITHOUT docker prefix."""
    try:
        return _discover(run)
    except Stop:
        raise
    except Exception:
        raise Stop('DISCOVERY_UNAVAILABLE') from None


def _discover(run):
    release, directory = checked_path(RELEASE)
    require(directory, 'RELEASE_NOT_DIRECTORY')
    names = [PREFIX + '-' + role for role in ROLES]
    try:
        raw = run(['inspect', *names], timeout=30, limit=INSPECT_LIMIT)
    except Exception:
        raise Stop('DOCKER_INSPECT_FAILED') from None
    require(isinstance(raw, bytes) and len(raw) <= INSPECT_LIMIT,
            'DOCKER_RESPONSE_LIMIT')
    containers = json_data(raw)
    require(isinstance(containers, list) and len(containers) == len(names),
            'CONTAINER_SET_CHANGED')
    by_name = {}
    for container in containers:
        require(isinstance(container, dict), 'CONTAINER_LAYOUT_UNSUPPORTED')
        name = container.get('Name')
        require(isinstance(name, str) and name.startswith('/'), 'CONTAINER_NAME_UNSUPPORTED')
        name = name[1:]
        require(name in names and name not in by_name, 'CONTAINER_SET_CHANGED')
        require(container.get('State', {}).get('Running') is True and
                container['State'].get('Status') == 'running', 'CONTAINER_NOT_RUNNING')
        require(isinstance(container.get('Id'), str) and
                re.fullmatch(r'[0-9a-f]{64}', container['Id']) is not None,
                'CONTAINER_ID_UNSUPPORTED')
        require(isinstance(container.get('Image'), str) and
                IMAGE.fullmatch(container['Image']) is not None, 'IMAGE_ID_UNSUPPORTED')
        by_name[name] = container
    role = {key: by_name[PREFIX + '-' + key] for key in ROLES}
    images = json_data(read_file(release / 'images.json'))
    expected = {('caddy' if key == 'https' else key): role[key]['Image'] for key in ROLES}
    require(images == expected, 'IMAGE_MANIFEST_CHANGED')
    manifest = read_file(release / 'web/build-version.js')
    match = re.fullmatch(rb'// Generated by npm run build\. Do not edit\.\nself\.BOS_BUILD=(\{.*\});\n',
                         manifest, re.S)
    require(match is not None, 'BUILD_MANIFEST_UNSUPPORTED')
    require(json_data(match[1]).get('id') == BUILD, 'BUILD_CHANGED')
    port = http_route(role['edge'], 'BOS_REST_ORIGIN', role['rest'], containers)
    require(port == int(environment(role['rest']).get('PGRST_SERVER_PORT', '3000')),
            'REST_PORT_CHANGED')
    storage_port = http_route(role['edge'], 'BOS_STORAGE_ORIGIN', role['storage'], containers)
    storage_env = environment(role['storage'])
    if 'PORT' in storage_env:
        require(storage_port == int(storage_env['PORT']), 'STORAGE_PORT_CHANGED')
    for key, field in [('rest', 'PGRST_DB_URI'), ('auth', 'GOTRUE_DB_DATABASE_URL'),
                       ('storage', 'DATABASE_URL')]:
        database_route(role[key], field, role['db'], containers)
    mapped = {key: mounts(value) for key, value in role.items()}
    pinned_mounts = {
        'https': {'/srv': release / 'web', '/etc/caddy': release / 'caddy',
                  '/config': release / 'caddy-config'},
        'edge': {'/bos-src': release / 'edge/sources',
                 '/bos-bundles': release / 'edge/bundles', '/bos-main': release / 'edge/main'},
    }
    for key, expected_mounts in pinned_mounts.items():
        for target, expected_source in expected_mounts.items():
            actual = [(source, is_dir) for source, destination, is_dir in mapped[key]
                      if destination == PurePosixPath(target)]
            require(actual == [(expected_source, True)], 'PINNED_MOUNT_CHANGED')
    for source, target, is_dir in mapped['db']:
        if source is not None and not is_dir:
            require(source.name in DATABASE_CONFIG_NAMES and target.name in DATABASE_CONFIG_NAMES,
                    'DATABASE_FILE_MOUNT_UNSUPPORTED')
    require(storage_env.get('STORAGE_BACKEND') == 'file', 'STORAGE_BACKEND_UNSUPPORTED')
    storage_value = storage_env.get('FILE_STORAGE_BACKEND_PATH')
    require(isinstance(storage_value, str), 'STORAGE_PATH_UNSUPPORTED')
    storage_path = PurePosixPath(storage_value)
    require(storage_path.is_absolute() and '..' not in storage_path.parts,
            'STORAGE_PATH_UNSUPPORTED')
    storage_mounts = [(source, target, is_dir) for source, target, is_dir in mapped['storage']
                      if inside(storage_path, target)]
    require(len(storage_mounts) == 1, 'STORAGE_MOUNT_NOT_UNIQUE')
    source, target, is_dir = storage_mounts[0]
    require(source is not None and is_dir, 'STORAGE_MOUNT_UNSUPPORTED')
    _, is_dir = checked_path(source / storage_path.relative_to(target))
    require(is_dir, 'STORAGE_PATH_NOT_DIRECTORY')
    protected = {source for entries in mapped.values() for source, _, _ in entries if source is not None}
    db_dirs = {source for source, _, is_dir in mapped['db'] if source is not None and is_dir}
    require(db_dirs, 'DATABASE_DATA_MOUNT_UNVERIFIED')
    roots = {source for key, entries in mapped.items() for source, _, is_dir in entries
             if source is not None and (key != 'db' or not is_dir)}
    for filename in CONFIG_FILES:
        path, is_dir = checked_path(release / filename)
        require(not is_dir, 'RELEASE_CONFIG_NOT_REGULAR')
        roots.add(path)
    config = release / 'postgres.conf'
    if config.exists() or config.is_symlink():
        path, is_dir = checked_path(config)
        require(not is_dir, 'RELEASE_CONFIG_NOT_REGULAR')
        roots.add(path)
    for path in roots:
        require(path != release, 'RELEASE_ROOT_CAPTURE_FORBIDDEN')
        require(not any(inside(path, pgdata) or inside(pgdata, path) for pgdata in db_dirs),
                'DATABASE_FILES_CAPTURE_FORBIDDEN')
    # Shared or contained host roots need one archive copy; mount topology stays private.
    roots = sorted(path for path in roots if not any(path != other and inside(path, other) for other in roots))
    protected.update(protected_mounts(run, [container['Id'] for container in containers]))
    return {'containers': containers, 'database_container': role['db']['Id'],
            'database': DATABASE, 'images': expected, 'build': BUILD, 'release': release,
            'roots': roots, 'protected': sorted(protected)}
