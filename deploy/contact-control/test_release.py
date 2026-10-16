"""Filesystem integration tests; Docker/network boundaries are explicit fakes."""
import copy
import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'package'))
import frontend as f
import backend as b
import release as r
import database as d

META = json.loads((HERE/'package/release.json').read_text())
with zipfile.ZipFile(HERE/'bos295.pyz') as archive:
    FILES = {n: archive.read('payload/'+n) for n in META['after']}
BASE_FILES = {n: ('pinned baseline fixture: '+n+'\n').encode() for n in META['before']}
META['before'] = {n:f.sha(data) for n,data in BASE_FILES.items()}
OPTIONAL = {}
PATCHED = (HERE/'package/api-after.ts').read_bytes()
BASELINE = (HERE/'package/api-before.ts').read_bytes()
MIGRATION = (HERE/'package/migration.sql').read_text()
REAL_COMMAND = f.command
REAL_PROBE_CANDIDATE = b.probe_candidate


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.parent = Path(self.temp.name)
        self.root = self.parent/'release-test/web'
        self.root.mkdir(parents=True)
        for n in META['before']:
            (self.root/n).write_bytes(BASE_FILES[n])
        (self.root/'unrelated.txt').write_text('retain runtime settings')
        self.edge = dict(Id='edge-id', Name='/bos-release-test-edge', Image='sha256:fixed',
                         Config={'Image':'edge:tag', 'Env':['VK_APP_SECRET=preserve-secret',
                                 'SUPABASE_URL=http://existing-rest','SUPABASE_SERVICE_ROLE_KEY=fixture-key',
                                 'BOS_AUTH_ORIGIN=http://bos-release-test-auth:9999',
                                 'BOS_REST_ORIGIN=http://bos-release-test-rest:3000',
                                 'BOS_STORAGE_ORIGIN=http://bos-release-test-storage:5000'],
                                 'Entrypoint':['edge-runtime'], 'Cmd':['start','--main-service','/bos-main']},
                         HostConfig={'NetworkMode':'existing'}, Mounts=[], State={'Running':True, 'Pid':123})
        self.web = dict(Id='web-id', Name='/bos-release-test-https',
                        Config={'Image':'caddy:2'}, HostConfig={},
                        Mounts=[dict(Type='bind', Source=str(self.root), Destination='/srv')], State={'Running':True})
        self.roots = {}
        for folder, mount in b.MOUNTS.items():
            path = self.root.parent/'edge'/folder
            path.mkdir(parents=True)
            self.roots[folder] = str(path)
            self.edge['Mounts'].append(dict(Type='bind', Source=str(path), Destination=mount))
        (Path(self.roots['sources'])/'master-workflow-api/supabase/functions/master-workflow-api').mkdir(parents=True)
        (Path(self.roots['sources'])/'master-workflow-api/order-payroll.js').write_bytes((HERE.parent.parent/'order-payroll.js').read_bytes())
        (Path(self.roots['sources'])/'master-workflow-api/supabase/functions/master-workflow-api/index.ts').write_bytes(BASELINE)
        (Path(self.roots['sources'])/'other-api.ts').write_text('unchanged private handler')
        (Path(self.roots['bundles'])/'master-workflow-api.eszip').write_bytes(b'old-bundle'*20)
        (Path(self.roots['bundles'])/'other.eszip').write_bytes(b'unchanged compiled handler')
        (Path(self.roots['main'])/'index.ts').write_text('Deno.serve; /bos-bundles/ .eszip')
        f.PARENT = self.parent
        f.STAGE = self.parent/'contact-295-web'
        b.STAGE = self.parent/'contact-295-api'
        d.STAGE = self.parent/'contact-295-db'
        self.db_state = {'config': False, 'flags': {'enabled': False, 'reminders_enabled': False}}
        self.db_events = []
        self.before = f.snapshot(self.root)
        self.backend_before = {k: f.snapshot(Path(p)) for k,p in self.roots.items()}
        self.restarts = []
        self.fail_restart = None
        self.fail_http = False
        self.info = dict(container=self.edge['Id'], fingerprint=f.fingerprint(self.edge),
                         image=self.edge['Image'], config=copy.deepcopy(self.edge['Config']),
                         roots=self.roots, before=self.backend_before, environment={})
        self.patches = [patch.object(f,'command',self.command), patch.object(f,'http_get',self.http_get),
                        patch.object(f,'emit',lambda x:None), patch.object(b,'compile_candidate',self.compile),
                        patch.object(b,'probe_candidate',lambda rec:None),
                        patch.object(b,'probe_live',lambda rec,cors=True:None),
                        patch.object(d,'prepare',self.db_prepare), patch.object(d,'apply',self.db_apply),
                        patch.object(d,'verify_off',lambda rec: None),
                        patch.object(d,'inspect_schema',lambda rec: self.db_state),
                        patch.object(d,'retain_off',self.db_retain)]
        for p in self.patches: p.start()

    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()

    def command(self, args, timeout=60):
        if args[0] != 'docker': return REAL_COMMAND(args,timeout)
        if args[1:3] == ['ps','-q']: return b'web-id edge-id\n'
        if args[1:3] == ['ps','-aq']: return b''
        if args[1] == 'inspect':
            data = {'web-id':self.web, 'edge-id':self.edge}
            return json.dumps([data[cid] for cid in args[2:]]).encode()
        if args[1] == 'restart':
            cid = args[-1]
            self.restarts.append(cid)
            if cid == self.fail_restart:
                self.fail_restart = None
                raise f.Stop('simulated restart failure')
            return cid.encode()
        if args[1] == 'exec' and args[-2:] == ['cat','/srv/build-version.js']:
            return (self.root/'build-version.js').read_bytes()
        if args[1:4] == ['exec','edge-id','sha256sum']:
            mounted=args[4]
            folder=next(k for k,v in b.MOUNTS.items() if mounted.startswith(v+'/'))
            path=Path(self.roots[folder])/mounted.removeprefix(b.MOUNTS[folder]+'/')
            return (f.sha(path.read_bytes())+'  '+mounted+'\n').encode()
        raise AssertionError('unexpected action: '+str(args))

    def http_get(self, origin, name):
        if self.fail_http and name == 'order-control.js':
            self.fail_http = False
            return b'wrong public content'
        return (self.root/name).read_bytes()

    def compile(self, rec, patched):
        (b.STAGE/'sources/master-workflow-api/supabase/functions/master-workflow-api/index.ts').write_bytes(patched)
        (b.STAGE/'bundles/master-workflow-api.eszip').write_bytes(b'new-compiled-bundle'*20)

    def db_prepare(self, info):
        self.db_events.append('backup')
        d.STAGE.mkdir(mode=0o700)
        rec={'main_sha':f.MAIN,'state':'prepared','restarts_before':len(self.restarts)}
        d.save(rec)
        return rec

    def db_apply(self, rec, migration):
        self.db_events.append('migration')
        self.assertEqual(migration, MIGRATION)
        self.assertEqual(len(self.restarts), rec['restarts_before'])
        self.db_state['config']=True
        rec['state']='applied';d.save(rec)

    def db_retain(self, rec):
        self.db_events.append('retain-off')
        self.db_state['flags']={'enabled':False,'reminders_enabled':False}
        rec['state']='retained_off' if self.db_state['config'] else 'not_applied'
        d.save(rec)

    def test_db_backup_failure_cannot_activate_api_or_frontend(self):
        rec=self.prepare()
        with patch.object(d,'prepare',side_effect=f.Stop('backup failed')):
            with self.assertRaises(f.Stop):r.activate_all(META,FILES,OPTIONAL,rec,{},MIGRATION)
        self.assertEqual(self.restarts,[])
        self.assertFalse(self.db_state['config'])
        self.assertEqual(f.snapshot(self.root),self.before)

    def test_lost_commit_reply_retains_schema_and_restores_files(self):
        rec=self.prepare()
        def lost_reply(database,migration):
            self.db_apply(database,migration)
            raise f.Stop('lost reply after database commit')
        with patch.object(d,'apply',side_effect=lost_reply):
            with self.assertRaises(f.Stop):r.activate_all(META,FILES,OPTIONAL,rec,{},MIGRATION)
        self.assertTrue(self.db_state['config'])
        self.assertFalse(any(self.db_state['flags'].values()))
        self.assertEqual(self.restarts,[])
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def prepare(self): return b.prepare(self.info,PATCHED)

    def test_discover_accepts_observed_nested_edge_layout_without_mutations(self):
        info=b.discover(self.root)
        self.assertEqual(info['roots'],self.roots)
        self.assertEqual(info['before'],self.backend_before)
        self.assertFalse(b.STAGE.exists())
        self.assertFalse(f.STAGE.exists())
        self.assertEqual(self.restarts,[])

    def test_candidate_preserves_gateway_origins_without_production_credentials(self):
        original=copy.deepcopy(self.edge)
        actual=b.discover(self.root)['environment']
        live=dict(x.split('=',1) for x in self.edge['Config']['Env'])
        for name in ['BOS_AUTH_ORIGIN','BOS_REST_ORIGIN','BOS_STORAGE_ORIGIN']:
            self.assertEqual(actual[name],live[name])
        for name in ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VK_APP_SECRET']:
            self.assertNotEqual(actual[name],live[name])
        self.assertFalse(any(v in actual.values() for v in ['preserve-secret','fixture-key']))
        self.assertEqual(self.edge,original)
        self.assertEqual(self.restarts,[])
        self.assertFalse(b.STAGE.exists())

    def test_candidate_rejects_origins_with_credentials_paths_or_non_http_schemes(self):
        original=list(self.edge['Config']['Env'])
        for value in ['http://user:password@service:9999','http://service:9999/private',
                      'http://service:9999?token=secret','http://service:9999#secret',
                      'file:///etc/passwd','http://service:99999','http://service:0',
                      'http://service:9999\n','http://','http://service:9999?','http://service:9999#']:
            with self.subTest(value=value):
                self.edge['Config']['Env']=[x for x in original if not x.startswith('BOS_AUTH_ORIGIN=')]
                self.edge['Config']['Env'].append('BOS_AUTH_ORIGIN='+value)
                with self.assertRaisesRegex(f.Stop,'credential-free base URL'):
                    b.discover(self.root)
        self.assertEqual(self.restarts,[])
        self.assertFalse(b.STAGE.exists())

    def test_candidate_rejects_missing_private_service_origin(self):
        original=list(self.edge['Config']['Env'])
        for name in ['BOS_AUTH_ORIGIN','BOS_REST_ORIGIN','BOS_STORAGE_ORIGIN']:
            with self.subTest(name=name):
                self.edge['Config']['Env']=[x for x in original if not x.startswith(name+'=')]
                with self.assertRaisesRegex(f.Stop,'credential-free base URL'):
                    b.discover(self.root)

    def test_candidate_probe_retains_no_network_and_readonly_staging_mounts(self):
        rec=b.discover(self.root)
        rec['nonce']='a'*32
        commands=[]
        def run(args,label,**kwargs):
            commands.append(args)
            return b'temporary-container'
        with patch.object(b,'private_command',side_effect=run), \
             patch.object(b,'assert_isolated',return_value=123), \
             patch.object(b,'probe',return_value=True):
            REAL_PROBE_CANDIDATE(rec)
        args=commands[0]
        self.assertEqual(args[args.index('--network')+1],'none')
        self.assertEqual(args[args.index('--pull=never')],'--pull=never')
        mounts=[args[i+1] for i,v in enumerate(args) if v=='--mount']
        self.assertEqual(len(mounts),3)
        self.assertTrue(all('src='+str(b.STAGE)+'/' in m and m.endswith(',readonly') for m in mounts))
        self.assertNotIn('--env-file',args)
        self.assertEqual(self.restarts,[])

    def test_discover_rejects_mount_from_another_release(self):
        self.edge['Mounts'][0]['Source']=str(self.parent/'release-other/edge/sources')
        with self.assertRaises(f.Stop): b.discover(self.root)
        self.assertEqual(self.restarts,[])

    def test_discover_rejects_wrong_edge_directory(self):
        self.edge['Mounts'][0]['Source']=str(self.root.parent/'edge/main')
        with self.assertRaises(f.Stop): b.discover(self.root)

    def test_discover_rejects_symlinked_edge_mount(self):
        source=Path(self.roots['sources'])
        moved=source.with_name('sources-moved')
        source.rename(moved)
        source.symlink_to(moved,target_is_directory=True)
        with self.assertRaises(f.Stop): b.discover(self.root)

    def test_discover_rejects_overlay_below_source_mount(self):
        self.edge['Mounts'].append(dict(Type='bind',Source='/unexpected',Destination='/bos-src/master-workflow-api'))
        with self.assertRaises(f.Stop): b.discover(self.root)

    def test_frontend_readonly_preflight(self):
        f.preflight(META,OPTIONAL)
        self.assertFalse(f.STAGE.exists())
        self.assertEqual(f.snapshot(self.root),self.before)

    def test_frontend_atomic_apply_and_rollback(self):
        f.apply(META,FILES,OPTIONAL)
        rec=json.loads((f.STAGE/'journal.json').read_text())
        self.assertEqual(rec['state'],'active')
        self.assertEqual((self.root/'unrelated.txt').read_text(),'retain runtime settings')
        f.restore(META,rec)
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual(self.restarts,['web-id','web-id'])

    def test_frontend_http_failure_rolls_back(self):
        self.fail_http=True
        with self.assertRaises(f.Stop): f.apply(META,FILES,OPTIONAL)
        self.assertEqual(f.snapshot(self.root),self.before)

    def test_frontend_restart_failure_rolls_back(self):
        self.fail_restart='web-id'
        with self.assertRaises(f.Stop): f.apply(META,FILES,OPTIONAL)
        self.assertEqual(f.snapshot(self.root),self.before)

    def test_frontend_drift_stops_before_backup(self):
        (self.root/'order-control.js').write_text('other approved version')
        with self.assertRaises(f.Stop): f.apply(META,FILES,OPTIONAL)
        self.assertFalse(f.STAGE.exists())

    def test_frontend_rollback_refuses_later_changes(self):
        f.apply(META,FILES,OPTIONAL)
        rec=json.loads((f.STAGE/'journal.json').read_text())
        (self.root/'unrelated.txt').write_text('later deployment')
        with self.assertRaises(f.Stop): f.restore(META,rec)
        self.assertEqual((self.root/'unrelated.txt').read_text(),'later deployment')

    def test_prepare_retains_production_files_and_config(self):
        config=copy.deepcopy(self.edge)
        rec=self.prepare()
        self.assertEqual(rec['state'],'prepared')
        self.assertEqual(self.edge,config)
        self.assertEqual(self.restarts,[])
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def test_backend_activation_rollback_preserves_every_other_file_and_mode(self):
        rec=self.prepare()
        b.activate(rec)
        self.assertEqual(rec['state'],'active')
        self.assertEqual((Path(self.roots['sources'])/'master-workflow-api/supabase/functions/master-workflow-api/index.ts').read_bytes(),PATCHED)
        b.restore(rec)
        self.assertEqual(rec['state'],'rolled_back')
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)
        self.assertEqual(self.restarts,['edge-id','edge-id'])

    def test_backend_unrelated_drift_blocks_activation(self):
        rec=self.prepare()
        p=Path(self.roots['sources'])/'other-api.ts'
        p.write_text('later hotfix')
        with self.assertRaises(f.Stop): b.activate(rec)
        self.assertEqual(p.read_text(),'later hotfix')
        self.assertEqual(self.restarts,[])

    def test_backend_config_drift_blocks_activation(self):
        rec=self.prepare()
        self.edge['Config']['Env']=['different settings']
        with self.assertRaises(f.Stop): b.activate(rec)
        self.assertEqual(self.restarts,[])

    def test_backend_backup_corruption_blocks_rollback(self):
        rec=self.prepare()
        b.activate(rec)
        (b.STAGE/'backup/index.ts').write_text('corrupt')
        with self.assertRaises(f.Stop): b.restore(rec)
        self.assertEqual(len(self.restarts),1)

    def test_interruption_between_backend_file_replacements_is_recoverable(self):
        rec=self.prepare()
        rec['state']='activating'
        b.save(rec)
        p=Path(self.roots['sources'])/'master-workflow-api/supabase/functions/master-workflow-api/index.ts'
        f.write_candidate(p.parent,p.name,PATCHED,p.stat())
        b.restore(rec)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def test_backend_later_target_drift_refuses_rollback(self):
        rec=self.prepare()
        b.activate(rec)
        p=Path(self.roots['sources'])/'master-workflow-api/supabase/functions/master-workflow-api/index.ts'
        p.write_text('another deployment')
        with self.assertRaises(f.Stop): b.restore(rec)
        self.assertEqual(p.read_text(),'another deployment')

    def test_compile_failure_never_touches_production(self):
        with patch.object(b,'compile_candidate',side_effect=f.Stop('baseline mismatch')):
            with self.assertRaises(f.Stop): self.prepare()
        self.assertEqual(self.restarts,[])
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def test_combined_frontend_failure_restores_both_components(self):
        rec=self.prepare()
        self.fail_http=True
        with self.assertRaises(f.Stop): r.activate_all(META,FILES,OPTIONAL,rec,{},MIGRATION)
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def test_combined_edge_restart_failure_restores_backend(self):
        rec=self.prepare()
        self.fail_restart='edge-id'
        with self.assertRaises(f.Stop): r.activate_all(META,FILES,OPTIONAL,rec,{},MIGRATION)
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def test_combined_success_and_rollback(self):
        rec=self.prepare()
        r.activate_all(META,FILES,OPTIONAL,rec,{},MIGRATION)
        r.rollback_all(META)
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def test_api_payload_matches_reviewed_source(self):
        self.assertEqual(f.sha(BASELINE),b.SOURCE_BEFORE)
        self.assertEqual(f.sha(PATCHED),b.SOURCE_AFTER)
        self.assertEqual(PATCHED,(HERE.parent.parent/'supabase/functions/master-workflow-api/index.ts').read_bytes())

    def test_distributed_package_matches_reviewed_source_and_hashes(self):
        with zipfile.ZipFile(HERE/'bos295.pyz') as archive:
            for name in ['frontend.py','backend.py','release.py','__main__.py','api-before.ts','api-after.ts','database.py','migration.sql','preflight.py','release.json']:
                self.assertEqual(archive.read(name),(HERE/'package'/name).read_bytes())
            real_meta=json.loads(archive.read('release.json'))
            for name,digest in real_meta['after'].items():
                self.assertEqual(f.sha(archive.read('payload/'+name)),digest)
            build=archive.read('payload/build-version.js').decode().split('self.BOS_BUILD=',1)[1].rstrip(';\n')
            self.assertEqual(json.loads(build)['id'],real_meta['after_build'])

    def test_frontend_backup_failure_never_activates_backend(self):
        rec=self.prepare()
        with patch.object(f,'copy_tree',side_effect=f.Stop('disk full')):
            with self.assertRaisesRegex(f.Stop,'was rolled back'):
                r.activate_all(META,FILES,OPTIONAL,rec,{},MIGRATION)
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)
        self.assertEqual(self.restarts,[])

    def test_unjournalled_frontend_stage_does_not_prevent_backend_recovery(self):
        rec=self.prepare()
        b.activate(rec)
        f.STAGE.mkdir()
        (f.STAGE/'unfinished-copy').write_text('partial private backup')
        r.rollback_all(META)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)
        self.assertEqual((f.STAGE/'unfinished-copy').read_text(),'partial private backup')

    def test_rollback_https_failure_still_restores_backend_files(self):
        rec=self.prepare()
        r.activate_all(META,FILES,OPTIONAL,rec,{},MIGRATION)
        with patch.object(f,'public_verify',side_effect=f.Stop('network unavailable')):
            with self.assertRaisesRegex(f.Stop,'verification incomplete'): r.rollback_all(META)
        self.assertEqual(f.snapshot(self.root),self.before)
        self.assertEqual({k:f.snapshot(Path(p)) for k,p in self.roots.items()},self.backend_before)

    def test_rollback_and_retry_archives_both_backups(self):
        rec=self.prepare()
        r.activate_all(META,FILES,OPTIONAL,rec,{},MIGRATION)
        r.rollback_all(META)
        api=r.load(b.STAGE); web=r.load(f.STAGE)
        backups={str(p):f.snapshot(p) for p in [b.STAGE,f.STAGE]}
        r.archive_inactive(META,api,web)
        self.assertFalse(b.STAGE.exists()); self.assertFalse(f.STAGE.exists())
        for original,expected in backups.items():
            archived=list(self.parent.glob(Path(original).name+'-history-*'))
            self.assertEqual(len(archived),1)
            self.assertEqual(f.snapshot(archived[0]),expected)
        retry=self.prepare()
        r.activate_all(META,FILES,OPTIONAL,retry,{},MIGRATION)
        self.assertEqual(retry['state'],'active')

    def test_retry_refuses_active_backend(self):
        rec=self.prepare()
        b.activate(rec)
        with self.assertRaisesRegex(f.Stop,'interrupted'): r.archive_inactive(META,rec,None)
        self.assertTrue(b.STAGE.exists())

if __name__ == '__main__': unittest.main(verbosity=2)
