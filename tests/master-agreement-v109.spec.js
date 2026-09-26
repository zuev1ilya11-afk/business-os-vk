const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('unscheduled order uses agreement form then enters approved master flow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders.find(o=>String(o.id)==='11');
  order.scheduled_date='';
  order.scheduled_time='';
  order.time_slot='';
  order.phone='+79990000002';
  order.master_called_at=null;
  order.master_agreed_at=null;
  order.master_workflow_stage='assigned';

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));

  const panel=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
  await expect(panel).toBeVisible();
  await expect(page.getByRole('button',{name:'Договориться',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Выехал',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Начал работу',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Отправить отчет',exact:true})).toHaveCount(0);

  await page.getByRole('button',{name:'Договориться',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Согласовать дату и время',exact:true})).toBeVisible();
  await page.locator('#masterAgreementForm input[name="scheduled_date"]').fill('2099-09-15');
  await page.locator('#masterAgreementForm input[name="scheduled_time"]').fill('14:30');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();

  await expect.poll(()=>db.tables.orders.find(o=>String(o.id)==='11')?.scheduled_date).toBe('2099-09-15');
  const saved=db.tables.orders.find(o=>String(o.id)==='11');
  expect(saved?.scheduled_time).toBe('14:30');
  expect(saved?.time_slot).toBe('14:30–15:30');
  expect(saved?.master_called_at).toBeTruthy();
  expect(saved?.master_agreed_at).toBeTruthy();
  await expect(page.locator('.bosMasterWorkflow[data-bos-v179="1"]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Выехал',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Начал работу',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Отправить отчет',exact:true})).toBeDisabled();
});

test('scheduled order changes date only through approved reschedule request',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  db.tables.orders[0].scheduled_date='2099-09-10';
  db.tables.orders[0].scheduled_time='12:00';
  db.tables.orders[0].time_slot='12:00–13:00';
  db.tables.orders[0].master_workflow_stage='assigned';

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));

  const panel=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Требует подтверждения диспетчера или руководителя');
  await expect(page.getByRole('button',{name:'Запросить перенос',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Изменить дату и время',exact:true})).toHaveCount(0);

  await page.getByRole('button',{name:'Запросить перенос',exact:true}).click();
  await expect(page.locator('#masterRescheduleForm')).toBeVisible();
  await expect(page.getByRole('heading',{name:/Нужно перенести заявку/})).toBeVisible();
});
