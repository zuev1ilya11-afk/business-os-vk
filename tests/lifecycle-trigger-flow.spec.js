const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {token,attachmentUrl}=require('./helpers/edge.cjs');
test('real handlers create, assign, work, reject, repeat, approve and preserve finance receipts',async({page})=>{
 let archiveCalls=0;
 const {db,master}=await fullStack(page,'owner',{productionOrderGuards:true,archive:async(body,db)=>{
  archiveCalls++;const o=db.tables.orders.find(o=>o.id===body.order_id);
  expect(body.expected_report_token).toBe(o.report_upload_token);expect(body.expected_report_uploaded_at).toBe(o.report_uploaded_at);
  Object.assign(o,{drive_archive_status:'archived',drive_archive_url:'https://drive.test/fixture'});
  return new Response(JSON.stringify({ok:true,order:o}));
 }});
 await page.clock.install({time:new Date('2026-10-01T08:00:00Z')});await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 const request=(service,body,uid='100')=>page.evaluate(async({service,body,session})=>{
  const r=await fetch(`https://obsropbslfwtanyspjbi.supabase.co/functions/v1/${service}`,{method:'POST',headers:{'Content-Type':'application/json','X-BOS-Session':session},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};
 },{service,body,session:token(uid)});
 const created=await request('mini-app-api',{action:'createOrder',client:'Fixture',address:'Test only',work:'Монтаж',source:'VK',amount:1000,original_amount:1000});expect(created.status).toBe(200);const id=created.body.order.id;
 expect((await request('mini-app-api',{action:'updateOrder',id,master_vk_id:master.external_id,scheduled_date:'2026-10-02',scheduled_time:'10:00'})).status).toBe(200);
 for(const stage of ['departed','started'])expect((await request('master-workflow-api',{action:'setStage',id,stage},master.external_id)).status).toBe(200);
 const submission=upload_token=>({action:'finalizeMasterReport',order_id:id,upload_token,act_url:attachmentUrl(id,upload_token),photo_urls:[attachmentUrl(id,upload_token,'photo.jpg')],uncompleted_work_amount:100,extra_work_amount:50,extra_work_done:true});
 const first=await request('order-lifecycle-api',submission('cycle1'),master.external_id);expect(first.status).toBe(200);expect(first.body.order.amount).toBe(900);expect(first.body.order.original_amount).toBe(1000);expect(first.body.order.manager_payout).toBeUndefined();expect(first.body.order.master_payout).toBe(540);
 const snapshot=o=>({expected_report_token:o.report_upload_token,expected_report_uploaded_at:o.report_uploaded_at});
 const rejected=await request('mini-app-api',{action:'reviewReport',id,...snapshot(first.body.order),decision:'rejected',comment:'Fix photo'});expect(rejected.status).toBe(200);
 expect(rejected.body.order).toMatchObject({master_workflow_stage:'assigned',report_uploaded_at:null,report_upload_token:null,report_review_status:'rejected',report_review_comment:'Fix photo'});
 expect(archiveCalls).toBe(0);
 for(const stage of ['departed','started'])expect((await request('master-workflow-api',{action:'setStage',id,stage},master.external_id)).status).toBe(200);
 const second=await request('order-lifecycle-api',submission('cycle2'),master.external_id);expect(second.status).toBe(200);expect(second.body.order.report_upload_token).toBe('cycle2');
 expect((await request('order-lifecycle-api',{action:'reviewReport',id,...snapshot(second.body.order),decision:'approved'},master.external_id)).status).toBe(403);
 expect((await request('mini-app-api',{action:'reviewReport',id,...snapshot(first.body.order),decision:'approved'})).status).toBe(409);
 const approve={action:'reviewReport',id,...snapshot(second.body.order),decision:'approved'};
 const done=await request('mini-app-api',approve);expect(done.status).toBe(200);expect(done.body.order).toMatchObject({status:'Выполнена',report_review_status:'approved',master_payout:540,extra_work_amount:50});
 const before=structuredClone(db.tables.orders.find(o=>o.id===id));expect((await request('mini-app-api',approve)).status).toBe(200);expect(db.tables.orders.find(o=>o.id===id)).toEqual(before);expect(archiveCalls).toBe(1);
 expect((await request('order-lifecycle-api',submission('cycle2'),master.external_id)).status).toBe(200);expect(db.tables.orders.find(o=>o.id===id)).toEqual(before);
 expect((await request('order-lifecycle-api',submission('cycle3'),master.external_id)).status).toBe(409);
});
