const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const src=fs.readFileSync('dispatcher-smart-assign-v22.js','utf8');
const reg=fs.readFileSync('pwa-register.js','utf8');

test('smart dispatcher script is loaded and syntactically valid',()=>{
  new vm.Script(src);
  assert.match(reg,/dispatcher-smart-assign-v22\.js\?v=20260920-v22/);
});

test('smart dispatcher ranks by availability, load and optional context',()=>{
  assert.match(src,/city.*score|score.*city/i);
  assert.match(src,/load\*8/);
  assert.match(src,/workingHours/);
  assert.match(src,/skillMatch/);
  assert.match(src,/district/i);
  assert.match(src,/slice\(0,3\)/);
});

test('smart dispatcher requires confirmation and delegates assignment to approved board move',()=>{
  assert.match(src,/confirm\(`Назначить/);
  assert.match(src,/window\.__dispatchBoardMove/);
  assert.doesNotMatch(src,/master_payout\s*[:=]/);
  assert.doesNotMatch(src,/amount\s*[:=]/);
});
