const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

async function ready(page){
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>!!window.BOS_MASTER_ORDER_FLOW_V179)).toBe(true);
}

test('scheduled master order shows approved three-step flow and reschedule request',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders[0];
  order.scheduled_date=localDate();
  order.scheduled_time='10:00';
  order.time_slot='10:00–11:00';
  order.master_workflow_stage='assigned';
  order.master_called_at=null;
  order.master_agreed_at=null;
  order.report_uploaded_at=null;
  order.report_act_url=null;
  order.reschedule_requested=false;

  await ready(page);
  await page.evaluate(()=>window.openOrder('11'));
  const flow=page.locator('.bosOrderFlowV179[data-mode="scheduled"]');
  await expect(flow).toBeVisible();
  await expect(flow.getByRole('button',{name:'Выехал',exact:true})).toBeEnabled();
  await expect(flow.getByRole('button',{name:'Начал работу',exact:true})).toBeDisabled();
  await expect(flow.getByRole('button',{name:'Отправить отчет',exact:true})).toBeDisabled();
  await expect(flow.getByRole('button',{name:'Запросить перенос',exact:true})).toBeVisible();
  await expect(flow).toContainText('Требует подтверждения диспетчера или руководителя');

  await flow.getByRole('button',{name:'Выехал',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('departed');
  await expect(page.locator('.bosOrderFlowV179').getByRole('button',{name:'Начал работу',exact:true})).toBeEnabled();

  await page.locator('.bosOrderFlowV179').getByRole('button',{name:'Начал работу',exact:true}).click();
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('started');
  await expect(page.locator('.bosOrderFlowV179').getByRole('button',{name:'Отправить отчет',exact:true})).toBeEnabled();
});

test('unscheduled master order uses agreement form then enters scheduled flow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders[0];
  order.scheduled_date=null;
  order.scheduled_time=null;
  order.time_slot=null;
  order.master_workflow_stage='assigned';
  order.master_called_at=null;
  order.master_agreed_at=null;

  await ready(page);
  await page.evaluate(()=>window.openOrder('11'));
  const flow=page.locator('.bosOrderFlowV179[data-mode="agreement"]');
  await expect(flow).toBeVisible();
  await expect(flow.getByRole('button',{name:'Договориться',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Выехал',exact:true})).toHaveCount(0);

  await flow.getByRole('button',{name:'Договориться',exact:true}).click();
  const form=page.locator('#masterOrderAgreementV179');
  await expect(form).toBeVisible();
  await expect(page.getByRole('heading',{name:'Согласовать дату и время'})).toBeVisible();
  await form.locator('input[name="scheduled_date"]').fill(localDate());
  await form.locator('input[name="scheduled_time"]').fill('18:30');
  await form.getByRole('button',{name:'Сохранить',exact:true}).click();

  await expect.poll(()=>db.tables.orders[0].master_called_at).toBeTruthy();
  await expect.poll(()=>db.tables.orders[0].master_agreed_at).toBeTruthy();
  await expect.poll(()=>db.tables.orders[0].scheduled_time).toBe('18:30');
  await expect(page.locator('.bosOrderFlowV179[data-mode="scheduled"]')).toBeVisible();
  await expect(page.locator('.bosOrderFlowV179').getByRole('button',{name:'Выехал',exact:true})).toBeEnabled();
});