const {test, expect} = require('@playwright/test');
const {fullStack} = require('./helpers/full-stack.cjs');

for(const workText of ['Установка карниза','Своя работа <без сверления>'])test('Avito setup stays local and prefills work: '+workText, async ({page}) => {
  const errors = [];
  const externalCalls = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.url().includes('/avito-api')) externalCalls.push(request.url());
  });

  const {db} = await fullStack(page, 'owner');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  // Keep the feature-off rollback path covered after production activation.
  await page.evaluate(()=>{window.BUSINESS_OS_CONFIG.AVITO_API_ENABLED=false;show('home')});
  await expect(page.locator('#bosAvitoNav')).toHaveCount(0);

  await page.locator('#ownerToolsBtn').click();
  const avito = page.locator('.modal').getByRole('button', {name: /Авито/});
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
  await manual.locator('[name="work"]').fill(workText);
  await manual.locator('[name="item_url"]').fill('https://example.invalid/ad');
  await manual.locator('[name="message"]').fill('Нужно установить завтра');
  await page.getByRole('button', {name: 'Перенести в заявку'}).click();

  const order = page.locator('#orderForm');
  await expect(order).toBeVisible();
  await expect(page.locator('.avitoDraftNotice')).toContainText('Заявка подготовлена из обращения');
  await expect(order.locator('[name="client"]')).toHaveValue('Клиент Авито');
  await expect(order.locator('#bosPhone')).toHaveValue('9995554433');
  await expect(order.locator('[name="address"]')).toHaveValue('Лиговский 10');
  await expect(order.locator('#bosService option:checked')).toHaveText(workText);
  await expect(order.getByRole('radio',{name:'Авито',exact:true})).toBeChecked();
  expect(await order.locator('[name="comment"]').inputValue()).toContain('Работа из Авито: '+workText);
  await expect(order.locator('[name="comment"]')).toHaveValue(/Нужно установить завтра/);

  expect(db.tables.orders).toHaveLength(2);
  await order.locator('#bosAddWork').click();await order.locator('.bosWorkSelect').nth(1).selectOption('4');
  await order.locator('#bosAddPhone').click();await order.locator('.bosPhoneInput').nth(1).fill('9211112233');
  await order.getByRole('button',{name:'Создать заявку',exact:true}).click();await expect(order).toHaveCount(0);
  expect(db.tables.orders.find(o=>o.client==='Клиент Авито')).toMatchObject({work:workText+'\nУстановка декоративного карниза длиной до 2,5 метров',phone:'+79995554433; +79211112233',source:'Авито'});
  expect(externalCalls).toEqual([]);
  expect(errors).toEqual([]);
});
