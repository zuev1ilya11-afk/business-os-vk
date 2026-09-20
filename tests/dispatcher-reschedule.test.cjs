const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {edge,database,employee}=require('./helpers/edge.cjs');

test('dispatcher reschedule runtime is loaded and syntactically valid',()=>{
  const ui=fs.readFileSync('dispatcher-reschedule-v91.js','utf8');
  const loader=fs.readFileSync('pwa-register.js','utf8');
  assert.match(loader,/dispatcher-reschedule-v91\.js/);
  assert.doesNotThrow(()=>new Function(ui));
  assert.match(ui,/Перенести заявку/);
  assert.match(ui,/resolveReschedule/);
  assert.match(ui,/reschedule_requested:false/);
});

test('dispatcher resolves reschedule without changing money or master',async()=>{
  const dispatcher=employee('dispatcher','dispatcher');
  const master=employee('m','master',{full_name:'Мастер'});
  const order={id:'11',client:'Клиент',status:'В работе',amount:2500,original_amount:2500,master_staff_id:master.id,master_name:master.full_name,master_payout:1381.25,scheduled_date:'2099-09-10',scheduled_time:'10:00',time_slot:'10:00–11:00',reschedule_requested:true,reschedule_reason:'Клиент попросил позже',reschedule_requested_at:'2099-09-01T10:00:00Z',reschedule_requested_by:master.id};
  const db=database({business_staff:[dispatcher,master],orders:[order]});
  const handler=edge('order-meta-api',db);
  const result=await handler({action:'resolveReschedule',id:'11',scheduled_date:'2099-09-12',scheduled_time:'13:30'},dispatcher.external_id);
  assert.equal(result.status,200);
  assert.equal(result.body.ok,true);
  const saved=db.tables.orders[0];
  assert.equal(saved.scheduled_date,'2099-09-12');
  assert.equal(saved.scheduled_time,'13:30');
  assert.equal(saved.time_slot,'13:30–14:30');
  assert.equal(saved.reschedule_requested,false);
  assert.equal(saved.reschedule_reason,null);
  assert.equal(saved.reschedule_requested_at,null);
  assert.equal(saved.reschedule_requested_by,null);
  assert.equal(saved.sync_status,'pending_sheet');
  assert.equal(saved.amount,2500);
  assert.equal(saved.original_amount,2500);
  assert.equal(saved.master_staff_id,master.id);
  assert.equal(saved.master_payout,1381.25);
});

test('master cannot resolve a reschedule request',async()=>{
  const master=employee('m','master');
  const db=database({business_staff:[master],orders:[{id:'11',status:'В работе',reschedule_requested:true}]});
  const result=await edge('order-meta-api',db)({action:'resolveReschedule',id:'11',scheduled_date:'2099-09-12',scheduled_time:'13:30'},master.external_id);
  assert.equal(result.status,403);
  assert.equal(result.body.ok,false);
});
