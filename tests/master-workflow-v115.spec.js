const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('master follows departed work report sequence for scheduled order',async({page})=>{
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
  const flow=page.locator('.bosOrderFlowV179[data-mode="scheduled"]');
  await expect(flow).toBeVisible();
  await expect(flow.getByRole('button',{name:'Выехал',exact:true})).toBeEnabled();
  await expect(flow.getByRole('button',{name:'Начал работу',exact:true})).toBeDisabled();
  await expect(flow.getByRole('button',{name:'Отправить отчет',exact:true})).toBeDisabled();

  await flow.getByRole('button',{name:'Выехал',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('departed');
  await expect(page.getByRole('button',{name:'Начал работу',exact:true})).toBeEnabled();

  await page.getByRole('button',{name:'Начал работу',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('started');
  await expect(page.getByRole('button',{name:'Отправить отчет',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Отправить отчет',exact:true}).click();
  await expect(page.locator('#masterReportForm')).toBeVisible();
});

test('dispatcher sees simplified master workflow on current dispatch board',async({page})=>{
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

  await page.locator('[data-order-id="11"].dbOrderCard').first().click();
  const flow=page.locator('#dispatchBoardDetail .mwv2DispatcherFlow');
  await expect(flow).toBeVisible();
  await expect(flow).toContainText('Звонок');
  await expect(flow).toContainText('Договорённость');
  await expect(flow).toContainText('Работа');
  await expect(flow).toContainText('Отчёт');
  await expect(flow).toContainText('Завершена');
  await expect(flow).not.toContainText('Выехал');
});

test('legacy departed stage remains compatible as completed departure step',async({page})=>{
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
  const flow=page.locator('.bosOrderFlowV179[data-mode="scheduled"]');
  await expect(flow).toBeVisible();
  await expect(flow.getByRole('button',{name:/Выехал/})).toBeDisabled();
  await expect(flow.getByRole('button',{name:'Начал работу',exact:true})).toBeEnabled();
});