const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('mobile dispatcher layer preserves existing order workflow and stays mobile-only',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  await page.locator('nav button[data-page="orders"]').click();
  await expect(page.locator('.bosDispatcherMobile')).toBeVisible();
  await expect(page.locator('.dmMobileTitle')).toContainText('ДИСПЕТЧЕРСКАЯ');
  await expect(page.locator('.dmMetrics button')).toHaveCount(4);
  await expect(page.locator('.opsCompactOrder')).toHaveCount(2);
  await expect(page.locator('.dmCardActions')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Открыть'})).toHaveCount(2);
  await expect(page.locator('.dmDateTimeAction')).toHaveCount(2);
  await expect(page.locator('.dmAssignAction')).toHaveCount(1);

  await page.locator('.dmMetrics button').filter({hasText:'Без мастера'}).click();
  await expect(page.locator('.opsCompactOrder')).toHaveCount(1);
  await expect(page.locator('.opsCompactOrder')).toContainText('Борис');
  await expect(page.getByRole('button',{name:'Назначить мастера'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Изменить дату и время|Перенести заявку/})).toBeVisible();

  await page.getByRole('button',{name:'Назначить мастера'}).click();
  await expect(page.locator('#quickMaster')).toBeVisible();
  await expect(page.locator('#quickMaster')).toBeFocused();
  await page.evaluate(()=>closeModal());

  await page.getByRole('button',{name:/Изменить дату и время|Перенести заявку/}).click();
  await expect(page.locator('#dispatcherRescheduleForm,#quickScheduledDate')).toBeVisible();
  await page.evaluate(()=>closeModal());

  await page.setViewportSize({width:1024,height:768});
  await expect(page.locator('.bosDispatcherMobile')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Заявки'})).toBeVisible();
});

test('owner mobile orders keep the existing management UI',async({page})=>{
  await fullStack(page,'owner');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  await page.locator('nav button[data-page="orders"]').click();
  await expect(page.locator('.bosDispatcherMobile')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Заявки'})).toBeVisible();
  await expect(page.locator('.opsCompactOrder')).toHaveCount(2);
});
