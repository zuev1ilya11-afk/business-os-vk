const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {attachmentUrl}=require('./helpers/edge.cjs');
const panel=p=>p.locator('.bosMasterWorkflow[data-bos-v179="1"]');
async function open(page,extra={},width=390){
 await page.setViewportSize({width,height:1000});const context=await fullStack(page,'master');
 Object.assign(context.db.tables.orders[0],{scheduled_time:'10:00',time_slot:'10:00–11:00',phone:'+79990000002',...extra});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));await expect(panel(page)).toBeVisible();return context;
}
async function progress(page,value,buttons=1){await expect(panel(page).getByRole('progressbar')).toHaveAttribute('aria-valuenow',String(value));await expect(panel(page)).toContainText(`Завершено ${value/25} из 4`);await expect(panel(page).locator('.moa179Action')).toHaveCount(buttons)}
async function screenshot(page,info,name){await expect(async()=>{await panel(page).screenshot({path:info.outputPath(name+'.png')})}).toPass({timeout:5000});}
for(const width of [320,390,768,1280])test(`${width}: confirmed 25 → 50 → 75 → 100, history, return and cancellation`,async({page},info)=>{
 const {db}=await open(page,{},width),o=db.tables.orders[0];
 const check=async(n,name,buttons=1)=>{await progress(page,n,buttons);await expect.poll(()=>panel(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await screenshot(page,info,name)};
 await check(25,'assigned');await expect(panel(page).locator('.moa179Step.future')).toHaveCount(2);
 await expect(page.locator('.bosCompactClient').getByRole('link',{name:'Позвонить клиенту',exact:true})).toBeVisible();
 await panel(page).getByRole('button',{name:'Подтвердить: выехал',exact:true}).click();await check(50,'departed');
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));await progress(page,50);
 await panel(page).getByRole('button',{name:'Подтвердить: начал работу',exact:true}).click();await check(75,'started');
 const start=o.master_started_at;
 await panel(page).getByRole('button',{name:'Отправить отчёт',exact:true}).click();await expect(page.locator('#masterReportForm')).toBeVisible();expect(o.report_uploaded_at).toBeUndefined();
 await page.evaluate(()=>openOrder('11'));await progress(page,75);
 Object.assign(o,{report_review_status:'pending',report_uploaded_at:'2026-10-01T10:00:00Z',report_upload_token:'proof'});
 await page.evaluate(async()=>{await reloadData(true);openOrder('11')});await check(100,'pending',0);await expect(panel(page)).toContainText('Отчёт отправлен — ожидает проверки');expect(o.status).toBe('В работе');
 // Existing DB trigger clears old stage timestamps on rejection: still correct directly.
 Object.assign(o,{report_review_status:'rejected',report_review_comment:'Приложите чёткое фото крепления',report_uploaded_at:null,master_workflow_stage:'assigned',master_started_at:null,master_departed_at:null});
 await page.evaluate(async()=>{await reloadData(true);openOrder('11')});await check(75,'rejected');await expect(panel(page)).toContainText('Приложите чёткое фото крепления');await panel(page).getByRole('button',{name:'Исправить отчёт',exact:true}).click();await expect(page.locator('#masterReportForm')).toBeVisible();
 Object.assign(o,{report_review_status:'approved',report_uploaded_at:'2026-10-01T11:00:00Z',status:'Выполнена'});await page.evaluate(async()=>{await reloadData(true);openOrder('11')});await check(100,'approved',0);await expect(panel(page)).toContainText('Отчёт принят');
 Object.assign(o,{status:'Отменена'});await page.evaluate(async()=>{await reloadData(true);openOrder('11')});await expect(panel(page)).toContainText('Заявка отменена');await expect(panel(page).getByRole('progressbar')).toHaveCount(0);await expect(panel(page).locator('button')).toHaveCount(0);await screenshot(page,info,'cancelled');expect(start).toBeTruthy();
});
test('saving disables double click; response loss reconciles before retry and preserves original time',async({page})=>{
 const {db}=await open(page);
 await page.evaluate(()=>{window.progressFetch=window.fetch;window.progressRelease=null;window.fetch=async(input,init)=>{const b=JSON.parse(init?.body||'{}');if(b.action==='setStage'){const r=await window.progressFetch(input,init);await new Promise(resolve=>window.progressRelease=resolve);throw new TypeError('Failed to fetch')}return window.progressFetch(input,init)}});
 await panel(page).getByRole('button',{name:'Подтвердить: выехал',exact:true}).click();await expect.poll(()=>db.tables.orders[0].master_workflow_stage).toBe('departed');
 await progress(page,25);await expect(panel(page).getByRole('button',{name:'Сохраняем…',exact:true})).toBeDisabled();const at=db.tables.orders[0].master_departed_at;
 await page.evaluate(()=>{masterOrderStage179('11','departed');window.progressRelease()});await progress(page,50);expect(db.tables.orders[0].master_departed_at).toBe(at);
 expect(db.calls.filter(x=>x.table==='orders'&&x.mode==='update'&&x.payload.master_workflow_stage==='departed')).toHaveLength(1);
});
test('network failure never advances; unknown result locks retries until successful refresh',async({page})=>{
 const {db}=await open(page);
 await page.evaluate(()=>{window.progressFetch=window.fetch;window.fetch=async(input,init)=>{const b=JSON.parse(init?.body||'{}');if(['setStage','bootstrap'].includes(b.action))throw new TypeError('Failed to fetch');return window.progressFetch(input,init)}});
 await panel(page).getByRole('button',{name:'Подтвердить: выехал',exact:true}).click();await expect(panel(page)).toContainText('Результат сохранения неизвестен');await progress(page,25);await expect(panel(page).locator('.moa179Action')).toBeDisabled();expect(db.tables.orders[0].master_workflow_stage).toBe('assigned');
 await page.evaluate(()=>window.fetch=window.progressFetch);await panel(page).getByRole('button',{name:'Проверить состояние',exact:true}).click();await expect(panel(page).locator('.moa179Action')).toBeEnabled();await progress(page,25);
 await panel(page).getByRole('button',{name:'Подтвердить: выехал',exact:true}).click();await progress(page,50);
});
for(const [extra,value,label] of [[{master_workflow_stage:'arrived'},50,'Подтвердить: начал работу'],[{master_workflow_stage:'started'},75,'Отправить отчёт'],[{report_review_status:'rejected',scheduled_date:null,scheduled_time:null,time_slot:null},75,'Исправить отчёт']])test(`historical ${JSON.stringify(extra)} needs no retroactive timestamps`,async({page})=>{
 const {db}=await open(page,extra);await progress(page,value);await expect(panel(page).getByRole('button',{name:label,exact:true})).toBeEnabled();expect(db.tables.orders[0].master_departed_at).toBeUndefined();expect(db.tables.orders[0].master_started_at).toBeUndefined();
});
test('agreement stays separate from departure and report confirmation waits for final response',async({page})=>{
 const {db}=await open(page);await expect(page.locator('.bosMasterClientActions').getByRole('button',{name:'Связался с клиентом',exact:true})).toHaveCount(0);await page.locator('.bosCompactClient a[aria-label="Позвонить клиенту"]').dispatchEvent('click');const contactResult=page.locator('#masterContactResultForm');await expect(contactResult).toBeVisible();await contactResult.locator('input[value="agreed"]').check();await contactResult.getByRole('button',{name:'Сохранить итог',exact:true}).click();await expect.poll(()=>db.tables.orders[0].master_called_at).toBeTruthy();const agreement=page.locator('#masterOrderAgree179Form');await expect(agreement).toBeVisible();await agreement.getByRole('button',{name:'Сохранить',exact:true}).click();await expect.poll(()=>db.tables.orders[0].master_agreed_at).toBeTruthy();await progress(page,25);
 await panel(page).getByRole('button',{name:'Подтвердить: выехал',exact:true}).click();await progress(page,50);await panel(page).getByRole('button',{name:'Подтвердить: начал работу',exact:true}).click();await progress(page,75);
 await page.route(/\/(?:api\/proxy|functions\/v1)\/report-api(?:\?|$)/,async route=>{const b=route.request().postDataJSON();if(b.action!=='uploadReportFile')return route.fallback();await route.fulfill({json:{ok:true,url:attachmentUrl('11',b.upload_token,b.file_kind+'.jpg')}})});
 await page.evaluate(()=>{window.progressFetch=window.fetch;window.fetch=async(input,init)=>{const b=JSON.parse(init?.body||'{}');if(b.action==='finalizeMasterReport')await new Promise(resolve=>window.progressRelease=resolve);return window.progressFetch(input,init)}});
 await panel(page).getByRole('button',{name:'Отправить отчёт',exact:true}).click();const form=page.locator('#masterReportForm');
 await form.locator('#mrAct').setInputFiles({name:'act.pdf',mimeType:'application/pdf',buffer:Buffer.from('fixture act')});await form.locator('#mrPhotos').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=','base64')});
 await form.locator('button[type="submit"]').click();await expect(form.locator('#mrMsg')).toContainText('Сохраняем отчёт');expect(db.tables.orders[0].report_uploaded_at).toBeUndefined();expect(await page.evaluate(()=>state.orders.find(o=>o.id==='11').report_uploaded_at)).toBeFalsy();
 await page.evaluate(()=>window.progressRelease());await expect(form).toBeHidden();await page.evaluate(()=>openOrder('11'));await progress(page,100,0);expect(db.tables.orders[0].status).toBe('В работе');
});

test('direct browser API cannot skip stages even after agreement, and cannot change a foreign order',async({page})=>{
 const {db}=await open(page,{master_called_at:'2026-01-01',master_agreed_at:'2026-01-01'});
 const send=(service,body)=>page.evaluate(async({service,body})=>{const r=await fetch(`https://obsropbslfwtanyspjbi.supabase.co/functions/v1/${service}`,{method:'POST',headers:{...await BOS_AUTH_HEADERS(),'Content-Type':'application/json'},body:JSON.stringify(body)});return r.status},{service,body});
 expect(await send('master-workflow-api',{action:'setStage',id:'11',stage:'started'})).toBe(409);
 expect(await send('master-workflow-api',{action:'setStage',id:'12',stage:'departed'})).toBe(403);
 for(const service of ['report-api','order-lifecycle-api'])expect(await send(service,{action:'finalizeMasterReport',order_id:'11',upload_token:'skip',act_url:attachmentUrl('11','skip'),photo_urls:[attachmentUrl('11','skip','photo.jpg')]})).toBe(409);
 await progress(page,25);expect(db.tables.orders[0].master_started_at).toBeUndefined();expect(db.tables.orders[0].report_uploaded_at).toBeUndefined();
});
for(const change of [{status:'Отменена'},{master_staff_id:'other'}])test(`browser refreshes after concurrent ${JSON.stringify(change)}`,async({page})=>{
 const {db}=await open(page);db.beforeQuery=(table,mode)=>{if(table==='orders'&&mode==='update'){Object.assign(db.tables.orders[0],change);db.beforeQuery=null}};
 await panel(page).getByRole('button',{name:'Подтвердить: выехал',exact:true}).click();
 if(change.status){await expect(panel(page)).toContainText('Заявка отменена');await expect(panel(page).locator('button')).toHaveCount(0)}else await expect(panel(page)).toHaveCount(0);
 expect(db.tables.orders[0].master_departed_at).toBeUndefined();
});
