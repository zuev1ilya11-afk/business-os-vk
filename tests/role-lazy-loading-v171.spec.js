const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const pwa=fs.readFileSync(path.join(root,'pwa-register.js'),'utf8');
const auth=fs.readFileSync(path.join(root,'mandatory-auth-v29.js'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const eager=pwa.slice(pwa.indexOf('const eagerScripts='),pwa.indexOf('const roleScripts='));
const lazy=pwa.slice(pwa.indexOf('const roleScripts='));

test('late master and dispatcher UI modules are not in the eager startup list',async()=>{
  expect(eager).not.toContain('dispatcher-smart-assign-v119.js');
  expect(eager).not.toContain('dispatcher-attention-v123.js');
  expect(eager).not.toContain('master-home-orders-v124.js');
  expect(eager).not.toContain('master-cabinet-v141.js');
  expect(lazy).toContain('dispatcher-smart-assign-v119.js');
  expect(lazy).toContain('dispatcher-attention-v123.js');
  expect(lazy).toContain('master-home-orders-v124.js');
  expect(lazy).toContain('master-cabinet-v141.js');
});

test('role loader keeps employee roles isolated and management previews complete',async()=>{
  expect(pwa).toContain("if(value==='dispatcher')await loadList(roleScripts.dispatcher)");
  expect(pwa).toContain("else if(value==='master')await loadList(roleScripts.master)");
  expect(pwa).toContain("else if(value==='owner'||value==='manager')");
  expect(pwa).toContain('await loadList(roleScripts.dispatcher);');
  expect(pwa).toContain('await loadList(roleScripts.master);');
  expect(pwa).toContain('window.BOS_ROLE_MODULES_V171={dispatcher:roleScripts.dispatcher.length,master:roleScripts.master.length};');
});

test('authorization waits for role modules before revealing the app',async()=>{
  const reloadPos=auth.indexOf('await reloadData(false);');
  const lazyPos=auth.indexOf("await window.BOS_LOAD_ROLE_MODULES(state.user.role)");
  const unlockPos=auth.indexOf('unlock();',lazyPos);
  expect(reloadPos).toBeGreaterThan(-1);
  expect(lazyPos).toBeGreaterThan(reloadPos);
  expect(unlockPos).toBeGreaterThan(lazyPos);
  expect(pwa).toContain("new MutationObserver(loadAfterLegacyUnlock).observe(document.body");
});

test('role-loading release bumps the service worker cache generation',async()=>{
  expect(sw).toContain("const CACHE='business-os-shell-v12';");
  expect(sw).toContain("const REV='20260925-v171';");
  expect(pwa).toContain("register('./sw.js?v=20260925-v171'");
});
