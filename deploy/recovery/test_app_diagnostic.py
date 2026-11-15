"""Real local files and tar; no Docker needed for structural diagnostics."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import app_diagnostic as d
import discovery
from test_app_plan import fixture, SECRET


def make_bundle(root):
    """Also used by native Windows launcher tests; returns the actual input path."""
    bundle = Path(root) / 'BOS-Backup'
    bundle.mkdir()
    context, contents, add = fixture()
    routes = json.loads(contents['root-003/routes.json'])
    # This recorded production source layout was not supported by v1.
    add('root-004/push-api/index.ts', b'// synthetic push source')
    add('root-004/push-api/deno.json', b'{"imports":{}}')
    add('root-000/push-api.eszip', b'synthetic push bundle')
    routes['push-api'] = {'entrypoint': 'index.ts', 'import_map': 'deno.json',
                         'bundle_sha256': 'a' * 64,
                         'source_sha256': {'index.ts': 'b' * 64, 'deno.json': 'c' * 64}, 'verify_jwt': False}
    # Unknown values must never leak, regardless of route schema rejection.
    routes['private-test'] = {'entrypoint': 'https://production.invalid/' + SECRET,
                              'token': SECRET, 'nested': {'value': SECRET}}
    add('root-003/routes.json', routes)
    # Captured Linux paths remain lexical POSIX paths on Windows.
    from pathlib import PurePosixPath
    for name in list(context['inventory']):
        for parent in PurePosixPath(name).parents:
            if str(parent) != '.':
                context['inventory'].setdefault(str(parent), {'type': 'directory', 'bytes': 0})
    with tarfile.open(bundle / 'files.tar', 'w') as archive:
        for name, record in context['inventory'].items():
            item = tarfile.TarInfo(name)
            if record['type'] == 'directory':
                item.type = tarfile.DIRTYPE
                archive.addfile(item)
            else:
                item.size = len(contents[name])
                archive.addfile(item, io.BytesIO(contents[name]))
    (bundle / 'private-config.json').write_text(json.dumps(context['private']))
    (bundle / 'inventory.json').write_text(json.dumps(context['inventory']))
    (bundle / 'database.dump').write_bytes(b'PGDMP private fixture never read')
    (bundle / 'globals.sql').write_text(SECRET)
    (bundle / 'images.tar').write_bytes(b'not used by metadata-only diagnostic')
    payloads = {p.name: {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                for p in bundle.iterdir()}
    manifest = json.dumps({'format': 1, 'capture': 'COMPLETE', 'build': discovery.BUILD,
                           'payloads': payloads}).encode()
    (bundle / 'manifest.json').write_bytes(manifest)
    (Path(root) / 'restore-report.json').write_text(json.dumps({
        'status': 'DRILL_COMPLETED', 'source_manifest_sha256': hashlib.sha256(manifest).hexdigest()}))
    return bundle


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='bos diagnostic ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = make_bundle(self.root)

    def run_check(self):
        text = io.StringIO()
        with contextlib.redirect_stdout(text):
            code = d.main(['--package-dir', str(self.root)])
        self.assertNotIn(SECRET, text.getvalue())
        return code, json.loads(text.getvalue())

    def test_all_routes_reported_without_docker_or_backup_writes(self):
        before = {p.name: p.read_bytes() for p in self.bundle.iterdir()}
        with patch.object(subprocess, 'Popen', side_effect=AssertionError('No child processes allowed')):
            code, summary = self.run_check()
        self.assertEqual(code, 0)
        report = json.loads(Path(summary['report']).read_text())
        self.assertEqual(len(report['routes']), 4)
        self.assertEqual(summary['unsupported_routes'], 1)
        self.assertFalse(report['docker_called'])
        self.assertFalse(report['backup_modified'])
        self.assertEqual({p.name: p.read_bytes() for p in self.bundle.iterdir()}, before)
        wire = json.dumps(report)
        self.assertNotIn(SECRET, wire)
        self.assertNotIn('https://production.invalid', wire)
        push = next(r for r in report['routes'] if r['name'] == 'push-api')
        self.assertEqual(push['route_contract'], 'SUPPORTED')
        self.assertEqual(push['shape']['fields']['entrypoint']['captured_code_path'], 'index.ts')
        self.assertEqual(push['shape']['fields']['import_map']['captured_code_path'], 'deno.json')
        self.assertTrue(push['captured_payloads']['root_index'])
        self.assertFalse(push['captured_payloads']['nested_index'])
        self.assertTrue(all(v == 'SUPPORTED' for r in report['service_checks'].values() for v in r.values()))

    def test_private_metadata_tampering_stops_without_value_leak(self):
        with (self.bundle / 'private-config.json').open('a') as stream:
            stream.write(SECRET)
        code, summary = self.run_check()
        self.assertEqual(code, 1)
        self.assertEqual(summary['reason'], 'PAYLOAD_HASH_MISMATCH')

    def test_selected_archive_member_hash_is_checked(self):
        with tarfile.open(self.bundle / 'files.tar', 'a') as archive:
            item = tarfile.TarInfo('root-003/routes.json')
            item.size = len(SECRET)
            archive.addfile(item, io.BytesIO(SECRET.encode()))
        code, summary = self.run_check()
        self.assertEqual(code, 1)
        self.assertEqual(summary['reason'], 'DIAGNOSTIC_GATEWAY_MEMBER_INVALID')

    def test_unknown_paths_numbers_arrays_and_values_are_redacted(self):
        value = {'entrypoint': SECRET, 'import_map': '/etc/' + SECRET,
                 'token': SECRET, 'list': [SECRET], 'number': 123456789,
                 SECRET: {SECRET: SECRET}, 'verify_jwt': False}
        wire = d.describe(value, 'api', 'root-000', {})
        self.assertNotIn(SECRET, json.dumps(wire))
        self.assertNotIn('123456789', json.dumps(wire))
        self.assertEqual(wire['fields']['verify_jwt']['value'], False)

    def test_independent_service_checks_do_not_stop_at_bad_route(self):
        report = d.app_cli.read_report(self.root / 'restore-report.json')
        context, contents, roles, images, prefixes = d.load_metadata(self.bundle, report)
        roles['storage']['Config']['Cmd'] = ['sh', '-c', SECRET]
        result = d.collect(context, contents, roles, images, prefixes)
        self.assertEqual(result['service_checks']['storage']['command'], 'APP_STORAGE_COMMAND_UNSUPPORTED')
        self.assertEqual(len(result['routes']), 4)
        self.assertNotIn(SECRET, json.dumps(result))

    def test_supported_plan_can_read_verified_local_import_maps(self):
        report = d.app_cli.read_report(self.root / 'restore-report.json')
        context, contents, roles, images, prefixes = d.load_metadata(self.bundle, report)
        self.assertIn('root-004/push-api/deno.json', contents)
        route_name = prefixes['/bos-main'] + '/routes.json'
        routes = json.loads(contents[route_name])
        del routes['private-test']
        contents[route_name] = json.dumps(routes).encode()
        context['inventory'][route_name] = {'type': 'file', 'bytes': len(contents[route_name]),
            'sha256': hashlib.sha256(contents[route_name]).hexdigest()}
        result = d.collect(context, contents, roles, images, prefixes)
        self.assertEqual(result['plan_result'], 'SUPPORTED')
        self.assertTrue(all(route['route_contract'] == 'SUPPORTED' for route in result['routes']))


if __name__ == '__main__':
    unittest.main()
