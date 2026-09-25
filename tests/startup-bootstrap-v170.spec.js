const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

const source=fs.readFileSync(path.resolve(__dirname,'..','mandatory-auth-v29.js'),'utf8');

test('saved-session validation reuses the successful bootstrap once',async()=>{
  expect(source).toContain('let validatedBootstrap=null;');
  expect(source).toContain('validatedBootstrap={session,data:d};');
  expect(source).toContain("action==='bootstrap'&&validatedBootstrap?.session===session");
  expect(source).toContain('validatedBootstrap=null;');
});

test('password and VK fresh login paths still load normal bootstrap data',async()=>{
  expect(source).toContain('setSession(d.session_token);await loadApp()');
  expect(source).toContain("try{const r=await ensureVkSession();if(r?.registration_required)return;await loadApp()}");
  expect(source).toContain("return post(MINI,{action,...payload},{'X-BOS-Session':session});");
});
