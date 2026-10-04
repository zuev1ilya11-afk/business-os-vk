const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee,attachmentUrl}=require('./helpers/edge.cjs');
function fixture(extra={}){
 return database({business_staff:[employee('owner','owner'),employee('d','dispatcher'),employee('mgr','manager'),employee('m')],orders:[{id:'o',master_workflow_stage:'started',status:'В работе',master_staff_id:'m',original_amount:1000,amount:1000,master_payout:552.5,manager_payout:159.8,dispatcher_payout:119.85,report_upload_token:'r1',report_uploaded_at:'2026-01-01',report_act_url:'https://files.test/act',report_photo_urls:'["https://files.test/photo"]',report_review_status:'pending',...extra}]});
}
function linked(db,archiveResult){
 const calls=[];
 const lifecycle=edge('order-lifecycle-api',db,{fetch:async(url,init)=>{
  assert.equal(url,'https://test.invalid/functions/v1/drive-archive-api');calls.push('archive');
  const result=archiveResult?archiveResult(db):{ok:true,order:{...db.tables.orders[0],drive_archive_status:'archived',drive_archive_url:'https://drive.test/report'}};
  if(result.order)Object.assign(db.tables.orders[0],result.order);
  return new Response(JSON.stringify(result));
 }});
 const mini=edge('mini-app-api',db,{fetch:async(url,init)=>{
  assert.equal(url,'https://test.invalid/functions/v1/order-lifecycle-api');calls.push('lifecycle');
  const response=await lifecycle(JSON.parse(init.body),'ignored',init.headers['x-bos-session']);
  return new Response(JSON.stringify(response.body),{status:response.status});
 }});
 return {mini,lifecycle,calls};
}
for(const uid of ['100','staff_d','staff_mgr'])test(`${uid}: manual create/update cannot skip approval, even with files present`,async()=>{
 const db=fixture(),before=structuredClone(db.tables.orders),api=edge('mini-app-api',db);
 for(const b of [{action:'updateOrder',id:'o',status:'Выполнена'},{action:'createOrder',status:'Выполнена',client:'Клиент',address:'Адрес',work:'Монтаж'}]){
  assert.equal((await api(b,uid)).status,409);assert.deepEqual(db.tables.orders,before);
 }
});
test('editing an already completed order preserves its completion date',async()=>{
 const db=fixture({status:'Выполнена',report_review_status:'approved',completed_at:'2020-01-01T00:00:00Z'});
 const r=await edge('mini-app-api',db)({action:'updateOrder',id:'o',status:'Выполнена',comment:'Уточнение'});
 assert.equal(r.status,200);assert.equal(db.tables.orders[0].completed_at,'2020-01-01T00:00:00Z');assert.equal(db.tables.orders[0].comment,'Уточнение');
});
test('reviewing a real report after manual closure preserves completion time, history and payroll',async()=>{
 const history=[{actor_id:'owner',actor_role:'owner',actor_name:'Владелец',at:'2026-01-01T12:00:00Z',reason:'Проверено'}];
 const db=fixture({status:'Выполнена',completed_at:history[0].at,manual_completion_history:history}),{lifecycle,calls}=linked(db);
 const before=structuredClone(db.tables.orders[0]);
 const r=await lifecycle({action:'reviewReport',id:'o',decision:'approved',expected_report_token:'r1',expected_report_uploaded_at:'2026-01-01'});
 assert.equal(r.status,200);assert.deepEqual(calls,['archive']);assert.equal(db.tables.orders[0].completed_at,before.completed_at);
 assert.deepEqual(db.tables.orders[0].manual_completion_history,history);
 for(const key of ['master_payout','manager_payout','dispatcher_payout','amount','original_amount','report_act_url','report_photo_urls','report_upload_token'])assert.equal(db.tables.orders[0][key],before[key],key);
});
for(const uid of ['100','staff_d','staff_mgr'])test(`${uid}: legacy review archives through the real lifecycle and duplicate keeps receipt`,async()=>{
 const db=fixture(),{mini,calls}=linked(db);
 const b={action:'reviewReport',id:'o',expected_report_token:'r1',expected_report_uploaded_at:'2026-01-01',decision:'approved',reviewer_name:'spoofed'};
 assert.equal((await mini(b,uid)).status,200);assert.deepEqual(calls,['lifecycle','archive']);
 assert.equal(db.tables.orders[0].status,'Выполнена');assert.equal(db.tables.orders[0].report_review_status,'approved');assert.notEqual(db.tables.orders[0].report_reviewed_by,'spoofed');
 const before=structuredClone(db.tables.orders);assert.equal((await mini(b,uid)).status,200);assert.deepEqual(db.tables.orders,before);assert.deepEqual(calls,['lifecycle','archive','lifecycle']);
});
for(const result of [{ok:false,error:'Drive unavailable'},{ok:true},{ok:true,order:{drive_archive_status:'archived',drive_archive_url:null}}])test(`archive failure or incomplete receipt cannot complete: ${JSON.stringify(result)}`,async()=>{
 const db=fixture(),{mini}=linked(db,()=>result);
 const r=await mini({action:'reviewReport',id:'o',expected_report_token:'r1',expected_report_uploaded_at:'2026-01-01',decision:'approved'});
 assert.equal(r.status,500);assert.equal(db.tables.orders[0].status,'В работе');assert.equal(db.tables.orders[0].report_review_status,'pending');assert.equal(db.tables.orders[0].completed_at,undefined);
});
test('legacy review keeps master authorization and pending-only conflict response',async()=>{
 const db=fixture({status:'Отменена'}),{mini,calls}=linked(db);
 assert.equal((await mini({action:'reviewReport',id:'o',expected_report_token:'r1',expected_report_uploaded_at:'2026-01-01',decision:'approved'},'staff_m')).status,403);assert.deepEqual(calls,[]);
 assert.equal((await mini({action:'reviewReport',id:'o',expected_report_token:'r1',expected_report_uploaded_at:'2026-01-01',decision:'approved'})).status,409);assert.deepEqual(calls,['lifecycle']);
});
test('lifecycle submission and receipt hide internal financial fields from master and owner preview',async()=>{
 for(const uid of ['staff_m','100']){
  const db=fixture({report_review_status:'not_submitted',report_uploaded_at:null,report_upload_token:null}),api=edge('order-lifecycle-api',db);
  const b={action:'finalizeMasterReport',order_id:'o',upload_token:'r2',act_url:attachmentUrl('o','r2'),photo_urls:[attachmentUrl('o','r2','photo.jpg')],...(uid==='100'?{acting_master_vk_id:'staff_m'}:{})};
  for(let i=0;i<2;i++){
   const r=await api(b,uid);assert.equal(r.status,200);
   for(const key of ['amount','original_amount','manager_payout','dispatcher_payout'])assert.equal(key in r.body.order,false,key);
   assert.equal(r.body.order.master_payout,552.5);assert.equal(r.body.order.extra_work_amount,0);
  }
  assert.equal(db.tables.orders[0].amount,1000);assert.equal(db.tables.orders[0].manager_payout,159.8);
 }
});

test('an edit read before reopening cannot restore completed status',async()=>{
 const db=fixture({status:'Выполнена',report_review_status:'approved'});
 db.beforeQuery=(table,mode)=>{if(table==='orders'&&mode==='update'){Object.assign(db.tables.orders[0],{status:'В работе',report_review_status:'not_submitted'});db.beforeQuery=null}};
 const r=await edge('mini-app-api',db)({action:'updateOrder',id:'o',status:'Выполнена',comment:'stale'});
 assert.equal(r.status,409);assert.equal(db.tables.orders[0].status,'В работе');assert.equal(db.tables.orders[0].comment,undefined);
});
