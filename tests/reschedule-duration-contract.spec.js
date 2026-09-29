const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {employee}=require('./helpers/edge.cjs');
async function setup(page,end='13:00'){
 await page.clock.install({time:new Date('2026-10-01T08:00:00Z')});
 const data=await fullStack(page,'dispatcher');
 Object.assign(data.db.tables.orders[0],{scheduled_date:'2026-10-01',scheduled_time:'10:00',time_slot:`10:00–${end}`,reschedule_requested:true,reschedule_reason:'Позже',updated_at:'2026-10-01T07:00:00Z'});
 await page.setViewportSize({width:1600,height:1000});return data;
}
async function open(page){await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.waitForFunction(()=>window.BOS_UNIFIED_DISPATCH_SCHEDULE_V187);await page.locator('nav [data-page=orders]').click();await expect(page.locator('#dispatchBoardDate')).toHaveValue('2026-10-01')}
for(const [end,next] of [['10:30','12:00–12:30'],['13:00','12:00–15:00']])test(`reschedule modal preserves ${end} duration after reload`,async({page})=>{
 const {db}=await setup(page,end);await open(page);await page.evaluate(()=>openDispatcherReschedule('11'));
 await page.locator('#dispatcherRescheduleForm input[name=scheduled_date]').fill('2026-10-02');await page.locator('#dispatcherRescheduleForm input[name=scheduled_time]').fill('12:00');
 await page.getByRole('button',{name:'Подтвердить перенос',exact:true}).click();
 await expect(page.locator('#dispatcherRescheduleForm')).toHaveCount(0);expect(db.tables.orders[0].time_slot).toBe(next);expect(db.tables.orders[0].reschedule_requested).toBe(false);
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();expect(await page.evaluate(()=>state.orders.find(o=>o.id==='11').time_slot)).toBe(next);
});
test('same-master requested move uses one atomic write and keeps three hours',async({page})=>{
 const {db,master}=await setup(page);await open(page);
 expect(await page.evaluate(m=>BOS_UNIFIED_DISPATCH_SCHEDULE_V187.move('11',m,'12:00'),master.external_id)).toBe(true);
 expect(db.tables.orders[0].time_slot).toBe('12:00–15:00');expect(db.tables.orders[0].reschedule_requested).toBe(false);
 expect(db.calls.filter(x=>x.table==='orders'&&x.mode==='update')).toHaveLength(1);
});
test('failed confirmation after reassignment retains the saved move and explains partial success',async({page})=>{
 const {db}=await setup(page);db.tables.business_staff.push(employee('second','master',{full_name:'Second'}));
 await page.route(/\/(?:functions\/v1|api\/proxy)\/order-meta-api(?:\?|$)/,r=>r.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"error":"test unavailable"}'}));
 await open(page);await page.evaluate(()=>{window.savedMessages=[];window.setMessage=text=>savedMessages.push(text)});
 expect(await page.evaluate(()=>BOS_UNIFIED_DISPATCH_SCHEDULE_V187.move('11','staff_second','12:00'))).toBe(false);
 expect(db.tables.orders[0]).toMatchObject({master_staff_id:'second',scheduled_time:'12:00',time_slot:'12:00–15:00',reschedule_requested:true});
 expect(await page.evaluate(()=>savedMessages.join(' '))).toContain('сохранены, но запрос переноса не подтверждён');
 expect(await page.evaluate(()=>state.orders.find(o=>o.id==='11').time_slot)).toBe('12:00–15:00');
});
test('conflict cancellation and out-of-day move make no writes',async({page})=>{
 const {db,master}=await setup(page);Object.assign(db.tables.orders[1],{master_staff_id:master.id,master_name:master.full_name,scheduled_date:'2026-10-01',scheduled_time:'13:00',time_slot:'13:00–14:00'});
 await open(page);page.on('dialog',d=>d.dismiss());
 expect(await page.evaluate(m=>BOS_UNIFIED_DISPATCH_SCHEDULE_V187.move('11',m,'12:00'),master.external_id)).toBe(false);
 expect(await page.evaluate(m=>BOS_UNIFIED_DISPATCH_SCHEDULE_V187.move('11',m,'22:00'),master.external_id)).toBe(false);
 expect(db.calls.filter(x=>x.table==='orders'&&x.mode==='update')).toHaveLength(0);
});
