const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
test.use({serviceWorkers:'block'});
async function setup(page,{missing=false,first=false}={}){
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const ctx=await fullStack(page,'owner');ctx.db.tables.orders.length=0;
 const order={id:'99',client:'Клиент пилота',work:'Монтаж',status:'В работе',master_staff_id:ctx.master.id,master_name:'Мастер',phone:'+79990000002',master_contact_control_active:true,master_contact_status:'thinking',master_contact_callback_at:'2099-10-20T13:00:00Z',master_contact_revision:0,master_contact_history:[{result:'thinking',at:'2026-10-15T09:00:00Z',phone:'+79990000002'}]};
 if(!missing)ctx.db.tables.orders.push(order);
 const task={order_id:'99',issue_code:first?'contact_first':'contact_followup',active:true,automatic:true,assignee_id:ctx.master.id,assignee_name:'Мастер',due_at:first?'2000-01-01T13:00:00Z':order.master_contact_callback_at,reminder_status:'off'};
 await page.route(/\/push-api(?:\?|$)/,r=>r.fulfill({json:{ok:true,tasks:[task],staff:[],reminders_enabled:false},headers:{'access-control-allow-origin':'*'}}));
 const old=ctx.db.rpc;ctx.db.rpc=async(n,p)=>n==='bos_contact_action'?{data:{ok:true,enabled:true,revision:0,time_zone:'Europe/Moscow'},error:null}:old(n,p);
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>BOS_CONTROL_TASKS.reload());
 return {...ctx,order,task};
}
test('home overdue and first-contact shortcuts include pilot obligations',async({page})=>{
 await setup(page,{first:true});
 await expect(page.locator('[data-oc-home-filter=overdue]')).toContainText('1');
 await expect(page.locator('[data-oc-home-filter=contact]')).toContainText('1');
 await page.locator('[data-oc-home-filter=overdue]').click();
 await expect(page.locator('.ocItem')).toHaveCount(1);
});
test('Control repaints a new outcome even when the task category stays the same',async({page})=>{
 const {order,task}=await setup(page);await page.evaluate(()=>BOS_ORDER_CONTROL.open());
 const card=page.locator('[data-oc-order="99"]');await expect(card).toContainText('Клиент думает');
 Object.assign(order,{master_contact_status:'waiting_delivery',master_contact_callback_at:'2099-10-21T13:00:00Z',master_contact_revision:1});task.due_at=order.master_contact_callback_at;order.master_contact_history.push({result:'waiting_delivery',at:'2026-10-15T10:00:00Z'});
 await page.evaluate(async()=>{await reloadData(true);await BOS_CONTROL_TASKS.reload()});
 await expect(card).toContainText('Ждёт доставку');await expect(card).not.toContainText('Клиент думает');
 await expect(card).toContainText('21.10');
});
test('result action loads a newly appeared order before opening its form',async({page})=>{
 const {order,db}=await setup(page,{missing:true});await page.evaluate(()=>BOS_ORDER_CONTROL.open());
 const action=page.locator('[data-ct-result="99"]');await expect(action).toBeVisible();
 db.tables.orders.push(order);await action.click();await expect(page.locator('#masterContactResultForm')).toBeVisible();
});
