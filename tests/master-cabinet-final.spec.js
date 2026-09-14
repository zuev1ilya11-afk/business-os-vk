const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master final cabinet keeps upcoming compact, report action, schedule summary and no staff management',async({page})=>{
  const {db,master}=await fullStack(page,'owner');
  const order=db.tables.orders.find(o=>String(o.id)==='11');
  order.status='В работе';
  order.master_staff_id=master.id;
  order.master_name=master.full_name;
  order.master_vk_id=master.external_id;
  order.scheduled_date='2099-09-10';
  order.scheduled_time='10:00';
  order.master_payout=552.5;

  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(({masterVkId})=>enterMasterPreview(masterVkId),{masterVkId:master.external_id});

  const upcoming=page.locator('.bosMasterUpcomingDays');
  await expect(upcoming).toBeVisible();
  const card=page.locator('.bosMasterUpcomingCard').first();
  await expect(card).toContainText('№ 11');
  await expect(card).toContainText('552,5');
  await expect(card).toContainText('10:00');
  await expect(card).not.toContainText('Невский');
  await expect(card).not.toContainText('Монтаж');

  await card.click();
  await expect(page.getByRole('button',{name:'Отчитаться по заявке'})).toBeVisible();
  await page.getByRole('button',{name:'Отчитаться по заявке'}).click();
  await expect(page.getByText('Отчёт по заявке 11')).toBeVisible();
  await expect(page.getByRole('button',{name:'Отправить отчёт и завершить'})).toBeVisible();
  await page.evaluate(()=>closeModal());

  await page.evaluate(({masterVkId})=>{
    state.masterSchedule=[
      {master_vk_id:masterVkId,work_date:'2099-09-10',is_working:true,work_start:'09:00',work_end:'18:00'},
      {master_vk_id:masterVkId,work_date:'2099-09-11',is_working:true,work_start:'09:00',work_end:'18:00'}
    ];
    show('dispatch');
  },{masterVkId:master.external_id});
  await expect(page.getByText('Сохранённый график')).toBeVisible();
  await expect(page.locator('.bosMasterSavedSchedule')).toContainText('09:00–18:00');
  await expect(page.locator('.bosMasterSavedSchedule')).toContainText('10.09');
  await expect(page.locator('.bosMasterSavedSchedule')).toContainText('11.09');

  await page.evaluate(()=>show('team'));
  await expect(page.getByText('КАБИНЕТ МАСТЕРА')).toBeVisible();
  await expect(page.getByText('Управление сотрудниками',{exact:true})).toHaveCount(0);
});
