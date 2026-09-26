const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const order11=db=>db.tables.orders.find(o=>String(o.id)==='11');

test('master follows departed started report flow for a scheduled order',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=order11(db);
  order.scheduled_date=localDate();
  order.scheduled_time='10:00';
  order.time_slot='10:00–11:00';
  order.master_workflow_stage='assigned';
  order.master_called_at=null;
  order.master_agreed_at=null;
  order.phone='+79990000002';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await expect(page.locator('#masterDailyV127')).toBeVisible();
  await expect(page.locator('.bosMasterTodayWorkflow:visible')).toHaveCount(0);
  await page.evaluate(()=>window.openOrder('11'));
  const workflow=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
  await expect(workflow).toBeVisible();
  await expect(workflow.getByRole('button',{name:'Запросить перенос',exact:true})).toBeVisible();
  await expect(workflow.getByRole('button',{name:/Выехал/})).toBeEnabled();
  await expect(workflow.getByRole('button',{name:/Начал работу/})).toBeDisabled();
  await expect(workflow.getByRole('button',{name:/Отправить отчет/})).toBeDisabled();

  await workflow.getByRole('button',{name:/Выехал/}).click();
  await expect.poll(()=>order11(db)?.master_workflow_stage).toBe('departed');
  await expect(workflow.getByRole('button',{name:/Начал работу/})).toBeEnabled();

  await workflow.getByRole('button',{name:/Начал работу/}).click();
  await expect.poll(()=>order11(db)?.master_workflow_stage).toBe('started');
  expect(order11(db)?.master_started_at).toBeTruthy();
  await expect(workflow.getByRole('button',{name:/Отправить отчет/})).toBeEnabled();

  const amount=order11(db).amount,payout=order11(db).master_payout;
  await workflow.getByRole('button',{name:/Отправить отчет/}).click();
  await expect(page.locator('#masterReportForm')).toBeVisible();
  expect(order11(db).amount).toBe(amount);
  expect(order11(db).master_payout).toBe(payout);
});

test('legacy arrived stage maps to departed and can continue directly to work',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=order11(db);
  order.scheduled_date=localDate();
  order.scheduled_time='10:00';
  order.phone='+79990000002';
  order.master_workflow_stage='arrived';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  const workflow=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
  await expect(workflow).toBeVisible();
  await expect(workflow).not.toContainText('На месте');
  await expect(workflow.getByRole('button',{name:/Выехал/})).toBeDisabled();
  await expect(workflow.getByRole('button',{name:/Начал работу/})).toBeEnabled();
  await workflow.getByRole('button',{name:/Начал работу/}).click();
  await expect.poll(()=>order11(db)?.master_workflow_stage).toBe('started');
});

test('dispatcher sees simplified field workflow without changing order values',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  const order=order11(db);
  order.scheduled_date=localDate();
  order.scheduled_time='19:00';
  order.master_workflow_stage='started';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.bosFieldOpsBar')).toBeVisible();
  await expect(page.locator('.bosFieldOpsBar')).toContainText('В работе: 1');
  await expect(page.locator('.bosFieldOpsBar')).not.toContainText('В дороге:');
  await expect(page.locator('.bosFieldOpsBar')).not.toContainText('На месте:');
  await expect.poll(()=>page.evaluate(()=>state.orders.find(o=>String(o.id)==='11')?.master_workflow_stage)).toBe('started');
  expect(order11(db).status).toBe('В работе');
  expect(order11(db).amount).toBe(1000);
});
