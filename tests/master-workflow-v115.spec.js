const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('master follows call agreement work and report sequence',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders[0];
  order.scheduled_date=localDate();
  order.scheduled_time='10:00';
  order.time_slot='10:00–11:00';
  order.phone='+79990000002';
  order.master_workflow_stage='assigned';
  order.master_called_at=null;
  order.master_agreed_at=null;

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  const panel=page.locator('.bosMasterWorkflow[data-bos-v115="1"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Нужно позвонить');
  await expect(panel.locator('.mwv2Step')).toHaveCount(5);
  await expect(panel).not.toContainText('Выехал');
  await expect(panel).not.toContainText('В дороге');

  await page.getByRole('button',{name:'Звонок выполнен',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_called_at).toBeTruthy();
  await expect(panel).toContainText('Созвонился');
  await page.getByRole('button',{name:'Договорённость',exact:true}).click();

  await expect(page.locator('#masterAgreementForm')).toBeVisible();
  await page.locator('#masterAgreementForm input[name="scheduled_time"]').fill('11:30');
  await page.getByRole('button',{name:'Сохранить договорённость',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_agreed_at).toBeTruthy();
  expect(db.tables.orders[0].scheduled_time).toBe('11:30');

  await page.evaluate(()=>window.openOrder('11'));
  await expect(page.locator('.bosMasterWorkflow[data-bos-v115="1"]')).toContainText('Договорено');
  await expect(page.getByRole('button',{name:'Начать работу',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Изменить дату и время',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Начать работу',exact:true}).click();

  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('started');
  await expect(page.getByRole('button',{name:'Заполнить отчёт',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Заполнить отчёт',exact:true}).click();
  await expect(page.locator('#masterReportForm')).toBeVisible();
});

test('dispatcher sees simplified master workflow progress on current dispatch board',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  const order=db.tables.orders[0];
  order.scheduled_date=localDate();
  order.scheduled_time='10:00';
  order.time_slot='10:00–11:00';
  order.master_workflow_stage='assigned';
  order.master_called_at='2026-09-23T08:00:00.000Z';
  order.master_agreed_at='2026-09-23T08:05:00.000Z';

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.dbBoard')).toBeVisible();
  await expect(page.locator('.mwv2OpsBar')).toContainText('Договорено: 1');
  await expect(page.locator('.mwv2OpsBar')).not.toContainText('В дороге');
  await expect(page.locator('[data-order-id="11"] .mwv2FieldStageChip').first()).toContainText('Договорено');

  await page.locator('[data-order-id="11"].dbOrderCard').first().click();
  const flow=page.locator('#dispatchBoardDetail .mwv2DispatcherFlow');
  await expect(flow).toBeVisible();
  await expect(flow.locator('span')).toHaveCount(5);
  await expect(flow).toContainText('Звонок');
  await expect(flow).toContainText('Договорённость');
  await expect(flow).toContainText('Работа');
  await expect(flow).not.toContainText('Выехал');
});

test('legacy departed stage maps to agreement and can start work directly',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].scheduled_time='10:00';
  db.tables.orders[0].phone='+79990000002';
  db.tables.orders[0].master_workflow_stage='departed';
  delete db.tables.orders[0].master_called_at;
  delete db.tables.orders[0].master_agreed_at;

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  const panel=page.locator('.bosMasterWorkflow[data-bos-v115="1"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Договорено');
  await expect(panel).not.toContainText('В дороге');
  await expect(page.getByRole('button',{name:'Начать работу',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Начать работу',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('started');
});