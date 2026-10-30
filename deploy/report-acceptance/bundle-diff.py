#!/usr/bin/env python3
"""Inspect an already staged baseline mismatch without running application code.

Reads the saved eszip files, source tree, gateway and frontend. Writes only a
private diagnostic report inside that stage. Does not invoke Docker or a build,
connect to the database/network, or replace production files.

Format reference (independent parser):
https://github.com/denoland/eszip/blob/v0.104.0/src/v2.rs
This is a diagnostic, NOT a relaxed deployment gate.
"""
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys

STAGER = Path('/tmp/bos-stage.py')
STAGER_SHA = '7e41a15b6f5209b17e3df0c73846585bf45fd4c4e69fd05ff7f8f440a3e06425'
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


def entrypoint(bundle):
    matches = [(name, body) for name, (kind, body) in bundle['modules'].items()
               if kind == 0 and (name.endswith('/order-lifecycle-api/index.ts') or
                  (b'archiveBeforeApproval' in body and b'reviewReport' in body))]
    return matches[0] if len(matches) == 1 else None


def package_label(name):
    return name if re.fullmatch(r'(?:@[a-z0-9._-]+/)?[a-z0-9._-]+@[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9._-]+)?', name) else 'package-' + sha(name.encode())[:12]


def module_label(name):
    for basename in ('order-payroll.js', 'service-catalog.js', 'report-deduction.js',
                     'hands-details.ts', 'report-storage.ts'):
        if name.endswith('/' + basename):
            return basename
    if name.endswith('/order-lifecycle-api/index.ts'):
        return 'order-lifecycle-api/index.ts'
    return 'module-' + sha(name.encode())[:12]


def comparison(old, new):
    old_keys, new_keys = set(old['modules']), set(new['modules'])
    old_entry, new_entry = entrypoint(old), entrypoint(new)
    code = lambda b: Counter((kind, sha(body)) for kind, body in b['modules'].values())
    changed = [name for name in old_keys & new_keys if old['modules'][name] != new['modules'][name]]
    return {
        'format': [old['magic'], new['magic']],
        'module_counts': [len(old_keys), len(new_keys)],
        'specifier_sets_equal': old_keys == new_keys,
        'all_module_content_equal': code(old) == code(new),
        'entrypoint_found': [old_entry is not None, new_entry is not None],
        'entrypoint_path_equal': old_entry[0] == new_entry[0] if old_entry and new_entry else None,
        'entrypoint_code_equal': old_entry[1] == new_entry[1] if old_entry and new_entry else None,
        'changed_modules': [module_label(n) for n in sorted(changed)][:12],
        'different_specifier_counts': [len(old_keys - new_keys), len(new_keys - old_keys)],
        'npm_graph_equal': old['npm'] == new['npm'] and old['npm_roots'] == new['npm_roots'],
        'packages_removed': sorted(package_label(n) for n in set(old['npm']) - set(new['npm']))[:12],
        'packages_added': sorted(package_label(n) for n in set(new['npm']) - set(old['npm']))[:12],
        'redirects_equal': old['redirects'] == new['redirects'],
        'source_maps_equal': old['maps'] == new['maps'],
        'checksums_verified': [old['checksums_verified'], new['checksums_verified']],
        'checksum_kind': [old['checksum_kind'], new['checksum_kind']],
        'trailer_equal': old['trailer'] == new['trailer'],
        'trailer_sizes': [len(old['trailer']), len(new['trailer'])],
    }


URL = re.compile(rb'https?://[^\s\x00-\x20\x7f\x22\x27<>`]+')


def frontend_kind(before, live):
    if before.rstrip() == live.rstrip():
        return 'EXACT'
    if URL.sub(b'<URL>', before.rstrip()) == URL.sub(b'<URL>', live.rstrip()):
        return 'URL_ONLY'
    return 'CODE_DIFFERS'


def main():
    if not STAGER.is_file() or STAGER.resolve() != STAGER or sha(STAGER.read_bytes()) != STAGER_SHA:
        print('DIFF_STOPPED=STAGING_HELPER_CHANGED')
        return 1
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location('bos_report_stage', STAGER)
    s = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(s)
    stages = [p for p in s.PARENT.glob('report-acceptance-stage-*') if p.resolve() == p
              and (p / 'inventory.json').is_file() and (p / 'output/order-lifecycle-api.eszip').is_file()]
    s.require(bool(stages), 'NO_SAVED_BASELINE_BUILD')
    stage = max(stages, key=lambda p: (p / 'inventory.json').stat().st_mtime_ns)
    rec = json.loads(s.read(stage / 'inventory.json'))
    live = Path(rec['live'])
    s.require(live.parent == s.PARENT and live.resolve() == live, 'UNKNOWN_RELEASE_ROOT')
    s.emit('STAGE', str(stage))
    unchanged = all(s.tree(live / folder) == rec['before'][folder] for folder in ('edge', 'web'))
    s.emit('LIVE_UNCHANGED', unchanged)
    old = s.read(stage / 'before/edge/bundles/order-lifecycle-api.eszip')
    new = s.read(stage / 'output/order-lifecycle-api.eszip')
    s.emit('BUNDLE_BYTES', [len(old), len(new)])
    try:
        report = comparison(parse(old), parse(new))
        for key in ('format', 'module_counts', 'specifier_sets_equal', 'all_module_content_equal',
                    'entrypoint_found', 'entrypoint_path_equal', 'entrypoint_code_equal',
                    'changed_modules', 'different_specifier_counts', 'npm_graph_equal',
                    'packages_removed', 'packages_added', 'redirects_equal', 'source_maps_equal',
                    'checksums_verified', 'checksum_kind', 'trailer_equal', 'trailer_sizes'):
            s.emit(key.upper(), report[key])
    except (InvalidBundle, UnicodeError, ValueError):
        report = {'parse': 'UNSUPPORTED_OR_INVALID_ESZIP'}
        s.emit('BUNDLE_PARSE', report['parse'])
    web = stage / 'before/web'
    front = {}
    for name in ('order-lifecycle-v106.js', 'master-report-patch.js', 'report-review-patch.js'):
        baseline = s.read(stage / 'payload/before' / name)
        matches = [(p.name, s.bundle_module(s.read(p), name)) for p in web.glob('*.bundle.js')]
        matches = [(n, data) for n, data in matches if data is not None]
        front[name] = frontend_kind(baseline, matches[0][1]) if len(matches) == 1 else 'MODULE_NOT_UNIQUE'
    s.emit('FRONTEND_DIFF', front)
    gateway = s.read(stage / 'before/edge/main/index.ts')
    names = sorted(set(re.findall(rb'Deno\.env\.get\(\s*[\x27\x22]([A-Z][A-Z0-9_]{0,79})[\x27\x22]\s*\)', gateway)))
    gateway_info = {'env_names': [n.decode() for n in names],
                    'env_to_object': b'Deno.env.toObject' in gateway,
                    'envVars': b'envVars' in gateway,
                    'internal_loopback_literal': b'http://127.0.0.1:9000' in gateway}
    s.emit('GATEWAY', gateway_info)
    report.update({'stage': str(stage), 'live_unchanged': unchanged, 'frontend': front, 'gateway': gateway_info})
    # Persist only diagnostic metadata, with restrictive permissions.
    target = stage / ('comparison-' + sha(json.dumps(report, sort_keys=True).encode())[:16] + '.json')
    if not target.exists():
        s.write(target, json.dumps(report, indent=2).encode())
    s.emit('DIFF_COMPLETE', True)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print('DIFF_STOPPED=COMMAND_OR_LAYOUT_UNAVAILABLE', flush=True)
        raise SystemExit(1)
