const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {edge,database,employee,attachmentUrl}=require('./helpers/edge.cjs');
const {reportSql}=require('./helpers/report-sql.cjs');
const migration=fs.readFileSync('supabase/migrations/20261116010000_preserve_report_revisions.sql','utf8');
const roles="create role anon; create role authenticated; create role service_role bypassrls;";
const base={id:'11',status:'В работе',master_staff_id:'m',master_workflow_stage:'started',
  master_agreed_at:'2026-11-15T08:00:00Z',scheduled_date:'2026-11-15',scheduled_time:'12:00',
  work:'Монтаж × 2',work_items:[{name:'Монтаж',quantity:2,price:500}],comment:'Комментарий мастера',
  amount:1000,original_amount:1000,master_payout:552.5,manager_payout:120,
  extra_work_done:true,extra_work_description:'Допработа',extra_work_amount:50,
  report_review_status:'pending',report_upload_token:'stage0-synthetic-r1',
  report_uploaded_at:'2026-11-15T10:00:00Z',report_act_url:attachmentUrl('11','stage0-synthetic-r1'),
  report_photo_urls:JSON.stringify([attachmentUrl('11','stage0-synthetic-r1','photo.jpg')])};
async function fixture({apply=true,bigint=false}={}){
  const db=database({business_staff:[employee('m'),employee('mgr','manager')],orders:[base]});
  const sql=await reportSql(db);
  await sql.pg.exec(roles);
  if(bigint)await sql.pg.exec('alter table orders alter column id type bigint using id::bigint');
  if(apply)await sql.pg.exec(migration);
  const api=edge('order-lifecycle-api',db,{fetch:async()=>Response.json({ok:true,order:{
    ...await sql.read(11),drive_archive_status:'archived',drive_archive_url:'https://drive.test/report'}})});
  const review=async(decision='rejected')=>{
    const row=await sql.read(11);
    return api({action:'reviewReport',id:'11',decision,comment:'Исправьте акт',
      expected_report_token:row.report_upload_token,expected_report_uploaded_at:row.report_uploaded_at},'staff_mgr');
  };
  const revisions=async()=>(await sql.pg.query('select * from bos_report_private.order_report_revisions order by saved_at')).rows;
  return {db,sql,api,review,revisions};
}
test('SQL rejection retains the exact report, works and decision while existing correction flow stays unchanged',async()=>{
  const f=await fixture({bigint:true});
  try{
    const before=await f.sql.read(11);
    assert.equal((await f.review()).status,200);
    const current=await f.sql.read(11),rows=await f.revisions();
    assert.equal(current.report_act_url,null);assert.equal(current.report_upload_token,null);
    assert.equal(current.report_review_status,'rejected');assert.equal(rows.length,1);
    const saved=rows[0];
    assert.equal(saved.order_id,'11');assert.equal(saved.report_upload_token,base.report_upload_token);
    assert.equal(saved.review_status,'rejected');assert.equal(saved.review_comment,'Исправьте акт');
    assert.equal(saved.reviewed_by,'mgr');assert.ok(saved.reviewed_at);
    for(const key of ['report_act_url','report_photo_urls','work','work_items','comment',
      'extra_work_description','extra_work_amount','master_agreed_at','scheduled_date','scheduled_time']){
      assert.deepEqual(saved.report_data[key],before[key],key);
    }
    assert.equal('manager_payout' in saved.report_data,false);
    assert.equal('amount' in saved.report_data,false);
    assert.equal(current.master_payout,before.master_payout);
    assert.equal((await f.review()).status,200);assert.deepEqual(await f.revisions(),rows);
    await f.sql.pg.exec(migration);assert.deepEqual(await f.revisions(),rows,'repeat migration retains history');
  }finally{await f.sql.close()}
});
test('corrected resubmission and approval preserve both revisions, and reopening cannot erase or duplicate them',async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.review()).status,200);const first=(await f.revisions())[0];
    const token='stage0-synthetic-r2';
    const sent=await f.api({action:'finalizeMasterReport',order_id:'11',upload_token:token,
      act_url:attachmentUrl('11',token),photo_urls:[attachmentUrl('11',token,'photo.jpg')]},'staff_m');
    assert.equal(sent.status,200);assert.deepEqual((await f.revisions())[0],first);
    assert.equal((await f.review('approved')).status,200);
    const rows=await f.revisions();assert.equal(rows.length,2);assert.equal(rows[1].review_status,'approved');
    assert.equal((await f.review('approved')).status,200);assert.deepEqual(await f.revisions(),rows);
    await f.sql.pg.exec("update orders set status='В работе' where id='11'");
    assert.equal((await f.sql.read(11)).report_act_url,null);assert.deepEqual(await f.revisions(),rows);
  }finally{await f.sql.close()}
});
test('failure to preserve a revision rolls back rejection and leaves the original report accessible',async()=>{
  const f=await fixture();
  try{
    const before=await f.sql.read(11);
    await f.sql.pg.exec('alter table bos_report_private.order_report_revisions add constraint synthetic_archive_failure check(false) not valid');
    assert.equal((await f.review()).status,500);
    assert.deepEqual(await f.sql.read(11),before);assert.deepEqual(await f.revisions(),[]);
  }finally{await f.sql.close()}
});
test('a reused upload token after rejection cannot replace or hide a later report version',async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.review()).status,200);const first=(await f.revisions())[0];
    const sent=await f.api({action:'finalizeMasterReport',order_id:'11',upload_token:base.report_upload_token,
      act_url:attachmentUrl('11',base.report_upload_token,'corrected-act.pdf'),
      photo_urls:[attachmentUrl('11',base.report_upload_token,'corrected-photo.jpg')]},'staff_m');
    assert.equal(sent.status,200);
    assert.equal((await f.review('approved')).status,200);
    const rows=await f.revisions();assert.equal(rows.length,2);assert.deepEqual(rows[0],first);
    assert.equal(rows[1].report_upload_token,first.report_upload_token);
    assert.notEqual(rows[1].report_uploaded_at,first.report_uploaded_at);
    assert.equal(rows[1].review_status,'approved');
    assert.equal(rows[1].report_data.report_act_url,attachmentUrl('11',base.report_upload_token,'corrected-act.pdf'));
  }finally{await f.sql.close()}
});
test('report archive is not readable by browser database roles or writable by service_role',async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.review()).status,200);
    for(const role of ['anon','authenticated','service_role']){
      await f.sql.pg.exec('set role '+role);
      try{
        if(role==='service_role')assert.equal((await f.revisions()).length,1);
        else await assert.rejects(f.revisions(),/permission denied/);
        for(const query of [
          'delete from bos_report_private.order_report_revisions',
          "update bos_report_private.order_report_revisions set review_comment='changed'",
          'insert into bos_report_private.order_report_revisions select * from bos_report_private.order_report_revisions']){
          await assert.rejects(f.sql.pg.exec(query),/permission denied/);
        }
      }finally{await f.sql.pg.exec('reset role')}
    }
    assert.equal((await f.revisions())[0].review_comment,'Исправьте акт');
  }finally{await f.sql.close()}
});
test('runtime service_role can preserve a revision through the trigger without direct archive write privileges',async()=>{
  const f=await fixture();
  try{
    await f.sql.pg.exec('grant select,update on orders to service_role; set role service_role');
    try{await f.sql.pg.exec("update orders set report_review_status='rejected',report_review_comment='Исправить',report_reviewed_by='manager',report_reviewed_at=now() where id='11'");}
    finally{await f.sql.pg.exec('reset role')}
    const rows=await f.revisions();assert.equal(rows.length,1);
    assert.equal(rows[0].report_data.report_act_url,base.report_act_url);
    assert.equal(rows[0].review_comment,'Исправить');
  }finally{await f.sql.close()}
});
test('migration fails before mutation when legacy report pointers have no stable version',async()=>{
  const f=await fixture({apply:false});
  try{
    await f.sql.pg.exec("update orders set report_upload_token=null where id='11'");
    const before=await f.sql.read(11);
    await assert.rejects(f.sql.pg.exec(migration),/REPORT_REVISIONS_PREFLIGHT: legacy report without version/);
    await f.sql.pg.exec('rollback');
    assert.deepEqual(await f.sql.read(11),before);
    assert.equal((await f.sql.pg.query("select to_regclass('bos_report_private.order_report_revisions') archive")).rows[0].archive,null);
  }finally{await f.sql.close()}
});
test('migration refuses an unrecognized completion guard before creating archive objects',async()=>{
  const f=await fixture({apply:false});
  try{
    await f.sql.pg.exec('drop trigger trg_guard_order_completion on orders');
    await assert.rejects(f.sql.pg.exec(migration),/REPORT_REVISIONS_PREFLIGHT: active completion guard missing/);
    await f.sql.pg.exec('rollback');
    assert.equal((await f.sql.pg.query("select to_regclass('bos_report_private.order_report_revisions') archive")).rows[0].archive,null);
    assert.equal((await f.sql.read(11)).report_upload_token,base.report_upload_token);
  }finally{await f.sql.close()}
});
