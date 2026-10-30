import importlib.util
from email.message import Message
import io
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


s = load('runtime_stage_base', ROOT/'stage.py')
m = load('runtime_stage_test', ROOT/'runtime-stage.py')
m.s = s
p = load('runtime_probe_test', ROOT/'runtime-probe.py')
GATEWAY = '''const keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','VK_APP_SECRET','BOS_SYNC_KEY','HANDS_API_KEY'];
const env=keys.map(k=>[k,Deno.env.get(k)||'']);
const worker=async(slug,route)=>await EdgeRuntime.userWorkers.create({
servicePath:'/bos-src/'+slug,envVars:[...env,['BOS_FUNCTION_NAME',slug]],noModuleCache:true});
'''


class RuntimeTests(unittest.TestCase):
    def test_observed_gateway_patch_preserves_routing_and_original_env_expression(self):
        patched = m.patch_gateway(GATEWAY)
        expected = "import { bosReportEnv } from './bos-report-env.ts';\n" + GATEWAY.replace(
            "envVars:[...env,['BOS_FUNCTION_NAME',slug]]",
            "envVars:bosReportEnv(slug,[...env,['BOS_FUNCTION_NAME',slug]])")
        self.assertEqual(patched, expected)
        self.assertIn('BOS_SYNC_KEY',m.worker_keys(GATEWAY))
        script = "const esbuild=require('esbuild');esbuild.transformSync(require('fs').readFileSync(0,'utf8'),{loader:'ts'});"
        proc = subprocess.run(['node','-e',script],input=patched.encode(),capture_output=True,cwd=REPO)
        self.assertEqual(proc.returncode,0,proc.stderr.decode())

    def test_unknown_or_duplicated_gateway_expression_stops(self):
        for source in (GATEWAY+GATEWAY,GATEWAY.replace('...env','...someOtherEnv'),m.patch_gateway(GATEWAY)):
            with self.subTest(source=source),self.assertRaises(s.Stop):
                m.patch_gateway(source)

    def test_runtime_wrapper_preserves_unrelated_functions_and_keys(self):
        config = {'version':1,'internal':m.INTERNAL,'public':m.PUBLIC,'legacy':'https://139.100.237.167',
                  'workerKey':'fixture-private-worker-key-0000000000000000','gas':'https://script.google.com/macros/s/fixture/exec'}
        script = r'''
const vm=require('node:vm'),assert=require('node:assert/strict');
const data=JSON.parse(require('fs').readFileSync(0,'utf8'));
const ctx={Deno:{readTextFileSync:p=>{assert.equal(p,'/bos-main/bos-report-env.json');return JSON.stringify(data.config)}}};
vm.createContext(ctx);vm.runInContext(data.helper.replace('export function','function'),ctx);
const original=[['SUPABASE_URL','https://old.example'],['SUPABASE_SERVICE_ROLE_KEY','keep-service-key'],['BOS_SYNC_KEY','keep-sync-key'],['HANDS_API_KEY','keep-hands-key'],['BOS_FUNCTION_NAME','drive-archive-api']];
assert.equal(ctx.bosReportEnv('mini-app-api',original),original);
for(const slug of data.slugs){
 const out=ctx.bosReportEnv(slug,original),env=Object.fromEntries(out);
 assert.equal(out.length,new Set(out.map(x=>x[0])).size);
 assert.equal(env.SUPABASE_URL,data.config.internal);assert.equal(env.BOS_PUBLIC_URL,data.config.public);
 assert.equal(env.BOS_SYNC_KEY,'keep-sync-key');assert.equal(env.HANDS_API_KEY,'keep-hands-key');assert.equal(env.SUPABASE_SERVICE_ROLE_KEY,'keep-service-key');
 assert.equal(env.BOS_DRIVE_WORKER_KEY,slug==='drive-archive-api'?data.config.workerKey:undefined);
 assert.equal(env.BOS_DRIVE_GAS_URL,['drive-archive-api','gas-bridge-health'].includes(slug)?data.config.gas:undefined);
}
'''
        proc = subprocess.run(['node','-e',script],input=json.dumps({'config':config,'helper':m.ENV_HELPER,'slugs':s.SLUGS}).encode(),capture_output=True)
        self.assertEqual(proc.returncode,0,proc.stderr.decode())

    def test_probe_uses_only_dummy_env_and_disposable_read_only_mounts(self):
        edge={'Image':'sha256:'+'a'*64,'Config':{'Env':['VK_APP_SECRET=PRODUCTION_PRIVATE_VALUE'],
              'Entrypoint':['edge-runtime'],'Cmd':['start','--main-service','/bos-main']}}
        env=m.dummy_environment(m.worker_keys(GATEWAY))
        args=m.runtime_arguments(edge,Path('/private/runtime'),'probe',env)
        self.assertIn('--network=none',args)
        self.assertNotIn('PRODUCTION_PRIVATE_VALUE',str(args))
        self.assertNotIn('-p',args)
        for i,arg in enumerate(args):
            if arg=='--mount':
                self.assertTrue(args[i+1].endswith(',readonly'))
                self.assertIn('/private/runtime/',args[i+1])

    def test_probe_download_is_pinned_to_reviewed_file_content(self):
        self.assertEqual(s.sha((ROOT/'runtime-probe.py').read_bytes()),m.PROBE_SHA)

    def test_streamed_json_patch_is_read_completely(self):
        headers = Message()
        headers['Transfer-Encoding'] = 'chunked'
        raw = b'5;fixture=yes\r\n{"ok"\r\n6\r\n:true}\r\n0\r\nX-Fixture: end\r\n\r\n'
        self.assertEqual(json.loads(p.read_body(io.BytesIO(raw),headers)),{'ok':True})

    def test_length_delimited_body_is_read_completely(self):
        headers = Message()
        headers['Content-Length'] = '11'
        self.assertEqual(p.read_body(io.BytesIO(b'{"ok":true}'),headers),b'{"ok":true}')

    def test_invalid_or_oversized_framing_stops(self):
        for encoding,raw,limit in [('chunked',b'4\r\nab',100),('chunked',b'ffff\r\n',100),
                                   ('gzip',b'x',100),('chunked',b'0\r\n',100)]:
            headers = Message()
            headers['Transfer-Encoding'] = encoding
            with self.subTest(raw=raw),self.assertRaises(RuntimeError):
                p.read_body(io.BytesIO(raw),headers,limit)

    def test_diagnostic_drops_urls_and_fixture_credentials(self):
        value = p.diagnostic_error('Fetch https://private.example/path?token=secret key=private-fixture-secret',
                                   {'vk_secret':'private-fixture-secret'})
        self.assertNotIn('private.example',value)
        self.assertNotIn('token=',value)
        self.assertNotIn('private-fixture-secret',value)


if __name__=='__main__':
    unittest.main()
