"""Offline checks for staging boundaries; no Docker daemon or network required."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
spec = importlib.util.spec_from_file_location('report_stage', HERE / 'stage.py')
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)


class StageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def fixture(self, version='before'):
        sources = self.root / 'live/edge/sources'
        entries = {}
        for slug in s.SLUGS:
            relative = (f'{slug}/supabase/functions/{slug}/index.ts'
                        if slug in ('report-api', 'order-lifecycle-api') else f'{slug}/index.ts')
            path = sources / relative
            path.parent.mkdir(parents=True)
            repo_path = f'supabase/functions/{slug}/index.ts'
            data = (subprocess.run(['git', 'show', s.BASE + ':' + repo_path], cwd=REPO,
                                   check=True, capture_output=True).stdout if version == 'before'
                    else (REPO / repo_path).read_bytes())
            path.write_bytes(data)
            entries[slug] = relative
        return sources, entries

    def test_mixed_actual_layout_resolves_without_flattening(self):
        sources, expected = self.fixture()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(s.source_inventory(sources), expected)

    def test_unknown_live_patch_stops_before_stage_writes(self):
        sources, entries = self.fixture()
        (sources / entries['report-api']).write_text('private custom report implementation')
        before = s.tree(self.root / 'live')
        with contextlib.redirect_stdout(io.StringIO()) as out, self.assertRaises(s.Stop):
            s.source_inventory(sources)
        self.assertIn('SOURCE_DIFFERENCES', out.getvalue())
        self.assertNotIn('private custom report implementation', out.getvalue())
        self.assertEqual(before, s.tree(self.root / 'live'))

    def test_duplicate_entrypoints_are_not_guessed(self):
        sources, _ = self.fixture()
        (sources / 'report-api/index.ts').write_text('other')
        with self.assertRaises(s.Stop):
            s.entrypoint(sources, 'report-api')

    def test_symlinked_source_is_rejected(self):
        sources, entries = self.fixture()
        path = sources / entries['report-api']
        target = self.root / 'target.ts'
        path.rename(target)
        path.symlink_to(target)
        with self.assertRaises(s.Stop):
            s.entrypoint(sources, 'report-api')

    def test_symlinked_directory_cannot_escape_tree_snapshot(self):
        root = self.root / 'tree'
        root.mkdir()
        (root / 'external').symlink_to(HERE, target_is_directory=True)
        with self.assertRaises(s.Stop):
            s.tree(root)

    def test_pinned_manifest_matches_all_application_files(self):
        for name, versions in s.ASSETS.items():
            self.assertEqual(s.sha((REPO / name).read_bytes()), versions['after'], name)
            if versions['before']:
                baseline = subprocess.run(['git', 'show', s.BASE + ':' + name], cwd=REPO,
                                          check=True, capture_output=True).stdout
                self.assertEqual(s.sha(baseline), versions['before'], name)

    def test_shared_helper_is_added_at_each_import_location_only_in_candidate(self):
        sources, entries = self.fixture()
        baseline = s.tree(self.root / 'live')
        stage = self.root / 'stage'
        shutil.copytree(sources, stage / 'candidate/edge/sources')
        for name in s.ASSETS:
            if '/functions/' in name:
                s.write(stage / 'payload/after' / name, (REPO / name).read_bytes())
        s.patch_sources(stage, entries)
        candidate = stage / 'candidate/edge/sources'
        expected = (REPO / 'supabase/functions/_shared/report-storage.ts').read_bytes()
        for slug in ('order-lifecycle-api', 'report-api'):
            self.assertEqual((candidate / slug / 'supabase/functions/_shared/report-storage.ts').read_bytes(), expected)
        self.assertEqual((candidate / '_shared/report-storage.ts').read_bytes(), expected)
        self.assertEqual(s.tree(self.root / 'live'), baseline)

    def test_unknown_existing_helper_is_preserved(self):
        sources, entries = self.fixture()
        stage = self.root / 'stage'
        shutil.copytree(sources, stage / 'candidate/edge/sources')
        for name in s.ASSETS:
            if '/functions/' in name:
                s.write(stage / 'payload/after' / name, (REPO / name).read_bytes())
        helper = stage / 'candidate/edge/sources/order-lifecycle-api/supabase/functions/_shared/report-storage.ts'
        s.write(helper, b'other helper')
        with self.assertRaises(s.Stop):
            s.patch_sources(stage, entries)
        self.assertEqual(helper.read_bytes(), b'other helper')

    def test_download_digest_rejects_changed_remote_content(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, maximum): return b'not the pinned artifact'
        with patch.object(s.urllib.request, 'urlopen', return_value=Response()), self.assertRaises(s.Stop):
            s.download('report-origin.js', 'after')

    def test_failed_command_details_do_not_reach_console(self):
        result = subprocess.CompletedProcess([], 1, b'SECRET_RESPONSE', b'SECRET_ERROR')
        stage = self.root / 'stage'
        with patch.object(s.subprocess, 'run', return_value=result), self.assertRaises(s.Stop) as caught:
            s.command(['fake'], stage, 'build')
        self.assertEqual(str(caught.exception), 'build_FAILED')
        self.assertEqual((stage / 'logs/build.log').stat().st_mode & 0o777, 0o600)

    def test_changed_baseline_bundle_stops_before_patched_build_and_removes_builder(self):
        stage = self.root / 'stage'
        stage.mkdir()
        s.write(stage / 'before/edge/bundles/report-api.eszip', b'live bundle')
        calls = []
        def command(args, *other):
            calls.append(args)
            if 'bundle' in args:
                (stage / 'output/report-api.eszip').write_bytes(b'different dependency graph')
            return b'fake container id'
        with patch.object(s, 'command', side_effect=command), patch.object(s, 'patch_sources') as modify:
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(s.Stop) as caught:
                s.compile_sources(stage, {'Image': 'sha256:' + 'a' * 64}, {'report-api': 'report-api/index.ts'})
            self.assertEqual(str(caught.exception), 'BUNDLE_BASELINE_DIFFERS_report-api')
            modify.assert_not_called()
        self.assertEqual(calls[-1][:3], ['docker', 'rm', '-f'])
        self.assertFalse(any('restart' in args or 'stop' in args for args in calls))


if __name__ == '__main__':
    unittest.main()
