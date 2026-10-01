const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('Dispatch Board v2 is loaded and syntactically valid',()=>{
  const ui=fs.readFileSync('dispatcher-board-v92.js','utf8');
  const loader=fs.readFileSync('pwa-register.js','utf8');
  assert.match(loader,/dispatcher-board-v92\.js/);
  assert.doesNotThrow(()=>new Function(ui));
  assert.match(ui,/const MIN_DESKTOP=1050/);
  assert.match(ui,/Расписание мастеров/);
  assert.match(ui,/Требует внимания/);
  assert.match(ui,/Перетаскивайте заявки между мастерами и временем/);
});

test('Dispatch Board keeps audited order selectors and desktop fallback',()=>{
  const ui=fs.readFileSync('dispatcher-board-v92.js','utf8');
  assert.match(ui,/id=\"bosOrderSearch\"/);
  assert.match(ui,/id=\"bosOrderMaster\"/);
  assert.match(ui,/bosFilteredOrder/);
  assert.match(ui,/return previousOrders\(\)/);
  assert.match(ui,/boardView!=='board'\?listHtml\(\):boardHtml\(\)/);
});

test('Dispatch Board reuses existing APIs and protects requested reschedules',()=>{
  const ui=fs.readFileSync('dispatcher-board-v92.js','utf8');
  assert.match(ui,/api\('updateOrder',payload\)/);
  assert.match(ui,/metaCall\('resolveReschedule'/);
  assert.match(ui,/master_vk_id:masterVkValue/);
  assert.match(ui,/reschedule_requested:false/);
  assert.match(ui,/hasConflict/);
  assert.match(ui,/confirm\(`/);
});

test('Hands payout remains 85% then 65%; direct source uses the approved 60%',()=>{
  const api=fs.readFileSync('supabase/functions/mini-app-api/index.ts','utf8');
  assert.match(api,/orderPayroll\.calculate/);
  const payroll=require('../order-payroll.js');
  assert.equal(payroll.calculate(1000,{external_source:'hands'}).master_payout,552.5);
  assert.equal(payroll.calculate(1000,{source:'Авито'}).master_payout,600);
});
