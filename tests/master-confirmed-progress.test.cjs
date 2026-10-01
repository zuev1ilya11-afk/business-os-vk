const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee,attachmentUrl}=require('./helpers/edge.cjs');
function fixture(extra={}){
 const db=database({business_staff:[employee('m'),employee('other','master',{phone:'+79990000002'})],orders:[{id:'1',master_staff_id:'m',status:'В работе',master_workflow_stage:'assigned',amount:1000,original_amount:1000,...extra}]});
 db.storage={from:()=>({upload:async()=>({error:null}),createSignedUrl:async path=>({data:{signedUrl:'https://files.test/'+path}})})};return db;
}
const body=(action,token='p1')=>({action,order_id:'1',upload_token:token,act_url:attachmentUrl('1',token),photo_urls:[attachmentUrl('1',token,'photo.jpg')],act_data:'YQ==',photos_json:'[{"name":"photo.jpg","data":"YQ=="}]'});
for(const legacy of [false,true]){
 const run=(db,stage)=>edge(legacy?'profile-self-api':'master-workflow-api',db)(legacy?{phone:'+79990000001',district:`@@BOS_WF1@@|1|${stage}`}:{action:'setStage',id:'1',stage},'staff_m');
 test(`${legacy?'legacy bridge':'workflow'}: agreement cannot skip departure; retries preserve initial times`,async()=>{
  const db=fixture({master_called_at:'2026-01-01',master_agreed_at:'2026-01-01'});
  assert.equal((await run(db,'started')).status,409);
  assert.equal((await run(db,'departed')).status,200);
  const at=db.tables.orders[0].master_departed_at;
  assert.equal((await run(db,'departed')).status,200);assert.equal(db.tables.orders[0].master_departed_at,at);
  assert.equal((await run(db,'started')).status,200);
  const done=structuredClone(db.tables.orders[0]),writes=db.calls.filter(x=>x.mode==='update').length;
  assert.equal((await run(db,'departed')).status,200);assert.equal((await run(db,'started')).status,200);
  assert.deepEqual(db.tables.orders[0],done);assert.equal(db.calls.filter(x=>x.mode==='update').length,writes);
 });
 test(`${legacy?'legacy bridge':'workflow'}: concurrent identical requests confirm once`,async()=>{
  const db=fixture();const rs=await Promise.all([run(db,'departed'),run(db,'departed')]);
  assert.deepEqual(rs.map(r=>r.status),[200,200]);assert.equal(rs[0].body.order.master_departed_at,rs[1].body.order.master_departed_at);
 });
 for(const change of [{master_staff_id:'other'},{status:'Отменена'},{master_workflow_stage:'started',master_started_at:'2026-01-01',master_departed_at:'2025-12-31'},{report_review_status:'pending',report_uploaded_at:'2026-01-01'}])test(`${legacy?'legacy bridge':'workflow'}: races preserve ${JSON.stringify(change)}`,async()=>{
  const db=fixture();let expected;
  db.beforeQuery=(table,mode)=>{if(table==='orders'&&mode==='update'){Object.assign(db.tables.orders[0],change);expected=structuredClone(db.tables.orders[0]);db.beforeQuery=null}};
  const r=await run(db,'departed');assert.ok([200,403,409].includes(r.status));assert.deepEqual(db.tables.orders[0],expected);
 });
 test(`${legacy?'legacy bridge':'workflow'}: cancelled and foreign rows reject without writes`,async()=>{
  for(const extra of [{status:'Отменена'},{master_staff_id:'other'}]){const db=fixture(extra),before=structuredClone(db.tables.orders);assert.ok([403,409].includes((await run(db,'departed')).status));assert.deepEqual(db.tables.orders,before)}
 });
}
for(const [slug,action] of [['order-lifecycle-api','finalizeMasterReport'],['report-api','finalizeMasterReport'],['report-api','uploadMasterReport']]){
 test(`${slug}/${action}: first report requires confirmed work, not agreement or attachments`,async()=>{
  for(const extra of [{},{master_agreed_at:'2026-01-01'},{master_workflow_stage:'departed'},{master_workflow_stage:'arrived'},{report_act_url:'https://files.test/draft'}]){
   const db=fixture(extra),before=structuredClone(db.tables.orders);const r=await edge(slug,db)(body(action),'staff_m');assert.equal(r.status,409);assert.equal(r.body.error,'WORK_NOT_STARTED');assert.deepEqual(db.tables.orders,before);
  }
 });
 test(`${slug}/${action}: historical work and returned reports remain usable without invented timestamps`,async()=>{
  for(const extra of [{master_workflow_stage:'started'},{master_started_at:'2026-01-01'},{report_review_status:'rejected',report_review_comment:'Исправьте фото'},{report_uploaded_at:'2026-01-01'}]){
   const db=fixture(extra),r=await edge(slug,db)(body(action),'staff_m');assert.equal(r.status,200);assert.equal(r.body.order.status,'В работе');assert.equal(r.body.order.report_review_status,'pending');assert.equal(db.tables.orders[0].master_departed_at,undefined);assert.equal(db.tables.orders[0].master_started_at,extra.master_started_at);
  }
 });
 test(`${slug}/${action}: concurrent duplicate returns same report receipt; newer stage/reassignment cannot be overwritten`,async()=>{
  const db=fixture({master_workflow_stage:'started'}),api=edge(slug,db),rs=await Promise.all([api(body(action),'staff_m'),api(body(action),'staff_m')]);
  assert.deepEqual(rs.map(r=>r.status),[200,200]);assert.equal(rs[0].body.order.report_uploaded_at,rs[1].body.order.report_uploaded_at);
  for(const change of [{master_workflow_stage:'assigned',master_started_at:null},{master_staff_id:'other'},{status:'Отменена'}]){
   const d=fixture({master_workflow_stage:'started'});let expected;
   d.beforeQuery=(table,mode)=>{if(table==='orders'&&mode==='update'){Object.assign(d.tables.orders[0],change);expected=structuredClone(d.tables.orders[0]);d.beforeQuery=null}};
   assert.equal((await edge(slug,d)(body(action),'staff_m')).status,409);assert.deepEqual(d.tables.orders[0],expected);
  }
 });
}
