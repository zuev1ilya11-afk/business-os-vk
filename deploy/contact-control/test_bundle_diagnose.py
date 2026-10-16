"""Diagnostic safety checks with filesystem fixtures and no Docker daemon."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE/'package'))
import frontend as f
import backend as b

spec = importlib.util.spec_from_file_location('diagnostic', HERE/'bundle-diagnose.py')
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)
diagnostic.f, diagnostic.b = f, b


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.parent = Path(self.temp.name)
        self.patch = patch.object(f, 'PARENT', self.parent)
        self.patch.start()
        self.edge = self.parent/'service-trial-test/edge'
        self.cache = self.edge/'cache'
        self.cache.mkdir(parents=True)
        (self.cache/'dependency.txt').write_text('original cache')
        self.sources = self.parent/'release-test/edge/sources'
        source = self.sources/diagnostic.SLUG
        (source/diagnostic.ENTRY).parent.mkdir(parents=True)
        (source/diagnostic.ENTRY).write_bytes((HERE/'package/api-before.ts').read_bytes())
        (source/'order-payroll.js').write_bytes((HERE/'fixtures/order-payroll.ru.js').read_bytes())
        f.copy_tree(self.sources, self.edge/'sources')
        (self.edge/'bundles').mkdir()
        self.old = b'ESZIP_V2 original baseline contents'
        (self.edge/'bundles'/diagnostic.FILENAME).write_bytes(self.old)
        (self.edge/'image.json').write_text(json.dumps({'image_id':'sha256:known'}))
        self.rec = {'image':'sha256:known', 'roots':{'sources':str(self.sources)},
                    'before':{'bundles':{diagnostic.FILENAME:{'sha256':f.sha(self.old)}}}}

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def test_only_matching_image_source_and_bundle_select_original_cache(self):
        with patch.object(f, 'emit'):
            self.assertEqual(diagnostic.find_cache(self.rec), self.cache)
            for path in [self.edge/'image.json', self.edge/'bundles'/diagnostic.FILENAME,
                         self.edge/'sources'/diagnostic.SLUG/'order-payroll.js']:
                before = path.read_bytes()
                path.write_bytes(b'not the original release')
                with self.assertRaisesRegex(f.Stop, 'uniquely match cache'):
                    diagnostic.find_cache(self.rec)
                path.write_bytes(before)

    def test_build_mounts_only_private_copies_without_network_or_credentials(self):
        work = self.parent/'private-copy'
        args = diagnostic.offline_args(self.rec, work, 'a'*32)
        self.assertEqual(args[args.index('--network')+1], 'none')
        self.assertNotIn('--env-file', args)
        mounts = [args[i+1] for i, item in enumerate(args) if item == '--mount']
        self.assertEqual(len(mounts), 3)
        self.assertTrue(all('src='+str(work)+'/' in item for item in mounts))
        self.assertTrue(any(item.endswith('dst=/bos-src/master-workflow-api,readonly') for item in mounts))
        self.assertEqual(args[args.index('--env')+1], 'DENO_DIR=/bos-cache')

    def run_trial(self, outputs):
        before = f.snapshot(self.cache)
        source_before = f.snapshot(self.sources)
        built = []
        cleaned = []
        def command(args, label, **kwargs):
            if label == 'diagnostic-start':
                return b'isolated-container'
            self.assertEqual(args[:4], ['docker','exec','isolated-container','edge-runtime'])
            # The runtime may write to its private cache, never the original.
            (b.STAGE/'cache/dependency.txt').write_text('private runtime write')
            (b.STAGE/'bundles'/diagnostic.FILENAME).write_bytes(outputs[len(built)])
            built.append(label)
            return b''
        with patch.object(f, 'emit'), patch.object(b, 'private_command', side_effect=command), \
             patch.object(b, 'assert_isolated'), patch.object(b, 'check'), \
             patch.object(b, 'cleanup', side_effect=lambda rec:cleaned.append(rec)):
            diagnostic.offline_trial(self.rec, self.old)
        self.assertEqual(f.snapshot(self.cache), before)
        self.assertEqual(f.snapshot(self.sources), source_before)
        self.assertEqual(len(cleaned), 1)
        work = next(self.parent.glob('contact-295-diagnose-*'))
        return json.loads((work/'result.json').read_text()), built

    def test_identical_offline_build_stops_after_one_attempt_and_preserves_inputs(self):
        result, built = self.run_trial([self.old])
        self.assertTrue(result['matches_live'])
        self.assertEqual(len(built), 1)

    def test_mismatch_is_reported_without_activation_after_second_build(self):
        result, built = self.run_trial([b'different build one', b'different build two'])
        self.assertFalse(result['matches_live'])
        self.assertEqual(len(built), 2)
        self.assertNotEqual(result['attempt_1'], result['attempt_2'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
