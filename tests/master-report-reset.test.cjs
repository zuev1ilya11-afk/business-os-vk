const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee,attachmentUrl}=require('./helpers/edge.cjs');
const {reportSql}=require('./helpers/report-sql.cjs');
const base={id:'11',status:'Назначена',source:'Лемана Про',master_staff_id:'m',master_workflow_stage:'started',master_agreed_at:'2026-11-10T08:00:00Z',master_started_at:'2026-11-10T09:00:00Z',scheduled_date:'2026-11-10',scheduled_time:'12:00',work:'Монтаж',amount:1000,original_amount:1000,master_payout:552.5,report_review_status:'not_submitted'};
const body={action:'finalizeMasterReport',order_id:'11',upload_token:'regression',act_url:attachmentUrl('11','regression'),photo_urls:[attachmentUrl('11','regression','photo.jpg')]};
async function setup(extra={},options={}){const db=database({business_staff:[employee('m'),employee('other'),employee('mgr','manager')],orders:[{...base,...extra}]});return {db,sql:await reportSql(db,options)}}
test('old SQL trigger destroys submitted report; API now refuses false success',async()=>{
 const {db,sql}=await setup({}, {fixed:false});try{const result=await edge('order-lifecycle-api',db)(body,'staff_m');assert.equal(result.status,409);assert.equal(result.body.error,'REPORT_NOT_SAVED');assert.equal((await sql.read(11)).report_upload_token,null);assert.equal((await sql.read(11)).master_workflow_stage,'assigned')}finally{await sql.close()}
});
test('real SQL: all active source statuses preserve report, schedule, payroll and single review',async()=>{
 const {db,sql}=await setup();try{
 for(const service of ['order-lifecycle-api','report-api'])for(const status of ['Новая','Назначена','В работе']){
  await sql.pg.query("delete from orders");const keys=Object.keys(base);await sql.pg.query(`insert into orders(${keys}) values(${keys.map((_,i)=>'$'+(i+1))})`,keys.map(k=>k==='status'?status:base[k]));
  const api=edge(service,db),before=await sql.read(11),writesBefore=sql.trace.filter(t=>t.rows.length).length;
  const results=await Promise.all([api(body,'staff_m'),api(body,'staff_m')]);
  for(const r of results){assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.order.report_review_status,'pending');assert.equal(r.body.order.report_upload_token,'regression')}
  assert.equal(sql.trace.filter(t=>t.rows.length).length,writesBefore+1,'one committed update for simultaneous requests');
  const saved=await sql.read(11);assert.equal(saved.master_workflow_stage,'started');assert.equal(saved.report_act_url,body.act_url);
  for(const k of ['master_agreed_at','master_started_at','master_staff_id','scheduled_date','scheduled_time','work','master_payout'])assert.equal(saved[k],before[k],k);
  const writes=sql.trace.length;await api(body,'staff_m');assert.equal(sql.trace.length,writes);
  let archives=0;const review=edge('order-lifecycle-api',db,{fetch:async()=>{archives++;return Response.json({ok:true,order:{...await sql.read(11),drive_archive_status:'archived',drive_archive_url:'https://drive.test/report'}})}});
  const reviewBody={action:'reviewReport',id:'11',decision:'approved',expected_report_token:saved.report_upload_token,expected_report_uploaded_at:saved.report_uploaded_at};
  assert.equal((await review(reviewBody,'staff_m')).status,403);
  assert.equal((await review(reviewBody,'staff_mgr')).status,200);assert.equal((await review(reviewBody,'staff_mgr')).status,200);assert.equal(archives,1);
  assert.equal((await sql.read(11)).report_review_status,'approved');
 }
 }finally{await sql.close()}
});
test('real SQL preserves authorization, rejected cycle and terminal reset',async()=>{
 const {db,sql}=await setup();try{
  const api=edge('order-lifecycle-api',db);assert.equal((await api(body,'staff_other')).status,403);assert.equal(sql.trace.length,0);
  await sql.pg.exec("update orders set status='Выполнена',report_type='work',report_uploaded_at=now(),report_upload_token='old',report_act_url='act',report_photo_urls='[\"photo\"]',report_review_status='approved'");
  assert.equal((await api(body,'staff_m')).status,409);
  await sql.pg.exec("update orders set status='В работе'");let row=await sql.read(11);assert.equal(row.report_upload_token,null);assert.equal(row.master_workflow_stage,'assigned');
  await sql.pg.exec("update orders set master_workflow_stage='started',report_review_status='rejected'");
  assert.equal((await api(body,'staff_m')).status,200);assert.equal((await sql.read(11)).report_review_status,'pending');
 }finally{await sql.close()}
});
test('updated guard preserves existing SQL manual completion and role restrictions',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),pg=new PGlite();
 try{for(const file of ['tests/sql/order-guards-schema.sql','tests/sql/manual-completion-schema.sql','supabase/migrations/20260929160000_capture_live_order_guards.sql','supabase/migrations/20261004100840_manual_order_completion.sql','supabase/migrations/20261110140000_preserve_submitted_report.sql','tests/sql/manual-completion-assertions.sql'])await pg.exec(fs.readFileSync(file,'utf8'))}finally{await pg.close()}
});
test('SQL concurrent different tokens cannot overwrite a report or apply deductions twice',async()=>{
 const {db,sql}=await setup();try{
  const api=edge('order-lifecycle-api',db);
  const a={...body,uncompleted_work_done:true,uncompleted_work_amount:100,extra_work_amount:50,extra_work_done:true,extra_work_description:'Тестовая допработа'};
  const b={...a,upload_token:'competing',act_url:attachmentUrl('11','competing'),photo_urls:[attachmentUrl('11','competing','photo.jpg')]};
  const results=await Promise.all([api(a,'staff_m'),api(b,'staff_m')]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const saved=await sql.read(11);assert.equal(saved.amount,900);assert.equal(saved.original_amount,1000);assert.equal(saved.extra_work_amount,50);assert.equal(saved.uncompleted_work_amount,100);
  assert.equal(sql.trace.filter(t=>t.rows.length).length,1);
  const winner=saved.report_upload_token===a.upload_token?a:b;
  assert.equal((await api(winner,'staff_m')).status,200);assert.deepEqual(await sql.read(11),saved);
 }finally{await sql.close()}
});
