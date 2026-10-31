import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('finance_host_check', Path(__file__).with_name('check.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def container(label, aliases=(), env=()):
    return {'Name': '/' + label, 'Id': label + '-id', 'Config': {'Env': list(env)},
            'NetworkSettings': {'Networks': {'private': {'Aliases': list(aliases)}}}}


class CheckTests(unittest.TestCase):
    def test_origin_normalization_preserves_other_code(self):
        self.assertEqual(c.source_hash(b"a='https://139.100.237.167';\n"),
                         c.source_hash(b"a='https://homemaster.qd.je';\n"))
        self.assertNotEqual(c.source_hash(b'pay=600;'), c.source_hash(b'pay=564;'))

    def test_read_rejects_escape_and_symlink(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'web'; root.mkdir()
            target = Path(folder) / 'outside'; target.write_text('private')
            (root / 'link').symlink_to(target)
            for relative in ('../outside', 'link'):
                with self.assertRaises(c.Stop): c.read(root, relative)

    def test_nested_mount_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            data = {'Mounts': [{'Destination': '/srv', 'Type': 'bind', 'Source': folder},
                               {'Destination': '/srv/nested', 'Type': 'bind', 'Source': folder}]}
            with self.assertRaisesRegex(c.Stop, 'NESTED_MOUNT'): c.mount(data, '/srv')

    def test_large_compiled_bundle_uses_separate_streamed_limit(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); data = b'x' * 5_000_000
            (root / 'mini-app-api.eszip').write_bytes(data)
            self.assertEqual(c.bundle_digest(root, 'mini-app-api.eszip'), (c.digest(data), len(data)))
            with self.assertRaises(c.Stop): c.read(root, 'mini-app-api.eszip')

    def test_bundle_missing_link_and_oversize_are_distinct(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with self.assertRaisesRegex(c.Stop, '^BUNDLE_MISSING$'): c.bundle_digest(root, 'missing.eszip')
            (root / 'actual.eszip').write_bytes(b'12345')
            (root / 'link.eszip').symlink_to(root / 'actual.eszip')
            with self.assertRaisesRegex(c.Stop, '^BUNDLE_PATH_UNSAFE$'): c.bundle_digest(root, 'link.eszip')
            with self.assertRaisesRegex(c.Stop, '^BUNDLE_SIZE_LIMIT$'): c.bundle_digest(root, 'actual.eszip', limit=4)

    def test_shared_network_required_for_database_resolution(self):
        a = container('edge'); b = container('rest', ['rest'])
        b['NetworkSettings']['Networks'] = {'another': {'Aliases': ['rest']}}
        with self.assertRaises(c.Stop): c.resolve(a, 'rest', [a, b])

    def test_schema_queries_only_metadata_and_never_passes_credentials(self):
        edge = container('edge', env=['BOS_REST_ORIGIN=http://rest:3000', 'VK_APP_SECRET=SECRET'])
        rest = container('rest', ['rest'], ['PGRST_DB_URI=postgres://user:PRIVATE@db:5432/bos_restore_check'])
        db = container('db', ['db'])
        with patch.object(c, 'EXPECTED_COLUMNS', {'orders': ['id', 'master_id']}), \
             patch.object(c, 'command', return_value=b'[["orders","id"]]') as cmd:
            self.assertEqual(c.schema(edge, [edge, rest, db]), ['orders.master_id'])
        args = cmd.call_args.args[0]
        self.assertNotIn('PRIVATE', str(args)); self.assertNotIn('SECRET', str(args))
        self.assertIn('BEGIN READ ONLY;', args[-1])
        self.assertIn('FROM information_schema.columns', args[-1])
        self.assertNotIn('FROM orders', args[-1])
        self.assertTrue(args[-1].endswith('ROLLBACK;'))

    def test_credential_bearing_rest_origin_is_not_queried(self):
        edge = container('edge', env=['BOS_REST_ORIGIN=http://user:SECRET@rest:3000'])
        with patch.object(c, 'command') as cmd:
            with self.assertRaisesRegex(c.Stop, 'REST_ROUTE_UNSUPPORTED'): c.schema(edge, [])
            cmd.assert_not_called()

    def test_duplicate_module_cannot_be_selected_silently(self):
        entry = b'// Source: network-direct-v86.js\nfirst\n;\n// Source: next.js\nx'
        self.assertEqual(c.module(entry, 'network-direct-v86.js'), b'first')
        with self.assertRaises(c.Stop): c.module(entry + entry, 'network-direct-v86.js')

    def test_active_bundle_wins_over_stale_standalone_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / 'network-direct-v86.js').write_bytes(b'stale')
            entry = b'// Source: network-direct-v86.js\nactive\n;\n// Source: next.js\nx'
            self.assertEqual(c.runtime_source(root, 'network-direct-v86.js', [entry]), b'active')
            self.assertIsNone(c.runtime_source(root, 'missing.js', [entry]))
            with self.assertRaises(c.Stop): c.runtime_source(root, 'network-direct-v86.js', [entry, entry])

    def test_inventory_reports_compatible_baseline_without_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            release = Path(folder); web = release / 'web'; web.mkdir()
            sources, bundles, main = [release / 'edge' / name for name in ('sources', 'bundles', 'main')]
            for root in (sources, bundles, main): root.mkdir(parents=True)
            (sources / 'mini-app-api').mkdir()
            api = b'// synthetic API source\n'
            (sources / 'mini-app-api/index.ts').write_bytes(api)
            (bundles / 'mini-app-api.eszip').write_bytes(b'synthetic bundle')
            modules = {'pwa-register.js': b'// loader\n', 'finance-data.js': b'// financial logic\n'}
            for filename, data in modules.items(): (web / filename).write_bytes(data)
            (web / 'startup-shell.bundle.js').write_bytes(b'// Source: network-direct-v86.js\nnetwork\n;\n// Source: next.js\nx')
            (web / 'index.html').write_bytes(b'<html>fixture</html>')
            meta = {'id': 'a' * 20, 'shell': c.digest((web / 'index.html').read_bytes()),
                    'assets': {n: c.digest(data) for n, data in modules.items()}}
            (web / 'build-version.js').write_text('// Generated by npm run build. Do not edit.\nself.BOS_BUILD=' + json.dumps(meta) + ';\n')
            e = container('bos-release-to2wblxf-edge', env=['VK_APP_SECRET=PRIVATE_TOKEN'])
            w = container('bos-release-to2wblxf-https')
            for data in (e, w): data.update({'Image': 'sha256:fixture', 'HostConfig': {'NetworkMode': 'host'}})
            e['Mounts'] = [{'Type': 'bind', 'Source': str(path), 'Destination': dest} for path, dest in
                           [(sources, '/bos-src'), (bundles, '/bos-bundles'), (main, '/bos-main')]]
            w['Mounts'] = [{'Type': 'bind', 'Source': str(web), 'Destination': '/srv'}]
            baseline = {'web': {n: c.source_hash(data) for n, data in modules.items()}, 'api': c.source_hash(api)}
            before = {str(p): p.read_bytes() for p in release.rglob('*') if p.is_file()}
            output = io.StringIO()
            with patch.object(c, 'BASELINE', baseline), patch.object(c, 'schema', return_value=[]), contextlib.redirect_stdout(output):
                c.inspect_host([e, w])
            after = {str(p): p.read_bytes() for p in release.rglob('*') if p.is_file()}
            self.assertEqual(before, after)
            text = output.getvalue()
            self.assertIn('FINANCE_WEB_DIFFERENCES={}', text)
            self.assertIn('API_BASELINE_MATCH=true', text)
            self.assertIn('CHECK_COMPLETE=true', text)
            self.assertNotIn('PRIVATE_TOKEN', text)
            self.assertNotIn('synthetic API source', text)
            (bundles / 'mini-app-api.eszip').unlink()
            output = io.StringIO()
            with patch.object(c, 'BASELINE', baseline), patch.object(c, 'schema', return_value=['orders.master_id']) as schema, contextlib.redirect_stdout(output):
                c.inspect_host([e, w])
            schema.assert_called_once()
            self.assertIn('API_BUNDLE_ERROR="BUNDLE_MISSING"', output.getvalue())
            self.assertIn('MISSING_COLUMNS=["orders.master_id"]', output.getvalue())


if __name__ == '__main__': unittest.main()
