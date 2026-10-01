const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee,attachmentUrl}=require('./helpers/edge.cjs');
const routes=[['order-lifecycle-api','finalizeMasterReport'],['report-api','finalizeMasterReport'],['report-api','uploadMasterReport']];
const request=(action,uploadToken='r1')=>({action,order_id:'o',upload_token:uploadToken,act_url:attachmentUrl('o',uploadToken),photo_urls:[attachmentUrl('o',uploadToken,'photo.jpg')],act_data:'YQ==',act_name:'act.pdf',photos_json:JSON.stringify([{name:'photo.jpg',data:'YQ=='}])});
function fixture(overrides={}){
 const db=database({business_staff:[employee('m'),employee('owner','owner')],orders:[{id:'o',master_workflow_stage:'started',master_staff_id:'m',report_upload_token:'r1',status:'В работе',amount:1000,original_amount:1000,updated_at:'2026-01-01T00:00:00Z',...overrides}]});
 const uploads=[];
 db.storage={from:()=>({upload:async(path,data,options)=>{uploads.push({path,options});return {error:null}},createSignedUrl:async path=>({data:{signedUrl:'https://files.test/'+path}})})};
 return {db,uploads};
}
for(const [slug,action] of routes){
 test(`${slug}/${action}: replay preserves submitted and approved receipts without writes`,async()=>{
  const {db,uploads}=fixture();const api=edge(slug,db);const body=request(action);
  assert.equal((await api(body,'staff_m')).status,200);
  for(const approved of [false,true]){
   if(approved)Object.assign(db.tables.orders[0],{status:'Выполнена',report_review_status:'approved',completed_at:'2026-01-02T10:00:00Z',drive_archive_status:'archived',drive_archive_url:'https://drive.test/folder'});
   const before=structuredClone(db.tables.orders[0]),writes=db.calls.filter(x=>x.mode==='update').length,files=uploads.length;
   const r=await api(body,'staff_m');assert.equal(r.status,200);assert.equal(r.body.order.report_upload_token,'r1');
   assert.deepEqual(db.tables.orders[0],before);assert.equal(db.calls.filter(x=>x.mode==='update').length,writes);assert.equal(uploads.length,files);
  }
 });
 test(`${slug}/${action}: fresh token cannot replace pending, approved, completed or cancelled reports`,async()=>{
  for(const state of [{report_review_status:'pending'},{report_review_status:'approved'},{status:'Выполнена'},{status:'Отменена'}]){
   const {db,uploads}=fixture({...state,report_upload_token:'older',report_uploaded_at:'2026-01-01'}),before=structuredClone(db.tables.orders);
   assert.equal((await edge(slug,db)(request(action),'staff_m')).status,409);assert.deepEqual(db.tables.orders,before);assert.equal(uploads.length,0);
  }
 });
 test(`${slug}/${action}: concurrent reassignment, completion and edit cannot be overwritten`,async()=>{
  for(const change of [{master_staff_id:'other'},{status:'Выполнена',report_review_status:'approved'},{updated_at:'2026-01-02T00:00:00Z',amount:500}]){
   const {db}=fixture();let expected;
   db.beforeQuery=(table,mode)=>{if(table==='orders'&&mode==='update'){Object.assign(db.tables.orders[0],change);expected=structuredClone(db.tables.orders[0]);db.beforeQuery=null}};
   const r=await edge(slug,db)(request(action),'staff_m');assert.equal(r.status,409);assert.deepEqual(db.tables.orders[0],expected);
  }
 });
 test(`${slug}/${action}: only one concurrent token wins`,async()=>{
  const {db}=fixture();const api=edge(slug,db);
  const result=await Promise.all([api(request(action),'staff_m'),api(request(action,'r2'),'staff_m')]);
  assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);assert.ok(['r1','r2'].includes(db.tables.orders[0].report_upload_token));
 });
}
test('uploads cannot overwrite files and are refused after submission',async()=>{
 const {db,uploads}=fixture();const api=edge('report-api',db),body={action:'uploadReportFile',order_id:'o',upload_token:'r1',file_kind:'act',file_name:'act.pdf',file_data:'YQ=='};
 assert.equal((await api(body,'staff_m')).status,200);assert.equal((await api(body,'staff_m')).status,200);
 assert.notEqual(uploads[0].path,uploads[1].path);assert.ok(uploads.every(x=>x.options.upsert===false));
 Object.assign(db.tables.orders[0],{report_review_status:'pending',report_upload_token:'r1',report_uploaded_at:'2026-01-01'});
 assert.equal((await api(body,'staff_m')).status,409);assert.equal(uploads.length,2);
});
test('repeated approval preserves completion time and never archives again',async()=>{
 const {db}=fixture({status:'Выполнена',report_review_status:'approved',report_uploaded_at:'2026-01-01',completed_at:'2026-01-02',drive_archive_url:'https://drive.test/folder'});
 const before=structuredClone(db.tables.orders);
 const r=await edge('order-lifecycle-api',db)({action:'reviewReport',id:'o',expected_report_token:'r1',expected_report_uploaded_at:'2026-01-01',decision:'approved'});
 assert.equal(r.status,200);assert.deepEqual(db.tables.orders,before);assert.equal(db.calls.filter(x=>x.mode==='update').length,0);
 assert.equal((await edge('order-lifecycle-api',db)({action:'reviewReport',id:'o',expected_report_token:'r1',expected_report_uploaded_at:'2026-01-01',decision:'rejected'})).status,409);
});
test('repeated rejection after the database trigger cleared pointers is a receipt',async()=>{
 const {db}=fixture({report_review_status:'rejected',report_uploaded_at:null,report_act_url:null});const before=structuredClone(db.tables.orders);
 assert.equal((await edge('order-lifecycle-api',db)({action:'reviewReport',id:'o',expected_report_token:'r1',expected_report_uploaded_at:'2026-01-01',decision:'rejected'})).status,200);assert.deepEqual(db.tables.orders,before);
});
test('review loses to a concurrent cancellation instead of reopening it',async()=>{
 const {db}=fixture({report_review_status:'pending',report_uploaded_at:'2026-01-01'});
 db.beforeQuery=(table,mode)=>{if(table==='orders'&&mode==='update')db.tables.orders[0].status='Отменена'};
 assert.equal((await edge('order-lifecycle-api',db)({action:'reviewReport',id:'o',expected_report_token:'r1',expected_report_uploaded_at:'2026-01-01',decision:'rejected'})).status,409);
 assert.equal(db.tables.orders[0].status,'Отменена');assert.equal(db.tables.orders[0].report_review_status,'pending');
});
