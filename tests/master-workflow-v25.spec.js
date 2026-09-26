const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('master completes approved depart start report flow without changing money',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].scheduled_time='10:00';
  db.tables.orders[0].time_slot='10:00–11:00';
  db.tables.orders[0].master_workflow_stage='assigned';
  db.tables.orders[0].master_called_at=null;
  db.tables.orders[0].master_agreed_at=null;
  db.tables.orders[0].phone='+79990000002';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await expect(page.locator('#masterDailyV127')).toBeVisible();
  await expect(page.locator('.bosMasterTodayWorkflow:visible')).toHaveCount(0);
  await page.evaluate(()=>window.openOrder('11'));
  await expect(page.locator('.bosMasterWorkflow[data-bos-v179="1"]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Выехал',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Начал работу',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Отправить отчет',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Запросить перенос',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Я на месте'})).toHaveCount(0);

  await page.getByRole('button',{name:'Выехал',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('departed');
  expect(db.tables.orders[0].master_departed_at).toBeTruthy();
  await expect(page.getByRole('button',{name:'Начал работу',exact:true})).toBeEnabled();

  await page.getByRole('button',{name:'Начал работу',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('started');
  expect(db.tables.orders[0].master_started_at).toBeTruthy();
  await expect(page.getByRole('button',{name:'Отправить отчет',exact:true})).toBeEnabled();

  const amount=db.tables.orders[0].amount,payout=db.tables.orders[0].master_payout;
  await page.getByRole('button',{name:'Отправить отчет',exact:true}).click();
  await expect(page.locator('#masterReportForm')).toBeVisible();
  expect(db.tables.orders[0].amount).toBe(amount);
  expect(db.tables.orders[0].master_payout).toBe(payout);
});

test('legacy arrived stage maps to departed and continues to start work',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].scheduled_time='10:00';
  db.tables.orders[0].phone='+79990000002';
  db.tables.orders[0].master_workflow_stage='arrived';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  await expect(page.locator('.bosMasterWorkflow[data-bos-v179="1"]')).toBeVisible();
  await expect(page.locator('.bosMasterWorkflow')).not.toContainText('На месте');
  await expect(page.getByRole('button',{name:'Выехал',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Начал работу',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Начал работу',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('started');
});

test('dispatcher sees simplified field workflow without changing order values',async({page})=>{
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
  await expect(page.locator('.bosFieldOpsBar')).not.toContainText('В дороге:');
  await expect(page.locator('.bosFieldOpsBar')).not.toContainText('На месте:');
  await expect.poll(()=>page.evaluate(()=>state.orders.find(o=>String(o.id)==='11')?.master_workflow_stage)).toBe('started');
  expect(db.tables.orders[0].status).toBe('В работе');
  expect(db.tables.orders[0].amount).toBe(1000);
});
