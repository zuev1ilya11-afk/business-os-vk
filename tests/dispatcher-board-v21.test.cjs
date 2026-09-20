const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('Dispatch Board v2.1 loads and is syntactically valid',()=>{
  const src=fs.readFileSync('dispatcher-board-v21.js','utf8');
  new vm.Script(src);
  const pwa=fs.readFileSync('pwa-register.js','utf8');
  assert.match(pwa,/dispatcher-board-v21\.js\?v=20260920-v21/);
});

test('Dispatch Board v2.1 contains daily operations without payroll changes',()=>{
  const src=fs.readFileSync('dispatcher-board-v21.js','utf8');
  assert.match(src,/Есть свободное окно/);
  assert.match(src,/Быстрый перенос/);
  assert.match(src,/Назначить свободному мастеру/);
  assert.match(src,/dispatchBoardV21MoveSelected/);
  assert.match(src,/dispatchBoardV21AutoAssign/);
  assert.match(src,/scheduled_date:date,scheduled_time:time/);
  assert.match(src,/resolveReschedule/);
  assert.doesNotMatch(src,/master_payout\s*[:=]/);
  assert.doesNotMatch(src,/manager_payout\s*[:=]/);
  assert.doesNotMatch(src,/dispatcher_payout\s*[:=]/);
});
