const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('notification center v2.6 is loaded and parses',()=>{
  const loader=fs.readFileSync('pwa-register.js','utf8');
  assert.match(loader,/notification-center-v26\.js/);
  const source=fs.readFileSync('notification-center-v26.js','utf8');
  assert.doesNotThrow(()=>new Function(source));
});

test('notification center covers required dispatcher and master signals',()=>{
  const source=fs.readFileSync('notification-center-v26.js','utf8');
  for(const token of ['reschedule_requested','unassigned:','overdue:','Новая заявка','Изменено время заявки','bosNotificationBell'])assert.ok(source.includes(token),token);
  assert.ok(!source.includes('service_role'));
  assert.ok(!source.includes("api('updateOrder'"));
});
