const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {edge,token}=require('./helpers/edge.cjs');
const {reportSql}=require('./helpers/report-sql.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=','base64');
const panel=page=>page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
async function setup(page,{started=true}={}){
 const f=await fullStack(page,'master');
 Object.assign(f.db.tables.orders[0],{status:'Назначена',source:'Лемана Про',master_workflow_stage:started?'started':'assigned',scheduled_time:'12:00',master_called_at:'2026-11-10T08:00:00Z',master_agreed_at:'2026-11-10T08:30:00Z',master_started_at:started?'2026-11-10T09:00:00Z':null,master_contact_status:'agreed',master_called_by_staff_id:f.me.id,master_called_by_name:'Тестовый мастер'});
 f.sql=await reportSql(f.db);f.uploads=new Map();
 f.db.storage={from:()=>({upload:async(path,bytes)=>{f.uploads.set(path,Buffer.from(bytes));return {error:null}},createSignedUrl:async path=>({data:{signedUrl:`https://test.invalid/storage/v1/object/sign/business-os-vk-files/${path}?token=test-signature`}})})};
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>window.BOS_ORDER_LIFECYCLE_V106===true);
 await page.evaluate(()=>openOrder('11'));
 return f;
}
async function form(page){
 await panel(page).getByRole('button',{name:'Отправить отчёт',exact:true}).click();
 await page.locator('#mrAct').setInputFiles({name:'act.png',mimeType:'image/png',buffer:png});
 await page.locator('#mrPhotos').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});
}
const submit=page=>page.locator('#masterReportForm button[type=submit]').click();
const pending=async page=>{await page.evaluate(()=>openOrder('11'));await expect(panel(page)).toContainText('Отчёт отправлен — ожидает проверки');await expect(panel(page).getByRole('button',{name:'Договориться',exact:true})).toHaveCount(0)};
test('master assigned order → work → SQL report → reload/new session → manager attachments and approval',async({page,browser,baseURL},info)=>{
 test.setTimeout(90000);const f=await setup(page,{started:false});const contexts=[];
 try{
  const before=await f.sql.read(11);
  for(const [button,confirmation] of [['Подтвердить: выехал','Подтвердить: выехал'],['Начать работу','Подтвердить: начал работу']]){
   await panel(page).getByRole('button',{name:button,exact:true}).click();
   await page.locator('.bosStageTask').getByRole('button',{name:confirmation,exact:true}).click();
   await expect(page.locator('.bosStageTask')).toHaveCount(0);
  }
  await form(page);await submit(page);await expect(page.locator('#masterReportForm')).toHaveCount(0);await pending(page);
  const saved=await f.sql.read(11);expect(saved).toMatchObject({status:'В работе',report_review_status:'pending',master_workflow_stage:'started'});
  for(const k of ['master_staff_id','master_agreed_at','scheduled_date','scheduled_time','work','master_payout'])expect(saved[k]).toBe(before[k]);
  expect(f.uploads.size).toBe(2);await page.screenshot({path:info.outputPath('master-pending.png')});
  await page.reload();await expect(page.locator('#authGate')).toBeHidden();await pending(page);
  const renewedContext=await browser.newContext({baseURL});contexts.push(renewedContext);const renewed=await renewedContext.newPage();const renewedFixture=await fullStack(renewed,'master');renewedFixture.db.from=f.db.from;
  await renewed.goto('/');await expect(renewed.locator('#authGate')).toBeHidden();await pending(renewed);
  const managerContext=await browser.newContext({baseURL});contexts.push(managerContext);const manager=await managerContext.newPage();let archives=0;
  const m=await fullStack(manager,'manager',{archive:async()=>{archives++;const order=await f.sql.read(11);return Response.json({ok:true,order:{...order,drive_archive_status:'archived',drive_archive_url:'https://drive.test/report'}})}});
  f.db.tables.business_staff.push(m.me);m.db.from=f.db.from;
  const fileRequests=[];await managerContext.route('https://test.invalid/storage/**',async route=>{const path=decodeURIComponent(new URL(route.request().url()).pathname).split('/business-os-vk-files/')[1];const bytes=f.uploads.get(path);fileRequests.push(path);await route.fulfill({status:bytes?200:404,contentType:path?.endsWith('.pdf')?'application/pdf':'image/jpeg',body:bytes||Buffer.from('missing')})});
  await manager.goto('/');await expect(manager.locator('#authGate')).toBeHidden();await manager.evaluate(()=>openReportReview('11'));
  await expect(manager.locator('#reviewForm')).toHaveAttribute('data-report-token',saved.report_upload_token);
  const photos=JSON.parse(saved.report_photo_urls);await expect(manager.locator('.reportPhotoGrid')).toBeVisible();
  const act=manager.getByRole('link',{name:/Открыть акт/});
  await expect(act).toHaveAttribute('href',saved.report_act_url);await act.click();
  for(const url of [saved.report_act_url,photos[0]]){
   if(url===photos[0])await manager.locator('.reportPhotoThumb').first().click();
   const viewer=manager.locator('#reportPhotoViewer');await expect(viewer).toBeVisible();
   await expect(viewer.locator('img')).toHaveAttribute('src',url);
   await expect.poll(()=>viewer.locator('img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
   await expect(viewer.getByRole('link',{name:'Открыть оригинал'})).toHaveAttribute('href',url);
   await viewer.getByRole('button',{name:'Закрыть',exact:true}).click();
  }
  expect(fileRequests.length).toBeGreaterThanOrEqual(2);expect(fileRequests.every(p=>f.uploads.has(p))).toBe(true);
  await manager.locator('#approveReportBtn').click();await expect(manager.locator('#reviewForm')).toHaveCount(0);
  expect(await f.sql.read(11)).toMatchObject({status:'Выполнена',report_review_status:'approved',master_payout:before.master_payout});expect(archives).toBe(1);
  await page.reload();await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));await expect(panel(page)).toContainText('Отчёт принят');
 }finally{for(const c of contexts)await c.close();await f.sql.close()}
});
for(const failure of ['upload','save','false-success','timeout'])test(`${failure}: preserve form or reconcile committed report without repeat writes`,async({page})=>{
 test.setTimeout(60000);const f=await setup(page);let failed=false,calls=0;
 try{
  const endpoint=failure==='upload'?'report-api':'order-lifecycle-api';
  const actual=edge('order-lifecycle-api',f.db);
  await page.route(new RegExp('/(?:api/proxy|functions/v1)/'+endpoint+'(?:\\?|$)'),async route=>{
   const body=route.request().postDataJSON();if(body.action!==(failure==='upload'?'uploadReportFile':'finalizeMasterReport'))return route.fallback();
   calls++;if(failed)return route.fallback();failed=true;
   if(failure==='timeout'){expect((await actual(body,f.me.external_id,token(f.me.external_id))).status).toBe(200);return route.abort('failed')}
   if(failure==='false-success')return route.fulfill({json:{ok:true,order:{id:'11',master_workflow_stage:'assigned',report_review_status:'not_submitted'}}});
   return route.fulfill({status:400,json:{ok:false,error:failure==='upload'?'Не удалось загрузить фотографию':'Не удалось сохранить отчёт'}});
  });
  await form(page);
  await page.locator('label').filter({has:page.locator('[name=mrExtra][value=true]')}).click();
  await page.locator('#mrExtraDesc').fill('Сохранить описание допработы');await page.locator('#mrExtraAmount').fill('50');
  await submit(page);
  if(failure==='timeout'){
   await expect(page.locator('#mrMsg')).toContainText('Отчёт уже загружен и ожидает проверки',{timeout:25000});expect(calls).toBe(1);
   expect(f.sql.trace.filter(t=>t.rows.length&&t.patch.report_upload_token)).toHaveLength(1);
   await page.getByRole('button',{name:'Открыть заявку',exact:true}).click();await pending(page);
  }else{
   await expect(page.locator('#mrMsg')).toContainText(failure==='false-success'?'Сервер не подтвердил':'Не удалось');
   expect(await page.locator('#mrAct').evaluate(el=>el.files.length)).toBe(1);expect(await page.locator('#mrPhotos').evaluate(el=>el.files.length)).toBe(1);
   expect((await f.sql.read(11)).master_workflow_stage).toBe('started');
   await expect(page.locator('#mrExtraDesc')).toHaveValue('Сохранить описание допработы');await expect(page.locator('#mrExtraAmount')).toHaveValue('50');
   await submit(page);await expect(page.locator('#masterReportForm')).toHaveCount(0);await pending(page);
   expect(f.sql.trace.filter(t=>t.rows.length&&t.patch.report_upload_token)).toHaveLength(1);
  }
  expect(await f.sql.read(11)).toMatchObject({extra_work_description:'Сохранить описание допработы',extra_work_amount:50});
 }finally{await f.sql.close()}
});
