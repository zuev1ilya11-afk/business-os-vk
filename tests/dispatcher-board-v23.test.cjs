const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('dispatcher board v2.3 is syntactically valid and loaded after v2.2',()=>{
  const src=fs.readFileSync('dispatcher-board-v23.js','utf8');
  assert.doesNotThrow(()=>new Function(src));
  const loader=fs.readFileSync('pwa-register.js','utf8');
  assert.match(loader,/dispatcher-smart-assign-v22\.js/);
  assert.match(loader,/dispatcher-board-v23\.js\?v=20260920-v23/);
  assert.ok(loader.indexOf('dispatcher-board-v23.js')>loader.indexOf('dispatcher-smart-assign-v22.js'));
});

test('v2.3 keeps assignment on the existing safe dispatch move path',()=>{
  const src=fs.readFileSync('dispatcher-board-v23.js','utf8');
  assert.match(src,/dispatchBoardDrop\(event/);
  assert.match(src,/dispatchBoardDragStart\(event/);
  assert.match(src,/data-master=/);
  assert.match(src,/data-time=/);
  assert.doesNotMatch(src,/api\('updateOrder'/);
  assert.doesNotMatch(src,/master_payout\s*=/);
});

test('v2.3 is desktop-only and preserves legacy views',()=>{
  const src=fs.readFileSync('dispatcher-board-v23.js','utf8');
  assert.match(src,/MIN_DESKTOP=1050/);
  assert.match(src,/План дня/);
  assert.match(src,/sessionStorage/);
  assert.match(src,/show\('orders'\)/);
  assert.match(src,/dbViewTabs button/);
});
