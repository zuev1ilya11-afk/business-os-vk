const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('desktop dispatcher exposes quick actions directly under list cards',async({page})=>{
  const {db,master}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[1],{scheduled_date:today(),scheduled_time:'11:00',time_slot:'11:00–12:00',city:'Санкт-Петербург'});
  db.tables.staff_schedule.push({id:'v159_work',staff_id:master.id,work_date:today(),is_working:true,work_start:'10:00',work_end:'21:00'});

  await page.setViewportSize({width:1280,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_QUICK_ACTIONS_V159?.version==='159');
  await page.locator('nav [data-page=orders]').click();
  await page.getByRole('button',{name:'Список',exact:true}).click();

  const actions=page.locator('.dq159DesktopActions[data-order-id="12"]');
  await expect(actions).toHaveCount(1);
  await expect(actions).toBeVisible();
  await expect(actions.getByRole('button',{name:'Статус'})).toBeVisible();
  await expect(actions.getByRole('button',{name:'Подобрать'})).toBeVisible();
  await expect(actions.getByRole('button',{name:'Время'})).toBeVisible();
  await expect(actions.getByRole('button',{name:'Открыть'})).toBeVisible();

  await actions.getByRole('button',{name:'Статус'}).click();
  await expect(page.getByRole('heading',{name:'Быстро изменить'})).toBeVisible();
  await expect(page.locator('#drv157Status')).toBeFocused();
  await page.evaluate(()=>closeModal());

  await actions.getByRole('button',{name:'Подобрать'}).click();
  await expect(page.getByRole('heading',{name:'Подобрать мастера'})).toBeVisible();
  await expect(page.locator('#dsa119ModalList')).toContainText('Тестовый мастер');
});

test('mobile dispatcher keeps manual assignment and adds smart master action without duplicate mutation',async({page})=>{
  const {db,master}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[1],{scheduled_date:today(),scheduled_time:'11:00',time_slot:'11:00–12:00',city:'Санкт-Петербург'});
  db.tables.staff_schedule.push({id:'v159_mobile_work',staff_id:master.id,work_date:today(),is_working:true,work_start:'10:00',work_end:'21:00'});

  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_QUICK_ACTIONS_V159?.version==='159');
  await page.locator('nav [data-page=orders]').click();

  const card=page.locator('#bosOrderList .opsCompactOrder').filter({hasText:'Борис'});
  const actions=card.locator('.dmCardActions');
  await expect(actions).toBeVisible();
  await expect(actions.locator('.dmAssignAction')).toBeVisible();
  await expect(actions.locator('.dsa119CardAction')).toBeVisible();
  await expect(actions.getByRole('button',{name:'Назначить мастера'})).toBeVisible();
  await expect(actions.getByRole('button',{name:'Подобрать мастера'})).toBeVisible();
  await expect(actions.locator('.dmDateTimeAction')).toBeVisible();
  await expect(actions.locator('.drv157QuickAction')).toBeVisible();
  await expect(actions.locator('.dmOpenAction')).toBeVisible();

  await actions.getByRole('button',{name:'Подобрать мастера'}).click();
  await expect(page.getByRole('heading',{name:'Подобрать мастера'})).toBeVisible();
});
