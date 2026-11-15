"""Offline portal tests: real loopback HTTP and a synthetic browser fetch."""
import http.client
import gzip
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import tempfile
import types
import unittest
from unittest.mock import patch

import app_browser as a


class URLTests(unittest.TestCase):
    def test_exact_origin_and_api_rewrite(self):
        base = 'http://127.0.0.1:1234'
        for url in [
            'https://business-os-api-gateway.netlify.app/api/proxy/mini-app-api?q=1',
            'https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e/api/proxy/mini-app-api?q=1',
            'https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api?q=1',
        ]:
            self.assertEqual(a.rewrite_url(url, base, a.KNOWN_ORIGINS),
                             base + '/functions/v1/mini-app-api?q=1')
        for url in ['https://business-os-api-gateway.netlify.app.evil.test/functions/v1/mini-app-api',
                    'https://user:secret@business-os-api-gateway.netlify.app/functions/v1/mini-app-api',
                    'data:text/plain,private', 'https://api-v2.appdeploy.ai/unrelated',
                    'https://unknown.test/storage/v1/object/public/x']:
            self.assertIsNone(a.rewrite_url(url, base, a.KNOWN_ORIGINS))

    def test_html_guard_precedes_scripts_and_known_media_is_local(self):
        raw = b'<!doctype html><html><head><script>first()</script></head><body><img src="https://homemaster.qd.je/storage/v1/object/public/x?a=1&amp;b=2"><a href="https://unknown.test/">x</a></body></html>'
        value = a.rewrite_html(raw, 'http://127.0.0.1:1234', a.KNOWN_ORIGINS).decode()
        self.assertLess(value.index(a.GUARD_PATH), value.index('first()'))
        self.assertIn('src="http://127.0.0.1:1234/storage/v1/object/public/x?a=1&amp;b=2"', value)
        self.assertIn('href="https://unknown.test/"', value)  # CSP + click/proxy guard deny it.

    def test_html_rewrite_keeps_captured_javascript_bytes(self):
        script = "const original='src=\"https://homemaster.qd.je/unchanged\"';"
        value = a.rewrite_html(('<head><script>' + script + '</script></head>').encode(),
                               'http://127.0.0.1:1234', a.KNOWN_ORIGINS).decode()
        self.assertIn(script, value)

    def test_captured_origin_cannot_contain_credentials_or_paths(self):
        for origin in ['https://example.test/path', 'https://user:password@example.test',
                       'file:///tmp/a', 'https://example.test?x=1', 'https://example.test\\evil',
                       'https://example.test:99999']:
            with self.assertRaises(ValueError):
                a.validated_origin(origin)

    def test_internal_and_logical_origins_only_map_storage(self):
        base = 'http://127.0.0.1:1234'
        for origin in a.STORAGE_ONLY_ORIGINS:
            url = origin + '/storage/v1/object/sign/bucket/photo.jpg?token=synthetic'
            self.assertEqual(a.rewrite_url(url, base, a.KNOWN_ORIGINS),
                             base + '/storage/v1/object/sign/bucket/photo.jpg?token=synthetic')
            for path in ['/functions/v1/mini-app-api', '/api/proxy/mini-app-api', '/private.html']:
                self.assertIsNone(a.rewrite_url(origin + path, base, a.KNOWN_ORIGINS, asset=True))
        for origin in ['http://127.0.0.1:9001', 'http://localhost:9000',
                       'https://bos-local.invalid.evil.test', 'https://bos-local.invalid:8443']:
            self.assertIsNone(a.rewrite_url(origin + '/storage/v1/object/public/bucket/photo.jpg',
                                          base, a.KNOWN_ORIGINS, asset=True))


class PortalTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.response = (200, {'Content-Type': 'text/html; charset=utf-8'},
                         b'<html><head><script>boot()</script></head><body>fixture</body></html>')
        def transport(method, path, headers, body):
            self.calls.append((method, path, headers, body))
            return self.response
        self.portal = a.LocalPortal(transport)
        self.thread = threading.Thread(target=self.portal.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close)

    def close(self):
        self.portal.shutdown()
        self.thread.join(timeout=2)

    def request(self, method='GET', path='/', headers=None, body=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.portal.server.server_address[1], timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_shell_injected_csp_and_no_store(self):
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertIn(a.GUARD_PATH.encode(), body)
        self.assertIn("connect-src 'self'", headers['Content-Security-Policy'])
        self.assertIn("worker-src 'none'", headers['Content-Security-Policy'])
        self.assertEqual(headers['Cache-Control'], 'no-store')

    def test_api_preserves_body_auth_and_drops_forwarding_headers(self):
        self.response = (200, {'Content-Type': 'application/json'}, b'{"ok":true}')
        payload = b'{"action":"bootstrap","fixture":"synthetic"}'
        status, _, _ = self.request('POST', '/api/proxy/mini-app-api',
            {'Content-Type': 'application/json', 'X-BOS-Session': 'synthetic-session',
             'Forwarded': 'host=evil.test', 'X-Forwarded-Host': 'evil.test',
             'Origin': self.portal.origin}, payload)
        self.assertEqual(status, 200)
        method, path, headers, body = self.calls[-1]
        self.assertEqual((method, path, body), ('POST', '/functions/v1/mini-app-api', payload))
        lower = {key.lower(): value for key, value in headers.items()}
        self.assertEqual(lower['x-bos-session'], 'synthetic-session')
        self.assertNotIn('host', lower)
        self.assertNotIn('forwarded', lower)
        self.assertNotIn('x-forwarded-host', lower)

    def test_foreign_hosts_origins_proxy_requests_and_tunnels_never_forward(self):
        cases = [
            ('GET', '/', {'Host': 'evil.test'}),
            ('POST', '/', {'Origin': 'https://evil.test'}),
            ('GET', '/', {'Sec-Fetch-Site': 'cross-site'}),
            ('GET', '/', {'Referer': 'https://evil.test/'}),
            ('GET', 'http://evil.test/private', {'Host': self.portal.host}),
            ('GET', 'https://homemaster.qd.je/', {'Host': self.portal.host}),
            ('CONNECT', 'evil.test:443', {'Host': 'evil.test:443'}),
        ]
        for method, path, headers in cases:
            with self.subTest(path=path, headers=headers):
                self.assertEqual(self.request(method, path, headers)[0], 403)
        self.assertEqual(self.calls, [])

    def test_local_absolute_proxy_request_is_allowed(self):
        self.assertEqual(self.request(path=self.portal.origin + '/')[0], 200)
        self.assertEqual(self.calls[-1][1], '/')

    def test_blocked_integration_and_body_limit_never_forward(self):
        status, _, body = self.request('POST', '/functions/v1/avito-api', body=b'{}')
        self.assertEqual(status, 501)
        self.assertEqual(json.loads(body)['code'], 'LOCAL_DRILL_EXTERNAL_DISABLED')
        self.assertEqual(self.request('POST', '/functions/v1/%70ush-api', body=b'{}')[0], 501)
        self.assertEqual(self.request('POST', '/functions/v1/../v1/push-api', body=b'{}')[0], 403)
        status, _, _ = self.request('POST', '/', {'Content-Length': str(a.MAX_BODY + 1)})
        self.assertEqual(status, 413)
        self.assertEqual(self.calls, [])

    def test_redirect_external_is_rejected(self):
        self.response = (302, {'Location': 'https://evil.test/private'}, b'')
        self.assertEqual(self.request()[0], 403)

    def test_guard_served_without_container_call(self):
        status, headers, body = self.request(path=a.GUARD_PATH)
        self.assertEqual(status, 200)
        self.assertIn('javascript', headers['Content-Type'])
        self.assertIn(b'LOCAL_DRILL_EXTERNAL_BLOCKED', body)
        self.assertEqual(self.calls, [])

    def test_storage_metadata_encoding_preserved_and_path_decoded_only_once(self):
        raw = gzip.compress(b'synthetic attachment')
        self.response = (200, {'Content-Type': 'application/pdf', 'Content-Encoding': 'gzip'}, raw)
        path = '/storage/v1/object/sign/bucket/%252e%252e.pdf?token=synthetic'
        status, headers, body = self.request(path=path)
        self.assertEqual((status, headers['Content-Type'], headers['Content-Encoding'], body),
                         (200, 'application/pdf', 'gzip', raw))
        self.assertEqual(self.calls[-1][1], path)

    def test_compressed_html_cannot_bypass_guard_injection(self):
        self.response = (200, {'Content-Type': 'text/html', 'Content-Encoding': 'gzip'},
                         gzip.compress(b'<html><script>boot()</script></html>'))
        self.assertEqual(self.request()[0], 502)


@unittest.skipUnless(shutil.which('node'), 'Node is needed for the browser Request contract')
class JavaScriptTests(unittest.TestCase):
    def test_request_stream_headers_method_and_abort_preserved(self):
        setup = r'''
const assert=require('node:assert/strict');
global.location=new URL('http://127.0.0.1:1234/');
let calls=[],opened=[],clickHandler;
global.window=global;global.open=(...args)=>{opened.push(args);return {}};
let observe;
global.MutationObserver=class{constructor(callback){observe=callback}observe(){}};
global.document={addEventListener:(name,handler)=>{if(name==='click')clickHandler=handler},documentElement:{querySelectorAll:()=>[]}};
global.fetch=async(input,options)=>{
 const request=new Request(input,options);
 calls.push({url:request.url,method:request.method,headers:request.headers,
             body:await request.text(),signal:request.signal,options,finiteBody:options.body instanceof ArrayBuffer});
 return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});
};
'''
        assertions = r'''
(async()=>{
const controller=new AbortController();
const request=new Request('https://business-os-api-gateway.netlify.app/api/proxy/mini-app-api?x=1',{
 method:'POST',headers:{'Content-Type':'application/json','X-BOS-Session':'fixture'},
 body:'{"action":"bootstrap"}',signal:controller.signal});
await fetch(request);
assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:1234/functions/v1/mini-app-api?x=1');
assert.equal(calls[0].method,'POST');assert.equal(calls[0].body,'{"action":"bootstrap"}');
assert.equal(calls[0].finiteBody,true);
assert.equal(calls[0].headers.get('X-BOS-Session'),'fixture');
controller.abort();assert.equal(calls[0].signal.aborted,true);
assert.equal(calls[0].options.redirect,'error');
await assert.rejects(fetch('https://evil.test/private'));
await assert.rejects(fetch('data:text/plain,private'));
assert.equal(calls.length,1);
const disabled=await fetch('https://business-os-api-gateway.netlify.app/api/proxy/push-api');
assert.equal(disabled.status,501);assert.equal(calls.length,1);
const baseRequest=new Request('https://homemaster.qd.je/functions/v1/mini-app-api',{method:'POST',body:'old'});
await fetch(baseRequest,{method:'PUT',body:'new',headers:{'X-BOS-Session':'override'}});
assert.equal(calls[1].method,'PUT');assert.equal(calls[1].body,'new');
assert.equal(calls[1].headers.get('X-BOS-Session'),'override');
const attributes={src:'https://homemaster.qd.je/storage/v1/object/public/bucket/photo.jpg'};
const image={getAttribute:name=>attributes[name],setAttribute:(name,value)=>{attributes[name]=value},querySelectorAll:()=>[]};
observe([{type:'childList',addedNodes:[image]}]);
assert.equal(attributes.src,'http://127.0.0.1:1234/storage/v1/object/public/bucket/photo.jpg');
attributes.src='https://unknown.test/photo.jpg';observe([{type:'attributes',target:image}]);
assert.equal(attributes.src,'https://unknown.test/photo.jpg');
const blob='blob:http://127.0.0.1:1234/00000000-0000-4000-8000-000000000001';
window.open(blob);assert.equal(opened[0][0],blob);
let prevented=false;const anchor={href:blob};
clickHandler({target:{closest:()=>anchor},preventDefault:()=>{prevented=true},stopImmediatePropagation:()=>{}});
assert.equal(prevented,false);assert.equal(anchor.href,blob);
window.open('blob:https://evil.test/00000000-0000-4000-8000-000000000001');assert.equal(opened.length,1);
await assert.rejects(fetch(blob));
for(const origin of ['https://bos-local.invalid','http://127.0.0.1:9000']){
 const url=origin+'/storage/v1/object/sign/bucket/photo.jpg?token=synthetic';
 await fetch(url);assert.equal(calls.at(-1).url,'http://127.0.0.1:1234/storage/v1/object/sign/bucket/photo.jpg?token=synthetic');
 attributes.src=url;observe([{type:'attributes',target:image}]);assert.equal(attributes.src,'http://127.0.0.1:1234/storage/v1/object/sign/bucket/photo.jpg?token=synthetic');
 await assert.rejects(fetch(origin+'/functions/v1/mini-app-api'));
 const previous=opened.length;window.open(origin+'/private.html');assert.equal(opened.length,previous);
}
await assert.rejects(fetch('http://127.0.0.1:9001/storage/v1/object/public/bucket/photo.jpg'));
await assert.rejects(fetch('http://localhost:9000/storage/v1/object/public/bucket/photo.jpg'));
const attachment='https://bos-local.invalid/storage/v1/object/sign/bucket/photo.jpg?token=synthetic';
const body=JSON.stringify({action:'finalizeMasterReport',act_url:attachment,photo_urls:[attachment]});
await fetch('https://homemaster.qd.je/functions/v1/report-api',{method:'POST',body});
assert.equal(calls.at(-1).body,body);
console.log('Request body, headers, method, init overrides and abort signal preserved');
})().catch(error=>{console.error(error);process.exitCode=1});
'''
        result = subprocess.run(['node', '-e', setup + a.guard_script(a.KNOWN_ORIGINS).decode() + assertions],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('preserved', result.stdout)


class EdgeProfileTests(unittest.TestCase):
    def test_fresh_profile_keeps_downloads_beside_package_and_retains_proxy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            executable = root / 'programs/Microsoft/Edge/Application/msedge.exe'
            executable.parent.mkdir(parents=True)
            executable.write_bytes(b'synthetic executable placeholder')
            profile = root / 'package/browser-profile'
            portal = a.LocalPortal(lambda *args: None, profile_dir=profile)
            self.addCleanup(portal.shutdown)
            def popen(args, **kwargs):
                # Preferences must already exist when the browser starts.
                prefs = json.loads((profile / 'Default/Preferences').read_text())
                expected = str((profile.parent / 'Downloads').resolve())
                self.assertEqual(prefs['download']['default_directory'], expected)
                self.assertEqual(prefs['savefile']['default_directory'], expected)
                self.assertFalse(prefs['download']['prompt_for_download'])
                self.assertTrue((profile.parent / 'Downloads').is_dir())
                self.assertIn('--proxy-server=' + portal.origin, args)
                self.assertIn('--proxy-bypass-list=<-loopback>', args)
                return types.SimpleNamespace(pid=12345)
            fake_os = types.SimpleNamespace(name='nt', environ={'PROGRAMFILES': str(root / 'programs')})
            with patch.object(a, 'os', fake_os), patch.object(a.subprocess, 'Popen', side_effect=popen) as launch:
                self.assertTrue(portal.open_browser())
                launch.assert_called_once()
                before = (profile / 'Default/Preferences').read_bytes()
                self.assertFalse(portal.open_browser())
                self.assertEqual((profile / 'Default/Preferences').read_bytes(), before)
                launch.assert_called_once()


class BrowserContractTests(unittest.TestCase):
    """Captured-code contract against synthetic data; not a production login test."""
    def test_actual_password_ui_local_modules_and_attachment(self):
        if os.environ.get('BOS_APP_BROWSER_CONTRACT') != '1':
            self.skipTest('Set BOS_APP_BROWSER_CONTRACT=1 on a runner permitting Chromium process sockets')
        self.assertIsNotNone(shutil.which('node'), 'BOS_APP_BROWSER_CONTRACT requires Node')
        check = subprocess.run(['node', '-e', "try{const fs=require('fs'),p=process.env.BOS_APP_CHROMIUM_EXECUTABLE||require('playwright').chromium.executablePath();process.exit(fs.existsSync(p)?0:2)}catch(_){process.exit(2)}"],
                               capture_output=True, timeout=10)
        self.assertEqual(check.returncode, 0, 'BOS_APP_BROWSER_CONTRACT requires Playwright and its Chromium, or BOS_APP_CHROMIUM_EXECUTABLE')
        repo = Path(__file__).resolve().parents[2]
        shell_names = ['app-build-runtime.js', 'vk-init.js', 'network-direct-v86.js', 'config.js']
        shell = '\n'.join((repo / name).read_text() for name in shell_names)
        shell += r'''
var state={user:null,settings:{},page:'home'};
window.BOS_PERMISSIONS={canUseDispatcherWorkspace:()=>false,canViewFinance:()=>false};
window.reloadData=async()=>{const data=await window.api('bootstrap');state.user=data.user;state.orders=data.orders;document.getElementById('content').textContent=data.orders[0].title;const img=document.createElement('img');img.id='fixturePhoto';img.src='https://homemaster.qd.je/storage/v1/object/public/fixture/photo.svg';document.body.appendChild(img)};
window.show=()=>{};
'''
        shell += (repo / 'mandatory-auth-v29.js').read_text()
        index = b'<!doctype html><html><head><script defer src="/build-version.js"></script><script defer src="/startup-shell.bundle.js"></script><script defer src="/pwa-register.js"></script></head><body><div id="authGate"></div><div id="content"></div></body></html>'
        assets = {'/': ('text/html', index),
                  '/build-version.js': ('text/javascript', b'self.BOS_BUILD={id:"fixture",assetBundles:{}};'),
                  '/startup-shell.bundle.js': ('text/javascript', shell.encode()),
                  '/pwa-register.js': ('text/javascript', (repo / 'pwa-register.js').read_bytes())}
        calls = []
        token = 'fixture_owner.9999999999.fixture_signature'
        def transport(method, path, headers, body):
            from urllib.parse import urlsplit
            pathname = urlsplit(path).path
            calls.append((method, pathname))
            if pathname in assets:
                content_type, value = assets[pathname]
                return 200, {'Content-Type': content_type}, value
            if pathname == '/functions/v1/password-session-api':
                data = json.loads(body)
                if data != {'action': 'login', 'login': 'fixture', 'password': 'fixture-only-password'}:
                    return 401, {'Content-Type': 'application/json'}, b'{"ok":false}'
                return 200, {'Content-Type': 'application/json', 'X-BOS-Session': token}, json.dumps({'ok': True, 'session_token': token}).encode()
            if pathname == '/functions/v1/mini-app-api':
                lower = {key.lower(): value for key, value in headers.items()}
                if lower.get('x-bos-session') != token:
                    return 401, {'Content-Type': 'application/json'}, b'{"ok":false}'
                return 200, {'Content-Type': 'application/json'}, json.dumps({'ok': True,
                    'user': {'id': 'fixture-owner', 'role': 'owner'},
                    'orders': [{'title': 'Synthetic order from local API'}]}).encode()
            if pathname.endswith('.svg'):
                return 200, {'Content-Type': 'image/svg+xml'}, b'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="green"/></svg>'
            if pathname.endswith('.js'):
                return 200, {'Content-Type': 'text/javascript'}, b'/* synthetic optional role module */'
            return 404, {'Content-Type': 'text/plain'}, b'Not found'
        portal = a.LocalPortal(transport)
        thread = threading.Thread(target=portal.serve_forever, daemon=True)
        thread.start()
        program = r'''
const assert=require('node:assert/strict'),fs=require('fs'),{chromium}=require('playwright');
(async()=>{
 const base=process.argv[1];
 const browser=await chromium.launch({headless:true,executablePath:process.env.BOS_APP_CHROMIUM_EXECUTABLE||chromium.executablePath(),
  proxy:{server:base,bypass:'<-loopback>'},args:['--no-sandbox','--disable-quic','--disable-background-networking','--disable-extensions','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 const page=await browser.newPage(),errors=[],requests=[],responses=[],failures=[];
 const pathOnly=url=>{try{const u=new URL(url);return u.origin+u.pathname}catch(_){return 'invalid-url'}};
 const record=(list,value)=>{if(list.length<80)list.push(value)};
 page.on('pageerror',error=>record(errors,error.message.slice(0,600)));
 page.on('request',request=>record(requests,{method:request.method(),path:pathOnly(request.url())}));
 page.on('response',response=>record(responses,{status:response.status(),path:pathOnly(response.url())}));
 page.on('requestfailed',request=>record(failures,{path:pathOnly(request.url()),error:String(request.failure()?.errorText||'').slice(0,200)}));
 try{
  const response=await page.goto(base+'/');assert.match(response.headers()['content-security-policy'],/worker-src 'none'/);
  await page.locator('#simplePassForm').waitFor();await page.locator('input[name=login]').fill('fixture');await page.locator('input[name=password]').fill('fixture-only-password');
  await page.locator('#simplePassForm button').click();await page.locator('body.bos-auth-ok').waitFor({timeout:15000});
  assert.equal(await page.locator('#content').textContent(),'Synthetic order from local API');
  await page.waitForFunction(()=>{const img=document.getElementById('fixturePhoto');return img?.complete&&img.naturalWidth===2});
  assert.equal(await page.locator('#fixturePhoto').getAttribute('src'),base+'/storage/v1/object/public/fixture/photo.svg');
  for(const origin of ['https://bos-local.invalid','http://127.0.0.1:9000']){
   const url=origin+'/storage/v1/object/sign/fixture/photo.svg?token=synthetic';
   assert.equal(await page.evaluate(async value=>(await fetch(value)).status,url),200);
   await page.locator('#fixturePhoto').evaluate((img,value)=>{img.src=value},url);
   await page.waitForFunction(expected=>{const img=document.getElementById('fixturePhoto');return img?.src===expected&&img.complete&&img.naturalWidth===2},base+'/storage/v1/object/sign/fixture/photo.svg?token=synthetic');
   assert.equal(await page.evaluate(value=>fetch(value+'/functions/v1/mini-app-api').then(()=>false,()=>true),origin),true);
  }
  assert.equal(await page.evaluate(()=>fetch('http://127.0.0.1:9001/storage/v1/object/sign/fixture/photo.svg').then(()=>false,()=>true)),true);
  assert.equal(await page.evaluate(()=>window.BOS_ROLE_MODULES_V190.master),10);
  assert.equal(await page.evaluate(()=>fetch('https://unrelated.invalid/private').then(()=>false,()=>true)),true);
  const denied=await browser.newPage();const blocked=await denied.goto('http://unrelated.invalid/private');assert.equal(blocked.status(),403);
  assert.deepEqual(errors,[]);console.log('Actual password UI, captured loaders, local media and proxy denial passed');
 }catch(error){
  // This fixture contains synthetic data only. Exclude input values, headers,
  // request bodies and URL queries even from its bounded failure diagnostics.
  const dom=await page.locator('body').innerText({timeout:1000}).then(value=>value.slice(0,2400),()=>'<unavailable>');
  console.error('BROWSER_FIXTURE_DIAGNOSTICS '+JSON.stringify({dom,errors,requests,responses,failures}));throw error;
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
'''
        try:
            result = subprocess.run(['node', '-e', program, portal.origin], capture_output=True,
                                    text=True, timeout=40, cwd=repo)
            self.assertEqual(result.returncode, 0, result.stderr + '\nSYNTHETIC_TRANSPORT_PATHS=' + json.dumps(calls[-80:]))
            self.assertIn('passed', result.stdout)
            self.assertIn(('POST', '/functions/v1/password-session-api'), calls)
            self.assertIn(('POST', '/functions/v1/mini-app-api'), calls)
            self.assertIn(('GET', '/master-home-orders-v124.js'), calls)
        finally:
            portal.shutdown()
            thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
