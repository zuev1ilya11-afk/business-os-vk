const {test, expect} = require('@playwright/test');
const {fullStack} = require('./helpers/full-stack.cjs');

test('Avito setup stays local and prefills an order', async ({page}) => {
  const errors = [];
  const externalCalls = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.url().includes('/avito-api')) externalCalls.push(request.url());
  });

  const {db} = await fullStack(page, 'owner');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  await page.locator('#ownerToolsBtn').click();
  const avito = page.getByRole('button', {name: /Авито/});
  await expect(avito).toContainText('Подготовка');
  await avito.click();
  await expect(page.locator('.avitoSetupCard')).toContainText('Подготовительный режим');
  expect(externalCalls).toEqual([]);

  await page.getByRole('button', {name: 'Входящие Авито'}).click();
  await expect(page.locator('.avitoExisting')).toContainText('Борис');

  await page.getByRole('button', {name: '+ Добавить обращение вручную'}).click();
  const manual = page.locator('#avitoManualForm');
  await manual.locator('[name="client"]').fill('Клиент Авито');
  await manual.locator('[name="phone"]').fill('+79995554433');
  await manual.locator('[name="address"]').fill('Лиговский 10');
  await manual.locator('[name="work"]').fill('Установка карниза');
  await manual.locator('[name="item_url"]').fill('https://example.invalid/ad');
  await manual.locator('[name="message"]').fill('Нужно установить завтра');
  await page.getByRole('button', {name: 'Перенести в заявку'}).click();

  const order = page.locator('#orderForm');
  await expect(order).toBeVisible();
  await expect(page.locator('.avitoDraftNotice')).toContainText('Заявка подготовлена из обращения');
  await expect(order.locator('[name="client"]')).toHaveValue('Клиент Авито');
  await expect(order.locator('[name="phone"]')).toHaveValue('+79995554433');
  await expect(order.locator('[name="address"]')).toHaveValue('Лиговский 10');
  await expect(order.locator('[name="work"]')).toHaveValue('Установка карниза');
  await expect(order.locator('[name="source"]')).toHaveValue('Авито');
  await expect(order.locator('[name="comment"]')).toHaveValue(/Нужно установить завтра/);

  expect(db.tables.orders).toHaveLength(2);
  expect(externalCalls).toEqual([]);
  expect(errors).toEqual([]);
});
