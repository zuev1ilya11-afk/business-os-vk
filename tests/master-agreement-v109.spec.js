const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master agrees unscheduled order and then enters scheduled workflow',async({page})=>{
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
  const panel=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button',{name:/Договориться/})).toBeEnabled();
  await expect(panel.getByRole('button',{name:/Подтвердить: выехал/})).toHaveCount(0);

  await panel.getByRole('button',{name:/Договориться/}).click();
  await expect(page.getByRole('heading',{name:'Согласовать дату и время'})).toBeVisible();
  await page.locator('#masterOrderAgree179Form input[name="scheduled_date"]').fill('2099-09-15');
  await page.locator('#masterOrderAgree179Form input[name="scheduled_time"]').fill('14:30');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();

  await expect.poll(()=>db.tables.orders.find(o=>String(o.id)==='11')?.scheduled_date).toBe('2099-09-15');
  expect(db.tables.orders.find(o=>String(o.id)==='11')?.scheduled_time).toBe('14:30');
  expect(db.tables.orders.find(o=>String(o.id)==='11')?.time_slot).toBe('14:30–15:30');
  expect(db.tables.orders.find(o=>String(o.id)==='11')?.master_called_at).toBeTruthy();
  expect(db.tables.orders.find(o=>String(o.id)==='11')?.master_agreed_at).toBeTruthy();
  await expect(panel.getByRole('button',{name:/Подтвердить: выехал/})).toBeEnabled();
  await expect(panel.getByRole('button',{name:/Подтвердить: начал работу/})).toHaveCount(0);
});

test('scheduled order uses confirmed reschedule instead of direct date editing',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders.find(o=>String(o.id)==='11');
  order.scheduled_date='2099-09-10';
  order.scheduled_time='12:00';
  order.time_slot='12:00–13:00';
  order.phone='+79990000002';
  order.master_workflow_stage='assigned';

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  const panel=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button',{name:/Договориться/})).toHaveCount(0);
  await expect(panel.getByRole('button',{name:/Подтвердить: выехал/})).toBeEnabled();
  await expect(panel).toContainText('Требует подтверждения диспетчера или руководителя');
  await panel.getByRole('button',{name:'Запросить перенос',exact:true}).click();
  await expect(page.locator('#masterRescheduleForm')).toBeVisible();
});
