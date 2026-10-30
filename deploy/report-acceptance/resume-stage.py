#!/usr/bin/env python3
"""Resume preparation with dependency versions taken from live eszip snapshots.

No production writes, DB access, application requests, or production restarts.
The original stage and comparison helpers must still be in /tmp.
"""
import concurrent.futures
import copy
import importlib.util
import json
import os
from pathlib import Path
import posixpath
import re
import shutil
import sys
import tempfile
import urllib.parse
import urllib.request
import uuid

HELPERS = {
    'stage': ('/tmp/bos-stage.py', '7e41a15b6f5209b17e3df0c73846585bf45fd4c4e69fd05ff7f8f440a3e06425'),
    'diff': ('/tmp/bos-diff.py', '33eadb84a7e95769a677667b2834214972ebdb9b70f9b628e26adb33148b6771'),
}
s = d = None


def load_helper(name):
    import hashlib
    location, digest = HELPERS[name]
    path = Path(location)
    if not path.is_file() or path.resolve() != path or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise RuntimeError('HELPER_CHANGED')
    spec = importlib.util.spec_from_file_location('bos_report_' + name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def split_package(identifier):
    match = re.fullmatch(r'((?:@[a-z0-9._-]+/)?[a-z0-9._-]+)@([0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9._-]+)?)', identifier)
    s.require(match is not None, 'UNSUPPORTED_NPM_PACKAGE_ID')
    return match.group(1), match.group(2)


def integrity(identifier):
    name, version = split_package(identifier)
    url = 'https://registry.npmjs.org/' + urllib.parse.quote(name, safe='@') + '/' + version
    try:
        with urllib.request.urlopen(url, timeout=40) as response:
            s.require(response.status == 200, 'NPM_METADATA_HTTP')
            data = response.read(2_000_001)
        s.require(len(data) <= 2_000_000, 'NPM_METADATA_SIZE')
        info = json.loads(data)
        s.require(info.get('name') == name and info.get('version') == version, 'NPM_METADATA_IDENTITY')
        value = info.get('dist', {}).get('integrity', '')
        s.require(re.fullmatch(r'sha(?:256|384|512)-[A-Za-z0-9+/]{40,172}={0,2}', value) is not None, 'NPM_INTEGRITY_MISSING')
        return identifier, value
    except s.Stop:
        raise
    except Exception:
        raise s.Stop('NPM_METADATA_DOWNLOAD_FAILED') from None


def lockfile(bundle, integrities):
    counts = {}
    for identifier in bundle['npm']:
        name, _ = split_package(identifier)
        counts[name] = counts.get(name, 0) + 1
    lock = {'version': '4', 'specifiers': {}, 'npm': {}}
    for request, identifier in sorted(bundle['npm_roots'].items()):
        name, version = split_package(identifier)
        s.require(request.startswith(name + '@'), 'NPM_ROOT_ALIAS_UNSUPPORTED')
        lock['specifiers']['npm:' + request] = version
    for identifier, dependencies in sorted(bundle['npm'].items()):
        value = {'integrity': integrities[identifier]}
        resolved = []
        for alias, target in sorted(dependencies.items()):
            name, _ = split_package(target)
            s.require(alias == name and target in bundle['npm'], 'NPM_ALIAS_UNSUPPORTED')
            resolved.append(name if counts[name] == 1 else target)
        if resolved:
            value['dependencies'] = resolved
        lock['npm'][identifier] = value
    return lock


def options(data):
    reader = d.Reader(data)
    magic = reader.take(8)
    return reader.take(reader.uint()) if magic in d.MAGICS[2:] else b''


def equal_baseline(before_data, after_data):
    # Compare every parsed module, including opaque data and source maps, by its
    # exact specifier. Only serialization order/offsets are immaterial.
    before, after = d.parse(before_data), d.parse(after_data)
    fields = ('magic', 'modules', 'maps', 'redirects', 'npm', 'npm_roots', 'checksum_kind', 'trailer')
    return (options(before_data) == options(after_data) and
            before['checksum_kind'] in (0, 1) and
            all(before[field] == after[field] for field in fields))


def install_locks(work, entries, bundles):
    all_ids = sorted({identifier for b in bundles.values() for identifier in b['npm']})
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        integrities = dict(pool.map(integrity, all_ids))
    for slug, relative in entries.items():
        bundle = bundles[slug]
        if not bundle['npm']:
            continue
        root = (work / 'candidate/edge/sources' / relative).parent
        s.require(not (root / 'deno.jsonc').exists(), 'JSONC_BUILD_CONFIG_REQUIRES_REVIEW')
        config_path = root / 'deno.json'
        config = json.loads(s.read(config_path)) if config_path.exists() else {'workspace': []}
        s.require(isinstance(config, dict), 'INVALID_BUILD_CONFIG')
        config['lock'] = {'path': './bos-report.lock', 'frozen': True}
        config_path.write_text(json.dumps(config, indent=2) + '\n')
        s.write(root / 'bos-report.lock', (json.dumps(lockfile(bundle, integrities), indent=2) + '\n').encode())
        s.emit('PINNED_' + slug, sorted(bundle['npm_roots'].values()))


def exact_or_urls(before, current, after):
    before, current = before.rstrip(), current.rstrip()
    if before == current:
        return after.rstrip()
    s.require(d.frontend_kind(before, current) == 'URL_ONLY', 'FRONTEND_SOURCE_CONFLICT')
    old_urls, new_urls = d.URL.findall(before), d.URL.findall(current)
    s.require(len(old_urls) == len(new_urls), 'FRONTEND_URL_COUNT')
    replacements = {}
    for old, new in zip(old_urls, new_urls):
        s.require(old not in replacements or replacements[old] == new, 'FRONTEND_URL_AMBIGUOUS')
        replacements[old] = new
    def apply(data):
        return d.URL.sub(lambda m: replacements.get(m.group(), m.group()), data)
    s.require(apply(before) == current, 'FRONTEND_URL_TRANSFORM')
    return apply(after.rstrip())


def once(data, old, new, label):
    s.require(data.count(old) == 1, 'FRONTEND_PATCH_CONFLICT_' + label)
    return data.replace(old, new, 1)


def function_line(source, prefix):
    lines = [line for line in source.splitlines() if line.strip().startswith(prefix)]
    s.require(len(lines) == 1, 'FRONTEND_FUNCTION_NOT_UNIQUE')
    return lines[0]


def unique_splice(before, current, after):
    prefix = 0
    while prefix < min(len(before), len(after)) and before[prefix] == after[prefix]:
        prefix += 1
    suffix = 0
    while suffix < min(len(before), len(after)) - prefix and before[-1 - suffix] == after[-1 - suffix]:
        suffix += 1
    old_end = len(before) - suffix
    new_end = len(after) - suffix
    left = before[max(0, prefix - 96):prefix]
    right = before[old_end:old_end + 96]
    old = left + before[prefix:old_end] + right
    new = left + after[prefix:new_end] + right
    s.require(len(left) + len(right) >= 64, 'FRONTEND_SPLICE_CONTEXT')
    return once(current, old, new, 'report-open-tail')


def merge_frontend(name, before, current, after):
    # Use complete matching modules when possible. Two production URL helpers
    # have private migration edits; the guarded prefixes preserve their bodies.
    if d.frontend_kind(before, current) in ('EXACT', 'URL_ONLY'):
        return exact_or_urls(before, current, after)
    if name == 'master-report-patch.js':
        prefix = b'function safeReportHref(value){'
        extra = b'if(window.BOS_REPORT_URL)return window.BOS_REPORT_URL(value);'
        s.require(after == before.replace(prefix, prefix + extra, 1), 'UNKNOWN_MASTER_REPORT_DELTA')
        return once(current, prefix, prefix + extra, 'master-report-helper').rstrip()
    s.require(name == 'report-review-patch.js', 'FRONTEND_CUSTOM_MODULE_' + name)
    prefix = b'function safeHref(value){'
    extra = b'if(window.BOS_REPORT_URL)return window.BOS_REPORT_URL(value);'
    result = once(current, prefix, prefix + extra, 'report-url-helper')
    modeled = once(before, prefix, prefix + extra, 'model-report-url-helper')
    for label in (b'function archiveStatus(o){', b'window.retryDriveArchive=async function(id){'):
        old_line = function_line(before, label)
        new_line = function_line(after, label)
        live_line = function_line(result, label)
        merged = exact_or_urls(old_line, live_line, new_line)
        if label.startswith(b'window.retry'):
            indent = live_line[:len(live_line) - len(live_line.lstrip())]
            merged = indent + b'const archiveBusy=new Set();\n' + merged
            new_line = b'  const archiveBusy=new Set();\n' + new_line
        result = once(result, live_line, merged, label.decode().split('(')[0])
        modeled = once(modeled, old_line, new_line, 'model-function')
    label = b'window.openReportReview=function(id){'
    old_line, new_line = function_line(before, label), function_line(after, label)
    current_line = function_line(result, label)
    result = once(result, current_line, unique_splice(old_line, current_line, new_line), 'report-open')
    modeled = once(modeled, old_line, new_line, 'model-open')
    s.require(modeled.rstrip() == after.rstrip(), 'UNMODELED_REPORT_REVIEW_DELTA')
    return result.rstrip()


def module_bounds(bundle, name):
    marker = b'// Source: ' + name.encode() + b'\n'
    s.require(bundle.count(marker) == 1, 'FRONTEND_MODULE_NOT_UNIQUE_' + name)
    start = bundle.index(marker) + len(marker)
    end = bundle.find(b'\n;\n// Source:', start)
    s.require(end >= start, 'FRONTEND_MODULE_BOUNDARY_' + name)
    return start, end


def prepare_frontend(parent, work):
    source, target = parent / 'before/web', work / 'candidate/web'
    shutil.copytree(source, target)
    before_meta = s.read(source / 'build-version.js')
    match = re.fullmatch(rb'// Generated by npm run build\. Do not edit\.\nself\.BOS_BUILD=(\{.*\});\n', before_meta, re.S)
    s.require(match is not None, 'FRONTEND_MANIFEST')
    meta = json.loads(match.group(1))
    names = ('order-lifecycle-v106.js', 'master-report-patch.js', 'report-review-patch.js',
             'master-order-hands-layout-v72.js', 'approved-master-ui.css')
    changed = {}
    for name in names:
        before = s.read(parent / 'payload/before' / name)
        after = s.read(parent / 'payload/after' / name)
        bundle_name = meta.get('assetBundles', {}).get(name)
        if bundle_name:
            s.require(re.fullmatch(r'[A-Za-z0-9_.-]+\.js', bundle_name) is not None, 'FRONTEND_BUNDLE_PATH')
            bundle = changed.get(bundle_name, s.read(target / bundle_name))
            start, end = module_bounds(bundle, name)
            current = bundle[start:end]
            merged = merge_frontend(name, before, current, after)
            changed[bundle_name] = bundle[:start] + merged.rstrip() + current[len(current.rstrip()):] + bundle[end:]
        if (target / name).exists():
            changed[name] = merge_frontend(name, before, s.read(target / name), after)
    shell = changed.get('startup-shell.bundle.js', s.read(target / 'startup-shell.bundle.js'))
    helper = s.read(parent / 'payload/after/report-origin.js')
    marker = b'\n;\n// Source: master-report-patch.js\n'
    s.require(b'// Source: report-origin.js\n' not in shell and shell.count(marker) == 1, 'REPORT_ORIGIN_MODULE_POSITION')
    # Existing RU routing/config executes first. The helper then installs URL
    # normalization without replacing an already active BOS_RU_NETWORK router.
    network_marker = b'// Source: network-direct-v86.js\n'
    s.require(network_marker in shell and shell.index(network_marker) < shell.index(marker), 'RU_ROUTER_ORDER')
    shell = shell.replace(marker, b'\n;\n// Source: report-origin.js\n' + helper + marker, 1)
    changed['startup-shell.bundle.js'], changed['report-origin.js'] = shell, helper
    build = s.sha((meta['id'] + ''.join(n + s.sha(v) for n, v in sorted(changed.items()))).encode())[:20]
    old_id, new_id = meta['id'].encode(), build.encode()
    html = s.read(target / 'index.html')
    s.require(old_id in html and s.sha(html) == meta['shell'], 'FRONTEND_SHELL_BASELINE')
    changed['index.html'] = html.replace(old_id, new_id)
    token = b"const BUILD_ID='" + old_id + b"';"
    changed['sw.js'] = once(s.read(target / 'sw.js'), token, b"const BUILD_ID='" + new_id + b"';", 'worker-build')
    updated = copy.deepcopy(meta)
    updated['id'], updated['shell'] = build, s.sha(changed['index.html'])
    updated.setdefault('assetBundles', {})['report-origin.js'] = 'startup-shell.bundle.js'
    for name, data in changed.items():
        if name in updated['assets']:
            updated['assets'][name] = s.sha(data)
    changed['build-version.js'] = b'// Generated by npm run build. Do not edit.\nself.BOS_BUILD=' + json.dumps(updated, ensure_ascii=False, separators=(',', ':')).encode() + b';\n'
    for name, data in changed.items():
        (target / name).write_bytes(data)
    for name, digest in updated['assets'].items():
        s.require(s.sha(s.read(target / name)) == digest, 'FRONTEND_CANDIDATE_ASSET_' + name)
    s.emit('FRONTEND_CANDIDATE', build)
    return {'build': build, 'changed_files': {n: s.sha(v) for n, v in changed.items()}}


def executable_modules(bundle, relative):
    """Resolve eszip-relative paths against the known mounted entrypoint.

    Adding ../_shared can move the common archive root up one directory.
    The source file is still the same /bos-src/<relative>/index.ts.
    """
    entries = [name for name, (kind, _) in bundle['modules'].items()
               if kind == 0 and (name == 'index.ts' or name.endswith('/index.ts'))]
    s.require(len(entries) == 1, 'PATCHED_ENTRYPOINT_NOT_UNIQUE')
    s.require(not relative.startswith('/') and all(p not in ('', '.', '..') for p in relative.split('/')), 'UNSAFE_SOURCE_ENTRYPOINT')
    logical_entry = '/bos-src/' + relative
    entry_name = entries[0]
    entry_url = urllib.parse.urlsplit(entry_name)
    if entry_url.scheme:
        s.require(entry_url.scheme == 'file' and not entry_url.netloc and not entry_url.query and not entry_url.fragment,
                  'UNSUPPORTED_ENTRYPOINT_URL')
        s.require(urllib.parse.unquote(entry_url.path) == logical_entry, 'ABSOLUTE_ENTRYPOINT_CHANGED')
        root = '/bos-src'
    else:
        s.require(not entry_name.startswith('/') and all(p not in ('', '.', '..') for p in entry_name.split('/')),
                  'UNSAFE_ARCHIVE_ENTRYPOINT')
        s.require(logical_entry.endswith('/' + entry_name), 'ARCHIVE_ENTRYPOINT_SUFFIX_CHANGED')
        # The bundler can choose the filesystem root as the archive root.
        # For bos-src/<relative>, stripping the separator must preserve '/':
        # an empty string would turn every subsequent join into a relative path.
        root = logical_entry[:-len(entry_name)].rstrip('/') or '/'

    def canonical(name):
        url = urllib.parse.urlsplit(name)
        if url.scheme and url.scheme != 'file':
            return name
        if url.scheme == 'file':
            s.require(not url.netloc and not url.query and not url.fragment, 'UNSAFE_FILE_SPECIFIER')
            path = urllib.parse.unquote(url.path)
        else:
            s.require(not name.startswith('/') and not url.query and not url.fragment, 'UNSAFE_RELATIVE_SPECIFIER')
            path = posixpath.join(root, urllib.parse.unquote(name))
        normalized = posixpath.normpath(path)
        s.require(normalized.startswith('/bos-src/'), 'MODULE_OUTSIDE_STAGED_SOURCE')
        return normalized

    modules = {}
    for name, value in bundle['modules'].items():
        if value[0] == 3:
            continue
        key = canonical(name)
        s.require(key not in modules, 'DUPLICATE_CANONICAL_MODULE')
        modules[key] = value
    redirects = {}
    for name, target in bundle['redirects'].items():
        key = canonical(name)
        s.require(key not in redirects, 'DUPLICATE_CANONICAL_REDIRECT')
        redirects[key] = canonical(target)
    s.require(logical_entry in modules, 'LOGICAL_ENTRYPOINT_MISSING')
    return modules, redirects, logical_entry


def validate_patched(original, compiled, relative):
    s.require(compiled['npm'] == original['npm'] and compiled['npm_roots'] == original['npm_roots'], 'PATCHED_NPM_DRIFT')
    old_modules, old_redirects, entry = executable_modules(original, relative)
    new_modules, new_redirects, new_entry = executable_modules(compiled, relative)
    s.require(new_entry == entry, 'PATCHED_ENTRYPOINT_CHANGED')
    helper = posixpath.normpath(posixpath.join(posixpath.dirname(entry), '../_shared/report-storage.ts'))
    s.require(not (set(old_modules) - set(new_modules)) and
              (set(new_modules) - set(old_modules)) <= {helper}, 'PATCHED_MODULE_SET')
    for name, value in old_modules.items():
        if name != entry:
            s.require(new_modules[name] == value, 'PATCHED_DEPENDENCY_DRIFT')
    s.require(old_redirects == new_redirects, 'PATCHED_REDIRECT_DRIFT')


def build(parent, work, rec, bundles):
    builder = 'bos301-locked-' + uuid.uuid4().hex
    output = work / 'output'
    output.mkdir(mode=0o700)
    entries = rec['entrypoints']
    args = ['docker', 'run', '-d', '--pull=never', '--network=bridge', '--name', builder,
            '--label', 'bos.report-locked-stage=' + builder, '--memory=512m', '--memory-swap=512m',
            '--cpus=1', '--pids-limit=256', '--user=0:0', '--entrypoint=/bin/sh',
            '--mount', 'type=bind,src=' + str(work / 'candidate/edge/sources') + ',dst=/bos-src,readonly',
            '--mount', 'type=bind,src=' + str(output) + ',dst=/bos-output', rec['image'],
            '-c', 'while :; do sleep 1; done']
    created = False
    try:
        s.command(args, work, 'builder-start')
        created = True
        for slug, relative in entries.items():
            s.emit('BUILD_LOCKED_BASELINE', slug)
            command = ['docker', 'exec', builder, 'edge-runtime', 'bundle', '--entrypoint', '/bos-src/' + relative,
                       '--output', '/bos-output/' + slug + '.eszip', '--quiet', '--timeout', '90']
            s.command(command, work, 'baseline-' + slug, 120)
            built = s.read(output / (slug + '.eszip'))
            original = s.read(parent / 'before/edge/bundles' / (slug + '.eszip'))
            if not equal_baseline(original, built):
                comparison = d.comparison(d.parse(original), d.parse(built))
                s.emit('LOCKED_BASELINE_DIFF', {'function': slug, **comparison})
                raise s.Stop('LOCKED_BASELINE_DIFFERS_' + slug)
        s.command(['docker', 'network', 'disconnect', 'bridge', builder], work, 'builder-offline')
        info = s.inspect(builder)
        s.require(not info['NetworkSettings']['Networks'], 'BUILDER_HAS_NETWORK')
        interfaces = s.command(['nsenter', '-t', str(info['State']['Pid']), '-n', sys.executable, '-c',
                                'import socket,json;print(json.dumps([n for _,n in socket.if_nameindex()]))'], work, 'builder-interfaces')
        s.require(json.loads(interfaces) == ['lo'], 'BUILDER_NOT_ISOLATED')
        s.patch_sources(work, entries)
        for slug, relative in entries.items():
            s.emit('BUILD_PATCHED_OFFLINE', slug)
            (output / (slug + '.eszip')).unlink()
            s.command(['docker', 'exec', builder, 'edge-runtime', 'bundle', '--entrypoint', '/bos-src/' + relative,
                       '--output', '/bos-output/' + slug + '.eszip', '--quiet', '--timeout', '90'], work, 'patched-' + slug, 120)
            compiled = d.parse(s.read(output / (slug + '.eszip')))
            original = bundles[slug]
            # Executable modules must remain identical outside this function
            # and its helper. The compiler may update its opaque VFS metadata.
            # Package bytes were checked in the baseline and its dependency
            # cache is reused with the network physically disconnected.
            try:
                validate_patched(original, compiled, relative)
            except s.Stop as error:
                # Report only known source basenames, never arbitrary URLs.
                s.emit('MODULE_PATH_DIAGNOSTIC', {'function': slug,
                    'before': [d.module_label(n) for n, v in original['modules'].items() if v[0] != 3],
                    'after': [d.module_label(n) for n, v in compiled['modules'].items() if v[0] != 3]})
                raise s.Stop(str(error) + '_' + slug) from None
            shutil.copyfile(output / (slug + '.eszip'), work / 'candidate/edge/bundles' / (slug + '.eszip'))
    finally:
        if created:
            s.command(['docker', 'rm', '-f', builder], work, 'builder-remove')


def main():
    global s, d
    import fcntl
    os.umask(0o077)
    sys.dont_write_bytecode = True
    s, d = load_helper('stage'), load_helper('diff')
    s.require(os.geteuid() == 0, 'ROOT_REQUIRED')
    with (s.PARENT / '.report-acceptance-stage.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        parents = [p for p in s.PARENT.glob('report-acceptance-stage-*') if p.resolve() == p
                   and (p / 'inventory.json').is_file() and (p / 'payload/after/report-origin.js').is_file()]
        s.require(bool(parents), 'SAVED_STAGE_MISSING')
        parent = max(parents, key=lambda p: (p / 'inventory.json').stat().st_mtime_ns)
        rec = json.loads(s.read(parent / 'inventory.json'))
        live = Path(rec['live'])
        s.require(live.resolve() == live and live.parent == s.PARENT and rec['app_revision'] == s.APP, 'STAGE_IDENTITY')
        s.require(re.fullmatch('sha256:[0-9a-f]{64}', rec['image']) is not None, 'IMAGE_NOT_PINNED')
        s.require(s.inspect(rec['edge_id'])['Image'] == rec['image'], 'EDGE_IMAGE_CHANGED')
        for folder in ('edge', 'web'):
            s.require(s.tree(live / folder) == rec['before'][folder] == s.tree(parent / 'before' / folder), 'LIVE_OR_BACKUP_CHANGED')
        for name, versions in s.ASSETS.items():
            s.require(s.sha(s.read(parent / 'payload/after' / name)) == versions['after'], 'PAYLOAD_CHANGED')
        for name in s.FRONTEND:
            s.require(s.sha(s.read(parent / 'payload/before' / name)) == s.ASSETS[name]['before'], 'BASE_PAYLOAD_CHANGED')
        entries = s.source_inventory(parent / 'before/edge/sources')
        s.require(entries == rec['entrypoints'], 'ENTRYPOINTS_CHANGED')
        work = Path(tempfile.mkdtemp(prefix='locked-', dir=parent))
        s.emit('PREPARE_DIR', str(work))
        shutil.copytree(parent / 'before/edge', work / 'candidate/edge')
        shutil.copytree(parent / 'payload', work / 'payload')
        # Frontend merge failure is reported but does not prevent independent
        # backend preparation; publication always requires both to be ready.
        try:
            front = prepare_frontend(parent, work)
        except s.Stop as error:
            front = {'status': str(error)}
            s.emit('FRONTEND_REQUIRES_REVIEW', str(error))
        bundles = {slug: d.parse(s.read(parent / 'before/edge/bundles' / (slug + '.eszip'))) for slug in entries}
        install_locks(work, entries, bundles)
        build(parent, work, rec, bundles)
        for folder in ('edge', 'web'):
            s.require(s.tree(live / folder) == rec['before'][folder], 'CONCURRENT_LIVE_CHANGE')
        journal = {**rec, 'parent_stage': str(parent), 'status': 'compiled_not_activated',
                   'frontend': front, 'candidate_edge': s.tree(work / 'candidate/edge')}
        if 'build' in front:
            journal['candidate_web'] = s.tree(work / 'candidate/web')
        s.write(work / 'journal.json', json.dumps(journal, indent=2).encode())
        s.emit('BACKEND_READY', True)
        s.emit('FRONTEND_READY', 'build' in front)
        s.emit('PREPARE_DIR', str(work))
        s.emit('PRODUCTION_UPDATED', False)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('PREPARE_STOPPED=INTERRUPTED', flush=True)
        raise SystemExit(130)
    except Exception as error:
        # Fixed internal failure labels only; no arbitrary exception messages.
        label = str(error) if s is not None and isinstance(error, s.Stop) else 'COMMAND_OR_LAYOUT_UNAVAILABLE'
        print('PREPARE_STOPPED=' + label, flush=True)
        raise SystemExit(1)
