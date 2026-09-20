const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('dispatch control v2.4 is syntactically valid and loaded after day plan',()=>{
  const src=fs.readFileSync('dispatcher-control-v24.js','utf8');
  assert.doesNotThrow(()=>new Function(src));
  const loader=fs.readFileSync('pwa-register.js','utf8');
  assert.match(loader,/dispatcher-control-v24\.js\?v=20260920-v24/);
  assert.ok(loader.indexOf('dispatcher-control-v24.js')>loader.indexOf('dispatcher-board-v23.js'));
});

test('v2.4 classifies operational problems without changing orders',()=>{
  const src=fs.readFileSync('dispatcher-control-v24.js','utf8');
  for(const text of ['Нужно перенести','Без мастера','Просрочено','Конфликт времени','Время прошло','Без даты/времени'])assert.match(src,new RegExp(text));
  assert.match(src,/conflictsMap/);
  assert.match(src,/pastTime/);
  assert.doesNotMatch(src,/api\('updateOrder'/);
  assert.doesNotMatch(src,/master_payout\s*=/);
});

test('v2.4 stays dispatcher desktop-only and keeps legacy views',()=>{
  const src=fs.readFileSync('dispatcher-control-v24.js','utf8');
  assert.match(src,/MIN_DESKTOP=1050/);
  assert.match(src,/state\?\.user\?\.role/);
  assert.match(src,/dbViewTabs button/);
  assert.match(src,/sessionStorage/);
});
