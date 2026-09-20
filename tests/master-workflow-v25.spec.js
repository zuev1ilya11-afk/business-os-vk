const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('master v2.5 follows depart-arrive-start flow and finishes through report form',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].scheduled_time='10:00';
  db.tables.orders[0].master_workflow_stage='assigned';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await expect(page.locator('.bosMasterTodayWorkflow')).toBeVisible();
  await expect(page.locator('.bosMasterTodayWorkflow')).toContainText('Рабочий день');
  await page.evaluate(()=>window.openOrder('11'));
  await expect(page.locator('.bosMasterWorkflow')).toBeVisible();
  await expect(page.getByRole('button',{name:'Выехал'})).toBeVisible();
  await page.getByRole('button',{name:'Выехал'}).click();
  await expect(page.locator('.bosMasterWorkflow')).toContainText('Выехал');
  expect(db.tables.orders[0].master_workflow_stage).toBe('departed');
  expect(db.tables.orders[0].master_departed_at).toBeTruthy();

  await page.getByRole('button',{name:'Я на месте'}).click();
  await expect(page.locator('.bosMasterWorkflow')).toContainText('На месте');
  expect(db.tables.orders[0].master_workflow_stage).toBe('arrived');

  await page.getByRole('button',{name:'Начать работу'}).click();
  await expect(page.getByRole('button',{name:'Завершить работу'})).toBeVisible();
  expect(db.tables.orders[0].master_workflow_stage).toBe('started');
  const amount=db.tables.orders[0].amount,payout=db.tables.orders[0].master_payout;
  await page.getByRole('button',{name:'Завершить работу'}).click();
  await expect(page.locator('#masterReportForm')).toBeVisible();
  expect(db.tables.orders[0].amount).toBe(amount);
  expect(db.tables.orders[0].master_payout).toBe(payout);
});

test('dispatcher v2.5 sees field workflow stage without changing order',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].scheduled_time='23:59';
  db.tables.orders[0].master_workflow_stage='started';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.bosFieldOpsBar')).toBeVisible();
  await expect(page.locator('.bosFieldOpsBar')).toContainText('В работе: 1');
  await expect(page.locator('.bosFieldStageChip').first()).toContainText('В работе');
  expect(db.tables.orders[0].status).toBe('В работе');
  expect(db.tables.orders[0].amount).toBe(1000);
});
