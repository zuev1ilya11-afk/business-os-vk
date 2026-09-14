const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync('supabase/functions/staff-admin-api/index.ts','utf8');

test('staff admin refuses sessions when VK app secret is missing',()=>{
  assert.match(source,/if\(!s\|\|p\.length!==3/);
});

test('staff admin validates token subject and expiry formats',()=>{
  assert.match(source,/\^\[A-Za-z0-9_-\]\{1,128\}\$/);
  assert.match(source,/\^\\d\{1,12\}\$/);
});

test('staff admin compares HMAC without direct string equality',()=>{
  assert.match(source,/let mismatch=0/);
  assert.match(source,/mismatch\|=exp\.charCodeAt\(i\)\^p\[2\]\.charCodeAt\(i\)/);
  assert.doesNotMatch(source,/await hmac\(`\$\{p\[0\]\}\.\$\{p\[1\]\}`\s*,\s*s\)===p\[2\]/);
});
