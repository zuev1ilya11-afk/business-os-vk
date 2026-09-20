const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('desktop dispatcher runtime is loaded and syntactically valid',()=>{
  const ui=fs.readFileSync('dispatcher-desktop-v89.js','utf8');
  const compat=fs.readFileSync('dispatcher-desktop-compat-v90.js','utf8');
  const loader=fs.readFileSync('pwa-register.js','utf8');

  assert.match(loader,/dispatcher-desktop-v89\.js/);
  assert.match(loader,/dispatcher-desktop-compat-v90\.js/);
  assert.doesNotThrow(()=>new Function(ui));
  assert.doesNotThrow(()=>new Function(compat));
  assert.match(ui,/const DESKTOP_MIN=1050/);
  assert.match(ui,/String\(state\.user\?\.role\|\|''\)==='dispatcher'/);
  assert.match(compat,/Сохранить изменения/);
});

test('desktop dispatcher exposes the core operational queue',()=>{
  const ui=fs.readFileSync('dispatcher-desktop-v89.js','utf8');

  assert.match(ui,/ДИСПЕТЧЕРСКАЯ/);
  assert.match(ui,/Очередь заявок/);
  assert.match(ui,/Без мастера/);
  assert.match(ui,/Просрочено/);
  assert.match(ui,/Нужно перенести/);
  assert.match(ui,/reschedule_requested/);
  assert.match(ui,/reschedule_reason/);
  assert.match(ui,/Мастера сегодня/);
  assert.match(ui,/Поиск по номеру, клиенту, телефону, адресу, работе/);
});

test('desktop dispatcher keeps existing backend actions and mobile fallback',()=>{
  const ui=fs.readFileSync('dispatcher-desktop-v89.js','utf8');

  assert.match(ui,/return previousOrders\(\)/);
  assert.match(ui,/api\('updateOrder'/);
  assert.match(ui,/master_vk_id:master/);
  assert.match(ui,/openOrderForm\('/);
  assert.match(ui,/href=\"tel:/);
  assert.match(ui,/reloadData\(true\)/);
});

test('desktop dispatcher preserves legacy order selectors used by audited workflows',()=>{
  const ui=fs.readFileSync('dispatcher-desktop-v89.js','utf8');

  assert.match(ui,/id=\"bosOrderSearch\"/);
  assert.match(ui,/id=\"bosOrderMaster\"/);
  assert.match(ui,/bosFilteredOrder/);
  assert.match(ui,/m\?\.vk_user_id/);
  assert.match(ui,/getFullYear\(\)/);
});
