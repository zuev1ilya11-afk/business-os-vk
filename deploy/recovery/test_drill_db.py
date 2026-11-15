"""Safety-boundary tests for the disposable database restore transport."""
import copy
import json
import unittest

import drill_db


RUN = 'bos-drill-123456abcdef'
VOLUME = RUN + '-data'
IMAGE = 'sha256:' + 'a' * 64
PAYLOADS = {name: {'sha256': char * 64, 'bytes': 100}
            for name, char in (('database.dump', 'a'), ('globals.sql', 'b'), ('files.tar', 'c'))}
PRIVATE = {'database': {'database': 'bos_restore_check', 'version': 170006,
                       'bytes': 4 * 1024 * 1024,
                       'extensions': [['plpgsql', '1.0']]},
           'containers': [{'Config': {'Env': ['PGHOST=production-secret-host',
                                             'PGPASSWORD=never-output-this']}}]}


class Docker:
    def __init__(self):
        self.calls, self.containers = [], {}
        self.sequence = 0
        self.wait_code = b'0\n'
        self.fail = None
        self.mutate = None
        self.volume = {'Name': VOLUME, 'Driver': 'local', 'Options': None,
                       'Labels': {drill_db.LABEL: RUN}}
        self.image = {'Id': IMAGE, 'Os': 'linux',
                      'Config': {'Volumes': {'/var/lib/postgresql/data': {}}}}
        self.checked = {'version': 170006, 'database': 'bos_restore_check',
                        'socket_only': True, 'readonly': True,
                        'workers_disabled': True, 'extensions': [['plpgsql', '1.0']],
                        'guard_function': True, 'guard_trigger': True,
                        'orders': 12, 'staff': 4, 'storage_objects': 23}

    def __call__(self, args, **kwargs):
        self.calls.append(list(args))
        if self.fail and self.fail(args):
            raise RuntimeError('never-output-this SQL: sensitive record')
        if args[:2] == ['image', 'inspect']:
            return json.dumps([self.image]).encode()
        if args[:2] == ['volume', 'inspect']:
            return json.dumps([self.volume]).encode()
        if args[0] == 'create':
            self.sequence += 1
            cid = str(self.sequence) * 64
            helper = args[args.index('--user') + 1] == '0:0'
            mounts, tmpfs = [], {}
            for i, arg in enumerate(args):
                if arg == '--mount':
                    parsed = dict(p.split('=', 1) if '=' in p else (p, True)
                                  for p in args[i + 1].split(','))
                    mount = {'Type': parsed['type'], 'Destination': parsed['target'],
                             'RW': 'readonly' not in parsed}
                    if parsed['type'] == 'volume':
                        mount['Name'] = parsed['source']
                    mounts.append(mount)
                if arg == '--tmpfs':
                    target, options = args[i + 1].split(':', 1)
                    tmpfs[target] = options
                    mounts.append({'Type': 'tmpfs', 'Destination': target, 'RW': True})
            self.containers[cid] = {
                'Id': cid, 'Name': args[args.index('--name') + 1],
                'State': {'Running': False},
                'HostConfig': {'NetworkMode': 'none', 'Privileged': False,
                               'ReadonlyRootfs': True, 'PortBindings': {},
                               'CapDrop': ['ALL'], 'CapAdd': ['CHOWN', 'DAC_READ_SEARCH'] if helper else [],
                               'SecurityOpt': ['no-new-privileges:true'],
                               'RestartPolicy': {'Name': 'no'}, 'LogConfig': {'Type': 'none'},
                               'Memory': 1024 ** 3, 'MemorySwap': 1024 ** 3,
                               'NanoCpus': 2_000_000_000, 'PidsLimit': 256, 'ShmSize': 128 * 1024 * 1024,
                               'Tmpfs': tmpfs},
                'Config': {'Labels': {drill_db.LABEL: RUN},
                           'User': '0:0' if helper else 'postgres',
                           'Entrypoint': ['/bin/sh'], 'Healthcheck': {'Test': ['NONE']}},
                'NetworkSettings': {'Networks': {'none': {'IPAddress': ''}}},
                'Mounts': mounts}
            return (cid + '\n').encode()
        if args[0] == 'inspect':
            obj = copy.deepcopy(self.containers[args[1]])
            if self.mutate:
                self.mutate(obj)
            return json.dumps([obj]).encode()
        if args[0] == 'start':
            self.containers[args[1]]['State']['Running'] = True
            return (args[1] + '\n').encode()
        if args[0] == 'wait':
            self.containers[args[1]]['State']['Running'] = False
            return self.wait_code
        if args[0] == 'stop':
            self.containers[args[-1]]['State']['Running'] = False
            return b''
        if args[0] == 'rm':
            del self.containers[args[-1]]
            return b''
        if args[0] == 'exec':
            if drill_db.VALIDATE_SQL in args:
                return json.dumps(self.checked).encode()
            if 'SELECT 1;' in args:
                return b'1\n'
            return b''
        raise AssertionError('Unexpected Docker command')


def restore(docker, **overrides):
    arguments = {'runner': docker, 'image_id': IMAGE, 'run_id': RUN,
                 'volume': VOLUME, 'bundle_mount': '/private/captured-bundle',
                 'private': PRIVATE, 'expected_payloads': PAYLOADS,
                 'bootstrap_role': 'postgres', 'bootstrap_create_span': (0, len('CREATE ROLE postgres;'))}
    arguments.update(overrides)
    return drill_db.restore_database(**arguments)


class DrillDatabaseTests(unittest.TestCase):
    def assertReason(self, expected, docker, **kwargs):
        with self.assertRaises(drill_db.DrillDBError) as raised:
            restore(docker, **kwargs)
        self.assertEqual(expected, raised.exception.reason_code)
        self.assertNotIn('never-output-this', str(raised.exception))

    def test_restores_into_two_owned_networkless_containers_and_removes_them(self):
        docker = Docker()
        result = restore(docker)
        self.assertEqual('RESTORED', result['database'])
        self.assertEqual('MATCH', result['extensions'])
        self.assertEqual({'orders': 12, 'staff': 4, 'storage_objects': 23}, result['counts'])
        self.assertEqual({}, docker.containers)
        created = [c for c in docker.calls if c[0] == 'create']
        self.assertEqual(2, len(created))
        for args in created:
            self.assertEqual('none', args[args.index('--network') + 1])
            self.assertIn('--read-only', args)
            self.assertIn('--no-healthcheck', args)
            self.assertNotIn('-p', args)
            self.assertNotIn('--privileged', args)
            self.assertIn('type=volume,source=' + VOLUME + ',target=/bos,volume-nocopy', args)
        self.assertFalse(any('/bundle' in arg for arg in created[1]))
        self.assertFalse(any(c[:2] == ['volume', 'rm'] for c in docker.calls))
        self.assertNotIn('production-secret-host', repr(docker.calls))
        self.assertNotIn('never-output-this', repr(result))

    def test_original_bootstrap_identity_and_separate_temporary_admin(self):
        docker = Docker()
        restore(docker)
        create = [c for c in docker.calls if c[0] == 'create'][1]
        self.assertEqual('postgres', create[-1])
        create_admin = next(c for c in docker.calls if any(x.startswith('CREATE ROLE "drill_admin_') for x in c))
        self.assertEqual('postgres', create_admin[create_admin.index('-U') + 1])
        globals_command = next(c for c in docker.calls if '/bos/input/globals-restore.sql' in c)
        self.assertRegex(globals_command[globals_command.index('-U') + 1], r'^drill_admin_[0-9a-f]{24}$')
        restore_command = next(c for c in docker.calls if 'pg_restore' in c)
        self.assertIn('--create', restore_command)
        self.assertIn('--exit-on-error', restore_command)
        self.assertNotIn('--no-owner', restore_command)
        self.assertNotIn('--no-acl', restore_command)
        self.assertNotIn('--single-transaction', restore_command)

    def test_queries_clear_client_routing_and_force_local_socket(self):
        docker = Docker()
        restore(docker)
        commands = [c for c in docker.calls if c[0] == 'exec']
        for args in commands:
            self.assertEqual('/tmp', args[args.index('-h') + 1])
            self.assertEqual('postgres', args[args.index('--user') + 1])
            for name in drill_db.ROUTING:
                self.assertIn(name, args)
                self.assertEqual('-u', args[args.index(name) - 1])
        validation = next(c for c in commands if drill_db.VALIDATE_SQL in c)
        self.assertTrue(any('default_transaction_read_only=on' in x for x in validation))

    def test_source_database_name_and_major_are_pinned(self):
        for database, version in [('postgres', 170006), ('bos_restore_check', 160010)]:
            private = copy.deepcopy(PRIVATE)
            private['database'].update(database=database, version=version)
            docker = Docker()
            self.assertReason('DRILL_DATABASE_METADATA_INVALID', docker, private=private)
            self.assertEqual([], docker.calls)

    def test_refuses_volume_with_external_driver_options(self):
        docker = Docker()
        docker.volume['Options'] = {'type': 'none', 'o': 'bind', 'device': '/live'}
        self.assertReason('DRILL_VOLUME_UNCONFIRMED', docker)
        self.assertFalse(any(c[0] == 'create' for c in docker.calls))

    def test_refuses_bundle_mount_option_injection(self):
        docker = Docker()
        self.assertReason('DRILL_BUNDLE_MOUNT_INVALID', docker, bundle_mount='/tmp/a,target=/live')
        self.assertEqual([], docker.calls)

    def test_rejects_image_volume_overlapping_bos(self):
        docker = Docker()
        docker.image['Config']['Volumes'] = {'/bos/data': {}}
        self.assertReason('DRILL_IMAGE_VOLUMES_INVALID', docker)
        self.assertFalse(any(c[0] == 'create' for c in docker.calls))

    def test_refuses_published_port_before_start(self):
        docker = Docker()
        docker.mutate = lambda c: c['HostConfig'].update(PortBindings={'5432/tcp': [{}]})
        self.assertReason('DRILL_ISOLATION_UNCONFIRMED', docker)
        self.assertFalse(any(c[0] == 'start' for c in docker.calls))
        self.assertEqual({}, docker.containers)

    def test_refuses_additional_network_after_restore(self):
        docker = Docker()
        def mutate(obj):
            if obj['Name'].endswith('-db') and any(drill_db.VALIDATE_SQL in c for c in docker.calls):
                obj['NetworkSettings']['Networks']['bridge'] = {'IPAddress': '172.17.0.2'}
        docker.mutate = mutate
        self.assertReason('DRILL_ISOLATION_UNCONFIRMED', docker)
        self.assertEqual({}, docker.containers)

    def test_docker_capability_prefixes_and_security_option_forms(self):
        for option in ('no-new-privileges', 'no-new-privileges:true', 'no-new-privileges=true'):
            docker = Docker()
            def mutate(obj):
                config = obj['HostConfig']
                config['SecurityOpt'] = [option]
                config['CapAdd'] = ['CAP_' + name for name in config['CapAdd']]
            docker.mutate = mutate
            self.assertEqual('RESTORED', restore(docker)['database'])
            created = [c for c in docker.calls if c[0] == 'create']
            self.assertTrue(all(c[c.index('--security-opt') + 1] == 'no-new-privileges' for c in created))

    def test_disabled_or_extra_security_options_and_extra_capabilities_are_rejected(self):
        for override in ({'SecurityOpt': ['no-new-privileges=false']},
                         {'SecurityOpt': ['no-new-privileges:true', 'seccomp=unconfined']},
                         {'CapAdd': ['CAP_CHOWN', 'CAP_DAC_READ_SEARCH', 'CAP_SYS_ADMIN']},
                         {'CapDrop': []}):
            docker = Docker()
            docker.mutate = lambda c: c['HostConfig'].update(override)
            self.assertReason('DRILL_ISOLATION_UNCONFIRMED', docker)
            self.assertFalse(any(c[0] == 'start' for c in docker.calls))

    def test_missing_memory_limit_and_host_device_are_rejected(self):
        for override in ({'Memory': 0}, {'Devices': [{'PathOnHost': '/dev/sda'}]}):
            docker = Docker()
            docker.mutate = lambda c: c['HostConfig'].update(override)
            self.assertReason('DRILL_ISOLATION_UNCONFIRMED', docker)
            self.assertFalse(any(c[0] == 'start' for c in docker.calls))

    def test_insufficient_vm_disk_fails_before_database_create(self):
        docker = Docker()
        docker.wait_code = b'42\n'
        self.assertReason('DRILL_INSUFFICIENT_SPACE', docker)
        self.assertEqual(1, len([c for c in docker.calls if c[0] == 'create']))
        self.assertEqual({}, docker.containers)

    def test_copied_files_are_hash_checked_before_database_create(self):
        docker = Docker()
        docker.wait_code = b'43\n'
        self.assertReason('DRILL_COPY_HASH_MISMATCH', docker)
        created = [c for c in docker.calls if c[0] == 'create']
        self.assertEqual(1, len(created))
        self.assertEqual(['a' * 64, 'b' * 64, 'c' * 64], created[0][-6:-3])
        self.assertIn('cp /bundle/files.tar /bos/input/files.tar', drill_db.INIT_SCRIPT)
        self.assertIn('sha256sum --check --status', drill_db.INIT_SCRIPT)
        self.assertEqual({}, docker.containers)

    def test_payload_hashes_must_be_present_and_cannot_inject_shell(self):
        for supplied in (None, {}, {'database.dump': {'sha256': 'x;echo secret', 'bytes': 1}}):
            docker = Docker()
            self.assertReason('DRILL_PAYLOAD_METADATA_INVALID', docker, expected_payloads=supplied)
            self.assertEqual([], docker.calls)

    def test_globals_error_stops_without_restoring_data_or_leaking_stderr(self):
        docker = Docker()
        docker.fail = lambda c: '/bos/input/globals-restore.sql' in c
        self.assertReason('DRILL_GLOBALS_RESTORE_FAILED', docker)
        self.assertFalse(any('pg_restore' in c for c in docker.calls))
        self.assertEqual({}, docker.containers)

    def test_bootstrap_metadata_required_and_bad_copy_span_rejected(self):
        for overrides in ({'bootstrap_role': None}, {'bootstrap_role': 'postgres;SELECT secret'},
                          {'bootstrap_create_span': (-1, 15)}, {'bootstrap_create_span': (0, 101)},
                          {'bootstrap_create_span': None}):
            docker = Docker()
            self.assertReason('DRILL_BOOTSTRAP_METADATA_REQUIRED', docker, **overrides)
            self.assertEqual([], docker.calls)
        docker = Docker()
        docker.wait_code = b'44\n'
        self.assertReason('DRILL_BOOTSTRAP_METADATA_MISMATCH', docker)
        self.assertEqual(1, len([c for c in docker.calls if c[0] == 'create']))

    def test_globals_copy_uses_parser_byte_span_not_line_filter_or_grant_rewrite(self):
        self.assertIn('head -c "$5" /bos/input/globals.sql', drill_db.INIT_SCRIPT)
        self.assertIn('tail -c "+$(($6 + 1))" /bos/input/globals.sql', drill_db.INIT_SCRIPT)
        self.assertNotIn('GRANTED BY', drill_db.INIT_SCRIPT)
        self.assertNotIn('sed ', drill_db.INIT_SCRIPT)
        self.assertNotIn('CREATE ROLE', drill_db.VALIDATE_SQL)

    def test_database_restore_error_is_not_ignored(self):
        docker = Docker()
        docker.fail = lambda c: 'pg_restore' in c
        self.assertReason('DRILL_DATABASE_RESTORE_FAILED', docker)
        self.assertEqual({}, docker.containers)

    def test_extension_and_guard_mismatches_stop(self):
        docker = Docker()
        docker.checked['extensions'] = [['plpgsql', 'wrong']]
        self.assertReason('DRILL_EXTENSION_MISMATCH', docker)
        docker = Docker()
        docker.checked['guard_trigger'] = False
        self.assertReason('DRILL_REPORT_GUARD_MISSING', docker)

    def test_cleanup_failure_prevents_success(self):
        docker = Docker()
        docker.fail = lambda c: c[0] == 'stop'
        self.assertReason('DRILL_CLEANUP_UNCONFIRMED', docker)

    def test_tampered_identity_is_never_stopped_or_removed(self):
        docker = Docker()
        docker.mutate = lambda c: c['Config'].update(Labels={drill_db.LABEL: 'somebody-else'})
        self.assertReason('DRILL_CLEANUP_UNCONFIRMED', docker)
        self.assertFalse(any(c[0] in ('stop', 'rm') for c in docker.calls))

    def test_worker_settings_and_original_configs_are_not_used(self):
        self.assertIn('-c max_worker_processes=0', drill_db.START_SCRIPT)
        self.assertIn('-c shared_preload_libraries=', drill_db.START_SCRIPT)
        self.assertIn('test ! -e /bos/data', drill_db.START_SCRIPT)
        self.assertNotIn('postgres.conf', drill_db.START_SCRIPT)
        self.assertNotIn('docker-entrypoint', drill_db.START_SCRIPT)


if __name__ == '__main__':
    unittest.main()
