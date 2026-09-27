const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

function finishOthers(db,keep){
  for(const o of db.tables.orders){
    if(o!==keep)Object.assign(o,{status:'Выполнена',report_review_status:'approved'});
  }
}

test('master v177 shows scheduled workflow buttons in order',async({page})=>{
  const {db,master}=await fullStack(page,'master');
  const order=db.tables.orders.find(o=>String(o.id)==='11')||db.tables.orders[0];
  finishOthers(db,order);
  Object.assign(order,{
    master_staff_id:master.id,
    scheduled_date:'2099-09-10',
    scheduled_time:'10:30',
    status:'В работе',
    master_workflow_stage:'assigned',
    master_called_at:null,
    master_agreed_at:null,
    report_uploaded_at:null,
    report_act_url:null,
    report_review_status:null,
    reschedule_requested:false
  });

  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_ORDER_FLOW_V177===true);
  await page.evaluate(()=>show('home'));

  const flow=page.locator('#masterOrderFlowHome177');
  await expect(flow).toBeVisible();
  await expect(flow.getByRole('button',{name:'Выехал'})).toBeEnabled();
  await expect(flow.getByRole('button',{name:'Начал работу'})).toBeDisabled();
  await expect(flow.getByRole('button',{name:'Отправить отчёт'})).toBeDisabled();
  await expect(flow.getByRole('button',{name:'Перенести заявку'})).toBeVisible();
  await expect(flow).toContainText('Требует подтверждения диспетчера / руководителя');
  await expect(page.locator('#masterDailyV127 .masterV127Main strong')).toContainText('Запланирована');

  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('master v177 unscheduled order opens date and time agreement form',async({page})=>{
  const {db,master}=await fullStack(page,'master');
  const order=db.tables.orders.find(o=>String(o.id)==='11')||db.tables.orders[0];
  finishOthers(db,order);
  Object.assign(order,{
    master_staff_id:master.id,
    scheduled_date:'',
    scheduled_time:'',
    time_slot:'',
    status:'В работе',
    master_workflow_stage:'assigned',
    master_called_at:null,
    master_agreed_at:null,
    report_uploaded_at:null,
    report_act_url:null,
    report_review_status:null
  });

  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_ORDER_FLOW_V177===true);
  await page.evaluate(()=>show('home'));

  const flow=page.locator('#masterOrderFlowHome177');
  await expect(flow).toContainText('Дата и время не согласованы');
  await expect(flow.getByRole('button',{name:'Договориться'})).toBeVisible();
  await expect(flow.getByRole('button',{name:'Выехал'})).toHaveCount(0);

  await flow.getByRole('button',{name:'Договориться'}).click();
  const form=flow.locator('.mof177Agreement');
  await expect(form).toBeVisible();
  await expect(form.locator('input[name="scheduled_date"]')).toBeVisible();
  await expect(form.locator('input[name="scheduled_time"]')).toBeVisible();
  await expect(form.getByRole('button',{name:'Подтвердить'})).toBeVisible();
  await expect(form).toContainText('После подтверждения будут доступны: Выехал, Начал работу, Отправить отчёт.');
});
