# Parser vendored from reviewed report deployment 800b057; no runtime or network access.
import hashlib
import struct
MAGICS = (b'ESZIP_V2', b'ESZIP2.1', b'ESZIP2.2', b'ESZIP2.3')

class InvalidBundle(Exception):
    pass


def require(value):
    if not value:
        raise InvalidBundle('UNSUPPORTED_OR_INVALID_ESZIP')


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Reader:
    def __init__(self, data):
        self.data, self.pos = data, 0

    def take(self, count):
        require(0 <= count <= len(self.data) - self.pos)
        start = self.pos
        self.pos += count
        return self.data[start:self.pos]

    def uint(self):
        return struct.unpack('>I', self.take(4))[0]

    def string(self):
        count = self.uint()
        require(count <= 1_000_000)
        return self.take(count).decode('utf-8')

    def remaining(self):
        return len(self.data) - self.pos


def parse(data):
    r = Reader(data)
    magic = r.take(8)
    require(magic in MAGICS)
    algorithm, digest_size = (1, 32) if magic in MAGICS[:2] else (0, 0)
    checksums_verified = algorithm == 1

    def check(body, digest):
        nonlocal checksums_verified
        if algorithm == 1:
            require(digest_size == 32 and hashlib.sha256(body).digest() == digest)
        elif algorithm == 0:
            require(digest_size == 0)
        else:
            # Unknown/xxhash checksums are not falsely reported as verified.
            checksums_verified = False

    def section(reader):
        body = reader.take(reader.uint())
        check(body, reader.take(digest_size))
        return body

    if magic in MAGICS[2:]:
        options = r.take(r.uint())
        require(len(options) % 2 == 0)
        values = dict(zip(options[::2], options[1::2]))
        algorithm = values.get(0, 0)
        digest_size = values.get(1, {0: 0, 1: 32, 2: 8}.get(algorithm))
        require(digest_size is not None and digest_size <= 128)
        checksums_verified = algorithm == 1
        check(options, r.take(digest_size))
    h = Reader(section(r))
    records, redirects, npm_roots = {}, {}, {}
    while h.remaining():
        name, kind = h.string(), h.take(1)[0]
        require(name not in records and name not in redirects and name not in npm_roots)
        if kind == 0:
            records[name] = (h.uint(), h.uint(), h.uint(), h.uint(), h.take(1)[0])
        elif kind == 1:
            redirects[name] = h.string()
        elif kind == 2 and magic != MAGICS[0]:
            npm_roots[name] = h.uint()
        else:
            raise InvalidBundle('UNSUPPORTED_HEADER_KIND')
        require(len(records) + len(redirects) + len(npm_roots) < 100_000)
    npm_raw = section(r) if magic != MAGICS[0] else b''
    sources, maps = r.take(r.uint()), r.take(r.uint())
    modules, source_maps = {}, {}
    coverage = [[], []]
    for name, (offset, size, map_offset, map_size, kind) in records.items():
        bodies = []
        for i, (area, start, count) in enumerate(((sources, offset, size), (maps, map_offset, map_size))):
            if start == count == 0:
                bodies.append(b'')
                continue
            require(start + count + digest_size <= len(area))
            body = area[start:start + count]
            check(body, area[start + count:start + count + digest_size])
            coverage[i].append((start, start + count + digest_size))
            bodies.append(body)
        modules[name] = (kind, bodies[0])
        source_maps[name] = bodies[1]
    for area, spans in zip((sources, maps), coverage):
        end = 0
        for start, stop in sorted(spans):
            require(start == end)
            end = stop
        require(end == len(area))
    npm_reader, packages = Reader(npm_raw), []
    while npm_reader.remaining():
        name, count = npm_reader.string(), npm_reader.uint()
        require(count < 100_000)
        deps = {}
        for _ in range(count):
            dep, idx = npm_reader.string(), npm_reader.uint()
            require(dep not in deps)
            deps[dep] = idx
        packages.append((name, deps))
        require(len(packages) < 100_000)
    canonical_packages = {}
    for name, deps in packages:
        require(name not in canonical_packages and all(i < len(packages) for i in deps.values()))
        canonical_packages[name] = {dep: packages[i][0] for dep, i in deps.items()}
    require(all(i < len(packages) for i in npm_roots.values()))
    return {'magic': magic.decode(), 'modules': modules, 'maps': source_maps,
            'redirects': redirects, 'npm': canonical_packages,
            'npm_roots': {name: packages[i][0] for name, i in npm_roots.items()},
            'checksum_kind': algorithm, 'checksums_verified': checksums_verified,
            'trailer': r.take(r.remaining())}
