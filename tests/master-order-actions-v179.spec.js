const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const moscowDate=(offset=0)=>{const d=new Date(Date.now()+offset*24*60*60*1000);const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).filter(({type})=>type!=='literal').map(({type,value})=>[type,value]));return `${parts.year}-${parts.month}-${parts.day}`};
const order11=db=>db.tables.orders.find(o=>String(o.id)==='11');

test('scheduled master order shows confirmed sequential progress and confirmed reschedule',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=order11(db);
  order.scheduled_date=moscowDate(1);
  order.scheduled_time='10:00';
  order.time_slot='10:00–11:00';
  order.master_workflow_stage='assigned';
  order.phone='+79990000002';

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));

  const panel=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button',{name:/Подтвердить: выехал/})).toBeEnabled();
  await expect(panel.getByRole('button',{name:/Подтвердить: начал работу/})).toHaveCount(0);
  await expect(panel.getByRole('button',{name:/Отправить отчёт/})).toHaveCount(0);
  await expect(panel).toContainText('Требует подтверждения диспетчера или руководителя');
  await expect(panel.getByRole('button',{name:'Запросить перенос',exact:true})).toBeVisible();

  await panel.getByRole('button',{name:/Подтвердить: выехал/}).click();
  await expect.poll(()=>order11(db)?.master_workflow_stage).toBe('departed');
  await expect(panel.getByRole('button',{name:/Подтвердить: начал работу/})).toBeEnabled();

  await panel.getByRole('button',{name:/Подтвердить: начал работу/}).click();
  await expect.poll(()=>order11(db)?.master_workflow_stage).toBe('started');
  await expect(panel.getByRole('button',{name:/Отправить отчёт/})).toBeEnabled();

  await panel.getByRole('button',{name:/Отправить отчёт/}).click();
  await expect(page.locator('#masterReportForm')).toBeVisible();
});

test('order without date uses agreement form then switches to scheduled workflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=order11(db);
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
  await expect(panel.getByRole('button',{name:/Договориться/})).toBeVisible();
  await expect(panel.getByRole('button',{name:/Подтвердить: выехал/})).toHaveCount(0);

  await panel.getByRole('button',{name:/Договориться/}).click();
  const form=page.locator('#masterOrderAgree179Form');
  await expect(form).toBeVisible();
  await form.locator('input[name="scheduled_date"]').fill(moscowDate(1));
  await form.locator('input[name="scheduled_time"]').fill('18:30');
  await page.locator('#masterOrderAgree179Form').getByRole('button',{name:'Связался с клиентом',exact:true}).click();
  await form.getByRole('button',{name:'Сохранить',exact:true}).click();

  await expect.poll(()=>order11(db)?.scheduled_time).toBe('18:30');
  await expect.poll(()=>order11(db)?.master_called_at).toBeTruthy();
  await expect.poll(()=>order11(db)?.master_agreed_at).toBeTruthy();
  await expect(panel.getByRole('button',{name:/Подтвердить: выехал/})).toBeEnabled();
  await expect(panel.getByRole('button',{name:/Подтвердить: начал работу/})).toHaveCount(0);
});

test('reschedule action keeps existing approval request form',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=order11(db);
  order.scheduled_date=moscowDate(1);
  order.scheduled_time='12:00';
  order.time_slot='12:00–13:00';

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>window.openOrder('11'));
  await page.locator('.bosMasterWorkflow[data-bos-v179="1"] button',{hasText:'Запросить перенос'}).click();
  await expect(page.locator('#masterRescheduleForm')).toBeVisible();
});
