import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


s = load('stage_for_resume', ROOT / 'stage.py')
d = load('diff_for_resume', ROOT / 'bundle-diff.py')
m = load('resume_stage', ROOT / 'resume-stage.py')
fixtures = load('bundle_fixtures', ROOT / 'test_bundle_diff.py')
m.s, m.d = s, d


def baseline(name):
    return subprocess.run(['git', 'show', s.BASE + ':' + name], cwd=REPO,
                          capture_output=True, check=True).stdout


class ResumeTests(unittest.TestCase):
    def bundle(self, modules, redirects=None):
        return {'modules': modules, 'redirects': redirects or {}, 'npm': {'sdk@1.0.0': {}},
                'npm_roots': {'sdk@1': 'sdk@1.0.0'}}

    def test_shared_import_can_rebase_direct_function_archive_root(self):
        old = self.bundle({'index.ts': (0, b'old entry'), 'vfs://0': (3, b'opaque before')})
        new = self.bundle({'drive-archive-api/index.ts': (0, b'new entry'),
                           '_shared/report-storage.ts': (0, b'new helper'),
                           'vfs://0': (3, b'opaque after')})
        m.validate_patched(old, new, 'drive-archive-api/index.ts')
        before, _, entry = m.executable_modules(old, 'drive-archive-api/index.ts')
        after, _, _ = m.executable_modules(new, 'drive-archive-api/index.ts')
        self.assertEqual(entry, '/bos-src/drive-archive-api/index.ts')
        self.assertEqual(set(after) - set(before), {'/bos-src/_shared/report-storage.ts'})

    def test_nested_function_keeps_its_existing_shared_module_and_payroll(self):
        relative = 'order-lifecycle-api/supabase/functions/order-lifecycle-api/index.ts'
        modules = {'supabase/functions/order-lifecycle-api/index.ts': (0, b'entry before'),
                   'supabase/functions/_shared/hands-details.ts': (0, b'existing helper'),
                   'order-payroll.js': (0, b'preserved payroll')}
        old, new = self.bundle(modules), self.bundle(copy.deepcopy(modules))
        new['modules']['supabase/functions/order-lifecycle-api/index.ts'] = (0, b'entry after')
        new['modules']['supabase/functions/_shared/report-storage.ts'] = (0, b'new helper')
        m.validate_patched(old, new, relative)
        new['modules']['order-payroll.js'] = (0, b'unrelated change')
        with self.assertRaisesRegex(s.Stop, 'PATCHED_DEPENDENCY_DRIFT'):
            m.validate_patched(old, new, relative)

    def test_rebased_entry_does_not_authorize_extra_code_or_missing_modules(self):
        old = self.bundle({'index.ts': (0, b'old'), 'extra.js': (0, b'keep')})
        new = self.bundle({'drive-archive-api/index.ts': (0, b'new'),
                           'drive-archive-api/extra.js': (0, b'keep'),
                           '_shared/report-storage.ts': (0, b'helper')})
        m.validate_patched(old, new, 'drive-archive-api/index.ts')
        new['modules']['unexpected.js'] = (0, b'extra unreviewed code')
        with self.assertRaisesRegex(s.Stop, 'PATCHED_MODULE_SET'):
            m.validate_patched(old, new, 'drive-archive-api/index.ts')
        del new['modules']['unexpected.js']
        del new['modules']['drive-archive-api/extra.js']
        with self.assertRaisesRegex(s.Stop, 'PATCHED_MODULE_SET'):
            m.validate_patched(old, new, 'drive-archive-api/index.ts')

    def test_rebased_entry_does_not_authorize_dependency_or_redirect_changes(self):
        old = self.bundle({'index.ts': (0, b'old')}, {'npm:sdk@1': 'npm:sdk@1.0.0'})
        new = self.bundle({'drive-archive-api/index.ts': (0, b'new')}, {'npm:sdk@1': 'npm:sdk@2.0.0'})
        with self.assertRaisesRegex(s.Stop, 'PATCHED_REDIRECT_DRIFT'):
            m.validate_patched(old, new, 'drive-archive-api/index.ts')
        new['npm_roots'] = {'sdk@1': 'sdk@1.1.0'}
        with self.assertRaisesRegex(s.Stop, 'PATCHED_NPM_DRIFT'):
            m.validate_patched(old, new, 'drive-archive-api/index.ts')

    def test_canonical_paths_cannot_escape_source_or_hide_duplicate_modules(self):
        for extra in ('../../outside.js', '../drive-archive-api/index.ts'):
            with self.subTest(extra=extra), self.assertRaises(s.Stop):
                m.executable_modules(self.bundle({'index.ts': (0, b'entry'), extra: (0, b'other')}),
                                     'drive-archive-api/index.ts')

    def test_shared_module_can_remain_parent_relative_without_rebasing(self):
        old = self.bundle({'index.ts': (0, b'old')})
        new = self.bundle({'index.ts': (0, b'new'), '../_shared/report-storage.ts': (0, b'helper')})
        m.validate_patched(old, new, 'report-file-upload/index.ts')

    def test_lockfile_pins_snapshot_roots_and_transitive_versions(self):
        graph = {'npm_roots': {'@supabase/supabase-js@2': '@supabase/supabase-js@2.117.3'},
                 'npm': {'@supabase/supabase-js@2.117.3': {'tslib': 'tslib@2.8.1'},
                         'tslib@2.8.1': {}}}
        locks = m.lockfile(graph, {n: 'sha512-dummy-integrity' for n in graph['npm']})
        self.assertEqual(locks['specifiers'], {'npm:@supabase/supabase-js@2': '2.117.3'})
        self.assertEqual(set(locks['npm']), set(graph['npm']))
        self.assertEqual(locks['npm']['@supabase/supabase-js@2.117.3']['dependencies'], ['tslib'])

    def test_multiple_versions_keep_dependency_target_explicit(self):
        graph = {'npm_roots': {'a@1': 'a@1.0.0'}, 'npm': {
            'a@1.0.0': {'b': 'b@1.0.0'}, 'b@1.0.0': {}, 'b@2.0.0': {}}}
        lock = m.lockfile(graph, {n: 'sha512-dummy' for n in graph['npm']})
        self.assertEqual(lock['npm']['a@1.0.0']['dependencies'], ['b@1.0.0'])

    def test_unsupported_package_ids_cannot_form_network_paths(self):
        for value in ('../private@1.0.0', 'https://secret@1.0.0', 'package@1.0.0_peer@2.0.0'):
            with self.subTest(value=value), self.assertRaises(s.Stop):
                m.split_package(value)

    def test_metadata_wrong_package_identity_is_rejected(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, _): return json.dumps({'name': 'different', 'version': '1.0.0'}).encode()
        with patch.object(m.urllib.request, 'urlopen', return_value=Response()), self.assertRaises(s.Stop):
            m.integrity('test@1.0.0')

    def test_serialization_order_only_is_accepted(self):
        self.assertTrue(m.equal_baseline(fixtures.fixture(), fixtures.fixture(reverse=True)))

    def test_code_graph_maps_paths_and_opaque_trailer_changes_are_rejected(self):
        original = fixtures.fixture()
        changes = [fixtures.fixture(code=b'changed'), fixtures.fixture(version='2.118.0'),
                   fixtures.fixture(map_text=b'changed map'), fixtures.fixture(root='file:///other/'),
                   original + b'new opaque trailer']
        for changed in changes:
            self.assertFalse(m.equal_baseline(original, changed))

    def test_existing_photo_helper_body_is_preserved(self):
        for name, prefix in (('master-report-patch.js', b'function safeReportHref(value){'),
                             ('report-review-patch.js', b'function safeHref(value){')):
            before, after = baseline(name), (REPO / name).read_bytes()
            custom = b"if(value&&String(value).startsWith('/storage/'))value=location.origin+value;"
            live = before.replace(prefix, prefix + custom)
            merged = m.merge_frontend(name, before, live, after)
            guard = b'if(window.BOS_REPORT_URL)return window.BOS_REPORT_URL(value);'
            expected = after.replace(prefix + guard, prefix + guard + custom).rstrip()
            self.assertEqual(merged, expected)

    def test_custom_report_link_markup_is_preserved_and_buttons_are_disabled(self):
        name = 'report-review-patch.js'
        before, after = baseline(name), (REPO / name).read_bytes()
        live = before.replace(b'const documents=links+photoGrid;', b"const documents=links+photoGrid+'<!-- private presentation -->';")
        merged = m.merge_frontend(name, before, live, after)
        self.assertEqual(merged, after.replace(b'const documents=links+photoGrid;', b"const documents=links+photoGrid+'<!-- private presentation -->';").rstrip())

    def test_current_server_function_routes_survive_lifecycle_update(self):
        name = 'order-lifecycle-v106.js'
        before, after = baseline(name), (REPO / name).read_bytes()
        old, new = b'https://obsropbslfwtanyspjbi.supabase.co', b'https://homemaster.qd.je'
        merged = m.merge_frontend(name, before, before.replace(old, new), after)
        self.assertEqual(merged, after.replace(old, new).rstrip())

    def test_conflicting_changes_are_not_overwritten(self):
        name = 'report-review-patch.js'
        before, after = baseline(name), (REPO / name).read_bytes()
        live = before.replace(b'window.retryDriveArchive=async function(id){', b'window.retryDriveArchive=async function(id){customArchiver();')
        with self.assertRaises(s.Stop):
            m.merge_frontend(name, before, live, after)

    def test_complete_frontend_candidate_retains_routing_and_has_valid_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            parent = Path(folder).resolve()
            web, work = parent / 'before/web', parent / 'locked'
            web.mkdir(parents=True)
            work.mkdir()
            names = ['master-report-patch.js', 'report-review-patch.js',
                     'order-lifecycle-v106.js', 'master-order-hands-layout-v72.js']
            router = b'window.BOS_RU_NETWORK={origin:location.origin,privateMigration:true};'
            bundle = b'// original private build\n;\n// Source: network-direct-v86.js\n' + router
            for name in [*names, 'approved-master-ui.css']:
                before, after = baseline(name), (REPO / name).read_bytes()
                s.write(parent / 'payload/before' / name, before)
                s.write(parent / 'payload/after' / name, after)
                (web / name).write_bytes(before)
                if name.endswith('.js'):
                    if name == 'master-report-patch.js':
                        before = before.replace(b'function safeReportHref(value){', b'function safeReportHref(value){/* private migration */')
                    bundle += b'\n;\n// Source: ' + name.encode() + b'\n' + before
            bundle += b'\n;\n// Source: tail.js\nvoid 0;\n'
            (web / 'startup-shell.bundle.js').write_bytes(bundle)
            build = 'a' * 20
            html = ('<html><meta name="bos-build-id" content="' + build + '"></html>').encode()
            (web / 'index.html').write_bytes(html)
            (web / 'sw.js').write_bytes(("const BUILD_ID='" + build + "';\n// preserve private worker\n").encode())
            meta = {'id': build, 'shell': s.sha(html), 'assets': {
                'startup-shell.bundle.js': s.sha(bundle),
                'approved-master-ui.css': s.sha((web / 'approved-master-ui.css').read_bytes())},
                'assetBundles': {name: 'startup-shell.bundle.js' for name in names}}
            (web / 'build-version.js').write_bytes(b'// Generated by npm run build. Do not edit.\nself.BOS_BUILD=' + json.dumps(meta).encode() + b';\n')
            s.write(parent / 'payload/after/report-origin.js', (REPO / 'report-origin.js').read_bytes())
            original = s.tree(web)
            with contextlib.redirect_stdout(io.StringIO()):
                result = m.prepare_frontend(parent, work)
            self.assertEqual(original, s.tree(web))
            candidate = work / 'candidate/web'
            new_bundle = (candidate / 'startup-shell.bundle.js').read_bytes()
            self.assertIn(router, new_bundle)
            self.assertIn(b'/* private migration */', new_bundle)
            self.assertLess(new_bundle.index(router), new_bundle.index(b'// Source: report-origin.js'))
            self.assertNotEqual(result['build'], build)
            self.assertIn(b'// preserve private worker', (candidate / 'sw.js').read_bytes())
            for name in result['changed_files']:
                if name.endswith('.js'):
                    proc = subprocess.run(['node', '--check', str(candidate / name)], capture_output=True)
                    self.assertEqual(proc.returncode, 0, name + ': ' + proc.stderr.decode())


if __name__ == '__main__':
    unittest.main()
