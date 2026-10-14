const { fullStack } = require('./full-stack.cjs');
const { employee } = require('./edge.cjs');

// A busy day and an undated queue expose clipping that two-row fixtures cannot.
async function dispatchScrollFixture(page, role = 'owner') {
  await page.clock.setFixedTime(new Date('2026-10-14T09:00:00Z'));
  const fixture = await fullStack(page, role);
  const { db, master } = fixture;
  master.full_name = 'Мастер 01';
  const masters = [master];
  for (let i = 2; i <= 12; i++) {
    const person = employee(`scroll-${i}`, 'master', {
      full_name: `Мастер ${String(i).padStart(2, '0')}`, city: 'Санкт-Петербург'
    });
    db.tables.business_staff.push(person);
    masters.push(person);
  }
  db.tables.orders = Array.from({ length: 30 }, (_, i) => ({
    id: String(501 + i), external_id: `hands:${7400501 + i}`,
    client: `Клиент ${String(i + 1).padStart(2, '0')}`, phone: '+70000000000',
    address: `Тестовая улица, дом ${i + 1}, квартира 15`,
    work: 'Установка карниза и монтаж штор. Проверить крепления и высоту установки.',
    amount: 2800 + i * 100, original_amount: 2800 + i * 100,
    status: 'В работе', source: 'Hands', city: 'Санкт-Петербург',
    master_staff_id: i < 12 ? masters[i].id : null,
    master_name: i < 12 ? masters[i].full_name : '',
    scheduled_date: i < 12 ? '2026-10-14' : null,
    scheduled_time: i < 12 ? '12:00' : null,
    time_slot: i < 12 ? '12:00–13:00' : '',
    master_workflow_stage: 'assigned', created_at: `2026-10-13T10:${String(i).padStart(2, '0')}:00Z`,
    reschedule_requested: i === 12,
    reschedule_reason: i === 12 ? 'Клиент просит согласовать новую дату' : null
  }));
  db.tables.staff_schedule = masters.map((person, i) => ({
    id: `day-${i}`, staff_id: person.id, work_date: '2026-10-14',
    is_working: i !== 10, work_start: '10:00', work_end: '21:00'
  }));
  await page.route(/\/(?:api\/proxy|functions\/v1)\/push-api(?:\?|$)/, async route => {
    if (route.request().postDataJSON()?.action !== 'controlList') return route.fallback();
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,tasks:[],staff:db.tables.business_staff.map(s=>({id:s.id,name:s.full_name,role:s.role,has_push:false})),reminders_enabled:false,more:false})});
  });
  return fixture;
}

module.exports = { dispatchScrollFixture };
