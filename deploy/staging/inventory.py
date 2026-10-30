#!/usr/bin/env python3
"""Offline, read-only host inventory. Never emit env values or container commands.

Uses docker ps/inspect/network inspect only. Does not contact the application,
query its database, export data, restart services or write files.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def run(args):
    result = subprocess.run(args, capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError('INVENTORY_COMMAND_FAILED')
    return result.stdout.decode()


def summarize(containers, networks):
    output = []
    for c in containers:
        ports = []
        for mapping in (c.get('HostConfig', {}).get('PortBindings'), c.get('NetworkSettings', {}).get('Ports')):
            for target, bindings in (mapping or {}).items():
                for b in bindings or []:
                    binding = {'target': target, 'host_ip': b['HostIp'], 'host_port': b['HostPort']}
                    if binding not in ports:
                        ports.append(binding)
        mounts = []
        for m in c.get('Mounts', []):
            mounts.append({k: m.get(v) for k, v in [('type', 'Type'), ('source', 'Source'),
                ('destination', 'Destination'), ('name', 'Name'), ('rw', 'RW')]})
        cfg = c.get('Config', {})
        ref = cfg.get('Image', '')
        if not re.fullmatch(r'[A-Za-z0-9_.:/@-]{1,300}', ref):
            ref = 'REDACTED_UNEXPECTED_IMAGE_REFERENCE'
        project = (cfg.get('Labels') or {}).get('com.docker.compose.project')
        if project is not None and not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}', project):
            raise RuntimeError('UNRECOGNIZED_COMPOSE_PROJECT_LABEL')
        output.append({'name': c.get('Name', '').lstrip('/'), 'image_reference': ref,
            'compose_project': project,
            'image_id': c.get('Image'), 'state': c.get('State', {}).get('Status'),
            'mounts': mounts, 'ports': ports,
            'networks': list(c.get('NetworkSettings', {}).get('Networks', {})),
            'environment_keys': sorted({x.split('=', 1)[0] for x in cfg.get('Env') or []}),
            'network_mode': c.get('HostConfig', {}).get('NetworkMode')})
    return {'format': 1, 'read_only': True, 'all_containers_included': True,
            'containers': output, 'networks': [{'name': n.get('Name'), 'internal': n.get('Internal')}
                                            for n in networks]}


def frontend_builds(containers):
    results = []
    seen = set()
    for container in containers:
        for mount in container.get('Mounts', []):
            if mount.get('Type') != 'bind':
                continue
            root = Path(mount['Source'])
            for suffix in ('', 'public', 'web', 'frontend', 'www', 'app'):
                file = root / suffix / 'build-version.js'
                if file in seen or not file.is_file() or file.resolve() != file or file.stat().st_size > 1_000_000:
                    continue
                seen.add(file)
                # Only the opaque build ID is emitted, never arbitrary source/config.
                match = re.search(rb'self\.BOS_BUILD=\{"id":"([a-f0-9]{20})"', file.read_bytes())
                if match:
                    results.append({'container': container['Name'].lstrip('/'), 'root': str(file.parent),
                                    'build_id': match.group(1).decode()})
    return results


def main():
    ids = run(['docker', 'ps', '-aq']).split()
    if not ids:
        raise RuntimeError('NO_CONTAINERS_INVENTORY_INCOMPLETE')
    containers = json.loads(run(['docker', 'inspect', *ids]))
    names = sorted({n for c in containers for n in c.get('NetworkSettings', {}).get('Networks', {})})
    networks = json.loads(run(['docker', 'network', 'inspect', *names])) if names else []
    result = summarize(containers, networks)
    result['frontend_builds'] = frontend_builds(containers)
    mem = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        if line.split(':')[0] in ('MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'):
            mem[line.split(':')[0] + '_kib'] = int(line.split()[1])
    result['resources'] = {'cpus': os.cpu_count(), 'memory': mem,
        'root_disk_free_bytes': shutil.disk_usage('/').free,
        'load_average': list(os.getloadavg())}
    result['limits'] = ['Docker inventory only; host processes, host timers and SQL cron require separate review.',
                        'Image ID is not a registry digest; inspect RepoDigests before pinning.',
                        'BUILD_ID is not proof of a Git SHA or complete server/source equality.']
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('INVENTORY_FAILED: Docker/host access unavailable or metadata incomplete; no changes made.', file=sys.stderr)
        sys.exit(1)
