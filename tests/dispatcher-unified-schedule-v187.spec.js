const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=offset=>{const d=new Date();d.setDate(d.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('dispatcher v187 unifies day schedule and renders multi-slot orders with editable duration',async({page})=>{
  const {db,master}=await fullStack(page,'dispatcher');
  const date=localDate(0);
  Object.assign(db.tables.orders[0],{
    scheduled_date:date,
    scheduled_time:'10:00',
    time_slot:'10:00–12:30',
    master_staff_id:master.id,
    master_name:master.full_name,
    status:'В работе'
  });
  Object.assign(db.tables.orders[1],{
    scheduled_date:date,
    scheduled_time:'12:00',
    time_slot:'12:00–13:00',
    master_staff_id:master.id,
    master_name:master.full_name,
    status:'В работе'
  });

  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_SCHEDULE_V187?.version==='187');
  await page.locator('nav [data-page=orders]').click();

  await expect(page.locator('.du187Plan')).toBeVisible();
  await expect(page.locator('.dbV23Tab')).toBeHidden();
  await expect(page.getByRole('button',{name:'Расписание',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Список',exact:true})).toBeVisible();

  const longCard=page.locator('[data-du187-order="11"]');
  await expect(longCard).toBeVisible();
  await expect(longCard).toHaveAttribute('data-duration-min','150');
  await expect(longCard).toContainText('10:00–12:30');
  await expect(page.locator('.du187Card.conflict')).toHaveCount(2);

  const geometry=await page.evaluate(()=>{
    const card=document.querySelector('[data-du187-order="11"]');
    const slot=document.querySelector('.du187Slot');
    return {card:card?.getBoundingClientRect().height||0,slot:slot?.getBoundingClientRect().height||0};
  });
  expect(geometry.slot).toBeGreaterThan(20);
  expect(geometry.card).toBeGreaterThan(geometry.slot*4);

  const saved=await page.evaluate(()=>window.BOS_DISPATCHER_SCHEDULE_V187.setRange('11','10:00','13:00',{skipConfirm:true,silent:true}));
  expect(saved).toBe(true);
  await expect.poll(()=>page.evaluate(()=>state.orders.find(o=>String(o.id)==='11')?.time_slot)).toBe('10:00–13:00');
  await expect(page.locator('[data-du187-order="11"]')).toHaveAttribute('data-duration-min','180');
  await expect(page.locator('[data-du187-order="11"]')).toContainText('10:00–13:00');

  await page.locator('[data-du187-order="11"]').click();
  await expect(page.locator('.du187DurationEditor')).toBeVisible();
  await expect(page.locator('.du187DurationEditor .du187Start')).toHaveValue('10:00');
  await expect(page.locator('.du187DurationEditor .du187End')).toHaveValue('13:00');
});