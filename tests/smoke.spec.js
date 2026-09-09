const { test, expect } = require('@playwright/test');

test('core UI loads and main actions work against Supabase API contract', async ({ page }) => {
  const seedMaster = { vk_user_id: 'master_seed', full_name: 'Александр Мастер', phone: '70000000000', city: 'Москва', role: 'master', is_active: true, specialization: 'Монтаж', work_start: '09:00', work_end: '18:00' };
  const data = {
    orders: [{ id: 'DONE-1', status: 'Выполнена', client: 'Клиент', address: 'Адрес', work: 'Монтаж', amount: 2300, original_amount: 2800, master_vk_id: 'master_seed', master_name: 'Александр Мастер', master_payout: 1270.75 }],
    users: [seedMaster], masters: [seedMaster], masterSchedule: []
  };

  await page.route(/\/(backend-version-patch|busy-fix|finance-patch|extra-work-patch|employee-profile-patch|role-preview-patch|master-calendar-patch|master-report-patch|report-supabase-patch|team-calendar-patch|claims-patch|claims-runtime-patch|dispatcher-report-patch|visual-polish|status-visual-patch)\.js/, route => route.fulfill({status:200,contentType:'application/javascript',body:''}));

  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api', async route => {
    let body = {};
    try { body = route.request().postDataJSON() || {}; } catch (_) {}
    const action = body.action || 'bootstrap';
    let result = { ok: true };
    if (action === 'bootstrap') result = { ok:true, user:{full_name:'Илья',role:'owner',city:'Москва'}, orders:data.orders, users:data.users, masters:data.masters, sources:[{source:'VK'}], settings:{}, masterSchedule:data.masterSchedule };
    else if (action === 'createOrder') { const order={id:'TEST-1',status:body.status||'В работе',master_name:'',master_payout:0,...body}; delete order.action; data.orders.unshift(order); result={ok:true,order}; }
    else if (action === 'updateOrder') { const i=data.orders.findIndex(x=>String(x.id)===String(body.id)); data.orders[i]={...data.orders[i],...body}; delete data.orders[i].action; result={ok:true,order:data.orders[i]}; }
    else if (action === 'addEmployee') { const user={vk_user_id:'staff_test',full_name:body.full_name,phone:body.phone||'',city:body.city||'Москва',role:body.role||'master',is_active:true}; const master=user.role==='master'?{...user,specialization:body.specialization||'',work_start:body.work_start||'09:00',work_end:body.work_end||'18:00'}:null; data.users.push(user); if(master)data.masters.push(master); result={ok:true,user,master}; }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Business OS', { exact:true }).first()).toBeVisible();
  await expect(page.getByText('Google Sheets синхронизированы с приложением.')).toBeVisible();

  await page.getByRole('button', { name:'Заявки' }).click();
  await page.getByRole('button', { name:'+ Новая' }).click();
  await page.locator('input[name="client"]').fill('Тест');
  await page.locator('input[name="address"]').fill('Тестовый адрес');
  await page.locator('input[name="work"]').fill('Монтаж');
  await page.locator('input[name="amount"]').fill('1000');
  await page.getByRole('button', { name:'Сохранить' }).click();
  await expect(page.getByText('TEST-1')).toBeVisible();

  await page.getByText('TEST-1').click();
  await page.getByRole('button', { name:'Редактировать' }).click();
  await page.locator('input[name="work"]').fill('Монтаж 2');
  await page.getByRole('button', { name:'Сохранить' }).click();
  await expect(page.getByText('Монтаж 2')).toBeVisible();

  await page.getByRole('button', { name:'Команда' }).click();
  await page.getByRole('button', { name:'+ Сотрудник' }).click();
  await page.locator('input[name="full_name"]').fill('Новый мастер');
  await page.getByRole('button', { name:'Добавить' }).click();
  await expect(page.getByText('Новый мастер')).toBeVisible();

  await page.getByRole('button', { name:'График' }).click();
  await expect(page.getByText('График', { exact:true }).first()).toBeVisible();
});