const {test,expect}=require('@playwright/test');
const fs=require('node:fs');const path=require('node:path');
const {fullStack}=require('./helpers/full-stack.cjs');
test.use({serviceWorkers:'block',viewport:{width:390,height:900},timezoneId:'America/Los_Angeles'});
// UI contract demo. Atomicity/scheduler/sender are tested in PostgreSQL, not simulated here.
test('no answer → overdue Control → agreed visit removes the old obligation',async({page},info)=>{
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 let order,tasks=[],clock='2026-10-15T10:00:00Z';

 async function session(role){
  const ctx=await fullStack(page,role);
 await page.route(/\/push-api(?:\?|$)/,r=>r.fulfill({json:{ok:true,tasks,staff:[],reminders_enabled:true},headers:{'access-control-allow-origin':'*'}}));
  if(!order)order={...ctx.db.tables.orders[0],client:'Тестовый клиент',master_name:'Мастер пилота',phone:'+79990000002',scheduled_date:null,scheduled_time:null,time_slot:'10:00–12:30',master_contact_revision:0,master_contact_control_active:true,master_contact_history:[]};
  ctx.db.tables.orders=[order];const old=ctx.db.rpc;
  ctx.db.rpc=async(n,p)=>{
   if(n!=='bos_contact_action')return old(n,p);
   if(p.p_action==='contactPolicy')return {data:{ok:true,enabled:true,revision:order.master_contact_revision,time_zone:'Europe/Moscow'},error:null};
   expect(p.p_action).toBe('recordContactResult');const b=p.p_input;
   expect(b.expected_revision).toBe(order.master_contact_revision);
   Object.assign(order,{master_contact_status:b.result,master_contact_callback_at:b.callback_at,master_contact_revision:order.master_contact_revision+1,updated_at:new Date().toISOString()});
   order.master_contact_history.push({...b,id:b.attempt_id,at:order.updated_at,by_name:'Мастер пилота'});
   if(b.result==='agreed'){
    Object.assign(order,{scheduled_date:b.scheduled_date,scheduled_time:b.scheduled_time,time_slot:'14:00–16:30',master_agreed_at:order.updated_at});tasks=[];
   }else{
    expect(b.result).toBe('no_answer');expect(b.callback_at).toBe('2026-10-16T13:00:00.000Z');
    tasks=[{order_id:'11',issue_code:'contact_followup',active:true,automatic:true,assignee_name:'Мастер пилота',due_at:b.callback_at,reminder_status:'off'}];
   }
   return {data:{ok:true,order:structuredClone(order)},error:null};
  };
  await page.clock.setFixedTime(new Date(clock));await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>BOS_CONTROL_TASKS.reload());
 }
 async function capture(name){
  const target=process.env.BOS_CONTACT_CAPTURE_DIR?path.join(process.env.BOS_CONTACT_CAPTURE_DIR,name):info.outputPath(name);
  fs.mkdirSync(path.dirname(target),{recursive:true});await page.screenshot({path:target});
 }
 await session('master');await page.evaluate(()=>openMasterContactResultForOrder('11'));
 let form=page.locator('#masterContactResultForm');await form.locator('input[value=no_answer]').check();
 await form.locator('[name=callback_at]').fill('2026-10-16T16:00');await form.locator('[name=comment]').fill('Повторить звонок после доставки');
 await form.getByRole('button',{name:'Сохранить итог',exact:true}).click();await expect(form).toHaveCount(0);
 await expect(page.locator('.bosMasterContactSummary')).toContainText('Не дозвонился');await expect(page.locator('.bosMasterContactSummary')).toContainText('16:00');
 await capture('01-next-contact.png');
 // Advance the fixture deadline; real server progression is asserted by contact-control-assertions.sql.
 clock='2026-10-16T16:00:00Z';tasks[0].needs_manager=true;tasks[0].manager_name='Руководитель пилота';tasks[0].escalated_at='2026-10-16T15:00:00Z';
 order.master_contact_callback_at=tasks[0].due_at;
 await page.setViewportSize({width:1000,height:1100});await session('owner');await page.evaluate(()=>BOS_ORDER_CONTROL.open());
 await expect(page.locator('[data-oc-order="11"]')).toContainText('Просрочен');await expect(page.locator('[data-oc-order="11"]')).toContainText('Руководитель пилота');
 await page.locator('[data-oc-filter=needsManager]').click();await page.evaluate(()=>scrollTo(0,0));await capture('02-overdue-control.png');await page.setViewportSize({width:390,height:900});
 await session('master');await page.evaluate(()=>openMasterContactResultForOrder('11','agreed'));
 form=page.locator('#masterContactResultForm');await form.locator('[name=scheduled_date]').fill('2026-10-17');await form.locator('[name=scheduled_time]').fill('14:00');
 await form.getByRole('button',{name:'Сохранить итог',exact:true}).click();await expect(form).toHaveCount(0);
 await expect(page.locator('.bosMasterContactSummary')).toContainText('Договорились');await expect(page.locator('.bosMasterContactSummary')).toContainText('14:00');expect(tasks).toHaveLength(0);await capture('03-agreed-visit.png');
 await session('owner');await page.evaluate(()=>BOS_ORDER_CONTROL.open());await expect(page.locator('[data-oc-order="11"]')).toHaveCount(0);
});
