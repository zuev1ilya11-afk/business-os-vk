import importlib
from pathlib import Path
import tempfile
import unittest


class EdgeTrialTests(unittest.TestCase):
    def setUp(self):self.m=importlib.import_module('edge_trial')

    def test_builder_mounts_only_sources_output_cache_without_credentials(self):
        args=self.m.build_args('bos-service-trial-test-build-a','sha256:'+'a'*64,Path('/private/edge'),
                               'a',{'entrypoint':'src/index.ts','import_map':'src/deno.json'})
        self.assertNotIn('--env-file',args)
        self.assertEqual(args[args.index('--network')+1],'bridge')
        mounts=[args[i+1] for i,x in enumerate(args) if x=='--mount']
        self.assertEqual(len(mounts),3)
        self.assertTrue(any('source=/private/edge/sources/a,target=/bos-src/a,readonly' in x for x in mounts))
        self.assertFalse(any('secrets' in x or '/data' in x or '/config' in x for x in mounts))
        self.assertIn('/bos-src/a/src/index.ts',args)
        self.assertIn('/bos-src/a/src/deno.json',args)

    def test_builder_cannot_resolve_sibling_tree_but_keeps_own_root_imports(self):
        from pathlib import PurePosixPath
        import posixpath
        args=self.m.build_args('bos-service-trial-test-build-a','sha256:'+'a'*64,Path('/private/edge'),
                              'a',{'entrypoint':'supabase/functions/a/index.ts','import_map':None})
        mounts=[dict(item.split('=',1) for item in args[i+1].split(',') if '=' in item)
                for i,x in enumerate(args) if x=='--mount']
        def mounted_path(importer,specifier):
            target=PurePosixPath(posixpath.normpath(str(PurePosixPath(importer).parent/specifier)))
            matches=[m for m in mounts if target.is_relative_to(m['target'])]
            return None if not matches else matches[0]['source']+'/'+str(target.relative_to(matches[0]['target']))
        self.assertIsNone(mounted_path('/bos-src/a/src/index.ts','../../b/index.ts'))
        self.assertEqual(mounted_path('/bos-src/a/supabase/functions/a/index.ts','../../../shared.js'),
                         '/private/edge/sources/a/shared.js')

    def test_runtime_shares_only_offline_clone_namespace(self):
        args=self.m.runtime_args('bos-service-trial-test-edge','sha256:'+'a'*64,Path('/private/edge'),'b'*64)
        self.assertEqual(args[args.index('--network')+1],'container:'+'b'*64)
        self.assertNotIn('-p',args);self.assertNotIn('--publish',args)
        mounts=[args[i+1] for i,x in enumerate(args) if x=='--mount']
        self.assertTrue(all(x.endswith(',readonly') for x in mounts))
        self.assertFalse(any('cache' in x for x in mounts))

    def test_fixture_scope_cleans_even_when_probe_raises_and_rejects_changed_rows(self):
        events=[]
        class Runner:
            def sql(self,db,query):
                events.append(query)
                class Result:stdout=b'{"staff":"abc","orders":"def","rate":"ghi"}'
                return Result()
        def fail():raise RuntimeError('probe failed')
        fixture=self.m.new_fixture()
        with self.assertRaisesRegex(RuntimeError,'probe failed'):
            self.m.with_fixture(Runner(),'db',fixture,fail)
        self.assertEqual(len(events),4) # baseline, create, cleanup, exact postcheck
        self.assertIn(fixture['id'],events[1]);self.assertIn(fixture['id'],events[2])
        self.assertIn(fixture['rate_hash'],events[2])
        class Changed(Runner):
            def sql(self,db,query):
                r=super().sql(db,query)
                if len(events)==4:r.stdout=b'{"staff":"changed","orders":"def","rate":"ghi"}'
                return r
        events.clear()
        with self.assertRaisesRegex(ValueError,'rows changed'):
            self.m.with_fixture(Changed(),'db',fixture,lambda:True)


if __name__=='__main__':unittest.main()
