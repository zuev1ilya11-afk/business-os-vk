const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const workingDay=staff_id=>({id:`smart_dispatch_${staff_id}`,staff_id,work_date:today(),is_working:true,work_start:'10:00',work_end:'14:00'});

test('unassigned order shows ranked inline options and one-action assignment preserves money',async({page})=>{
  const {db,master}=await fullStack(page,'dispatcher');
  db.tables.business_staff.push(
    {id:'m2',external_id:'staff_m2',full_name:'Московский мастер',role:'master',is_active:true,phone:'+79990000002',login:'m2',password_hash:'audit-password',city:'Москва'},
    {id:'m3',external_id:'staff_m3',full_name:'Второй мастер',role:'master',is_active:true,phone:'+79990000003',login:'m3',password_hash:'audit-password',city:'Санкт-Петербург'}
  );
  db.tables.staff_schedule.push(workingDay(master.id),workingDay('m2'),workingDay('m3'));
  Object.assign(db.tables.orders[0],{scheduled_date:today(),scheduled_time:'11:00',time_slot:'11:00–12:00',city:'Санкт-Петербург'});
  Object.assign(db.tables.orders[1],{scheduled_date:today(),scheduled_time:'11:00',time_slot:'11:00–12:00',city:'Санкт-Петербург'});

  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_SMART_DISPATCH_V121===true);
  await page.locator('nav [data-page=orders]').click();

  const card=page.locator('#bosOrderList .opsCompactOrder').filter({hasText:'Борис'});
  const smart=card.locator('.dsd121');
  await expect(smart).toBeVisible();
  await expect(smart.locator('.dsd121Candidate')).toHaveCount(3);
  const best=smart.locator('.dsd121Candidate').first();
  await expect(best).toContainText('Рекомендуем');
  await expect(best).toContainText('Тестовый мастер');
  await expect(best).toContainText('10:00');
  await expect(best).toContainText('город совпадает');

  page.once('dialog',dialog=>dialog.accept());
  await best.getByRole('button',{name:/Назначить Тестовый мастер на 10:00/}).click();

  await expect.poll(()=>db.tables.orders[1].master_staff_id).toBe(master.id);
  await expect.poll(()=>db.tables.orders[1].scheduled_time).toBe('10:00');
  expect(db.tables.orders[1].amount).toBe(2000);
  expect(db.tables.orders[1].master_payout).toBe(1105);
  await expect(page.locator('#bosOrderList .opsCompactOrder').filter({hasText:'Борис'}).locator('.dsd121')).toHaveCount(0);
});
