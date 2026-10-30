import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class SafetyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'bos-staging'
        self.root.mkdir(mode=0o700)
        self.inventory = {'format': 1, 'read_only': True, 'containers': [{
            'name': 'production', 'mounts': [{'type': 'bind', 'source': '/opt/business-os', 'destination': '/srv'},
            {'type': 'volume', 'name': 'prod-data', 'source': '/var/lib/docker/volumes/prod-data/_data', 'destination': '/db'}],
            'ports': [{'host_ip': '0.0.0.0', 'host_port': '443'}], 'networks': ['prod-net']}],
            'networks': [{'name': 'prod-net', 'internal': False}], 'all_containers_included': True}
        service = {'image': 'example.invalid/service@sha256:' + 'a' * 64,
                   'networks': {'isolated': {}}, 'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
                   'environment': {}, 'labels': {'bos.environment': 'staging'}}
        self.plan = {'name': 'bos-staging-test', 'services': {k: copy.deepcopy(service)
            for k in ['web', 'edge', 'db', 'auth', 'rest', 'storage']},
            'networks': {'isolated': {'name': 'bos-staging-test-isolated', 'internal': True}},
            'volumes': {'db': {'name': 'bos-staging-test-db'}, 'storage': {'name': 'bos-staging-test-storage'}}}
        self.plan['services']['web']['ports'] = [{'host_ip': '127.0.0.1', 'published': '18443', 'target': 443, 'protocol': 'tcp'}]
        self.plan['services']['db']['volumes'] = [{'type': 'volume', 'source': 'db', 'target': '/data'}]
        self.plan['services']['storage']['volumes'] = [{'type': 'volume', 'source': 'storage', 'target': '/objects'}]
        self.guard = module('guard')

    def check(self):
        return self.guard.validate(self.plan, self.inventory, self.root)

    def rejected(self):
        with self.assertRaises(self.guard.Stop):
            self.check()

    def test_structural_plan_passes_but_does_not_claim_runtime_readiness(self):
        result = self.check()
        self.assertEqual(result['status'], 'STRUCTURAL_CHECK_ONLY')
        self.assertFalse(result['ready_to_launch'])

    def test_requires_complete_production_inventory(self):
        self.inventory['all_containers_included'] = False
        self.rejected()

    def test_external_network_denied(self):
        self.plan['networks']['isolated']['internal'] = False
        self.rejected()

    def test_unlisted_network_denied(self):
        self.plan['services']['edge']['networks']['prod-net'] = {}
        self.rejected()

    def test_external_volume_denied(self):
        self.plan['volumes']['db']['external'] = True
        self.rejected()

    def test_named_production_volume_denied(self):
        self.plan['volumes']['db']['name'] = 'prod-data'
        self.rejected()

    def test_production_bind_denied(self):
        self.plan['services']['edge']['volumes'] = [{'type': 'bind', 'source': '/opt/business-os/files', 'target': '/files', 'read_only': True}]
        self.rejected()

    def test_nested_production_mount_under_staging_root_denied(self):
        self.inventory['containers'][0]['mounts'][0]['source'] = str(self.root / 'live')
        self.plan['services']['edge']['volumes'] = [{'type': 'bind', 'source': str(self.root / 'live' / 'code'), 'target': '/code'}]
        self.rejected()

    def test_symlink_root_and_mount_denied(self):
        link = self.root / 'escape'
        link.symlink_to(Path(self.tmp.name), target_is_directory=True)
        self.plan['services']['web']['volumes'] = [{'type': 'bind', 'source': str(link / 'missing'), 'target': '/web'}]
        self.rejected()

    def test_host_escape_denied(self):
        for key, value in [('privileged', True), ('network_mode', 'host'), ('pid', 'host'), ('devices', ['/dev/sda']), ('cap_add', ['NET_ADMIN']), ('volumes_from', ['production']), ('extra_hosts', ['host:host-gateway'])]:
            with self.subTest(key=key):
                service = self.plan['services']['edge']
                service[key] = value
                self.rejected()
                del service[key]

    def test_engine_socket_hooks_host_cgroup_and_unknown_service_options_denied(self):
        for key, value in [('use_api_socket', True), ('post_start', [{'command': 'id', 'privileged': True}]),
                           ('cgroup', 'host'), ('future_host_escape_option', True)]:
            with self.subTest(key=key):
                self.plan['services']['edge'][key] = value
                self.rejected()
                del self.plan['services']['edge'][key]

    def test_existing_compose_project_denied_even_with_custom_container_name(self):
        self.inventory['containers'][0]['compose_project'] = 'bos-staging-test'
        self.rejected()

    def test_implicit_container_name_collision_denied(self):
        for name in ['bos-staging-test-web-1', 'bos-staging-test_edge_2']:
            with self.subTest(name=name):
                self.inventory['containers'][0]['name'] = name
                self.rejected()

    def test_public_port_denied(self):
        self.plan['services']['web']['ports'][0]['host_ip'] = '0.0.0.0'
        self.rejected()

    def test_production_port_collision_denied(self):
        self.plan['services']['web']['ports'][0]['published'] = '443'
        self.rejected()

    def test_duplicate_staging_port_denied(self):
        self.plan['services']['edge']['ports'] = copy.deepcopy(self.plan['services']['web']['ports'])
        self.rejected()

    def test_integration_key_and_external_url_denied_without_echoing_value(self):
        for key, value in [('HANDS_API_KEY', 'DO_NOT_PRINT_SECRET'), ('SUPABASE_URL', 'https://production.invalid'), ('OTHER_URL', 'https://external.invalid'), ('HTTP_PROXY', 'http://proxy.invalid')]:
            with self.subTest(key=key):
                self.plan['services']['edge']['environment'] = {key: value}
                with self.assertRaises(self.guard.Stop) as ctx:
                    self.check()
                self.assertNotIn(value, str(ctx.exception))

    def test_inline_client_secret_denied(self):
        self.plan['services']['web']['environment'] = {'SUPABASE_SERVICE_ROLE_KEY': 'DO_NOT_PRINT_SECRET'}
        self.rejected()

    def test_unresolved_environment_denied(self):
        self.plan['services']['edge']['env_file'] = ['.env']
        self.rejected()

    def test_missing_service_and_image_digest_denied(self):
        del self.plan['services']['auth']
        self.rejected()

    def test_secret_file_outside_root_denied(self):
        self.plan['secrets'] = {'key': {'file': '/etc/production.env'}}
        self.rejected()

    def test_inventory_redacts_env_commands_labels_and_registry_auth(self):
        inventory = module('inventory')
        data = [{'Name': '/production', 'Config': {'Image': 'postgres:17', 'Env': ['PASSWORD=DO_NOT_PRINT_SECRET'],
                 'Labels': {'token': 'DO_NOT_PRINT_SECRET'}, 'Cmd': ['DO_NOT_PRINT_SECRET']},
                 'Image': 'sha256:' + 'b' * 64, 'State': {'Status': 'running'},
                 'HostConfig': {'NetworkMode': 'bridge'}, 'Mounts': [],
                 'NetworkSettings': {'Ports': {}, 'Networks': {'prod-net': {}}}}]
        result = inventory.summarize(data, [{'Name': 'prod-net', 'Internal': False}])
        self.assertNotIn('DO_NOT_PRINT_SECRET', json.dumps(result))
        self.assertEqual(result['containers'][0]['environment_keys'], ['PASSWORD'])
        self.assertTrue(result['all_containers_included'])

    def test_inventory_includes_stopped_port_reservations_and_only_compose_project_label(self):
        inventory = module('inventory')
        result = inventory.summarize([{'Name': '/stopped', 'Config': {'Image': 'postgres:17',
            'Labels': {'com.docker.compose.project': 'existing-project', 'token': 'DO_NOT_PRINT_SECRET'}},
            'State': {'Status': 'exited'}, 'Mounts': [],
            'HostConfig': {'PortBindings': {'443/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '18443'}]}},
            'NetworkSettings': {'Ports': None, 'Networks': {}}}], [])
        container = result['containers'][0]
        self.assertEqual(container['compose_project'], 'existing-project')
        self.assertEqual(container['ports'][0]['host_port'], '18443')
        self.assertNotIn('DO_NOT_PRINT_SECRET', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
