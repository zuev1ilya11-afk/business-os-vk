const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const order11=db=>db.tables.orders.find(o=>String(o.id)==='11');

test('master follows departed started report sequence for scheduled order',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=order11(db);
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
  const panel=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
  await expect(panel).toBeVisible();
  const departed=panel.getByRole('button',{name:/Выехал/});
  const started=panel.getByRole('button',{name:/Начал работу/});
  const report=panel.getByRole('button',{name:/Отправить отчет/});
  await expect(departed).toBeEnabled();
  await expect(started).toBeDisabled();
  await expect(report).toBeDisabled();

  await departed.click();
  await expect.poll(()=>order11(db)?.master_workflow_stage).toBe('departed');
  await expect(departed).toBeDisabled();
  await expect(started).toBeEnabled();
  await expect(report).toBeDisabled();

  await started.click();
  await expect.poll(()=>order11(db)?.master_workflow_stage).toBe('started');
  await expect(started).toBeDisabled();
  await expect(report).toBeEnabled();

  await report.click();
  await expect(page.locator('#masterReportForm')).toBeVisible();
});

test('dispatcher sees simplified master workflow on current dispatch board',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  const order=order11(db);
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

test('legacy departed stage maps to completed departed action',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=order11(db);
  order.scheduled_date=localDate();
  order.scheduled_time='10:00';
  order.phone='+79990000002';
  order.master_workflow_stage='departed';
  delete order.master_called_at;
  delete order.master_agreed_at;

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  const panel=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button',{name:/Выехал/})).toBeDisabled();
  await expect(panel.getByRole('button',{name:/Начал работу/})).toBeEnabled();
  await expect(panel.getByRole('button',{name:/Отправить отчет/})).toBeDisabled();
});
