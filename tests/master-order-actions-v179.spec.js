const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('scheduled master order shows approved three-step actions and confirmed reschedule',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders[0];
  order.scheduled_date=localDate();
  order.scheduled_time='10:00';
  order.time_slot='10:00–11:00';
  order.master_workflow_stage='assigned';
  order.phone='+79990000002';

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));

  const panel=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button',{name:/Выехал/})).toBeEnabled();
  await expect(panel.getByRole('button',{name:/Начал работу/})).toBeDisabled();
  await expect(panel.getByRole('button',{name:/Отправить отчет/})).toBeDisabled();
  await expect(panel).toContainText('Требует подтверждения диспетчера или руководителя');
  await expect(panel.getByRole('button',{name:'Запросить перенос',exact:true})).toBeVisible();

  await panel.getByRole('button',{name:/Выехал/}).click();
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('departed');
  await expect(panel.getByRole('button',{name:/Начал работу/})).toBeEnabled();

  await panel.getByRole('button',{name:/Начал работу/}).click();
  await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('started');
  await expect(panel.getByRole('button',{name:/Отправить отчет/})).toBeEnabled();

  await panel.getByRole('button',{name:/Отправить отчет/}).click();
  await expect(page.locator('#masterReportForm')).toBeVisible();
});

test('order without date uses agreement form then switches to scheduled workflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders[0];
  order.scheduled_date='';
  order.scheduled_time='';
  order.time_slot='';
  order.master_called_at=null;
  order.master_agreed_at=null;
  order.master_workflow_stage='assigned';

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));

  const panel=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
  await expect(panel.getByRole('button',{name:'Договориться',exact:true})).toBeVisible();
  await expect(panel.getByRole('button',{name:/Выехал/})).toHaveCount(0);

  await panel.getByRole('button',{name:'Договориться',exact:true}).click();
  const form=page.locator('#masterOrderAgree179Form');
  await expect(form).toBeVisible();
  await form.locator('input[name="scheduled_date"]').fill(localDate());
  await form.locator('input[name="scheduled_time"]').fill('18:30');
  await form.getByRole('button',{name:'Сохранить',exact:true}).click();

  await expect.poll(()=>db.tables.orders[0].scheduled_time).toBe('18:30');
  await expect.poll(()=>db.tables.orders[0].master_called_at).toBeTruthy();
  await expect.poll(()=>db.tables.orders[0].master_agreed_at).toBeTruthy();
  await expect(panel.getByRole('button',{name:/Выехал/})).toBeEnabled();
  await expect(panel.getByRole('button',{name:/Начал работу/})).toBeDisabled();
});

test('reschedule action keeps existing approval request form',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders[0];
  order.scheduled_date=localDate();
  order.scheduled_time='12:00';
  order.time_slot='12:00–13:00';

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  await page.locator('.bosMasterWorkflow[data-bos-v179="1"] button',{hasText:'Запросить перенос'}).click();
  await expect(page.locator('#masterRescheduleForm')).toBeVisible();
});