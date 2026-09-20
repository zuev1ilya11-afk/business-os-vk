const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('dispatcher reschedules requested order from desktop workspace',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  const {db}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[0],{
    scheduled_date:'2099-09-10',
    scheduled_time:'10:00',
    time_slot:'10:00–11:00',
    reschedule_requested:true,
    reschedule_reason:'Клиент попросил перенести',
    reschedule_requested_at:'2099-09-01T10:00:00Z',
    reschedule_requested_by:'m'
  });

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.getByRole('button',{name:'Перенести заявку'})).toBeVisible();
  await page.getByRole('button',{name:'Перенести заявку'}).click();
  await expect(page.locator('#dispatcherRescheduleForm')).toBeVisible();
  await expect(page.locator('.dispatcherRescheduleReason')).toContainText('Клиент попросил перенести');

  await page.locator('#dispatcherRescheduleForm [name=scheduled_date]').fill('2099-09-12');
  await page.locator('#dispatcherRescheduleForm [name=scheduled_time]').fill('13:30');
  await page.getByRole('button',{name:'Подтвердить перенос'}).click();

  await expect(page.locator('#dispatcherRescheduleForm')).toHaveCount(0);
  expect(db.tables.orders[0].scheduled_date).toBe('2099-09-12');
  expect(db.tables.orders[0].scheduled_time).toBe('13:30');
  expect(db.tables.orders[0].reschedule_requested).toBe(false);
  expect(db.tables.orders[0].reschedule_reason).toBeNull();
  expect(db.tables.orders[0].amount).toBe(1000);
  expect(db.tables.orders[0].master_staff_id).toBe('m');
});
