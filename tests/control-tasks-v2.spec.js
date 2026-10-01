const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const core=require('../order-control-tasks.js');
async function setup(page,{role='owner',failSave=false}={}){
 const data=await fullStack(page,role),store=[],writes=[];
 if(role==='master')store.push({id:'t1',order_id:'11',issue_code:'agreement',assignee_id:data.me.id,assignee_name:data.me.full_name,due_at:new Date(Date.now()+3600000).toISOString(),version:1,active:true,remind:false,reminder_status:'off'});
 const people=data.db.tables.business_staff.map(s=>({id:s.id,name:s.full_name,role:s.role,has_push:false}));
 await page.route(/\/(?:api\/proxy|functions\/v1)\/push-api(?:\?|$)/,async route=>{
  const body=route.request().postDataJSON();let result,status=200;
  if(body.action==='controlList')result={ok:true,tasks:body.order_id?store.filter(t=>t.order_id===body.order_id&&t.issue_code===body.issue_code):store.filter(t=>t.active),staff:role==='master'?[]:people,reminders_enabled:true,more:false};
  else if(['controlSave','controlClear'].includes(body.action)){
   writes.push(body);
   if(failSave){status=409;result={ok:false,error:'Поручение уже изменено. Откройте его заново.'}}
   else{let t=store.find(t=>t.order_id===body.order_id&&t.issue_code===body.issue_code);if(!t){t={id:'task'};store.push(t)}Object.assign(t,body,{version:(t.version||0)+1,active:body.action==='controlSave',assignee_name:people.find(p=>p.id===body.assignee_id)?.name,has_push:false,reminder_status:body.remind?'scheduled':'off'});result={ok:true,task:t}}
  }else{status=404;result={ok:false,error:'unsupported test service'}}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.waitForFunction(()=>!!window.BOS_CONTROL_TASKS);
 return {...data,store,writes};
}
for(const width of [320,1280])test(`control tasks save server-backed responsibility and Moscow deadline at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const data=await setup(page);
 const button=page.locator('[data-ct-edit="12"][data-ct-code="unassigned"]');await button.click();
 const box=page.locator('dialog.ctDialog');await expect(box.locator('select')).toBeVisible();
 await box.locator('[name=assignee]').selectOption('owner');const due=core.toInput(new Date(Date.now()+86400000));
 await box.locator('[name=due]').fill(due);await box.locator('[name=remind]').check();
 await expect(box).toContainText('нет активного подключения push');
 await page.screenshot({path:info.outputPath(`control-editor-${width}.png`)});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await box.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(box).toHaveCount(0);
 expect(data.writes).toHaveLength(1);expect(data.writes[0].due_at).toBe(core.parseDue(due));expect(data.writes[0].expected_version).toBe(0);
 await expect(button).toHaveText('Изменить поручение');
 await page.reload();await expect(page.locator('[data-ct-edit="12"][data-ct-code="unassigned"]')).toHaveText('Изменить поручение');
 await page.locator('[data-ct-edit="12"][data-ct-code="unassigned"]').click();await expect(box.locator('[name=due]')).toHaveValue(due);
 await box.getByRole('button',{name:'Снять поручение',exact:true}).click();await expect(box).toHaveCount(0);expect(data.writes.at(-1).action).toBe('controlClear');
});
test('control stale save reports conflict and retains user input without retry',async({page})=>{
 const data=await setup(page,{failSave:true});await page.locator('[data-ct-edit="12"][data-ct-code="unassigned"]').click();
 const box=page.locator('dialog.ctDialog');await box.locator('[name=assignee]').selectOption('owner');const due=core.toInput(new Date(Date.now()+86400000));await box.locator('[name=due]').fill(due);
 await box.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(box.locator('[role=alert]')).toContainText('уже изменено');await expect(box.locator('[name=due]')).toHaveValue(due);expect(data.writes).toHaveLength(1);
});
test('master sees personal tasks without assignment controls',async({page})=>{
 const data=await setup(page,{role:'master'});const panel=page.locator('#bosMyControlTasks');await expect(panel).toContainText('Связаться с клиентом');await expect(page.locator('[data-ct-edit]')).toHaveCount(0);
 await panel.getByRole('button',{name:'Открыть заявку'}).click();await expect(page.locator('#modalRoot .modal')).toBeVisible();expect(data.writes).toEqual([]);
});
test('logout closes task editor and removes assignment UI',async({page})=>{
 await setup(page);await page.locator('[data-ct-edit="12"][data-ct-code="unassigned"]').click();await expect(page.locator('dialog.ctDialog select')).toBeVisible();
 await page.evaluate(()=>document.body.classList.remove('bos-auth-ok'));await expect(page.locator('dialog.ctDialog')).toHaveCount(0);await expect(page.locator('.ctMeta')).toHaveCount(0);
});
