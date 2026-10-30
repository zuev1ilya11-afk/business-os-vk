#!/usr/bin/env python3
"""Read-only structural gate for rendered Compose JSON, never a launcher.

Even success is NOT runtime readiness: schema, secret provenance, RLS, egress,
browser requests, Auth, Storage and restore need real staging acceptance.
"""
import argparse
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit


class Stop(Exception):
    pass


def require(value, code):
    if not value:
        raise Stop(code)


def overlap(a, b):
    return a == b or a in b.parents or b in a.parents


def safe_path(raw, root):
    require(isinstance(raw, str) and Path(raw).is_absolute(), 'ABSOLUTE_PATH_REQUIRED')
    p = Path(raw)
    require(p.resolve() == p and p.is_relative_to(root) and p != root, 'PATH_OUTSIDE_STAGING_OR_SYMLINK')
    return p


def validate(plan, inventory, root):
    root = Path(root)
    require(root.is_absolute() and root.resolve() == root and root.is_dir(), 'STAGING_ROOT_INVALID')
    require(root.name.startswith('bos-staging') and not root.stat().st_mode & 0o077, 'PRIVATE_STAGING_ROOT_REQUIRED')
    require(inventory.get('format') == 1 and inventory.get('read_only') is True and
            inventory.get('all_containers_included') is True and inventory.get('containers'), 'COMPLETE_PRODUCTION_INVENTORY_REQUIRED')
    live_paths, live_names, live_ports, live_nets, live_volumes = [], set(), set(), set(), set()
    for c in inventory['containers']:
        live_names.add(c['name'])
        live_nets.update(c['networks'])
        live_ports.update(str(p['host_port']) for p in c['ports'])
        for m in c['mounts']:
            if m.get('source'):
                live_paths.append(Path(m['source']).resolve())
            if m.get('name'):
                live_volumes.add(m['name'])
    require(not any(overlap(root, p) for p in live_paths), 'STAGING_ROOT_OVERLAPS_EXISTING_MOUNT')
    project = plan.get('name', '')
    require(re.fullmatch(r'bos-staging-[a-z0-9-]{1,40}', project), 'STAGING_PROJECT_REQUIRED')
    require(not any(c.get('compose_project') == project for c in inventory['containers']), 'EXISTING_COMPOSE_PROJECT')
    services = plan.get('services', {})
    require(set(services) == {'web', 'edge', 'db', 'auth', 'rest', 'storage'}, 'EXPLICIT_SIX_SERVICE_PLAN_REQUIRED')
    require(not any(re.fullmatch(re.escape(project) + r'[-_](?:' + '|'.join(services) + r')[-_]\d+', name)
                    for name in live_names), 'IMPLICIT_CONTAINER_NAME_COLLISION')
    require(not any(plan.get(k) for k in ('include', 'extends', 'configs', 'x-bos-enabled-jobs')), 'UNRESOLVED_OR_EXTRA_CONFIGURATION')
    networks = plan.get('networks', {})
    require(bool(networks), 'ISOLATED_NETWORK_REQUIRED')
    for n in networks.values():
        require(isinstance(n, dict) and n.get('internal') is True and not n.get('external') and
                n.get('name', '').startswith(project + '-') and n['name'] not in live_nets,
                'EXTERNAL_OR_SHARED_NETWORK')
        require(not any(n.get(k) for k in ('driver_opts', 'ipam', 'enable_ipv6')) and n.get('driver', 'bridge') == 'bridge',
                'UNSUPPORTED_NETWORK_OPTIONS')
    volumes = plan.get('volumes', {})
    for v in volumes.values():
        require(isinstance(v, dict) and not v.get('external') and not v.get('driver_opts') and
                v.get('driver', 'local') == 'local' and v.get('name', '').startswith(project + '-') and
                v['name'] not in live_volumes, 'EXTERNAL_OR_SHARED_VOLUME')
    for secret in plan.get('secrets', {}).values():
        require(isinstance(secret, dict) and set(secret) == {'file'}, 'UNRESOLVED_SECRET')
        p = safe_path(secret['file'], root)
        require(p.is_file() and not p.stat().st_mode & 0o077, 'PRIVATE_SECRET_FILE_REQUIRED')
    used_ports, bound_origins = set(), set()
    for name, svc in services.items():
        for port in svc.get('ports', []):
            require(isinstance(port, dict) and port.get('host_ip') == '127.0.0.1' and port.get('protocol', 'tcp') == 'tcp', 'LOOPBACK_TCP_ONLY')
            published = str(port.get('published', ''))
            require(published.isdecimal() and 1024 <= int(published) <= 65535 and
                    published not in live_ports and published not in used_ports, 'PORT_COLLISION_OR_INVALID')
            require(name == 'web', 'ONLY_WEB_MAY_PUBLISH_PORTS')
            used_ports.add(published)
            bound_origins.update(f'{scheme}://127.0.0.1:{published}' for scheme in ('http', 'https'))
    require(bool(bound_origins), 'PRIVATE_WEB_ENDPOINT_REQUIRED')
    denied_options = ('privileged', 'network_mode', 'pid', 'ipc', 'uts', 'userns_mode', 'devices', 'device_cgroup_rules',
                      'cap_add', 'volumes_from', 'extra_hosts', 'dns', 'dns_search', 'dns_opt', 'env_file',
                      'build', 'extends', 'develop', 'provider', 'profiles', 'external_links', 'links')
    # Fail closed on future Compose options, including implicit Docker socket access
    # and lifecycle hooks with privileges not visible in the service's own caps.
    allowed_options = {'image', 'container_name', 'networks', 'ports', 'volumes', 'environment', 'labels',
                       'cap_drop', 'security_opt', 'read_only', 'tmpfs', 'restart', 'user', 'command',
                       'entrypoint', 'depends_on', 'healthcheck', 'init', 'stop_grace_period', 'stop_signal',
                       'mem_limit', 'cpus', 'pids_limit', 'secrets', 'working_dir', 'hostname'}
    integration = re.compile(r'HANDS|AVITO|VAPID|GAS|DRIVE|OPENAI|SMTP|SMS|TELEGRAM|PAYMENT|SYNC_KEY|WORKER_TOKEN|PROXY', re.I)
    for name, svc in services.items():
        require(set(svc) <= allowed_options, 'UNREVIEWED_SERVICE_OPTION')
        require(not any(svc.get(k) for k in denied_options), 'UNSAFE_SERVICE_OPTION')
        require(re.fullmatch(r'[^\s]+@sha256:[0-9a-f]{64}', svc.get('image', '')), 'PINNED_IMAGE_DIGEST_REQUIRED')
        require(svc.get('labels', {}).get('bos.environment') == 'staging', 'SERVICE_STAGING_LABEL_REQUIRED')
        require('ALL' in svc.get('cap_drop', []) and any(x in svc.get('security_opt', []) for x in
                ('no-new-privileges:true', 'no-new-privileges')), 'CAPABILITY_RESTRICTIONS_REQUIRED')
        require(set(svc.get('security_opt', [])) <= {'no-new-privileges:true', 'no-new-privileges'}, 'UNSAFE_SECURITY_OPTION')
        if svc.get('container_name'):
            require(svc['container_name'].startswith(project + '-') and svc['container_name'] not in live_names, 'SHARED_CONTAINER_NAME')
        attached = svc.get('networks', {})
        require(isinstance(attached, dict) and attached and set(attached) <= set(networks), 'UNDECLARED_NETWORK')
        require(all(not cfg for cfg in attached.values()), 'CUSTOM_NETWORK_ALIAS_OR_ADDRESS')
        for mount in svc.get('volumes', []):
            require(isinstance(mount, dict) and mount.get('type') in ('volume', 'bind', 'tmpfs'), 'UNRESOLVED_MOUNT')
            require(mount.get('target', '').startswith('/') and not any(x in mount['target'] for x in ('docker.sock', 'containerd.sock')), 'HOST_SOCKET_DENIED')
            if mount['type'] == 'volume':
                require(mount.get('source') in volumes, 'UNDECLARED_VOLUME')
            elif mount['type'] == 'bind':
                p = safe_path(mount.get('source'), root)
                require(p.exists() and not any(overlap(p, x) for x in live_paths), 'SHARED_OR_MISSING_BIND_MOUNT')
                require(not mount.get('bind', {}).get('propagation') or mount['bind']['propagation'] == 'rprivate', 'BIND_PROPAGATION_DENIED')
        env = svc.get('environment', {})
        require(isinstance(env, dict), 'RESOLVED_ENVIRONMENT_REQUIRED')
        for key, value in env.items():
            require(isinstance(value, str) and '${' not in value, 'UNRESOLVED_ENVIRONMENT')
            require(not value or not integration.search(key), 'EXTERNAL_INTEGRATION_CONFIGURATION_DENIED')
            if name == 'web':
                require(not re.search('SECRET|TOKEN|PASSWORD|SERVICE_ROLE|PRIVATE_KEY', key, re.I), 'CLIENT_SECRET_DENIED')
            if '://' in value:
                # Connections may only address the declared isolated services or the loopback web origin.
                require(',' not in value and '\n' not in value, 'MULTIPLE_OR_UNPARSEABLE_URLS')
                url = urlsplit(value)
                origin = f'{url.scheme}://{url.netloc}'
                require((url.hostname in services and url.scheme in ('http', 'https', 'postgres', 'postgresql')) or
                        (origin in bound_origins and url.scheme in ('http', 'https')), 'EXTERNAL_URL_DENIED')
    return {'status': 'STRUCTURAL_CHECK_ONLY', 'ready_to_launch': False, 'project': project,
            'limitations': ['No containers started or inspected against this plan.',
                'Image content, required environment, credential provenance, schema, RLS and runtime egress unverified.',
                'Host timers/SQL cron, browser/Auth/Storage scenarios, backup/restore and restart acceptance remain required.']}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--environment', required=True, choices=['staging'])
    p.add_argument('--compose-json', type=Path, required=True)
    p.add_argument('--production-inventory', type=Path, required=True)
    p.add_argument('--root', type=Path, required=True)
    args = p.parse_args()
    result = validate(json.loads(args.compose_json.read_text()), json.loads(args.production_inventory.read_text()), args.root)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Stop as e:
        print('STAGING_REFUSED: ' + str(e), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('STAGING_REFUSED: INVALID_OR_INCOMPLETE_INPUT', file=sys.stderr)
        sys.exit(1)
