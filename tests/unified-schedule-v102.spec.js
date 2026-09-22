const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const currentMonthDate=day=>{
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
};

test('dispatcher schedule day shows every master and distinguishes full partial and off days',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db,master}=await fullStack(page,'dispatcher');
  const fullDate=currentMonthDate(10);
  db.tables.business_staff.push(
    {id:'m2',external_id:'staff_m2',full_name:'Частичный мастер',role:'master',is_active:true,city:'Санкт-Петербург',phone:'+79990000002'},
    {id:'m3',external_id:'staff_m3',full_name:'Выходной мастер',role:'master',is_active:true,city:'Санкт-Петербург',phone:'+79990000003'}
  );
  db.tables.staff_schedule.push(
    {id:'s1',staff_id:master.id,work_date:fullDate,is_working:true,work_start:'10:00',work_end:'20:00'},
    {id:'s2',staff_id:'m2',work_date:fullDate,is_working:true,work_start:'13:00',work_end:'20:00'}
  );

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_UNIFIED_SCHEDULE_V102===true);
  await page.locator('nav [data-page="dispatch"]').click();
  await expect(page.locator('.usScheduleCard')).toBeVisible();
  await page.locator(`.usDay[data-date="${fullDate}"]`).click();

  const modal=page.locator('.modal');
  await expect(modal).toContainText('Тестовый мастер');
  await expect(modal).toContainText('Частичный мастер');
  await expect(modal).toContainText('Выходной мастер');
  await expect(modal.locator('.usTime.full')).toContainText('10:00–20:00');
  await expect(modal.locator('.usTime.partial')).toContainText('13:00–20:00');
  await expect(modal.locator('.usTime.off')).toContainText('Выходной');
});

test('master schedule uses the same calendar and keeps all controls inside one card',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db,master}=await fullStack(page,'master');
  const fullDate=currentMonthDate(10),partialDate=currentMonthDate(11);
  db.tables.staff_schedule.push(
    {id:'s1',staff_id:master.id,work_date:fullDate,is_working:true,work_start:'10:00',work_end:'20:00'},
    {id:'s2',staff_id:master.id,work_date:partialDate,is_working:true,work_start:'13:00',work_end:'20:00'}
  );

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_UNIFIED_SCHEDULE_V102===true);
  await page.locator('nav [data-page="dispatch"]').click();

  const card=page.locator('.usScheduleCard');
  await expect(card).toBeVisible();
  await expect(card.locator(`.usDay[data-date="${fullDate}"]`)).toHaveClass(/full/);
  await expect(card.locator(`.usDay[data-date="${partialDate}"]`)).toHaveClass(/partial/);
  await card.locator(`.usDay[data-date="${partialDate}"]`).click();

  await expect(card.locator('.usQuick')).toBeVisible();
  await expect(card.locator('#usBulkStart')).toBeVisible();
  await expect(card.locator('#usBulkEnd')).toBeVisible();
  await expect(card.locator('.usEditor')).toBeVisible();
  await expect(card.locator('#usStart')).toHaveValue('13:00');
  await expect(card.locator('#usEnd')).toHaveValue('20:00');
  await expect(card.getByRole('button',{name:'Сохранить график'})).toBeVisible();
});
