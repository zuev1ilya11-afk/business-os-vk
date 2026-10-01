const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {edge,attachmentUrl}=require('./helpers/edge.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=','base64');
async function setup(page){
 const f=await fullStack(page,'master',{productionOrderGuards:true});
 f.order=f.db.tables.orders[0];f.order.master_workflow_stage='started';
 f.uploads=[];
 f.db.storage={from:()=>({upload:async path=>{f.uploads.push(path);return {error:null}},createSignedUrl:async path=>({data:{signedUrl:`https://test.invalid/storage/v1/object/sign/business-os-vk-files/${path}?token=test-signature`}})})};
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>window.BOS_ORDER_LIFECYCLE_V106===true);
 await page.evaluate(()=>openMasterReportForm('11'));
 await page.locator('#mrAct').setInputFiles({name:'act.txt',mimeType:'text/plain',buffer:Buffer.from('test act')});
 await page.locator('#mrPhotos').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});
 return f;
}
function saved(order,review){Object.assign(order,{status:review==='approved'?'Выполнена':'В работе',report_review_status:review,report_uploaded_at:'2026-09-30T12:13:44Z',report_upload_token:'saved-report',report_act_url:attachmentUrl('11','saved-report'),report_photo_urls:JSON.stringify([attachmentUrl('11','saved-report','photo.jpg')])})}
for(const [review,message] of [['pending','Отчёт уже загружен и ожидает проверки'],['approved','Отчёт уже принят'],['cancelled','Заявка отменена']]){
 test(`stale report form reconciles ${review} without replacing the saved report`,async({page})=>{
  const f=await setup(page);saved(f.order,review==='cancelled'?'pending':review);
  if(review==='cancelled')f.order.status='Отменена';
  const before=structuredClone(f.order);
  await page.getByRole('button',{name:'Отправить отчёт и завершить',exact:true}).click();
  await expect(page.locator('#mrMsg')).toContainText(message);
  await expect(page.locator('#mrMsg')).not.toContainText('REPORT_CHANGED');
  await expect(page.getByRole('button',{name:'Отправить отчёт и завершить',exact:true})).toBeDisabled();
  expect(f.uploads).toEqual([]);expect(f.order).toEqual(before);
  await page.getByRole('button',{name:'Открыть заявку',exact:true}).click();
  await expect(page.locator('#masterReportForm')).toHaveCount(0);
  if(review==='approved')await expect(page.locator('.moa179Review.approved')).toContainText('Отчёт принят');
 });
}
test('lost finalization responses recover the saved receipt with only one write',async({page})=>{
 const f=await setup(page),finalize=edge('order-lifecycle-api',f.db);let calls=0;
 await page.route(/\/(?:api\/proxy|functions\/v1)\/order-lifecycle-api(?:\?|$)/,async route=>{
  const body=route.request().postDataJSON();if(body.action!=='finalizeMasterReport')return route.fallback();
  calls++;const r=await finalize(body,f.me.external_id);expect(r.status).toBe(200);
  // Commit succeeds, but the browser never receives any of its retry responses.
  await route.abort('failed');
 });
 await page.getByRole('button',{name:'Отправить отчёт и завершить',exact:true}).click();
 await expect(page.locator('#mrMsg')).toContainText('Отчёт уже загружен и ожидает проверки',{timeout:25000});
 expect(calls).toBe(1);expect(f.order.report_review_status).toBe('pending');
 expect(f.db.calls.filter(c=>c.table==='orders'&&c.mode==='update')).toHaveLength(1);
 expect(f.uploads).toHaveLength(2);
});
test('a failed fresh read cannot turn cached report data into a success receipt',async({page})=>{
 const f=await setup(page);let conflict=false;
 await page.evaluate(()=>Object.assign(state.orders.find(o=>o.id==='11'),{report_review_status:'pending',report_uploaded_at:'2026-09-30T12:13:44Z'}));
 await page.route(/\/(?:api\/proxy|functions\/v1)\/report-api(?:\?|$)/,async route=>{
  conflict=true;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:'REPORT_CHANGED'})});
 });
 await page.route(/\/(?:api\/proxy|functions\/v1)\/mini-app-api(?:\?|$)/,async route=>{
  if(!conflict)return route.fallback();
  await route.fulfill({status:403,contentType:'application/json',body:'{"ok":false,"error":"READ_DENIED"}'});
 });
 await page.getByRole('button',{name:'Отправить отчёт и завершить',exact:true}).click();
 await expect(page.locator('#mrMsg')).toContainText('Результат отправки неизвестен');
 await expect(page.locator('#mrMsg')).not.toContainText('уже загружен');
 await expect(page.getByRole('button',{name:'Отправить отчёт и завершить',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Проверить состояние',exact:true})).toBeEnabled();
 expect(await page.locator('#mrAct').evaluate(el=>el.files.length)).toBe(1);
 expect(f.uploads).toEqual([]);expect(f.order.report_uploaded_at).toBeUndefined();
});
test('a background busy reset cannot start a second submit for the same form',async({page})=>{
 const f=await setup(page);let uploadCalls=0,release;
 const held=new Promise(resolve=>release=resolve);
 await page.route(/\/(?:api\/proxy|functions\/v1)\/report-api(?:\?|$)/,async route=>{
  uploadCalls++;if(uploadCalls===1)await held;await route.fallback();
 });
 await page.getByRole('button',{name:'Отправить отчёт и завершить',exact:true}).click();
 await expect.poll(()=>uploadCalls).toBe(1);
 await page.evaluate(async()=>{state.busy=false;await BOS_MASTER_REPORT_SUBMIT({preventDefault(){},currentTarget:document.querySelector('#masterReportForm')},'11')});
 expect(uploadCalls).toBe(1);release();
 await expect(page.locator('#masterReportForm')).toHaveCount(0);
 expect(f.uploads).toHaveLength(2);
 expect(f.db.calls.filter(c=>c.table==='orders'&&c.mode==='update')).toHaveLength(1);
});
