const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master can agree date and time only for own unscheduled order',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders.find(o=>String(o.id)==='11');
  order.scheduled_date='';
  order.scheduled_time='';
  order.time_slot='';

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();

  const agree=page.getByRole('button',{name:'Договориться',exact:true}).first();
  await expect(agree).toBeVisible();
  await agree.click();
  await expect(page.getByRole('heading',{name:/Договориться по заявке/})).toBeVisible();
  await page.locator('#masterAgreementForm input[name="scheduled_date"]').fill('2099-09-15');
  await page.locator('#masterAgreementForm input[name="scheduled_time"]').fill('14:30');
  await page.getByRole('button',{name:'Сохранить договорённость',exact:true}).click();

  await expect.poll(()=>db.tables.orders.find(o=>String(o.id)==='11')?.scheduled_date).toBe('2099-09-15');
  expect(db.tables.orders.find(o=>String(o.id)==='11')?.scheduled_time).toBe('14:30');
  expect(db.tables.orders.find(o=>String(o.id)==='11')?.time_slot).toBe('14:30–15:30');
  await expect(page.getByRole('button',{name:'Договориться',exact:true})).toHaveCount(0);
});

test('master cannot overwrite an already scheduled order through agreement action',async({page})=>{
  const {db}=await fullStack(page,'master');
  db.tables.orders[0].scheduled_time='12:00';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.getByRole('button',{name:'Договориться',exact:true})).toHaveCount(0);
});
