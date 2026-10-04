const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {edge}=require('./helpers/edge.cjs');
async function setup(page,role='master',extra={}){
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const ctx=await fullStack(page,role);Object.assign(ctx.db.tables.orders[0],{phone:'+79990000002',scheduled_date:'2099-09-10',scheduled_time:'10:00',time_slot:'10:00–11:00',...extra});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();return ctx;
}
async function tapCall(page,result='thinking',finish=true,index=0,comment=''){
 const link=page.locator('.bosCompactClient a[aria-label^="Позвонить клиенту"]').nth(index);
 await expect(link).toHaveAttribute('href',/^tel:/);
 await link.dispatchEvent('click');
 const form=page.locator('#masterContactResultForm');await expect(form).toBeVisible();
 if(!finish)return form;
 await form.locator(`input[value="${result}"]`).check();
 if(comment)await form.locator('[name=comment]').fill(comment);
 await form.getByRole('button',{name:'Сохранить итог',exact:true}).click();
 await expect(form).toHaveCount(0);
 return form;
}
for(const width of [360,390,430])test(`${width}: call result is saved and master sees the current contact state`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const {db,master}=await setup(page);await page.evaluate(()=>openOrder('11'));
 const client=page.locator('.bosCompactClient');await expect(client.locator('.bosContactStatus')).toHaveCount(0);await expect(client.getByRole('button',{name:'Связался с клиентом',exact:true})).toHaveCount(0);
 await tapCall(page);await expect.poll(()=>db.tables.orders[0].master_called_at).toBeTruthy();expect(db.tables.orders[0].master_called_by_staff_id).toBe(master.id);const at=db.tables.orders[0].master_called_at;
 await expect(page.locator('.bosMasterContactSummary')).toContainText('Клиент думает');await page.locator('.bosCompactOrderModal').screenshot({path:info.outputPath('contact-result-master.png')});expect(await client.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));await expect(page.locator('.bosMasterContactSummary')).toContainText('Клиент думает');expect(db.tables.orders[0].master_called_at).toBe(at);
});
test('legacy call timestamp is also hidden from master and has no manual confirmation action',async({page})=>{
 await setup(page,'master',{master_called_at:'2026-10-01T21:05:00Z',master_agreed_at:'2026-10-01T21:06:00Z'});await page.evaluate(()=>openOrder('11'));const client=page.locator('.bosCompactClient');
 await expect(client.locator('.bosContactStatus')).toHaveCount(0);await expect(client.getByRole('button',{name:'Связался с клиентом',exact:true})).toHaveCount(0);
});
test('agreement form requires the phone action, not a separate contact confirmation',async({page})=>{
 const {db}=await setup(page,'master',{scheduled_date:null,scheduled_time:null,time_slot:null});await page.evaluate(()=>openOrder('11'));
 await page.locator('.bosMasterWorkflow').getByRole('button',{name:/Договориться/}).click();let form=page.locator('#masterOrderAgree179Form');await expect(form.getByRole('button',{name:'Сохранить',exact:true})).toBeDisabled();await expect(form.getByRole('button',{name:'Связался с клиентом',exact:true})).toHaveCount(0);await expect(form).toContainText('Сначала нажмите «Позвонить»');
 await form.getByRole('button',{name:'Отмена',exact:true}).click();await expect(page.locator('.bosCompactMasterCard')).toBeVisible();await tapCall(page,'agreed');await expect.poll(()=>db.tables.orders[0].master_called_at).toBeTruthy();
 form=page.locator('#masterOrderAgree179Form');await expect(form).toBeVisible();await form.locator('[name=scheduled_date]').fill('2099-09-10');await form.locator('[name=scheduled_time]').fill('12:00');await expect(form.getByRole('button',{name:'Сохранить',exact:true})).toBeEnabled();await form.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(form).toHaveCount(0);expect(db.tables.orders[0].master_called_by_staff_id).toBe('master');expect(db.tables.orders[0].master_agreed_at).toBeTruthy();
});
for(const [role,width] of [['owner',1280],['dispatcher',1280],['owner',390],['dispatcher',390]])test(`${role} ${width}: operations roles see saved contact time and master preview cannot create it`,async({page})=>{
 await page.setViewportSize({width,height:900});const {db}=await setup(page,role,{master_called_at:'2026-10-01T21:05:00Z',master_called_by_staff_id:'former',master_called_by_name:'Первый <мастер>'});
 await page.locator('nav [data-page=orders]').click();const all=page.getByRole('button',{name:'Все заявки',exact:true});if(await all.isVisible())await all.click();await expect(page.locator('#content .bosContactStatus').filter({hasText:'Связался · 02.10, 00:05'}).first()).toBeVisible();
 await page.evaluate(()=>openOrder('11'));await expect(page.locator('#modalRoot .bosContactStatus')).toContainText('Связался · 02.10, 00:05');await expect(page.locator('#modalRoot')).toContainText('Первый <мастер>');await expect(page.locator('#modalRoot мастер')).toHaveCount(0);
 Object.assign(db.tables.orders[0],{master_called_at:null,master_called_by_staff_id:null,master_called_by_name:null});await page.evaluate(async()=>{await reloadData(true);window.isMasterPreview=()=>true;openOrder('11')});const before=structuredClone(db.tables.orders[0]);await expect(page.locator('.bosCompactMasterCard')).toBeVisible();await expect(page.locator('.bosCompactClient').getByRole('button',{name:'Связался с клиентом',exact:true})).toHaveCount(0);await page.evaluate(()=>window.masterOrderContact179('11','markCalled'));expect(db.tables.orders[0]).toEqual(before);
 expect((await edge('master-workflow-api',db)({action:'markCalled',id:'11',contact_confirmed:true},role==='owner'?'100':'staff_dispatcher')).status).toBe(403);
});
test('reassignment during automatic call save never creates a false contact receipt',async({page})=>{
 const {db,master}=await setup(page);await page.evaluate(()=>openOrder('11'));
 const workflow=edge('master-workflow-api',db);
 await page.route('**/master-workflow-api',async route=>{
  if(route.request().method()==='OPTIONS')return route.fallback();
  db.tables.orders[0].master_staff_id='another';
  const result=await workflow(route.request().postDataJSON(),master.external_id);
  await route.fulfill({status:result.status,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(result.body)});
 });
 const resultForm=await tapCall(page,'thinking',false);await expect.poll(()=>db.tables.orders[0].master_staff_id).toBe('another');expect(db.tables.orders[0].master_called_at).toBeFalsy();expect(db.tables.orders[0].master_called_by_staff_id).toBeFalsy();expect(db.tables.orders[0].master_contact_history||[]).toHaveLength(0);await expect(resultForm).toBeVisible();
});
test('failed automatic save can be retried by another phone tap and dispatcher sees the receipt',async({page,browser})=>{
 const {db}=await setup(page);await page.evaluate(()=>openOrder('11'));
 const failure=async route=>{if(route.request().method()==='OPTIONS')return route.fallback();await route.fulfill({status:503,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({ok:false,error:'Тестовая ошибка сохранения'})})};
 await page.route('**/master-workflow-api',failure);const failedForm=await tapCall(page,'thinking',false);await page.waitForTimeout(100);expect(db.tables.orders[0].master_called_at).toBeFalsy();await failedForm.getByRole('button',{name:'Заполнить позже',exact:true}).click();
 await page.unroute('**/master-workflow-api',failure);await page.waitForTimeout(550);await tapCall(page);await expect.poll(()=>db.tables.orders[0].master_called_at).toBeTruthy();const receipt=structuredClone(db.tables.orders[0]);
 const context=await browser.newContext();try{
  const dispatcher=await context.newPage();await setup(dispatcher,'dispatcher',{...receipt,reschedule_requested:true,reschedule_reason:'Тестовый перенос'});await dispatcher.evaluate(()=>openOrder('11'));await expect(dispatcher.locator('#modalRoot .bosContactStatus')).toContainText('Клиент думает ·');await expect(dispatcher.locator('#modalRoot .bosContactHistory')).toContainText(receipt.master_called_by_name);
  await dispatcher.locator('.modalClose').click();await dispatcher.locator('nav [data-page=orders]').click();await dispatcher.locator('#bosOrderControlEntry').click();await expect(dispatcher.locator('[data-oc-order="11"] .bosContactStatus')).toContainText('Клиент думает ·');
 }finally{await context.close()}
});
test('two client numbers keep separate call history visible to operations',async({page,browser})=>{
 const {db}=await setup(page,'master',{phone:'+79990000002; +79990000003'});await page.evaluate(()=>openOrder('11'));
 await tapCall(page,'no_answer',true,1,'Второй номер не отвечает');
 await expect.poll(()=>db.tables.orders[0].master_contact_history?.length).toBe(1);
 await page.evaluate(()=>openOrder('11'));await tapCall(page,'waiting_delivery',true,0,'Доставка ожидается 6 октября');
 const history=db.tables.orders[0].master_contact_history;expect(history).toHaveLength(2);expect(history.map(x=>x.phone)).toEqual(['+79990000003','+79990000002']);
 const receipt=structuredClone(db.tables.orders[0]),context=await browser.newContext();try{
  const dispatcher=await context.newPage();await setup(dispatcher,'dispatcher',receipt);await dispatcher.evaluate(()=>openOrder('11'));
  const journal=dispatcher.locator('#modalRoot .bosContactHistory');await expect(journal).toContainText('+79990000003');await expect(journal).toContainText('+79990000002');
  await expect(journal).toContainText('Не дозвонился');await expect(journal).toContainText('Ждёт доставку');await expect(journal).toContainText('Доставка ожидается 6 октября');
 }finally{await context.close()}
});
for(const role of ['master','dispatcher'])test(role+': legacy call labels in lists never claim a successful conversation',async({page})=>{
 await setup(page,role,{master_called_at:'2026-10-01T21:05:00Z'});
 await page.locator('nav [data-page=orders]').click();
 if(role==='dispatcher'){const all=page.getByRole('button',{name:'Все заявки',exact:true});if(await all.isVisible())await all.click()}
 const card=role==='master'?page.locator('[data-master-order-id="11"]'):page.locator('#content .opsCompactOrder,#content .dbV94ListCard').filter({hasText:'Невский 1'}).first();await expect(card).toBeVisible();await expect(card).not.toContainText('Созвонился');await expect(card).toContainText('Звонок отмечен');
});
test('contact wording preserves dispatcher workflow counts for legacy and proven calls',async({page})=>{
 await page.setViewportSize({width:1280,height:900});const d=new Date(),today=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const {db}=await setup(page,'dispatcher',{scheduled_date:today,master_called_at:'2026-10-01T21:05:00Z'});await page.locator('nav [data-page=orders]').click();const bar=page.locator('.mwv2OpsBar');await expect(bar).toHaveAttribute('data-mwv3-sig',/call/);await expect(bar).toContainText('Связаться: 1');
 Object.assign(db.tables.orders[0],{master_called_by_staff_id:'m',master_called_by_name:'Первый мастер'});await page.evaluate(()=>reloadData(true));await expect(bar).toHaveAttribute('data-mwv3-sig',/call/);await expect(bar).toContainText('Связаться: 1');
});
