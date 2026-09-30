const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {attachmentUrl}=require('./helpers/edge.cjs');

// Only Storage transfer and the Drive provider are fixtures. Both browser roles
// use the real API handlers and the production order-trigger behavior.
for(const [role,width] of [['owner',390],['dispatcher',390],['owner',1280]]){
 test(`${role} ${width}: reject with reason, correct in master UI, and approve once`,async({page,browser,baseURL})=>{
  let archiveCalls=0;
  const reviewer=await fullStack(page,role,{productionOrderGuards:true,archive:async(body,db)=>{
   archiveCalls++;
   const order=db.tables.orders.find(o=>o.id===body.order_id);
   expect(body.expected_report_token).toBe(order.report_upload_token);
   expect(body.expected_report_uploaded_at).toBe(order.report_uploaded_at);
   Object.assign(order,{drive_archive_status:'archived',drive_archive_url:'https://drive.test/corrected-report'});
   return Response.json({ok:true,order});
  }});
  await page.setViewportSize({width,height:844});
  const masterContext=await browser.newContext({baseURL,viewport:{width:390,height:844}});
  try{
   const masterPage=await masterContext.newPage();
   const master=await fullStack(masterPage,'master',{productionOrderGuards:true});
   reviewer.db.tables.business_staff.push(master.me);
   for(const key of Object.keys(reviewer.db.tables))master.db.tables[key]=reviewer.db.tables[key];
   const order=reviewer.db.tables.orders[0];
   Object.assign(order,{master_staff_id:master.me.id,master_name:master.me.full_name,scheduled_date:'2026-10-01',scheduled_time:'12:00',time_slot:'12:00–13:00',master_workflow_stage:'started',master_departed_at:'2026-10-01T07:00:00Z',master_started_at:'2026-10-01T07:30:00Z'});
   const uploads=[];
   await masterPage.route(/\/(?:api\/proxy|functions\/v1)\/report-api(?:\?|$)/,async route=>{
    const body=route.request().postDataJSON();
    if(body.action!=='uploadReportFile')return route.fallback();
    expect(body.order_id).toBe('11');
    expect(Buffer.from(body.file_data,'base64').length).toBeGreaterThan(0);
    uploads.push({token:body.upload_token,kind:body.file_kind});
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,url:attachmentUrl('11',body.upload_token,`${body.file_kind}-${body.file_index}.jpg`)})});
   });
   for(const p of [page,masterPage]){
    await p.clock.install({time:new Date('2026-10-01T08:00:00Z')});
    await p.goto('/');
    await expect(p.locator('#authGate')).toBeHidden();
    await p.waitForFunction(()=>typeof window.BOS_REFRESH_NOW==='function');
   }
   const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=','base64');
   const upload=async()=>{
    await expect(masterPage.locator('#masterReportForm')).toBeVisible();
    await masterPage.locator('#mrAct').setInputFiles({name:'act.txt',mimeType:'text/plain',buffer:Buffer.from('test act')});
    await masterPage.locator('#mrPhotos').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});
    await masterPage.getByRole('button',{name:'Отправить отчёт и завершить',exact:true}).click();
    await expect(masterPage.locator('#masterReportForm')).toHaveCount(0);
    expect(order.report_review_status).toBe('pending');
   };
   await masterPage.evaluate(()=>openOrder('11'));
   await masterPage.locator('.bosMasterWorkflow[data-bos-v179="1"]').getByRole('button',{name:/Отправить отчет/}).click();
   await upload();
   const firstToken=order.report_upload_token;
   await page.evaluate(()=>BOS_REFRESH_NOW());
   await page.locator('.reportReviewCard').filter({hasText:'Невский 1'}).first().click();
   await page.locator('#rejectReportBtn').click();
   await expect(page.locator('#reviewMsg')).toContainText('Укажите причину отклонения');
   expect(order.report_review_status).toBe('pending');
   const reason='Добавьте фото <крепления> и исправьте акт';
   await page.locator('#reviewComment').fill(reason);
   await page.locator('#rejectReportBtn').click();
   await expect(page.locator('#reviewForm')).toHaveCount(0);
   expect(order).toMatchObject({status:'В работе',report_review_status:'rejected',report_review_comment:reason,report_uploaded_at:null,report_upload_token:null,master_workflow_stage:'assigned'});
   expect(archiveCalls).toBe(0);

   await masterPage.evaluate(()=>BOS_REFRESH_NOW());
   await masterPage.evaluate(()=>openOrder('11'));
   const panel=masterPage.locator('.bosMasterWorkflow[data-bos-v179="1"]');
   await expect(panel.locator('.moa179Review.rejected')).toContainText(reason);
   await expect(panel.getByRole('button',{name:/Исправить отчет/})).toBeDisabled();
   await panel.getByRole('button',{name:/Выехал/}).click();
   await expect.poll(()=>order.master_workflow_stage).toBe('departed');
   await panel.getByRole('button',{name:/Начал работу/}).click();
   await expect.poll(()=>order.master_workflow_stage).toBe('started');
   await panel.getByRole('button',{name:/Исправить отчет/}).click();
   await upload();
   expect(order.report_upload_token).not.toBe(firstToken);
   expect(order.report_review_comment).toBe('');
   expect(uploads.map(x=>x.kind)).toEqual(['act','photo','act','photo']);

   await page.evaluate(()=>BOS_REFRESH_NOW());
   await page.locator('.reportReviewCard').filter({hasText:'Невский 1'}).first().click();
   await expect(page.locator('#reviewForm')).toHaveAttribute('data-report-token',order.report_upload_token);
   await page.locator('#approveReportBtn').click();
   await expect(page.locator('#reviewForm')).toHaveCount(0);
   expect(order).toMatchObject({status:'Выполнена',report_review_status:'approved',drive_archive_status:'archived',master_payout:552.5});
   expect(archiveCalls).toBe(1);
   await masterPage.evaluate(()=>BOS_REFRESH_NOW());
   await masterPage.evaluate(()=>openOrder('11'));
   await expect(panel.locator('.moa179Review.approved')).toContainText('Отчёт принят');
   await expect(panel.locator('.moa179Head')).toContainText('ЗАЯВКА ВЫПОЛНЕНА');
   await expect(panel.locator('button:enabled')).toHaveCount(0);
   await expect(panel.locator('.moa179Review.rejected')).toHaveCount(0);
   await masterPage.reload();
   await expect(masterPage.locator('#authGate')).toBeHidden();
   await masterPage.evaluate(()=>openOrder('11'));
   await expect(panel.locator('.moa179Review.approved')).toContainText('Отчёт принят');
   expect(archiveCalls).toBe(1);
  }finally{await masterContext.close()}
 });
}

for(const [status,reviewStatus,heading] of [['Выполнена','not_submitted','ЗАЯВКА ВЫПОЛНЕНА'],['Отменена','approved','ЗАЯВКА ОТМЕНЕНА']]){
 test(`${status}: terminal card does not imply a new assignment or an accepted report`,async({page})=>{
  const {db}=await fullStack(page,'master');
  Object.assign(db.tables.orders[0],{status,report_review_status:reviewStatus,scheduled_date:null,scheduled_time:null,time_slot:null});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>openOrder('11'));
  const panel=page.locator('.bosMasterWorkflow[data-bos-v179="1"]');
  await expect(panel.locator('.moa179Head')).toContainText(heading);
  await expect(panel.locator('.moa179Head')).not.toContainText('Требуется договориться');
  await expect(panel).not.toContainText('Согласуйте с клиентом');
  await expect(panel.locator('.moa179Review.approved')).toHaveCount(0);
  await expect(panel.locator('button:enabled')).toHaveCount(0);
 });
}
