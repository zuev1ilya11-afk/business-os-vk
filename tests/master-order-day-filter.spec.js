const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master orders are grouped by date and can be filtered by day',async({page})=>{
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

  // Master preview now opens the real orders screen directly. Verify the
  // production grouping contract instead of the removed upcoming widget.
  await expect(page.getByText('Мои заявки',{exact:true})).toBeVisible();
  await expect(page.locator('.masterDayFilters')).toBeVisible();
  await expect(page.locator('.masterDayGroup')).toHaveCount(2);

  const firstGroup=page.locator('.masterDayGroup[data-master-day="2099-09-10"]');
  const secondGroup=page.locator('.masterDayGroup[data-master-day="2099-09-11"]');
  await expect(firstGroup).toHaveCount(1);
  await expect(secondGroup).toHaveCount(1);
  await expect(firstGroup).toContainText('№ 11');
  await expect(firstGroup).toContainText('10:00');
  await expect(firstGroup).toContainText('Монтаж');
  await expect(secondGroup).toContainText('№ day-filter-2');
  await expect(secondGroup).toContainText('12:00');
  await expect(secondGroup).toContainText('Вторая заявка');

  const allFilter=page.locator('[data-master-day-filter="all"]');
  const firstDateFilter=page.locator('[data-master-day-filter="2099-09-10"]');
  const secondDateFilter=page.locator('[data-master-day-filter="2099-09-11"]');
  await expect(allFilter).toHaveAttribute('aria-pressed','true');

  await firstDateFilter.click();
  await expect(page.locator('.masterDayGroup')).toHaveCount(1);
  await expect(firstGroup).toBeVisible();
  await expect(secondGroup).toHaveCount(0);
  await expect(firstDateFilter).toHaveAttribute('aria-pressed','true');

  await secondDateFilter.click();
  await expect(page.locator('.masterDayGroup')).toHaveCount(1);
  await expect(page.locator('.masterDayGroup[data-master-day="2099-09-11"]')).toBeVisible();
  await expect(page.getByText('Монтаж')).toHaveCount(0);
  await expect(page.getByText('Вторая заявка')).toBeVisible();
  await expect(secondDateFilter).toHaveAttribute('aria-pressed','true');

  await allFilter.click();
  await expect(page.locator('.masterDayGroup')).toHaveCount(2);
  await expect(allFilter).toHaveAttribute('aria-pressed','true');
});
