const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {edge,database}=require('./helpers/edge.cjs');
const key='test-integration-key';
function setup(order=null,mapping={}){
  const db=database({orders:order?[order]:[],api_integrations:[{id:'i',name:'Fixture',slug:'fixture',is_active:true,field_mapping:mapping,api_key_hash:createHash('sha256').update(key).digest('hex')}]});
  const call=edge('integration-api',db);
  return {db,call:order=>call({action:'upsertOrder',order:{external_id:'external-1',client:'Fixture',address:'Fixture',work:'Fixture',...order}},'100','',{'x-api-key':key})};
}
for(const field of ['amount','original_amount'])for(const value of [-1,'NaN','Infinity','-Infinity',1e308])for(const existing of [false,true])test(`external import rejects invalid ${field}=${value} before ${existing?'update':'insert'}`,async()=>{
  const order=existing?{id:'1',external_source:'api:fixture',external_id:'external-1',amount:100,original_amount:100,status:'В работе',updated_at:'2026-10-01T00:00:00Z'}:null;
  const {db,call}=setup(order),before=structuredClone(db.tables.orders);
  const r=await call({amount:100,original_amount:100,[field]:value});
  assert.equal(r.status,400);assert.equal(r.body.ok,false);
  assert.deepEqual(db.tables.orders,before);
  assert.equal(db.calls.filter(x=>x.table==='orders'&&x.mode!=='select').length,0);
});
test('external mapped money is validated after mapping',async()=>{
  const {db,call}=setup(null,{amount:'payment.total'});
  const r=await call({amount:100,payment:{total:-1}});
  assert.equal(r.status,400);assert.equal(db.tables.orders.length,0);
});
test('external import retains zero, omitted and numeric-string money semantics',async()=>{
  for(const [payload,expected] of [[{},0],[{amount:0},0],[{amount:'123.45',original_amount:'150.50'},123.45]]){
    const {call}=setup(),r=await call(payload);
    assert.equal(r.status,200);assert.equal(r.body.order.amount,expected);
    assert.equal(r.body.order.original_amount,payload.original_amount?150.5:expected);
    assert.equal(r.body.order.master_payout,0);
  }
});
test('external invalid price cannot change an already accepted receipt',async()=>{
  const order={id:'1',external_source:'api:fixture',external_id:'external-1',status:'Выполнена',report_review_status:'approved',amount:100,original_amount:100};
  const {db,call}=setup(order),r=await call({amount:-1});
  assert.equal(r.status,200);assert.equal(r.body.preserved,true);assert.deepEqual(db.tables.orders,[order]);
});
