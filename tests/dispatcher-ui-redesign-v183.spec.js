const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('dispatcher redesign keeps the desktop list readable and action-focused',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  const today=new Date().toISOString().slice(0,10);
  db.tables.orders[0].scheduled_date=today;
  db.tables.orders[0].scheduled_time='10:00';
  db.tables.orders[1].scheduled_date=today;
  db.tables.orders[1].scheduled_time='12:00';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();

  await expect(page.locator('.du183Kpis')).toBeVisible();
  await expect(page.locator('.du183Kpi')).toHaveCount(4);
  await expect(page.locator('.dbLayout .dbAttention')).toBeVisible();
  await expect(page.locator('.dbLayout .dbSchedule')).toBeVisible();
  await expect(page.locator('#dispatchBoardDetail .dbDetail')).toBeVisible();

  await page.locator('.dbViewTabs button',{hasText:'Список'}).click();
  await expect(page.locator('.dbV94InlineList')).toBeVisible();
  await expect(page.locator('.dbV94ListCard').first()).toBeVisible();
  await expect(page.locator('.dbV94ListCard .du183Date').first()).toBeVisible();
  await expect(page.locator('.dbV94ListCard .du183Amount').first()).toContainText('₽');

  await page.locator('.dbV94ListCard[data-order-id="12"]').click();
  await expect(page.locator('#dispatchBoardDetail .du183PriorityAlert')).toContainText('Нет мастера');
  await expect(page.locator('#dispatchBoardDetail .du183PriorityAlert')).toContainText('Требуется назначить мастера');

  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('dispatcher desktop redesign does not replace the mobile workspace',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.du183Kpis')).toHaveCount(0);
  await expect(page.locator('#bosOrderSearch')).toBeVisible();
});
