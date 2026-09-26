const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master agrees unscheduled order directly with date and time',async({page})=>{
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
  const flow=page.locator('.bosOrderFlowV179[data-mode="agreement"]');
  await expect(flow).toBeVisible();
  await expect(flow.getByRole('button',{name:'Договориться',exact:true})).toBeVisible();
  await flow.getByRole('button',{name:'Договориться',exact:true}).click();

  const form=page.locator('#masterOrderAgreementV179');
  await expect(page.getByRole('heading',{name:'Согласовать дату и время'})).toBeVisible();
  await form.locator('input[name="scheduled_date"]').fill('2099-09-15');
  await form.locator('input[name="scheduled_time"]').fill('14:30');
  await form.getByRole('button',{name:'Сохранить',exact:true}).click();

  await expect.poll(()=>db.tables.orders.find(o=>String(o.id)==='11')?.scheduled_date).toBe('2099-09-15');
  expect(db.tables.orders.find(o=>String(o.id)==='11')?.scheduled_time).toBe('14:30');
  expect(db.tables.orders.find(o=>String(o.id)==='11')?.master_called_at).toBeTruthy();
  expect(db.tables.orders.find(o=>String(o.id)==='11')?.master_agreed_at).toBeTruthy();
  await expect(page.locator('.bosOrderFlowV179[data-mode="scheduled"]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Выехал',exact:true})).toBeEnabled();
});

test('scheduled order changes date and time only through reschedule approval request',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  db.tables.orders[0].scheduled_date='2099-09-10';
  db.tables.orders[0].scheduled_time='12:00';
  db.tables.orders[0].time_slot='12:00–13:00';
  db.tables.orders[0].phone='+79990000002';
  db.tables.orders[0].master_workflow_stage='assigned';

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  const flow=page.locator('.bosOrderFlowV179[data-mode="scheduled"]');
  await expect(flow).toBeVisible();
  await expect(flow.getByRole('button',{name:'Выехал',exact:true})).toBeEnabled();
  await expect(flow.getByRole('button',{name:'Запросить перенос',exact:true})).toBeVisible();
  await expect(flow).toContainText('Требует подтверждения диспетчера или руководителя');
  await expect(page.getByRole('button',{name:'Изменить дату и время',exact:true})).toHaveCount(0);
});