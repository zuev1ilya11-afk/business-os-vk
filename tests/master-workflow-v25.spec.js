const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('master advances through simplified workflow and finishes through report form',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].scheduled_time='10:00';
  db.tables.orders[0].master_workflow_stage='assigned';
  db.tables.orders[0].master_called_at=null;
  db.tables.orders[0].master_agreed_at=null;
  db.tables.orders[0].phone='+79990000002';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await expect(page.locator('.bosMasterTodayWorkflow')).toBeVisible();
  await page.evaluate(()=>window.openOrder('11'));
  const panel=page.locator('.bosMasterWorkflow[data-bos-v115="1"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.mwv2Step')).toHaveCount(5);
  await expect(page.getByRole('button',{name:'Выехал',exact:true})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Позвонить клиенту',exact:true})).toBeVisible();

  await page.getByRole('button',{name:'Звонок выполнен',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_called_at).toBeTruthy();
  await page.getByRole('button',{name:'Договорённость',exact:true}).click();
  await expect(page.locator('#masterAgreementForm')).toBeVisible();
  await page.getByRole('button',{name:'Сохранить договорённость',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_agreed_at).toBeTruthy();

  await page.evaluate(()=>window.openOrder('11'));
  await expect(page.getByRole('button',{name:'Начать работу',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Начать работу',exact:true}).click();
  await expect(page.locator('.bosMasterWorkflow')).toContainText('В работе');
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('started');
  expect(db.tables.orders[0].master_started_at).toBeTruthy();
  await expect(page.getByRole('button',{name:'Заполнить отчёт',exact:true})).toBeVisible();

  const amount=db.tables.orders[0].amount,payout=db.tables.orders[0].master_payout;
  await page.getByRole('button',{name:'Заполнить отчёт',exact:true}).click();
  await expect(page.locator('#masterReportForm')).toBeVisible();
  expect(db.tables.orders[0].amount).toBe(amount);
  expect(db.tables.orders[0].master_payout).toBe(payout);
});

test('legacy arrived stage is hidden and maps directly to agreement',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].scheduled_time='10:00';
  db.tables.orders[0].phone='+79990000002';
  db.tables.orders[0].master_workflow_stage='arrived';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  const panel=page.locator('.bosMasterWorkflow[data-bos-v115="1"]');
  await expect(panel).toBeVisible();
  await expect(panel).not.toContainText('На месте');
  await expect(panel).not.toContainText('Выехал');
  await expect(panel).toContainText('Договорено');
  await page.getByRole('button',{name:'Начать работу',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('started');
});

test('dispatcher sees simplified field workflow without changing order',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].scheduled_time='19:00';
  db.tables.orders[0].master_workflow_stage='started';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.mwv2OpsBar')).toBeVisible();
  await expect(page.locator('.mwv2OpsBar')).toContainText('В работе: 1');
  await expect(page.locator('.mwv2OpsBar')).not.toContainText('В дороге');
  await expect(page.locator('.bosFieldOpsBar')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>state.orders.find(o=>String(o.id)==='11')?.master_workflow_stage)).toBe('started');
  expect(db.tables.orders[0].status).toBe('В работе');
  expect(db.tables.orders[0].amount).toBe(1000);
});