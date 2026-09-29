const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
for(const width of [390,1600])test(`conflicts agree on canonical masters and exact interval at ${width}`,async({page})=>{
 await page.clock.install({time:new Date('2026-10-01T08:00:00Z')});await page.setViewportSize({width,height:1000});
 const {db,master}=await fullStack(page,'dispatcher');
 Object.assign(db.tables.orders[0],{scheduled_date:'2026-10-01',scheduled_time:'12:00',time_slot:'10:00–11:00'});
 Object.assign(db.tables.orders[1],{scheduled_date:'2026-10-01',scheduled_time:'12:30',time_slot:'12:30–13:00',master_staff_id:master.id});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.waitForFunction(()=>window.BOS_DISPATCHER_CONFLICTS&&window.BOS_UNIFIED_DISPATCH_SCHEDULE_V187);
 // Exercise the legacy client payload: bootstrap normally normalizes the staff FK.
 await page.evaluate(m=>{const o=state.orders.find(o=>o.id==='12');o.master_staff_id=null;o.master_vk_id=m.external_id},master);
 const r=await page.evaluate(m=>({mobile:BOS_DISPATCHER_CONFLICTS.ids().sort(),desktop:BOS_UNIFIED_DISPATCH_SCHEDULE_V187.conflictFor('11',m,'2026-10-01',720,780),boundary:BOS_UNIFIED_DISPATCH_SCHEDULE_V187.conflictFor('11',m,'2026-10-01',780,840)}),master);
 expect(r).toEqual({mobile:['11','12'],desktop:true,boundary:false});
 if(width===1600){await page.locator('nav [data-page=orders]').click();await expect(page.locator('.dh190Card[data-order-id="11"] .du187When')).toHaveText('12:00–13:00')}
});
test('desktop displays and moves an off-grid appointment without changing duration',async({page})=>{
 await page.clock.install({time:new Date('2026-10-01T08:00:00Z')});await page.setViewportSize({width:1600,height:1000});const {db,master}=await fullStack(page,'dispatcher');
 Object.assign(db.tables.orders[0],{scheduled_date:'2026-10-01',scheduled_time:'10:45',time_slot:'10:45–12:20'});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.locator('nav [data-page=orders]').click();
 const card=page.locator('.dh190Card[data-order-id="11"]');await expect(card.locator('.du187When')).toHaveText('10:45–12:20');expect(await card.evaluate(e=>e.style.getPropertyValue('--dh190-offset'))).toBe('75%');
 expect(await page.evaluate(m=>BOS_UNIFIED_DISPATCH_SCHEDULE_V187.move('11',m,'12:05'),master.external_id)).toBe(true);expect(db.tables.orders[0].time_slot).toBe('12:05–13:40');
});
for(const timezoneId of ['UTC','Europe/Moscow'])test.describe(timezoneId,()=>{
 test.use({timezoneId});
 test('master deadline includes 24:00 and the exact +90 boundary',async({page})=>{
  await page.clock.install({time:new Date('2026-10-01T08:00:00Z')});await fullStack(page,'master');await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.waitForFunction(()=>window.BOS_MASTER_DAILY_HOME_V127_API);
  const r=await page.evaluate(()=>{
   const api=BOS_MASTER_DAILY_HOME_V127_API,o={status:'В работе',scheduled_date:'2026-10-01',time_slot:'23:00–24:00'};const end=new Date('2026-10-02T00:00:00').getTime();
   return {end:api.scheduleEndTs(o)===end,boundaries:[89,90,91].map(n=>api.reportOverdue(o,end+n*60000)),single:api.scheduleEndTs({...o,time_slot:'9:00–10:00'})===new Date('2026-10-01T10:00:00').getTime()};
  });expect(r).toEqual({end:true,boundaries:[false,true,true],single:true});
 });
});
test('smart assignment fits the whole three-hour job between bookings and shift end',async({page})=>{
 await page.clock.install({time:new Date('2026-10-01T08:00:00Z')});await page.setViewportSize({width:390,height:844});const {db}=await fullStack(page,'dispatcher');
 db.tables.staff_schedule.push({id:'schedule_m',staff_id:'m',work_date:'2026-10-01',is_working:true,work_start:'10:00',work_end:'16:00'});
 Object.assign(db.tables.orders[0],{scheduled_date:'2026-10-01',scheduled_time:'12:00',time_slot:'12:00–13:00'});
 Object.assign(db.tables.orders[1],{scheduled_date:'2026-10-01',scheduled_time:'10:00',time_slot:'10:00–13:00'});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.waitForFunction(()=>window.BOS_DISPATCHER_SMART_ASSIGN_V119);await page.locator('nav [data-page=orders]').click();
 await page.locator('#bosOrderList .opsCompactOrder').filter({hasText:'Борис'}).getByRole('button',{name:'Подобрать мастера'}).click();
 await expect(page.locator('#dsa119ModalList .dsa119Times')).toHaveText('13:00');
 page.once('dialog',d=>d.accept());await page.locator('#dsa119ModalList .dsa119Pick').click();await expect.poll(()=>db.tables.orders[1].time_slot).toBe('13:00–16:00');
});
