const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {edge,database,employee}=require('./helpers/edge.cjs');

test('master workflow keeps phone calls separate from manual stage changes',()=>{
  const src=fs.readFileSync('master-call-workflow-v26.js','utf8');
  assert.doesNotThrow(()=>new Function(src));
  assert.match(src,/profile-self-api/);
  assert.match(src,/@@BOS_WF1@@\|/);
  assert.match(src,/href=\"tel:\$\{escv\(href\)\}\"/);
  assert.match(src,/Позвонить клиенту/);
  assert.match(src,/masterWorkflowSetStage/);
  assert.match(src,/>Выехал<\/button>/);
  assert.match(src,/>Работа начата<\/button>/);
  assert.match(src,/Нужно перенести/);
  assert.match(src,/Завершить и прикрепить отчёт/);
  assert.match(src,/openMasterRescheduleForm/);
  assert.doesNotMatch(src,/Позвонить по приезду/);
  assert.doesNotMatch(src,/onclick=\"masterWorkflowCallAndAdvance/);
  assert.doesNotMatch(src,/автоматический переход после звонка/);
  assert.doesNotMatch(src,/Я на месте/);

  const loader=fs.readFileSync('pwa-register.js','utf8');
  assert.match(loader,/master-call-workflow-v26\.js\?v=20260922-v27/);

  const proxy=fs.readFileSync('netlify/functions/proxy.mts','utf8');
  assert.match(proxy,/\"profile-self-api\"/);
});

test('profile bridge persists master workflow stages without touching money',()=>{
  const sql=fs.readFileSync('supabase/migrations/20260922104500_master_workflow_profile_bridge.sql','utf8');
  assert.match(sql,/@@BOS_WF1@@\|/);
  assert.match(sql,/old\.role <> 'master'/);
  assert.match(sql,/master_staff_id = old\.id/);
  assert.match(sql,/requested_stage = 'departed'/);
  assert.match(sql,/requested_stage = 'started'/);
  assert.match(sql,/Этапы нужно отмечать по порядку/);
  assert.doesNotMatch(sql,/master_payout\s*=/);
  assert.doesNotMatch(sql,/manager_payout\s*=/);
});

test('workflow migration remains backward-compatible and does not touch payouts',()=>{
  const sql=fs.readFileSync('supabase/migrations/20260920133158_add_master_workflow_fields.sql','utf8');
  for(const name of ['master_workflow_stage','master_departed_at','master_arrived_at','master_started_at'])assert.match(sql,new RegExp(name));
  assert.match(sql,/assigned.*departed.*arrived.*started/s);
  assert.doesNotMatch(sql,/master_payout\s*=/);
  assert.doesNotMatch(sql,/manager_payout\s*=/);
});

test('master workflow API supports manual v26 flow and legacy arrived clients without changing money',async()=>{
  const me=employee('m','master',{full_name:'Мастер'}),other=employee('x','master',{full_name:'Другой'}),owner=employee('owner','owner');
  const db=database({business_staff:[me,other,owner],orders:[
    {id:'11',status:'В работе',master_staff_id:me.id,master_workflow_stage:'assigned',amount:2000,original_amount:2000,master_payout:1105},
    {id:'12',status:'В работе',master_staff_id:other.id,master_workflow_stage:'assigned',amount:1000,master_payout:552.5},
    {id:'13',status:'В работе',master_staff_id:me.id,master_workflow_stage:'assigned',amount:1000,master_payout:552.5},
    {id:'14',status:'В работе',master_staff_id:me.id,master_workflow_stage:'arrived',amount:1000,master_payout:552.5},
    {id:'15',status:'В работе',master_staff_id:me.id,master_workflow_stage:'departed',amount:1000,master_payout:552.5}
  ]});
  const h=edge('master-workflow-api',db);
  let r=await h({action:'setStage',id:'11',stage:'departed'},me.external_id);
  assert.equal(r.status,200);assert.equal(db.tables.orders[0].master_workflow_stage,'departed');assert.ok(db.tables.orders[0].master_departed_at);assert.equal(db.tables.orders[0].amount,2000);assert.equal(db.tables.orders[0].master_payout,1105);
  r=await h({action:'setStage',id:'11',stage:'started'},me.external_id);assert.equal(r.status,200);assert.ok(db.tables.orders[0].master_started_at);
  r=await h({action:'setStage',id:'13',stage:'started'},me.external_id);assert.equal(r.status,409);
  r=await h({action:'setStage',id:'14',stage:'started'},me.external_id);assert.equal(r.status,200);assert.equal(db.tables.orders[3].master_workflow_stage,'started');
  r=await h({action:'setStage',id:'15',stage:'arrived'},me.external_id);assert.equal(r.status,200);assert.equal(db.tables.orders[4].master_workflow_stage,'arrived');assert.ok(db.tables.orders[4].master_arrived_at);
  r=await h({action:'setStage',id:'15',stage:'started'},me.external_id);assert.equal(r.status,200);assert.equal(db.tables.orders[4].master_workflow_stage,'started');
  r=await h({action:'setStage',id:'12',stage:'departed'},me.external_id);assert.equal(r.status,403);
  r=await h({action:'setStage',id:'11',stage:'started'},owner.external_id);assert.equal(r.status,403);
});
