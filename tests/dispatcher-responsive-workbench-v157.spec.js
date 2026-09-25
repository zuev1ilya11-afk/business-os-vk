const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('desktop dispatcher gets a contextual next-action panel',async({page})=>{
  const {db,master}=await fullStack(page,'dispatcher');
  Object.assign(master,{work_start:'10:00',work_end:'21:00'});
  Object.assign(db.tables.orders[1],{scheduled_date:today(),scheduled_time:'11:00',time_slot:'11:00–12:00',city:'Санкт-Петербург'});
  db.tables.staff_schedule.push({id:'schedule_m',staff_id:'m',work_date:today(),is_working:true,work_start:'10:00',work_end:'21:00'});

  await page.setViewportSize({width:1280,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_RESPONSIVE_V157?.decorate);
  await page.locator('nav [data-page=orders]').click();

  const card=page.locator('.ddQueueCard').filter({hasText:'Борис'});
  await expect(card).toBeVisible();
  await card.click();

  const assist=page.locator('.drv157DesktopAssist');
  await expect(assist).toBeVisible();
  await expect(assist).toContainText('СЛЕДУЮЩЕЕ ДЕЙСТВИЕ');
  await expect(assist).toContainText('Назначьте мастера');
  await expect(assist.getByRole('button',{name:'Подобрать мастера'})).toBeVisible();
  await expect(assist.getByRole('button',{name:'График мастеров'})).toBeVisible();
  await expect(assist).toContainText('Тестовый мастер');
});

test('mobile dispatcher can open status and master quick edit from an order card',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_RESPONSIVE_V157?.decorate);
  await page.locator('nav [data-page=orders]').click();

  const card=page.locator('#bosOrderList .opsCompactOrder').filter({hasText:'Борис'});
  const quick=card.getByRole('button',{name:'Быстро изменить статус и мастера'});
  await expect(quick).toBeVisible();
  await quick.click();

  await expect(page.getByRole('heading',{name:'Быстро изменить'})).toBeVisible();
  await expect(page.locator('#drv157Status')).toHaveValue('В работе');
  await expect(page.locator('#drv157Master')).toBeVisible();
  await expect(page.getByRole('button',{name:'Сохранить'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Открыть заявку'})).toBeVisible();
});
