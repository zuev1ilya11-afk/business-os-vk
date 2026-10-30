#!/usr/bin/env python3
"""Stage the reviewed report fix on the existing RU Docker host.

Copies and builds only. Never writes to the live release, connects to the DB,
starts application workers, restarts production, or enables a timer.
Run as root: python3 stage.py --backup "$BOS_BAK"
"""
import argparse
import concurrent.futures
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import uuid

APP = '8f1bb32b624c92d07a86dafe2c3196eb29da9903'
BASE = '80a97b374357706a5e1a1ca4f16d9bfdaaf773aa'
RAW = 'https://raw.githubusercontent.com/zuev1ilya11-afk/business-os-vk/'
PARENT = Path('/opt/business-os/deploy')
SLUGS = ('order-lifecycle-api', 'drive-archive-api', 'report-api',
         'report-file-upload', 'hands-report-api', 'push-api', 'gas-bridge-health')
FRONTEND = ('order-lifecycle-v106.js', 'master-report-patch.js',
            'report-review-patch.js', 'master-order-hands-layout-v72.js',
            'approved-master-ui.css', 'config.js', 'network-direct-v86.js')
ASSETS = {
  "supabase/functions/order-lifecycle-api/index.ts": {
    "before": "2b8f5dd41d2419512c76ad225d38f570d9c95dca8158b5c9e1acff71470a0520",
    "after": "7c679156ba09fa1c99d44eaa9f45adaa08724ec5b6220f20957fc3bea19943dc"
  },
  "supabase/functions/drive-archive-api/index.ts": {
    "before": "ad1b3eed4c1dd4b982ebfb2eb905fd9051b2c7bb71e86e43518461374c171a6e",
    "after": "863d4ccb7a4f1d5698ba18ad2857f53669d03bdb4e8dcdeb617ddcea01092582"
  },
  "supabase/functions/report-api/index.ts": {
    "before": "a41a571c246b72c5210e39832f4473d8dcb8babc1e5e8b0b6e857b73ffd61ad1",
    "after": "5624a7d9b7b11b882c63b1d1b22eaf3d1afa8a4ecbb3954481d1cb8b58e3c7a3"
  },
  "supabase/functions/report-file-upload/index.ts": {
    "before": "78c823d62f7b3a2b1b9eb7d11582c24948bf8c9c77605712e04ebe0e1791fafe",
    "after": "7307c360cb1f6c0835d6d27154845fc429bdfbb22c08c44fd4efa6a5341e60c7"
  },
  "supabase/functions/hands-report-api/index.ts": {
    "before": "a42138784c685b62e7429f8ba746e51c9879e67d31dbd483c5d4638110e34a41",
    "after": "9f4954e7217190505f288d9a3dc303b7423dd3d49673dd7e52fb4e9fe4e7c9dc"
  },
  "supabase/functions/push-api/index.ts": {
    "before": "974b7078e0448ed830ec28f82392ef4f3304687e631112983fd6bd400c076869",
    "after": "d5fbc7dc947d8254e066ab8388124789ab49161c4c61654c867979d919b6bf8d"
  },
  "supabase/functions/gas-bridge-health/index.ts": {
    "before": "9202b7321f816f428821ba532bb9865653bc9388b0835cb34b2ebb50ebaf229c",
    "after": "d96a8e8d5197bfb78c5e2de5a404695d8990b79814f5f59714dc092ea089df26"
  },
  "supabase/functions/_shared/report-storage.ts": {
    "before": None,
    "after": "78a7bb9618e18b9f950bba8543353340642b3464a038daa1cabcfa6af5b3d768"
  },
  "order-lifecycle-v106.js": {
    "before": "b9961c4bd3d109e9563af50954b3a5f0d7a51b34b01aad841eae3a0be2db89ae",
    "after": "e6aae7ae14717928841759c1d81ace8ac6c545eb7b1618c95eaf9f534141a4a8"
  },
  "master-report-patch.js": {
    "before": "9f0fc4beede4350ca80ea6ba6d7c93602f8a9439b5b6c8f12b3c9db5c37ae318",
    "after": "709607a09fe27ed19a886ff08ce27a80168d754dae1deb4ed585221752ac010c"
  },
  "report-review-patch.js": {
    "before": "3022a250a30e0940012e8b6b8106259cfad49e6a39cce2c0219f2f1cc7ba1bf5",
    "after": "d6c98a355e714e5b9cb9793c37c7ecce14ad16527dc315bf26417e05784cf0ae"
  },
  "master-order-hands-layout-v72.js": {
    "before": "688d4d30fb8061e89db902592489c956c6028091e43214519c324a81b1e05289",
    "after": "d531d743cf0b53316c7d2eb106e3d334ebfebec7766beedadf5ee1ea997c3fe7"
  },
  "approved-master-ui.css": {
    "before": "9bade3e05354ddc45879fe71c55ddd77d67b73b29a4e144a5a4120871e6a0b5e",
    "after": "ac5c6215a364047305c16b09eec7a8a0de5860c3cd51c1f98b8136bdf09d7e8a"
  },
  "config.js": {
    "before": "a054dff4a63ba32e214644ddb07afb5df2e54eb5790281c962407aecb45458f7",
    "after": "f148b6e916355bf7740a4b1768c4325734a9cadc58fd2b1661821dc32ba0ef4b"
  },
  "network-direct-v86.js": {
    "before": "2c81572d88b12307661de2157536012bec07ee7230d13083a07f42a8fa474cd8",
    "after": "65c13afd17ff9b476b1e8195cc0082f0f4be911e513172034f5602d7669bfae4"
  },
  "report-origin.js": {
    "before": None,
    "after": "3b12858542bfe94b9d0ecda48c10927b785ef40a7bae919d389b8d8b9c4ea6f9"
  },
  "supabase/migrations/20261030090000_report_archive_queue.sql": {
    "before": None,
    "after": "a46d26840458d64e68564175f6260e8a531e6ff80c6b11858f0a532cb085daf1"
  },
  "google-apps-script/ReportUpload.gs": {
    "before": "23ee0600b80c2914584de69f01d44bc83b426dd2a6a058c21bff92ba8047e33e",
    "after": "c379f1822d0afeb7c86f11e265c51a4d7ac73d821d33223692d741e990b243e3"
  },
  "deploy/report-acceptance/archive-worker.py": {
    "before": None,
    "after": "3c2ba33fef204c90795f3de99062b1601b59dffe71a85a70fabf9ba67ec754d2"
  },
  "deploy/report-acceptance/bos-drive-archive.service": {
    "before": None,
    "after": "7e6c572053626f06bdf8fb541bd2d3a66886fbca12339f017f7ce4f633770152"
  },
  "deploy/report-acceptance/bos-drive-archive.timer": {
    "before": None,
    "after": "339fad420e644e866bdad1054fca651044b7b7cc4336ad3ae31ae1d95bf0bf7c"
  },
  "deploy/report-acceptance/checks.sql": {
    "before": None,
    "after": "3c11e5af61f7cb8c19cfa4afbcd80cfd757c8404ab5383eaccace194523738ad"
  }
}


class Stop(Exception):
    pass


def require(condition, label):
    if not condition:
        raise Stop(label)


def emit(label, value):
    print(label + '=' + json.dumps(value, separators=(',', ':')), flush=True)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path, maximum=16_000_000):
    require(path.is_file() and path.resolve() == path, 'UNSAFE_OR_MISSING_FILE')
    require(path.stat().st_size <= maximum, 'FILE_TOO_LARGE')
    return path.read_bytes()


def write(path, data):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(path.parent.resolve() == path.parent and not path.exists(), 'STAGE_FILE_EXISTS')
    with path.open('xb') as out:
        os.fchmod(out.fileno(), 0o600)
        out.write(data)


def command(args, stage=None, label='command', timeout=60):
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        raise Stop(label + '_UNAVAILABLE') from None
    if stage is not None:
        # Command output can contain credentials or package URLs. It stays private.
        log = stage / 'logs' / (label + '.log')
        write(log, result.stdout + b'\n' + result.stderr)
    require(result.returncode == 0, label + '_FAILED')
    return result.stdout


def inspect(container):
    return json.loads(command(['docker', 'inspect', container]))[0]


def mount(container, destination):
    entries = [m for m in container['Mounts'] if m['Destination'] == destination
               and m['Type'] == 'bind']
    require(len(entries) == 1, 'MOUNT_NOT_UNIQUE')
    root = Path(entries[0]['Source'])
    require(root.is_dir() and root.resolve() == root, 'UNSAFE_MOUNT')
    require(not any(m['Destination'].startswith(destination + '/')
                    for m in container['Mounts']), 'NESTED_MOUNT')
    return root


def tree(root):
    result = {}
    total = 0
    require(root.is_dir() and root.resolve() == root, 'UNSAFE_TREE_ROOT')
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink() and (path.is_file() or path.is_dir()), 'UNSAFE_TREE_ENTRY')
        if path.is_file():
            data = read(path)
            total += len(data)
            require(total < 512_000_000, 'TREE_TOO_LARGE')
            result[path.relative_to(root).as_posix()] = sha(data)
    return result


def entrypoint(sources, slug):
    # Both layouts are present on the production host. Do not flatten imports.
    paths = [sources / slug / 'index.ts',
             sources / slug / 'supabase/functions' / slug / 'index.ts']
    matches = [p for p in paths if p.exists()]
    require(len(matches) == 1, 'ENTRYPOINT_NOT_UNIQUE_' + slug)
    read(matches[0])
    return matches[0]


def source_inventory(sources):
    entries, differences = {}, []
    for slug in SLUGS:
        path = entrypoint(sources, slug)
        relative = path.relative_to(sources).as_posix()
        current = sha(read(path))
        expected = ASSETS['supabase/functions/' + slug + '/index.ts']['before']
        entries[slug] = relative
        if current != expected:
            differences.append({'function': slug, 'sha256': current})
    emit('ENTRYPOINTS', entries)
    if differences:
        emit('SOURCE_DIFFERENCES', differences)
        raise Stop('SOURCE_BASELINE_DIFFERS')
    return entries


def download(path, version):
    revision = APP if version == 'after' else BASE
    expected = ASSETS[path][version]
    require(expected is not None, 'PAYLOAD_NOT_IN_PINNED_TREE')
    request = urllib.request.Request(RAW + revision + '/' + path,
                                     headers={'Cache-Control': 'no-cache'})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            require(response.status == 200, 'PAYLOAD_HTTP_FAILED')
            data = response.read(4_000_001)
    except Stop:
        raise
    except Exception:
        raise Stop('PAYLOAD_DOWNLOAD_FAILED') from None
    require(len(data) <= 4_000_000 and sha(data) == expected, 'PAYLOAD_DIGEST_FAILED')
    return data


def get_payload(stage):
    jobs = [(path, 'after') for path in ASSETS]
    jobs += [(path, 'before') for path in FRONTEND]
    def fetch(job):
        path, version = job
        data = download(path, version)
        write(stage / 'payload' / version / path, data)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(fetch, jobs))
    emit('PAYLOAD_VERIFIED', APP)


def bundle_module(data, name):
    marker = b'// Source: ' + name.encode() + b'\n'
    if data.count(marker) != 1:
        return None
    start = data.index(marker) + len(marker)
    end = data.find(b'\n;\n// Source:', start)
    return data[start:end].rstrip() if end >= 0 else None


def frontend_inventory(web, stage):
    manifest_data = read(web / 'build-version.js')
    match = re.fullmatch(rb'// Generated by npm run build\. Do not edit\.\nself\.BOS_BUILD=(\{.*\});\n',
                         manifest_data, re.S)
    require(match is not None, 'WEB_MANIFEST_FORMAT')
    meta = json.loads(match.group(1))
    require(re.fullmatch('[0-9a-f]{20}', meta.get('id', '')) is not None, 'WEB_BUILD_INVALID')
    require(sha(read(web / 'index.html')) == meta['shell'], 'WEB_SHELL_CHANGED')
    for name, digest in meta['assets'].items():
        require(re.fullmatch(r'[A-Za-z0-9_.-]+', name) is not None and name not in ('.', '..'), 'WEB_ASSET_PATH')
        require(sha(read(web / name)) == digest, 'WEB_ASSET_CHANGED_' + name)
    bundles = {p.name: read(p) for p in web.glob('*.bundle.js')}
    state = {}
    for name in FRONTEND:
        source = read(web / name).rstrip() if (web / name).exists() else None
        modules = [(n, bundle_module(data, name)) for n, data in bundles.items()]
        modules = [(n, data) for n, data in modules if data is not None]
        values = ([('file', source)] if source is not None else []) + modules
        states = []
        for location, actual in values:
            known = 'custom'
            for version in ('before', 'after'):
                expected = read(stage / 'payload' / version / name).rstrip()
                alternatives = [expected]
                for origin in (b'https://139.100.237.167', b'https://136.234.17.113', b'https://homemaster.qd.je'):
                    alternatives.append(expected.replace(b'https://obsropbslfwtanyspjbi.supabase.co', origin))
                if actual in alternatives:
                    known = version
            states.append(location + ':' + known)
        state[name] = states or ['missing']
    emit('WEB_BUILD', meta['id'])
    emit('WEB_MODULES', state)
    return {'build': meta['id'], 'modules': state}


def backup_configuration(containers, live, stage):
    write(stage / 'private/containers.json', json.dumps(containers).encode())
    candidates = set()
    for c in containers:
        labels = c['Config'].get('Labels') or {}
        for value in labels.get('com.docker.compose.project.config_files', '').split(','):
            if value:
                candidates.add(Path(value))
        for m in c['Mounts']:
            p = Path(m['Source'])
            if m['Type'] == 'bind' and p.is_file():
                candidates.add(p)
    # Include release config/env files, excluding live data directories.
    for root in (live, live.parent.parent):
        candidates.update(p for p in root.iterdir() if p.is_file() and (
            p.name == 'Caddyfile' or p.name.startswith('.env') or
            p.name.endswith(('.yaml', '.yml', '.env'))))
    copied = []
    for path in sorted(candidates):
        if path.is_absolute() and path.is_file() and path.resolve() == path:
            write(stage / 'private/config' / path.relative_to('/'), read(path))
            copied.append(str(path))
    write(stage / 'private/config-files.json', json.dumps(copied).encode())
    emit('CONFIG_BACKUP_FILES', len(copied))


def patch_sources(stage, entries):
    for slug, relative in entries.items():
        path = stage / 'candidate/edge/sources' / relative
        path.write_bytes(read(stage / 'payload/after/supabase/functions' / slug / 'index.ts'))
        shared = path.parent.parent / '_shared/report-storage.ts'
        if b'../_shared/report-storage.ts' in path.read_bytes():
            require(shared.resolve().is_relative_to(stage / 'candidate/edge/sources'), 'SHARED_PATH_ESCAPE')
            data = read(stage / 'payload/after/supabase/functions/_shared/report-storage.ts')
            if shared.exists():
                require(read(shared) == data, 'EXISTING_REPORT_HELPER_DIFFERS')
            else:
                write(shared, data)


def compile_sources(stage, edge, entries):
    nonce = uuid.uuid4().hex
    builder = 'bos301-build-' + nonce
    output = stage / 'output'
    output.mkdir(mode=0o700)
    image = edge['Image']
    require(re.fullmatch('sha256:[0-9a-f]{64}', image) is not None, 'UNPINNED_RUNTIME_IMAGE')
    args = ['docker', 'run', '-d', '--pull=never', '--network=bridge',
            '--name', builder, '--label', 'bos.report-stage=' + nonce,
            '--memory=512m', '--memory-swap=512m', '--cpus=1', '--pids-limit=256',
            '--user=0:0', '--entrypoint=/bin/sh',
            '--mount', 'type=bind,src=' + str(stage / 'candidate/edge/sources') + ',dst=/bos-src,readonly',
            '--mount', 'type=bind,src=' + str(output) + ',dst=/bos-output', image,
            '-c', 'while :; do sleep 1; done']
    created = False
    try:
        command(args, stage, 'builder-start')
        created = True
        for slug, relative in entries.items():
            emit('BUILD_BASELINE', slug)
            command(['docker', 'exec', builder, 'edge-runtime', 'bundle',
                     '--entrypoint', '/bos-src/' + relative,
                     '--output', '/bos-output/' + slug + '.eszip', '--quiet', '--timeout', '90'],
                    stage, 'baseline-' + slug, 120)
            current = read(stage / 'before/edge/bundles' / (slug + '.eszip'))
            built = read(output / (slug + '.eszip'))
            require(sha(current) == sha(built), 'BUNDLE_BASELINE_DIFFERS_' + slug)
        # Reuse the exact resolved dependency cache. Patched builds stay offline.
        command(['docker', 'network', 'disconnect', 'bridge', builder], stage, 'builder-offline')
        info = inspect(builder)
        require(not info['NetworkSettings']['Networks'], 'BUILDER_NETWORK_STILL_ATTACHED')
        pid = info['State']['Pid']
        interfaces = command(['nsenter', '-t', str(pid), '-n', sys.executable, '-c',
                              'import socket,json;print(json.dumps([n for _,n in socket.if_nameindex()]))'],
                             stage, 'builder-interfaces')
        require(json.loads(interfaces) == ['lo'], 'BUILDER_NOT_ISOLATED')
        patch_sources(stage, entries)
        for slug, relative in entries.items():
            (output / (slug + '.eszip')).unlink()
            emit('BUILD_PATCHED', slug)
            command(['docker', 'exec', builder, 'edge-runtime', 'bundle',
                     '--entrypoint', '/bos-src/' + relative,
                     '--output', '/bos-output/' + slug + '.eszip', '--quiet', '--timeout', '90'],
                    stage, 'patched-' + slug, 120)
            require(len(read(output / (slug + '.eszip'))) > 64, 'EMPTY_BUNDLE_' + slug)
            shutil.copyfile(output / (slug + '.eszip'), stage / 'candidate/edge/bundles' / (slug + '.eszip'))
    finally:
        if created:
            command(['docker', 'rm', '-f', builder], stage, 'builder-remove')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', required=True)
    args = parser.parse_args()
    require(os.geteuid() == 0, 'ROOT_REQUIRED')
    os.umask(0o077)
    backup = Path(args.backup)
    require(backup.is_absolute() and backup.is_dir() and backup.resolve() == backup, 'BACKUP_PATH_REQUIRED')
    for name in ('db.dump', 'db-list.txt', 'app.tar.gz'):
        path = backup / name
        require(path.is_file() and path.resolve() == path and path.stat().st_size > 128, 'BACKUP_INCOMPLETE')
    with (backup / 'db.dump').open('rb') as dump:
        require(dump.read(5) == b'PGDMP', 'BACKUP_NOT_CUSTOM_PG_DUMP')
    require(PARENT.is_dir() and PARENT.resolve() == PARENT, 'RELEASE_PARENT_MISSING')
    with (PARENT / '.report-acceptance-stage.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        ids = command(['docker', 'ps', '-q']).decode().split()
        require(bool(ids), 'NO_RUNNING_CONTAINERS')
        containers = json.loads(command(['docker', 'inspect', *ids]))
        edges = [c for c in containers if re.fullmatch(r'/bos-release-[a-z0-9]+-edge', c['Name'])]
        require(len(edges) == 1, 'EDGE_NOT_UNIQUE')
        edge = edges[0]
        roots = {n: mount(edge, dest) for n, dest in (
            ('sources', '/bos-src'), ('bundles', '/bos-bundles'), ('main', '/bos-main'))}
        live = roots['sources'].parent.parent
        require(live.parent == PARENT and all(roots[n] == live / 'edge' / n for n in roots), 'RELEASE_LAYOUT_DIFFERS')
        require(shutil.disk_usage(live).free > 2_000_000_000, 'INSUFFICIENT_DISK')
        webs = [c for c in containers if any(m.get('Destination') == '/srv' and
                m.get('Source') == str(live / 'web') for m in c['Mounts'])]
        require(len(webs) == 1 and mount(webs[0], '/srv') == live / 'web', 'WEB_MOUNT_DIFFERS')
        entries = source_inventory(roots['sources'])
        for slug in entries:
            require(len(read(roots['bundles'] / (slug + '.eszip'))) > 64, 'LIVE_BUNDLE_MISSING_' + slug)
        before = {'edge': tree(live / 'edge'), 'web': tree(live / 'web')}
        stage = Path(tempfile.mkdtemp(prefix='report-acceptance-stage-', dir=PARENT))
        emit('STAGE', str(stage))
        emit('BACKUP', str(backup))
        for folder in ('edge', 'web'):
            shutil.copytree(live / folder, stage / 'before' / folder)
        shutil.copytree(stage / 'before/edge', stage / 'candidate/edge')
        backup_configuration(containers, live, stage)
        write(stage / 'inventory.json', json.dumps({
            'status': 'preparing', 'app_revision': APP, 'live': str(live),
            'backup': str(backup), 'edge_id': edge['Id'], 'image': edge['Image'],
            'entrypoints': entries, 'before': before}, indent=2).encode())
        gateway = read(roots['main'] / 'index.ts')
        names = sorted(set(re.findall(rb'Deno\.env\.get\(\s*[\'"]([A-Z][A-Z0-9_]{0,79})[\'"]\s*\)', gateway)))
        emit('GATEWAY', {'sha256': sha(gateway), 'env_names': [n.decode() for n in names],
                        'env_to_object': b'Deno.env.toObject' in gateway,
                        'envVars': b'envVars' in gateway,
                        'rest_path': b'/rest/v1' in gateway, 'storage_path': b'/storage/v1' in gateway})
        get_payload(stage)
        web_info = frontend_inventory(live / 'web', stage)
        emit('LIVE_RELEASE_UNCHANGED', True)
        compile_sources(stage, edge, entries)
        require(tree(live / 'edge') == before['edge'] and tree(live / 'web') == before['web'], 'CONCURRENT_LIVE_CHANGE')
        require(inspect(edge['Id'])['Config'] == edge['Config'], 'EDGE_CONFIG_CHANGED')
        record = {'status': 'compiled_not_activated', 'app_revision': APP, 'live': str(live),
                  'backup': str(backup), 'edge_id': edge['Id'], 'image': edge['Image'],
                  'entrypoints': entries, 'before': before, 'frontend': web_info,
                  'candidate_edge': tree(stage / 'candidate/edge')}
        write(stage / 'journal.json', json.dumps(record, indent=2).encode())
        emit('STAGE_READY', True)
        emit('PRODUCTION_UPDATED', False)
        emit('NEXT', 'DB_MIGRATION_AND_RUNTIME_ENV_VALIDATION')


if __name__ == '__main__':
    try:
        main()
    except Stop as error:
        emit('STAGE_STOPPED', str(error))
        raise SystemExit(1)
    except KeyboardInterrupt:
        emit('STAGE_STOPPED', 'INTERRUPTED')
        raise SystemExit(130)
    except Exception:
        # Do not echo exceptions containing credentials, URLs, or private paths.
        emit('STAGE_STOPPED', 'COMMAND_OR_LAYOUT_UNAVAILABLE')
        raise SystemExit(1)
