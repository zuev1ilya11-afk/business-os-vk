const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('Android back navigation keeps an in-app history stack',()=>{
  const source=fs.readFileSync('android-navigation-v112.js','utf8');
  assert.doesNotThrow(()=>new Function(source));
  assert.match(source,/history\.pushState/);
  assert.match(source,/addEventListener\('popstate'/);
  assert.match(source,/kind:'guard'/);
  assert.match(source,/rawCloseModal/);
  assert.match(source,/rawShow\('home'\)/);
});

test('authorized sessions are persistent and silently renewed',()=>{
  const edge=fs.readFileSync('supabase/functions/password-session-api/index.ts','utf8');
  const refresh=fs.readFileSync('session-refresh-v113.js','utf8');
  const register=fs.readFileSync('pwa-register.js','utf8');
  assert.match(edge,/SESSION_TTL_SECONDS=60\*60\*24\*365/);
  assert.match(edge,/action==='refresh'/);
  assert.match(refresh,/action:'refresh'/);
  assert.match(refresh,/localStorage\.setItem\(KEY,token\)/);
  assert.match(register,/android-navigation-v112\.js/);
  assert.match(register,/session-refresh-v113\.js/);
});
