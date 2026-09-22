const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=(dayOffset=0)=>{const d=new Date();d.setDate(d.getDate()+dayOffset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('dispatcher schedule shows every master and distinguishes full and partial days',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  const date=await page.evaluate(()=>{
    const d=new Date(),date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const first=state.masters[0];
    state.masters=[first];
    state.users.push({id:'extra-master',external_id:'extra-master',full_name:'Руслан',role:'master',is_active:true,city:'Санкт-Петербург'});
    state.masterSchedule=[
      {staff_id:first.id,master_id:first.id,work_date:date,is_working:true,work_start:'10:00',work_end:'20:00'},
      {staff_id:'extra-master',master_id:'extra-master',work_date:date,is_working:true,work_start:'13:00',work_end:'20:00'}
    ];
    show('dispatch');
    return date;
  });

  await page.locator(`[data-schedule-date="${date}"]`).click();
  const modal=page.locator('.bosUnifiedDayModal');
  await expect(modal).toBeVisible();
  await expect(modal.getByText('Тестовый мастер',{exact:true})).toBeVisible();
  await expect(modal.getByText('Руслан',{exact:true})).toBeVisible();
  await expect(modal.locator('.bosWorkChip.full')).toHaveText('10:00–20:00');
  await expect(modal.locator('.bosWorkChip.partial')).toHaveText('13:00–20:00');
});

test('master schedule keeps calendar, controls and time editor inside one card',async({page})=>{
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
