const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {attachmentUrl}=require('./helpers/edge.cjs');

for(const role of ['owner','dispatcher'])for(const decision of ['rejected','approved'])test(`${role}: ${decision} report saves when both AppDeploy gateways are unavailable`,async({page})=>{
 await page.setViewportSize({width:role==='owner'?1600:390,height:900});
 const denied=[],writes=[];let archives=0;
 const {db}=await fullStack(page,role,{productionOrderGuards:true,archive:async(body,db)=>{
  archives++;const order=db.tables.orders.find(o=>o.id===body.order_id);
  expect(body.expected_report_token).toBe('r1');
  Object.assign(order,{drive_archive_status:'archived',drive_archive_url:'https://drive.test/report'});
  return Response.json({ok:true,order});
 }});
 Object.assign(db.tables.orders[0],{master_workflow_stage:'started',report_review_status:'pending',report_type:'work',report_uploaded_at:'2026-01-01T10:00:00Z',report_upload_token:'r1',report_act_url:attachmentUrl('11','r1'),report_photo_urls:JSON.stringify([attachmentUrl('11','r1','photo.jpg')])});
 await page.route(/\/(?:api\/proxy|functions\/v1)\/order-lifecycle-api(?:\?|$)/,async route=>{
  const req=route.request();
  if(new URL(req.url()).hostname==='api-v2.appdeploy.ai'){
   denied.push(req.url());
   return route.fulfill({status:402,headers:{'X-AppDeploy-App-Availability':'temporarily-unavailable','Access-Control-Expose-Headers':'X-AppDeploy-App-Availability'},json:{code:'APP_TEMPORARILY_UNAVAILABLE',message:'This app is temporarily unavailable. Please try again later. If the problem continues, contact the app’s support team.'}});
  }
  writes.push(req.postDataJSON());return route.fallback();
 });
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openReportReview('11'));
 const comment='Не тот акт. Укажи невыполненные работы (Подрезка x2 — 1500).';
 await page.locator('#reviewComment').fill(comment);
 await page.locator(decision==='rejected'?'#rejectReportBtn':'#approveReportBtn').click();
 await expect(page.locator('#reviewForm')).toHaveCount(0);
 expect(denied).toHaveLength(2);expect(writes).toHaveLength(1);
 expect(writes[0]).toMatchObject({action:'reviewReport',decision,comment,expected_report_token:'r1',expected_report_uploaded_at:'2026-01-01T10:00:00Z'});
 const order=db.tables.orders.find(o=>o.id==='11');
 expect(order).toMatchObject({report_review_status:decision,report_review_comment:comment,master_payout:552.5});
 expect(archives).toBe(decision==='approved'?1:0);
 if(decision==='rejected')expect(order).toMatchObject({status:'В работе',master_workflow_stage:'assigned',report_uploaded_at:null,report_upload_token:null,completed_at:null});
 else expect(order).toMatchObject({status:'Выполнена',drive_archive_status:'archived'});
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();
 expect(await page.evaluate(()=>state.orders.find(o=>o.id==='11').report_review_status)).toBe(decision);
});
