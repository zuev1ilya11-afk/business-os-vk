const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('mobile dispatcher gets cancel, master profile and visible reschedule reason',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  await page.locator('nav button[data-page="orders"]').click();
  await expect(page.locator('.opsCompactOrder')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Отменить заявку'})).toHaveCount(2);

  const assigned=page.locator('.opsCompactOrder').filter({hasText:'Анна'});
  await expect(assigned.getByRole('button',{name:'Профиль назначенного мастера'})).toBeVisible();
  await assigned.getByRole('button',{name:'Профиль назначенного мастера'}).click();
  await expect(page.locator('#modalRoot')).toContainText('Тестовый мастер');
  await page.evaluate(()=>closeModal());

  await page.evaluate(()=>{
    const order=state.orders.find(o=>String(o.id)==='11');
    Object.assign(order,{reschedule_requested:true,reschedule_reason:'Клиент просит после 18:00'});
    show('orders');
  });
  await expect(page.locator('.opsCompactOrder').filter({hasText:'Анна'}).locator('.dwv114Reason')).toContainText('Клиент просит после 18:00');

  const unassigned=page.locator('.opsCompactOrder').filter({hasText:'Борис'});
  await unassigned.getByRole('button',{name:'Отменить заявку'}).click();
  await expect(page.getByRole('heading',{name:/Отменить заявку № 12/})).toBeVisible();
  await expect(page.locator('.dwv114CancelWarning')).toContainText('Подтвердите отмену');
  await page.getByRole('button',{name:'Не отменять'}).click();
  await expect(page.getByRole('heading',{name:/Отменить заявку № 12/})).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>state.orders.find(o=>String(o.id)==='12')?.status)).toBe('В работе');

  await page.locator('.opsCompactOrder').filter({hasText:'Борис'}).getByRole('button',{name:'Отменить заявку'}).click();
  await page.locator('#dwv114CancelConfirm').click();
  await expect.poll(()=>page.evaluate(()=>state.orders.find(o=>String(o.id)==='12')?.status)).toBe('Отменена');
});

test('desktop dispatcher current board exposes the same safe quick actions',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:1280,height:850});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  await page.locator('nav button[data-page="orders"]').click();
  await expect(page.locator('.dbBoard')).toBeVisible();
  await expect(page.getByRole('button',{name:'Отменить заявку'})).toBeVisible();

  const search=page.getByPlaceholder('Поиск по заявкам');
  await search.fill('Анна');
  const assigned=page.locator('.dbOrderCard').filter({hasText:'Анна'});
  await expect(assigned).toBeVisible();
  await assigned.click();
  await expect(page.locator('.dbDetail')).toContainText('Анна');
  await expect(page.getByRole('button',{name:'Профиль назначенного мастера'})).toBeVisible();

  await page.getByRole('button',{name:'Отменить заявку'}).click();
  await expect(page.locator('.dwv114CancelSummary')).toContainText('Анна');
  await page.getByRole('button',{name:'Не отменять'}).click();
  await expect(page.locator('.dbDetail')).toBeVisible();
});
