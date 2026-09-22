const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('master advances with explicit stage buttons, exposes reschedule, and finishes through report form',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].scheduled_time='10:00';
  db.tables.orders[0].master_workflow_stage='assigned';
  db.tables.orders[0].phone='+79990000002';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await expect(page.locator('.bosMasterTodayWorkflow')).toBeVisible();
  await page.evaluate(()=>window.openOrder('11'));
  await expect(page.locator('.bosMasterWorkflow[data-bos-v26="1"]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Нужно перенести'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Я на месте'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Выехал',exact:true})).toBeVisible();
  await page.evaluate(()=>window.masterWorkflowCallAndAdvance(null,'11','departed'));
  expect(db.tables.orders[0].master_workflow_stage).toBe('assigned');
  await expect(page.getByRole('link',{name:'Позвонить клиенту',exact:true})).toBeVisible();

  await page.getByRole('button',{name:'Выехал',exact:true}).click();
  await expect(page.locator('.bosMasterWorkflow')).toContainText('Выехал');
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('departed');
  expect(db.tables.orders[0].master_departed_at).toBeTruthy();
  await expect(page.getByRole('link',{name:'Позвонить клиенту',exact:true})).toBeVisible();

  await page.getByRole('button',{name:'Работа начата',exact:true}).click();
  await expect(page.locator('.bosMasterWorkflow')).toContainText('Работа начата');
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('started');
  expect(db.tables.orders[0].master_started_at).toBeTruthy();
  await expect(page.getByRole('button',{name:'Завершить и прикрепить отчёт'})).toBeVisible();

  const amount=db.tables.orders[0].amount,payout=db.tables.orders[0].master_payout;
  await page.getByRole('button',{name:'Завершить и прикрепить отчёт'}).click();
  await expect(page.locator('#masterReportForm')).toBeVisible();
  expect(db.tables.orders[0].amount).toBe(amount);
  expect(db.tables.orders[0].master_payout).toBe(payout);
});

test('legacy arrived stage is hidden and treated as departed',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].phone='+79990000002';
  db.tables.orders[0].master_workflow_stage='arrived';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  await expect(page.locator('.bosMasterWorkflow[data-bos-v26="1"]')).toBeVisible();
  await expect(page.locator('.bosMasterWorkflow')).not.toContainText('На месте');
  await expect(page.getByRole('link',{name:'Позвонить клиенту',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Работа начата',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('started');
});

test('dispatcher v2.6 sees field workflow stage without changing order',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].scheduled_time='19:00';
  db.tables.orders[0].master_workflow_stage='started';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.bosFieldOpsBar')).toBeVisible();
  await expect(page.locator('.bosFieldOpsBar')).toContainText('В работе: 1');
  await expect(page.locator('.bosFieldOpsBar')).not.toContainText('На месте:');
  await expect.poll(()=>page.evaluate(()=>state.orders.find(o=>String(o.id)==='11')?.master_workflow_stage)).toBe('started');
  expect(db.tables.orders[0].status).toBe('В работе');
  expect(db.tables.orders[0].amount).toBe(1000);
});
