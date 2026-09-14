const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master orders can be filtered by day and upcoming orders are grouped by date',async({page})=>{
  const {db,master}=await fullStack(page,'owner');
  const mine=db.tables.orders[0];
  mine.status='В работе';
  mine.master_staff_id=master.id;
  mine.master_name=master.full_name;
  mine.master_vk_id=master.external_id;
  mine.scheduled_date='2099-09-10';
  mine.scheduled_time='10:00';
  db.tables.orders.push({...mine,id:'day-filter-2',work:'Вторая заявка',scheduled_date:'2099-09-11',scheduled_time:'12:00'});

  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(({masterVkId})=>enterMasterPreview(masterVkId),{masterVkId:master.external_id});

  await expect(page.getByText('Ближайшие заявки')).toBeVisible();
  const upcoming=page.locator('.masterUpcomingCompact');
  await expect(upcoming).toHaveCount(2);
  await expect(upcoming.nth(0)).toContainText('Монтаж');
  await expect(upcoming.nth(1)).toContainText('Вторая заявка');

  await page.getByRole('button',{name:'Все',exact:true}).click();
  await expect(page.getByText('Мои заявки')).toBeVisible();
  await expect(page.locator('.masterDayFilters')).toBeVisible();

  const firstDateButton=page.locator('.masterDayFilters button').nth(1);
  await firstDateButton.click();
  await expect(page.locator('.masterDayGroup')).toHaveCount(1);
  await expect(page.getByText('Монтаж')).toBeVisible();
  await expect(page.getByText('Вторая заявка')).toHaveCount(0);
});
