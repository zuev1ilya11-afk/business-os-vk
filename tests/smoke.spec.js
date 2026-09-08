const { test, expect } = require('@playwright/test');

test('orders can be created, edited twice, and employee can be added', async ({ page }) => {
  const data = { orders: [], users: [], masters: [] };

  await page.route('https://unpkg.com/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.vkBridge={send:()=>Promise.resolve({})};' });
  });

  await page.route('https://script.google.com/macros/s/**', async route => {
    const u = new URL(route.request().url());
    const action = u.searchParams.get('action') || 'bootstrap';
    const callback = u.searchParams.get('callback') || 'callback';
    let payload = {};
    try { payload = JSON.parse(u.searchParams.get('payload') || '{}'); } catch (_) {}
    let result = { ok: true };

    if (action === 'bootstrap') {
      result = { ok: true, user: { full_name: 'Илья', role: 'owner', city: 'Москва' }, orders: data.orders, users: data.users, masters: data.masters, sources: [{ source: 'VK' }], settings: {} };
    } else if (action === 'createOrder') {
      const order = { id: 'TEST-1', status: payload.master_vk_id ? 'Назначена' : (payload.status || 'Новая'), master_name: '', master_payout: 0, ...payload };
      data.orders.unshift(order); result = { ok: true, order };
    } else if (action === 'updateOrder') {
      const i = data.orders.findIndex(x => x.id === payload.id);
      data.orders[i] = { ...data.orders[i], ...payload };
      result = { ok: true, order: data.orders[i] };
    } else if (action === 'addEmployee') {
      const user = { vk_user_id: 'staff_test', full_name: payload.full_name, phone: payload.phone || '', city: payload.city || 'Москва', role: payload.role || 'master', is_active: true };
      const master = user.role === 'master' ? { ...user, specialization: payload.specialization || '', work_start: payload.work_start || '09:00', work_end: payload.work_end || '18:00' } : null;
      data.users.push(user); if (master) data.masters.push(master);
      result = { ok: true, user, master };
    }
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: `${callback}(${JSON.stringify(result)});` });
  });

  await page.goto('/');
  await expect(page.getByText('Business OS', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Заявки' }).click();
  await page.getByRole('button', { name: '+ Новая' }).click();
  await page.locator('input[name="client"]').fill('Тест');
  await page.locator('input[name="address"]').fill('Тестовый адрес');
  await page.locator('input[name="work"]').fill('Монтаж');
  await page.locator('input[name="amount"]').fill('1000');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('TEST-1')).toBeVisible();

  await page.getByText('TEST-1').click();
  await page.getByRole('button', { name: 'Редактировать' }).click();
  await page.locator('input[name="work"]').fill('Монтаж 2');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Монтаж 2')).toBeVisible();

  await page.getByText('TEST-1').click();
  await page.getByRole('button', { name: 'Редактировать' }).click();
  await page.locator('input[name="work"]').fill('Монтаж 3');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Монтаж 3')).toBeVisible();

  await page.getByRole('button', { name: 'Команда' }).click();
  await page.getByRole('button', { name: '+ Сотрудник' }).click();
  await page.locator('input[name="full_name"]').fill('Александр');
  await page.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByText('Александр')).toBeVisible();
});
