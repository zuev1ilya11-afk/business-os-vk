const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee}=require('./helpers/edge.cjs');
const stamp='2026-10-04T10:00:00.000Z';
const request={action:'manualCompleteOrder',id:'11',reason:'Мастер не может отправить отчёт',expected_updated_at:stamp};
function setup(role='owner'){
 const actor=employee('actor',role),db=database({business_staff:[actor]});
 const calls=[];db.rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});return {data:{ok:true,order:{id:'11',status:'Выполнена'},idempotent:false},error:null}};
 return {actor,db,calls,api:edge('order-lifecycle-api',db)};
}
test('manual completion rejects unauthenticated, master, dispatcher and unknown roles before mutation',async()=>{
 for(const role of ['master','dispatcher','admin','viewer']){const x=setup(role);assert.equal((await x.api(request,x.actor.external_id)).status,403);assert.equal(x.calls.length,0)}
 const x=setup();assert.equal((await x.api(request,'','')).status,401);assert.equal(x.calls.length,0);
});
test('manual completion requires a reason and the displayed order version',async()=>{
 for(const patch of [{reason:''},{reason:'  '},{reason:'a'.repeat(1001)},{expected_updated_at:null},{expected_updated_at:'invalid'},{id:'oops'}]){
  const x=setup();assert.equal((await x.api({...request,...patch},x.actor.external_id)).status,400);assert.equal(x.calls.length,0);
 }
});
test('only existing leadership roles reach the transaction with authenticated identity',async()=>{
 for(const role of ['owner','manager']){
  const x=setup(role);const r=await x.api({...request,reason:'  Проверено  ',actor_id:'forged',role:'owner',master_payout:999,report_review_status:'approved'},x.actor.external_id);
  assert.equal(r.status,200);assert.equal(r.body.order.status,'Выполнена');
  assert.deepEqual(x.calls,[{name:'bos_manual_complete_order',args:{p_order_id:'11',p_actor_id:x.actor.id,p_reason:'Проверено',p_expected_updated_at:stamp}}]);
  assert.equal(x.db.calls.filter(c=>c.mode==='update'||c.mode==='insert').length,0);
 }
});
test('transaction conflicts and authorization changes are surfaced without fallback writes',async()=>{
 for(const [error,status]of [['ORDER_CHANGED',409],['ORDER_CANCELLED',409],['FORBIDDEN',403],['ORDER_NOT_FOUND',404]]){
  const x=setup();x.db.rpc=async()=>({data:{ok:false,error},error:null});assert.equal((await x.api(request,x.actor.external_id)).status,status);
 }
});
test('manually completed Hands master bootstrap preserves zero and custom saved payouts',async()=>{
 for(const saved of [0,123]){
  const master=employee('m'),at='2026-10-04T10:00:00Z';
  const db=database({business_staff:[master],orders:[{id:'11',master_staff_id:master.id,source:'Hands',status:'Выполнена',amount:1000,master_payout:saved,manager_payout:159.8,dispatcher_payout:119.85,completed_at:at,manual_completion_history:[{at,reason:'Проверено'}]}]});
  const r=await edge('mini-app-api',db)({action:'bootstrap'},master.external_id);assert.equal(r.status,200);assert.equal(r.body.orders[0].master_payout,saved);
  for(const field of ['amount','original_amount','manager_payout','dispatcher_payout'])assert.equal(field in r.body.orders[0],false,field);
 }
});
