"""Actual captured auth scripts plus local-only account controls in Chromium."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
import unittest

import app_browser
import app_role_ui
from app_roles import RoleSwitcher


class RoleScriptTests(unittest.TestCase):
    def test_injected_script_is_valid_javascript(self):
        if not shutil.which('node'):
            self.skipTest('Node is needed to check the injected JavaScript')
        result = subprocess.run(['node', '--check'], input=app_role_ui.role_script(),
                                capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))


class RoleBrowserTests(unittest.TestCase):
    def test_real_auth_switch_reload_cleanup_and_mobile_toolbar(self):
        if os.environ.get('BOS_APP_BROWSER_CONTRACT') != '1':
            self.skipTest('Set BOS_APP_BROWSER_CONTRACT=1 for the isolated Chromium contract')
        self.assertIsNotNone(shutil.which('node'))
        repo = Path(__file__).resolve().parents[2]
        secret = 'synthetic-local-role-key-not-used-outside-this-browser-test'
        staff = [
            {'id': 'owner-id', 'external_id': 'owner_subject', 'full_name': 'Тестовый владелец', 'role': 'owner'},
            {'id': 'master-id', 'external_id': 'master_subject', 'full_name': 'Тестовый мастер', 'role': 'master'},
            {'id': 'manager-id', 'external_id': 'manager_subject', 'full_name': 'Тестовый руководитель', 'role': 'manager'},
            {'id': 'dispatcher-id', 'external_id': 'dispatcher_subject', 'full_name': 'Тестовый диспетчер', 'role': 'dispatcher'},
            {'id': 'other-master-id', 'external_id': 'other_subject', 'full_name': '<img src=x onerror=alert(1)>', 'role': 'master'},
        ]
        by_subject = {row['external_id']: row for row in staff}
        def token(subject, ttl=86400):
            message = subject + '.' + str(int(time.time()) + ttl)
            signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
            return message + '.' + signature
        def verify(value):
            try:
                subject, expiry, signature = value.split('.')
                message = subject + '.' + expiry
                expected = base64.urlsafe_b64encode(hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
                return by_subject.get(subject) if int(expiry) > time.time() and hmac.compare_digest(signature, expected) else None
            except (TypeError, ValueError):
                return None
        broker = RoleSwitcher(secret, lambda: [dict(row) for row in staff])
        actions, api_subjects, logins, refreshes, authorizations = [], [], [], [], []
        class RecordingSwitcher:
            def handle(self, action, payload, session, grant=''):
                actions.append(action)
                result = broker.handle(action, payload, session, grant)
                if action == 'authorize':
                    authorizations.append(result[0])
                return result
            def close(self):
                broker.close()
        shell = r'''
var state={user:{role:'owner',full_name:'Unvalidated placeholder'},orders:[],page:'home'};
window.reloadData=async()=>{const data=await window.api('bootstrap');state.user=data.user;state.orders=data.orders;document.getElementById('content').textContent=state.user.role+':'+data.orders.map(x=>x.id).join(',')};
window.show=()=>{};
'''
        shell += (repo / 'mandatory-auth-v29.js').read_text()
        shell += (repo / 'session-refresh-v113.js').read_text()
        shell += (repo / 'profile-logout-v96.js').read_text()
        index = b'''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px system-ui}#content{padding:18px}nav{padding:14px;background:#eee}#authGate{padding:20px}.form{display:grid;gap:10px}input,button{padding:10px}</style><script defer src="/fixture-auth.js"></script></head><body><div id="authGate"></div><main id="content"></main><nav>Navigation stays below the local toolbar</nav><div id="modalRoot"></div></body></html>'''
        def transport(method, path, headers, body):
            if path == '/':
                return 200, {'Content-Type': 'text/html'}, index
            if path == '/fixture-auth.js':
                return 200, {'Content-Type': 'text/javascript'}, shell.encode()
            lower = {key.lower(): value for key, value in headers.items()}
            try:
                payload = json.loads(body)
            except (ValueError, UnicodeError):
                payload = {}
            if path == '/functions/v1/password-session-api':
                if payload.get('action') == 'login':
                    login = payload.get('login')
                    if payload.get('password') != 'fixture-only-password' or login not in ('owner', 'master'):
                        return 401, {'Content-Type': 'application/json'}, b'{"ok":false}'
                    logins.append(login)
                    return 200, {'Content-Type': 'application/json'}, json.dumps({'ok': True, 'session_token': token(login + '_subject')}).encode()
                current = verify(lower.get('x-bos-session', ''))
                if payload.get('action') == 'refresh' and current:
                    refreshes.append(current['external_id'])
                    # An old owner refresh must not replace the selected target
                    # token while the captured cancellation hook is running.
                    if len(refreshes) == 1:
                        time.sleep(2)
                    return 200, {'Content-Type': 'application/json'}, json.dumps({'ok': True, 'session_token': token(current['external_id'])}).encode()
                return 401, {'Content-Type': 'application/json'}, b'{"ok":false}'
            if path == '/functions/v1/mini-app-api':
                current = verify(lower.get('x-bos-session', ''))
                if not current:
                    return 401, {'Content-Type': 'application/json'}, b'{"ok":false}'
                api_subjects.append(current['external_id'])
                if payload.get('action') == 'ownerOnly':
                    status = 200 if current['role'] == 'owner' else 403
                    return status, {'Content-Type': 'application/json'}, json.dumps({'ok': status == 200}).encode()
                orders = [{'id': 'owner-only'}, {'id': 'master-own'}] if current['role'] == 'owner' else [{'id': 'master-own'}]
                return 200, {'Content-Type': 'application/json'}, json.dumps({'ok': True,
                    'user': {'id': current['id'], 'external_id': current['external_id'], 'full_name': current['full_name'], 'role': current['role']},
                    'orders': orders}).encode()
            return 404, {'Content-Type': 'text/plain'}, b'Not found'
        portal = app_browser.LocalPortal(transport)
        portal.role_switcher = RecordingSwitcher()
        thread = threading.Thread(target=portal.serve_forever, daemon=True)
        thread.start()
        program = r'''
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{chromium}=require('playwright');
(async()=>{
 const base=process.argv[1],shots=process.env.BOS_APP_ROLE_SCREENSHOT_DIR||'';
 const browser=await chromium.launch({headless:true,executablePath:process.env.BOS_APP_CHROMIUM_EXECUTABLE||chromium.executablePath(),
  proxy:{server:base,bypass:'<-loopback>'},args:['--no-sandbox','--disable-quic','--disable-background-networking','--disable-extensions','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message.slice(0,300)));
 const toolbar=page.locator('#bos-local-role-toolbar');
 const account=page.locator('#bos-local-role-account'),change=page.locator('#bos-local-role-switch'),back=page.locator('#bos-local-role-owner');
 async function ready(role){await page.locator('body.bos-auth-ok').waitFor();await page.waitForFunction(expected=>state.user.role===expected,role);await account.waitFor({state:'visible'});await page.waitForFunction(()=>document.getElementById('bos-local-role-toolbar').getAttribute('aria-busy')==='false')}
 try{
  await page.goto(base+'/');await toolbar.waitFor();
  assert.equal(await account.isVisible(),false);
  assert.match(await toolbar.locator('.identity').innerText(),/Войдите в приложение/);
  await page.locator('#simplePassForm input[name=login]').fill('owner');await page.locator('#simplePassForm input[name=password]').fill('fixture-only-password');await page.locator('#simplePassForm button').click();
  await ready('owner');assert.match(await toolbar.locator('.identity').innerText(),/Владелец.*Тестовый владелец/);
  assert.equal(await account.locator('optgroup').count(),4);
  assert.equal(await toolbar.locator('img').count(),0);
  if(shots){fs.mkdirSync(shots,{recursive:true});await page.screenshot({path:path.join(shots,'role-toolbar-desktop.png')})}
  await page.evaluate(()=>{localStorage.setItem('fixture-owner-cache','owner-only');sessionStorage.setItem('bosPendingClientCall','old-owner-call');sessionStorage.setItem('bosContactDraft:owner:1','old-owner-draft')});
  const refreshRequest=page.waitForRequest(request=>request.url().endsWith('/functions/v1/password-session-api')&&request.postData()?.includes('refresh'));
  await page.evaluate(()=>{void window.BOS_REFRESH_SESSION()});await refreshRequest;
  await account.selectOption('master-id');await change.click();
  await ready('master');await page.waitForTimeout(2200);
  assert.equal(await page.locator('#content').textContent(),'master:master-own');
  const stored=await page.evaluate(()=>({same:sessionStorage.getItem('bos_vk_session_v2')===localStorage.getItem('bos_vk_session_v2'),subject:sessionStorage.getItem('bos_vk_session_v2')?.split('.')[0],grant:!!sessionStorage.getItem('bos_local_roles_v1'),ownerCache:localStorage.getItem('fixture-owner-cache'),call:sessionStorage.getItem('bosPendingClientCall'),draft:sessionStorage.getItem('bosContactDraft:owner:1')}));
  assert.deepEqual(stored,{same:true,subject:'master_subject',grant:true,ownerCache:null,call:null,draft:null});
  assert.equal(await page.evaluate(async()=>{try{await window.api('ownerOnly');return false}catch(error){return error.status===403}}),true);
  assert.match(await toolbar.locator('.identity').innerText(),/Мастер.*Тестовый мастер/);
  await page.setViewportSize({width:390,height:844});
  const bounds=await page.evaluate(()=>{const host=document.getElementById('bos-local-role-toolbar'),bar=host.getBoundingClientRect(),content=document.getElementById('content').getBoundingClientRect();return{width:innerWidth,scroll:document.documentElement.scrollWidth,left:bar.left,right:bar.right,bottom:bar.bottom,contentTop:content.top}});
  assert.ok(bounds.scroll<=bounds.width);assert.ok(bounds.left>=0&&bounds.right<=bounds.width);assert.ok(bounds.contentTop>=bounds.bottom);
  assert.ok(await change.isVisible());assert.ok(await back.isVisible());
  if(shots)await page.screenshot({path:path.join(shots,'role-toolbar-mobile.png')});
  await back.click();await ready('owner');
  assert.equal(await page.locator('#content').textContent(),'owner:owner-only,master-own');
  const revocation=page.waitForResponse(response=>response.url().endsWith('/__bos_local_roles')&&response.request().postData()?.includes('revoke'));
  await page.evaluate(()=>window.BOS_PROFILE_LOGOUT());assert.equal((await revocation).status(),200);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('bos_local_roles_v1')),null);
  await page.locator('#bosLogoutLoginForm input[name=login]').fill('master');await page.locator('#bosLogoutLoginForm input[name=password]').fill('fixture-only-password');await page.locator('#bosLogoutLoginForm button').click();
  await page.locator('body.bos-auth-ok').waitFor();await page.waitForFunction(()=>state.user.role==='master');
  await page.waitForFunction(()=>document.getElementById('bos-local-role-toolbar').getAttribute('aria-busy')==='false');
  assert.equal(await account.isVisible(),false);assert.match(await toolbar.locator('.identity').innerText(),/Мастер.*Тестовый мастер/);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('bos_local_roles_v1')),null);
  assert.deepEqual(errors,[]);console.log('Real auth, owner grant, target API permissions, reload cleanup and mobile role toolbar passed');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
'''
        try:
            result = subprocess.run(['node', '-e', program, portal.origin], capture_output=True,
                                    text=True, timeout=60, cwd=repo)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('passed', result.stdout)
            self.assertEqual(logins, ['owner', 'master'])
            self.assertEqual(actions.count('switch'), 2)
            self.assertEqual(actions.count('revoke'), 1)
            # A concurrently refreshed token may cause a harmless retry. Only
            # the initial owner may obtain control; the later master may not.
            self.assertEqual(authorizations.count(200), 1)
            self.assertEqual(authorizations[-1], 403)
            self.assertIn('master_subject', api_subjects)
            self.assertIn('owner_subject', api_subjects)
        finally:
            portal.shutdown()
            thread.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
