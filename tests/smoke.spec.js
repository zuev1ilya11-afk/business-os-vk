const { test, expect } = require('@playwright/test');

test('core buttons, owner finance, team calendar, editing, team and master schedule work', async ({ page }) => {
  const seedMaster = { vk_user_id: 'master_seed', full_name: 'Александр Мастер', phone: '70000000000', city: 'Москва', role: 'master', is_active: true, specialization: 'Монтаж', work_start: '09:00', work_end: '18:00' };
  const data = {
    orders: [{ id: 'DONE-1', status: 'Выполнена', client: 'Клиент', address: 'Адрес', work: 'Монтаж', amount: 2300, original_amount: 2800, master_vk_id: 'master_seed', master_name: 'Александр Мастер', master_payout: 1270.75, manager_payout: 367.54, dispatcher_payout: 275.66, extra_work_amount: 300, uncompleted_work_amount: 500 }],
    users: [seedMaster], masters: [seedMaster], masterSchedule: []
  };

  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api**', async route => {
    const u = new URL(route.request().url());
    const action = u.searchParams.get('action') || 'bootstrap';
    const callback = u.searchParams.get('callback') || 'callback';
    let payload = {};
    try { payload = JSON.parse(u.searchParams.get('payload') || '{}'); } catch (_) {}
    let result = { ok: true };
    if (action === 'bootstrap') result = { ok:true, user:{full_name:'Илья',role:'owner',city:'Москва'}, orders:data.orders, users:data.users, masters:data.masters, sources:[{source:'VK'}], settings:{}, masterSchedule:data.masterSchedule };
    else if (action === 'createOrder') { const order={id:'TEST-1',status:payload.status||'В работе',master_name:'',master_payout:0,...payload}; data.orders.unshift(order); result={ok:true,order}; }
    else if (action === 'updateOrder') { const i=data.orders.findIndex(x=>x.id===payload.id); data.orders[i]={...data.orders[i],...payload}; result={ok:true,order:data.orders[i]}; }
    else if (action === 'addEmployee') { const user={vk_user_id:'staff_test',full_name:payload.full_name,phone:payload.phone||'',city:payload.city||'Москва',role:payload.role||'master',is_active:true}; const master=user.role==='master'?{...user,specialization:payload.specialization||'',work_start:payload.work_start||'09:00',work_end:payload.work_end||'18:00'}:null; data.users.push(user); if(master)data.masters.push(master); result={ok:true,user,master}; }
    else if (action === 'saveMasterSchedule') { data.masterSchedule=(payload.days||[]).map(d=>({...d,master_vk_id:payload.master_vk_id,week_start:payload.week_start})); result={ok:true,schedule:data.masterSchedule}; }
    await route.fulfill({status:200,contentType:'application/javascript',body:`${callback}(${JSON.stringify(result)});`});
  });

  await page.goto('/');
  await expect(page.getByText('Business OS', { exact:true }).first()).toBeVisible();
  await expect(page.getByText('Допработы', { exact:true }).first()).toBeVisible();
  await expect(page.getByText('300 ₽', { exact:true }).first()).toBeVisible();
  await expect(page.getByText('Невыполненные работы', { exact:true })).toBeVisible();
  await expect(page.getByText('− 500 ₽', { exact:true })).toBeVisible();

  await page.getByRole('button', { name:'График' }).click();
  await expect(page.getByText('График мастеров', { exact:true })).toBeVisible();
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

  await page.getByRole('button', { name:'Профиль' }).click();
  await page.getByRole('button', { name:'Войти как Александр Мастер' }).click();
  await expect(page.getByText('КАБИНЕТ МАСТЕРА')).toBeVisible();
  await page.getByRole('button', { name:'График' }).click();
  await expect(page.getByRole('button', { name:'Все дни' })).toBeVisible();
});