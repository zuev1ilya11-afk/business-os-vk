const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('dispatcher schedule shows all masters and full partial off states',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  const date=await page.evaluate(()=>{
    const d=new Date(),date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const first=state.masters[0];
    state.masters=[first];
    state.users.push(
      {id:'extra-master',external_id:'extra-master',full_name:'Руслан',role:'master',is_active:true,city:'Санкт-Петербург'},
      {id:'reserve-master',external_id:'reserve-master',full_name:'Резервный мастер',role:'master',is_active:true,city:'Санкт-Петербург'}
    );
    state.masterSchedule=[
      {master_vk_id:first.external_id||first.vk_user_id||first.id,staff_id:first.id,work_date:date,is_working:true,work_start:'10:00',work_end:'20:00'},
      {master_vk_id:'extra-master',staff_id:'extra-master',work_date:date,is_working:true,work_start:'13:00',work_end:'20:00'}
    ];
    show('dispatch');
    return date;
  });

  await page.locator(`[data-schedule-date="${date}"]`).click();
  const modal=page.locator('.bosUnifiedDayModal');
  await expect(modal).toBeVisible();
  await expect(modal.getByText('Тестовый мастер',{exact:true})).toBeVisible();
  await expect(modal.getByText('Руслан',{exact:true})).toBeVisible();
  await expect(modal.getByText('Резервный мастер',{exact:true})).toBeVisible();
  await expect(modal.locator('[data-master-name="Тестовый мастер"] .bosWorkChip.full')).toHaveText('10:00–20:00');
  await expect(modal.locator('[data-master-name="Руслан"] .bosWorkChip.partial')).toHaveText('13:00–20:00');
  await expect(modal.locator('[data-master-name="Резервный мастер"] .bosWorkChip.off')).toHaveText('Выходной');
});

test('master schedule keeps calendar controls editor and save in one card',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fullStack(page,'master');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  const dates=await page.evaluate(()=>{
    const now=new Date(),y=now.getFullYear(),m=now.getMonth(),last=new Date(y,m+1,0).getDate();
    const d1=Math.min(10,last),d2=Math.min(d1+1,last);
    const fmt=d=>`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const id=String(state.user.external_id||state.user.id||'');
    state.masterSchedule=[
      {master_vk_id:id,master_id:state.user.id,work_date:fmt(d1),is_working:true,work_start:'10:00',work_end:'20:00'},
      {master_vk_id:id,master_id:state.user.id,work_date:fmt(d2),is_working:true,work_start:'13:00',work_end:'20:00'}
    ];
    show('dispatch');
    return {full:fmt(d1),partial:fmt(d2)};
  });

  const root=page.locator('#masterMonthCalendar > .bosUnifiedMasterCard');
  await expect(root).toBeVisible();
  await expect(page.locator('#masterMonthCalendar > .card')).toHaveCount(1);
  await expect(root.getByRole('button',{name:'Этот месяц'})).toBeVisible();
  await expect(root.locator(`.bosCalDay[onclick*="${dates.full}"]`)).toHaveClass(/fullDay/);
  await expect(root.locator(`.bosCalDay[onclick*="${dates.partial}"]`)).toHaveClass(/partialDay/);

  await root.locator(`.bosCalDay[onclick*="${dates.partial}"]`).click();
  await expect(root.locator('#calStart')).toHaveValue('13:00');
  await expect(root.locator('#calEnd')).toHaveValue('20:00');
  await expect(root.locator('#calendarSaveMsg')).toBeAttached();
});
