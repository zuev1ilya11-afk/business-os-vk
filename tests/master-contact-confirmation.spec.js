const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {edge}=require('./helpers/edge.cjs');
async function setup(page,role='master',extra={}){
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const ctx=await fullStack(page,role);Object.assign(ctx.db.tables.orders[0],{phone:'+79990000002',scheduled_date:'2099-09-10',scheduled_time:'10:00',time_slot:'10:00–11:00',...extra});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();return ctx;
}
for(const width of [360,390,430])test(`${width}: dialing/opening/resuming never confirms; explicit contact survives reload`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const {db,master}=await setup(page);await page.evaluate(()=>openOrder('11'));
 const client=page.locator('.bosCompactClient');await expect(client).toContainText('Связь не подтверждена');
 for(const link of await client.locator('a[href^="tel:"]').all()){await link.evaluate(a=>a.addEventListener('click',e=>e.preventDefault()));await link.click()}await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'))});
 expect(db.tables.orders[0].master_called_at).toBeFalsy();expect(db.tables.orders[0].master_called_by_staff_id).toBeFalsy();
 await client.getByRole('button',{name:'Связался с клиентом',exact:true}).click();await expect(client.locator('.bosContactStatus')).toContainText('Связался ·');expect(db.tables.orders[0].master_called_by_staff_id).toBe(master.id);const at=db.tables.orders[0].master_called_at;
 await page.locator('.bosCompactOrderModal').screenshot({path:info.outputPath('contact-confirmed.png')});await expect(client.getByRole('button',{name:'Связался с клиентом',exact:true})).toHaveCount(0);expect(await client.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));await expect(client.locator('.bosContactStatus')).toContainText('Связался ·');expect(db.tables.orders[0].master_called_at).toBe(at);
});
test('legacy timestamp and agreement alone never render proven contact; legacy can be explicitly confirmed',async({page})=>{
 const {db}=await setup(page,'master',{master_called_at:'2026-10-01T21:05:00Z',master_agreed_at:'2026-10-01T21:06:00Z'});await page.evaluate(()=>openOrder('11'));const client=page.locator('.bosCompactClient');await expect(client.locator('.bosContactStatus')).toHaveText('Звонок отмечен · 02.10, 00:05');await client.getByRole('button',{name:'Связался с клиентом',exact:true}).click();await expect(client.locator('.bosContactStatus')).toContainText('Связался ·');expect(db.tables.orders[0].master_called_by_staff_id).toBe('master');
});
test('agreement form requires its explicit contact action before saving an uncalled order',async({page})=>{
 const {db}=await setup(page,'master',{scheduled_date:null,scheduled_time:null,time_slot:null});await page.evaluate(()=>openOrder('11'));await page.locator('.bosMasterWorkflow').getByRole('button',{name:/Договориться/}).click();const form=page.locator('#masterOrderAgree179Form');await form.locator('[name=scheduled_date]').fill('2099-09-10');await form.locator('[name=scheduled_time]').fill('12:00');await expect(form.getByRole('button',{name:'Сохранить',exact:true})).toBeDisabled();expect(db.tables.orders[0].master_called_at).toBeFalsy();await form.getByRole('button',{name:'Связался с клиентом',exact:true}).click();await expect(form.getByRole('button',{name:'Сохранить',exact:true})).toBeEnabled();await form.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(form).toHaveCount(0);expect(db.tables.orders[0].master_called_by_staff_id).toBe('master');
});
for(const [role,width] of [['owner',1280],['dispatcher',1280],['owner',390],['dispatcher',390]])test(`${role} ${width}: cards and details show original confirmation author after reassignment and preview cannot confirm`,async({page})=>{
 await page.setViewportSize({width,height:900});const {db,master}=await setup(page,role,{master_called_at:'2026-10-01T21:05:00Z',master_called_by_staff_id:'former',master_called_by_name:'Первый <мастер>'});
 await page.locator('nav [data-page=orders]').click();const all=page.getByRole('button',{name:'Все заявки',exact:true});if(await all.isVisible())await all.click();await expect(page.locator('#content .bosContactStatus').filter({hasText:'Связался · 02.10, 00:05'}).first()).toBeVisible();
 await page.evaluate(()=>openOrder('11'));await expect(page.locator('#modalRoot .bosContactStatus')).toContainText('Связался · 02.10, 00:05');await expect(page.locator('#modalRoot')).toContainText('Первый <мастер>');await expect(page.locator('#modalRoot мастер')).toHaveCount(0);
 Object.assign(db.tables.orders[0],{master_called_at:null,master_called_by_staff_id:null,master_called_by_name:null});await page.evaluate(async()=>{await reloadData(true);window.isMasterPreview=()=>true;openOrder('11')});const before=structuredClone(db.tables.orders[0]);await expect(page.locator('.bosCompactMasterCard')).toBeVisible();await expect(page.locator('.bosCompactClient').getByRole('button',{name:'Связался с клиентом',exact:true})).toBeDisabled();await page.evaluate(()=>window.masterOrderContact179('11','markCalled'));expect(db.tables.orders[0]).toEqual(before);
 expect((await edge('master-workflow-api',db)({action:'markCalled',id:'11'},role==='owner'?'100':'staff_dispatcher')).status).toBe(403);
});

test('reassignment during contact save never displays a false successful contact',async({page})=>{
 const {db,master}=await setup(page);await page.evaluate(()=>openOrder('11'));
 const workflow=edge('master-workflow-api',db);
 await page.route('**/master-workflow-api',async route=>{
  if(route.request().method()==='OPTIONS')return route.fallback();
  db.tables.orders[0].master_staff_id='another';
  const result=await workflow(route.request().postDataJSON(),master.external_id);
  await route.fulfill({status:result.status,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(result.body)});
 });
 await page.locator('.bosCompactClient').getByRole('button',{name:'Связался с клиентом',exact:true}).click();
 await expect(page.locator('.bosCompactMasterCard')).toHaveCount(0);expect(db.tables.orders[0].master_called_at).toBeFalsy();expect(db.tables.orders[0].master_called_by_staff_id).toBeFalsy();
});


test('failed contact save stays unconfirmed and dispatcher sees the same saved receipt after retry',async({page,browser})=>{
 const {db}=await setup(page);await page.evaluate(()=>openOrder('11'));
 const client=page.locator('.bosCompactClient');
 const failure=async route=>{if(route.request().method()==='OPTIONS')return route.fallback();await route.fulfill({status:503,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({ok:false,error:'Тестовая ошибка сохранения'})})};
 await page.route('**/master-workflow-api',failure);
 await client.getByRole('button',{name:'Связался с клиентом',exact:true}).click();
 await expect(page.locator('.moa179Msg')).toContainText('Не удалось сохранить');await expect(client.locator('.bosContactStatus')).toHaveText('Связь не подтверждена');expect(db.tables.orders[0].master_called_at).toBeFalsy();
 await page.unroute('**/master-workflow-api',failure);await client.getByRole('button',{name:'Связался с клиентом',exact:true}).click();await expect(client.locator('.bosContactStatus')).toContainText('Связался ·');
 const label=await client.locator('.bosContactStatus').textContent(),receipt=structuredClone(db.tables.orders[0]);
 const context=await browser.newContext();try{
  const dispatcher=await context.newPage();await setup(dispatcher,'dispatcher',{...receipt,reschedule_requested:true,reschedule_reason:'Тестовый перенос'});await dispatcher.evaluate(()=>openOrder('11'));await expect(dispatcher.locator('#modalRoot .bosContactStatus')).toHaveText(label);await expect(dispatcher.locator('#modalRoot .bosContactAuthor')).toContainText(receipt.master_called_by_name);
  await dispatcher.locator('.modalClose').click();await dispatcher.locator('nav [data-page=orders]').click();await dispatcher.locator('#bosOrderControlEntry').click();await expect(dispatcher.locator('[data-oc-order="11"] .bosContactStatus')).toHaveText(label);
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
