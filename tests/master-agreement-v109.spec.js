const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master agrees unscheduled order only after recorded client call',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders.find(o=>String(o.id)==='11');
  order.scheduled_date='';
  order.scheduled_time='';
  order.time_slot='';
  order.phone='+79990000002';
  order.master_called_at=null;
  order.master_agreed_at=null;

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  await expect(page.locator('.bosMasterWorkflow[data-bos-v115="1"]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Договорённость',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Звонок выполнен',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_called_at).toBeTruthy();
  await page.getByRole('button',{name:'Договорённость',exact:true}).click();

  await expect(page.getByRole('heading',{name:/Договорённость по заявке/})).toBeVisible();
  await page.locator('#masterAgreementForm input[name="scheduled_date"]').fill('2099-09-15');
  await page.locator('#masterAgreementForm input[name="scheduled_time"]').fill('14:30');
  await page.getByRole('button',{name:'Сохранить договорённость',exact:true}).click();

  await expect.poll(()=>db.tables.orders.find(o=>String(o.id)==='11')?.scheduled_date).toBe('2099-09-15');
  expect(db.tables.orders.find(o=>String(o.id)==='11')?.scheduled_time).toBe('14:30');
  expect(db.tables.orders.find(o=>String(o.id)==='11')?.time_slot).toBe('14:30–15:30');
  expect(db.tables.orders.find(o=>String(o.id)==='11')?.master_agreed_at).toBeTruthy();
});

test('master can change existing agreement date and time before work starts',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders[0];
  order.scheduled_date='2099-09-10';
  order.scheduled_time='12:00';
  order.time_slot='12:00–13:00';
  order.phone='+79990000002';
  order.master_called_at=null;
  order.master_agreed_at=null;

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  await page.getByRole('button',{name:'Звонок выполнен',exact:true}).click();
  await page.getByRole('button',{name:'Договорённость',exact:true}).click();

  const date=page.locator('#masterAgreementForm input[name="scheduled_date"]');
  const time=page.locator('#masterAgreementForm input[name="scheduled_time"]');
  await expect(date).toHaveValue('2099-09-10');
  await expect(time).toHaveValue('12:00');
  await date.fill('2099-09-16');
  await time.fill('13:30');
  await page.getByRole('button',{name:'Сохранить договорённость',exact:true}).click();

  await expect.poll(()=>db.tables.orders[0].master_agreed_at).toBeTruthy();
  expect(db.tables.orders[0].scheduled_date).toBe('2099-09-16');
  expect(db.tables.orders[0].scheduled_time).toBe('13:30');
  expect(db.tables.orders[0].time_slot).toBe('13:30–14:30');

  await page.evaluate(()=>window.openOrder('11'));
  await expect(page.getByRole('button',{name:'Начать работу',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Изменить дату и время',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Выехал',exact:true})).toHaveCount(0);
});