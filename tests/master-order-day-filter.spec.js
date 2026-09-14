const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master orders can be filtered by day and upcoming orders are grouped by date',async({page})=>{
  const {db,master}=await fullStack(page,'owner');
  const mine=db.tables.orders[0];
  mine.status='В работе';
  mine.master_staff_id=master.id;
  mine.master_name=master.full_name;
  mine.scheduled_date='2099-09-10';
  mine.scheduled_time='10:00';
  db.tables.orders.push({...mine,id:'13',work:'Вторая заявка',scheduled_date:'2099-09-11',scheduled_time:'12:00'});

  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(({masterVkId})=>enterMasterPreview(masterVkId),{masterVkId:master.external_id});

  await expect(page.getByText('Ближайшие заявки')).toBeVisible();
  await expect(page.locator('[data-master-day="2099-09-10"]')).toContainText('Монтаж');
  await expect(page.locator('[data-master-day="2099-09-11"]')).toContainText('Вторая заявка');

  await page.getByRole('button',{name:'Все',exact:true}).click();
  await expect(page.getByText('Мои заявки')).toBeVisible();
  await expect(page.locator('.masterDayFilters')).toBeVisible();

  await page.locator('[data-master-filter-day="2099-09-10"]').click();
  await expect(page.locator('.masterDayGroup')).toHaveCount(1);
  await expect(page.locator('[data-master-day="2099-09-10"]')).toContainText('Монтаж');
  await expect(page.getByText('Вторая заявка')).toHaveCount(0);
});
