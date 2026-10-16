"""Cached installer build regression checks; Docker is an explicit boundary fake."""
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import test_bundle_diagnose as fixtures
from test_bundle_diagnose import HERE, diagnostic, f, b


class CachedBuildTests(unittest.TestCase):
    def setUp(self):
        fixtures.DiagnosticTests.setUp(self)
        self.stage_patch = patch.object(b, 'STAGE', self.parent/'contact-295-api')
        self.stage_patch.start()
        b.STAGE.mkdir()
        f.copy_tree(self.sources, b.STAGE/'sources')
        (b.STAGE/'bundles').mkdir()
        (b.STAGE/'bundles'/diagnostic.FILENAME).write_bytes(self.old)
        self.rec['nonce'] = 'b'*32
        self.patched = (HERE/'package/api-after.ts').read_bytes()
        self.compiled = b'compiled candidate fixture'*10
        self.before = f.snapshot(self.sources)
        self.cache_before = f.snapshot(self.cache)
        self.events = []
        self.baseline_output = self.old

    def tearDown(self):
        self.stage_patch.stop()
        fixtures.DiagnosticTests.tearDown(self)

    def command(self, args, label, **kwargs):
        self.events.append(label)
        if label == 'build-start':
            self.assertEqual(args[args.index('--network')+1], 'none')
            self.assertEqual(args[args.index('--env')+1], 'DENO_DIR=/bos-cache')
            self.assertNotIn('--env-file', args)
            mounts = [args[i+1] for i, item in enumerate(args) if item == '--mount']
            self.assertEqual(len(mounts), 3)
            self.assertTrue(all('src='+str(b.STAGE)+'/' in item for item in mounts))
            self.assertTrue(any(item.endswith('dst=/bos-src/master-workflow-api,readonly') for item in mounts))
            self.assertEqual((b.STAGE/'cache/dependency.txt').read_text(), 'original cache')
            return b'private-builder'
        self.assertEqual(args[:4], ['docker','exec','private-builder','edge-runtime'])
        self.assertIn('isolated', self.events)
        self.assertEqual(args[args.index('--output')+1], '/bos-bundles/'+diagnostic.FILENAME)
        source = b.STAGE/'sources'/diagnostic.SLUG/diagnostic.ENTRY
        if label == 'baseline-build':
            self.assertEqual(source.read_bytes(), (HERE/'package/api-before.ts').read_bytes())
            data = self.baseline_output
            (b.STAGE/'cache/dependency.txt').write_text('private cache used')
        elif label == 'patched-build':
            self.assertEqual(source.read_bytes(), self.patched)
            self.assertEqual((b.STAGE/'cache/dependency.txt').read_text(), 'private cache used')
            data = self.compiled
        else:
            self.fail('Unexpected compiler operation: '+label)
        (b.STAGE/'output'/diagnostic.FILENAME).write_bytes(data)
        return b''

    def run_build(self):
        with patch.object(b, 'private_command', side_effect=self.command), \
             patch.object(b, 'assert_isolated', side_effect=lambda cid:self.events.append('isolated')), \
             patch.object(b, 'cleanup', side_effect=lambda rec:self.events.append('cleanup')):
            b.compile_candidate(self.rec, self.patched)

    def test_baseline_and_candidate_share_private_original_cache_without_network(self):
        self.run_build()
        self.assertEqual(self.events, ['build-start','isolated','baseline-build','patched-build','cleanup'])
        self.assertEqual((b.STAGE/'bundles'/diagnostic.FILENAME).read_bytes(), self.compiled)
        self.assertEqual(f.snapshot(self.cache), self.cache_before)
        self.assertEqual(f.snapshot(self.sources), self.before)

    def test_baseline_mismatch_still_prevents_patch_compilation(self):
        self.baseline_output = b'changed dependency bytes'
        with self.assertRaisesRegex(f.Stop, 'Baseline bundle rebuild differs'):
            self.run_build()
        self.assertNotIn('patched-build', self.events)
        self.assertEqual(self.events[-1], 'cleanup')
        self.assertEqual((b.STAGE/'sources'/diagnostic.SLUG/diagnostic.ENTRY).read_bytes(),
                         (HERE/'package/api-before.ts').read_bytes())
        self.assertEqual((b.STAGE/'bundles'/diagnostic.FILENAME).read_bytes(), self.old)
        self.assertEqual(f.snapshot(self.cache), self.cache_before)

    def test_unmatched_original_image_stops_before_starting_any_container(self):
        (self.edge/'image.json').write_text(json.dumps({'image_id':'sha256:another'}))
        with self.assertRaisesRegex(f.Stop, 'original build cache'):
            self.run_build()
        self.assertEqual(self.events, [])

    def test_symlinked_cache_is_rejected_before_starting_any_container(self):
        target = self.parent/'unrelated'
        target.mkdir()
        (target/'data').write_text('do not import unrelated files')
        (self.cache/'unexpected').symlink_to(target, target_is_directory=True)
        with self.assertRaisesRegex(f.Stop, 'Symlink or special file'):
            self.run_build()
        self.assertEqual(self.events, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
