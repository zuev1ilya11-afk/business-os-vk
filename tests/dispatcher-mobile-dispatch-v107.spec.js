const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('dispatcher mobile schedule shows day load, conflicts and quick actions',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();

  await page.evaluate(()=>{
    const master=state.masters[0];
    Object.assign(state.orders.find(o=>String(o.id)==='11'),{scheduled_date:'2099-09-10',scheduled_time:'10:00',time_slot:'10:00–11:00',phone:'79990000001'});
    Object.assign(state.orders.find(o=>String(o.id)==='12'),{scheduled_date:'2099-09-10',scheduled_time:'11:00',time_slot:'11:00–12:00',phone:'79990000002'});
    state.orders.push({id:'13',client:'Вера',address:'Невский 2',work:'Карниз',status:'В работе',amount:1500,scheduled_date:'2099-09-10',scheduled_time:'10:30',time_slot:'10:30–11:30',master_staff_id:master.id,master_name:master.full_name,source:'VK'});
    state.masterSchedule=[{master_staff_id:master.id,master_id:master.id,work_date:'2099-09-10',is_working:true,work_start:'09:00',work_end:'18:00'}];
    show('dispatch');
    dmDispatchSetDay('2099-09-10');
  });

  await expect(page.locator('.dmv2Dispatch')).toBeVisible();
  await expect(page.locator('.dmv2Metrics')).toContainText('Заявок3');
  await expect(page.locator('.dmv2Metrics')).toContainText('Без мастера1');
  await expect(page.locator('.dmv2Metrics')).toContainText('Конфликтов2');
  await expect(page.locator('.dmv2MasterCard').filter({hasText:'Тестовый мастер'})).toContainText('2 заяв.');
  await expect(page.locator('.dmv2MasterCard').filter({hasText:'Тестовый мастер'})).toContainText('Конфликт');

  const unassigned=page.locator('.dmv2Unassigned .dmv2Order').filter({hasText:'Борис'});
  await expect(unassigned).toBeVisible();
  await unassigned.getByRole('button',{name:'Назначить'}).click();
  await expect(page.locator('#quickMaster')).toBeVisible();
  await expect(page.locator('#quickMaster')).toBeFocused();
  await page.evaluate(()=>closeModal());

  await unassigned.getByRole('button',{name:'Перенести'}).click();
  await expect(page.locator('#dispatcherRescheduleForm,#quickScheduledDate')).toBeVisible();
  await page.evaluate(()=>closeModal());

  await page.setViewportSize({width:1024,height:768});
  await expect(page.locator('.dmv2Dispatch')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:/График/}).first()).toBeVisible();
});