const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {createHash}=require('node:crypto');
const {edge,database,employee}=require('./helpers/edge.cjs');
const {orderGuards}=require('./helpers/order-guards.cjs');
const {patch}=require('../scripts/patch-live-hands-import.cjs');
const receipt=()=>({id:'11',external_source:'hands',external_id:'hands:123',integration_slug:'fixture',status:'Выполнена',report_review_status:'approved',report_upload_token:'report-1',report_uploaded_at:'2026-09-20',report_act_url:'https://fixture.invalid/act',report_photo_urls:'["photo"]',drive_archive_url:'https://fixture.invalid/archive',drive_archive_status:'archived',amount:1000,original_amount:1000,master_payout:552.5,master_staff_id:'m',updated_at:'2026-09-20T00:00:00Z'});
function seed(order=receipt()){
 const db=database({business_staff:[employee('owner','owner'),employee('m')],orders:order?[order]:[],api_integrations:[{id:'i',slug:'fixture',name:'Fixture',is_active:true,api_key_hash:createHash('sha256').update('fixture-key').digest('hex')}]});
 db.beforeUpdate=(table,o,p)=>table==='orders'?orderGuards(o,p):p;return db;
}
function importFrom(kind,db,remote){
 if(kind==='production-hands'){
  const source=patch(fs.readFileSync('tests/fixtures/hands-v6-import.ts','utf8'));
  const ctx={clean:v=>String(v??'').trim(),externalId:v=>String(v??'').replace(/^hands:/,''),localExternalId:v=>'hands:'+v,money:Number,schedule:()=>({scheduled_date:null,scheduled_time:null}),phones:()=>'',workText:()=> 'Fixture',cityFrom:()=> 'Fixture',localStatus:o=>['COMPLETE','COMPLETED'].includes(o.status)?'Выполнена':o.status==='CANCELLED'?'Отменена':'В работе',externalComment:()=>'',errText:String};
  vm.createContext(ctx);vm.runInContext(stripTypeScriptTypes(source,{mode:'transform'}),ctx);
  return ()=>ctx.importOrder(db,remote,new Map());
 }
 const api=edge(kind,db,{env:{HANDS_API_KEY:'fixture'},fetch:async()=>Response.json([remote])});
 return async()=>{const r=await api({action:kind==='hands-api'?'syncOrders':'syncHandsOrders'});if(!r.body.ok)throw Error(r.body.error);return r};
}
for(const kind of ['hands-api','order-lifecycle-api','production-hands']){
 for(const status of ['ACTIVE','COMPLETED','CANCELLED'])test(`${kind}: ${status} preserves accepted report, archive and receipt`,async()=>{
  const db=seed(),before=structuredClone(db.tables.orders[0]);
  await importFrom(kind,db,{id:'123',status,price:99999})();// Upstream amount must not rewrite a reviewed receipt.
  assert.deepEqual(db.tables.orders[0],before);assert.equal(db.calls.filter(x=>x.table==='orders'&&x.mode!=='select').length,0);
 });
 test(`${kind}: remote completion cannot complete an unreviewed or new order`,async()=>{
  for(const existing of [true,false]){
   const order={...receipt(),status:'В работе',report_review_status:'pending',drive_archive_url:null,drive_archive_status:'pending'},db=seed(existing?order:null);
   await importFrom(kind,db,{id:'123',status:'COMPLETED',price:1000})();
   assert.equal(db.tables.orders[0].status,'В работе');
   if(existing)assert.equal(db.tables.orders[0].report_upload_token,'report-1');
  }
 });
 test(`${kind}: concurrent approval makes the import compare-and-swap fail`,async()=>{
  const db=seed({...receipt(),status:'В работе',report_review_status:'pending'});
  db.beforeQuery=(table,mode)=>{if(table==='orders'&&mode==='update'){Object.assign(db.tables.orders[0],{status:'Выполнена',report_review_status:'approved',updated_at:'newer'});db.beforeQuery=null}};
  await assert.rejects(importFrom(kind,db,{id:'123',status:'ACTIVE',price:99999}),/ORDER_CHANGED/);
  assert.equal(db.tables.orders[0].report_upload_token,'report-1');assert.equal(db.tables.orders[0].amount,1000);assert.equal(db.tables.orders[0].report_review_status,'approved');
 });
}
function external(db,order){return edge('integration-api',db)({action:'upsertOrder',order:{external_id:'hands:123',client:'Fixture',address:'Fixture',work:'Fixture',amount:99999,...order}},'100','',{'x-api-key':'fixture-key'})}
test('external upsert preserves a completed receipt even if upstream reopens or cancels it',async()=>{
 for(const status of ['В работе','Выполнена','Отменена']){
  const db=seed({...receipt(),external_source:'api:fixture'}),before=structuredClone(db.tables.orders[0]);
  const r=await external(db,{status});assert.equal(r.status,200);assert.equal(r.body.preserved,true);assert.deepEqual(db.tables.orders[0],before);
 }
});
test('external upsert cannot insert or update completed status without local approval',async()=>{
 for(const existing of [true,false]){
  const db=seed(existing?{...receipt(),external_source:'api:fixture',status:'В работе',report_review_status:'pending'}:null);
  const before=structuredClone(db.tables.orders),r=await external(db,{status:'Выполнена'});
  assert.equal(r.status,409);assert.equal(r.body.error,'REPORT_APPROVAL_REQUIRED');assert.deepEqual(db.tables.orders,before);
 }
});
test('external upsert retains ordinary active updates but cannot race an approval',async()=>{
 const db=seed({...receipt(),external_source:'api:fixture',status:'В работе',report_review_status:'pending'});
 assert.equal((await external(db,{amount:1000,client:'Changed'})).status,200);assert.equal(db.tables.orders[0].client,'Changed');
 db.beforeQuery=(table,mode)=>{if(table==='orders'&&mode==='update'){Object.assign(db.tables.orders[0],{status:'Выполнена',report_review_status:'approved',updated_at:'newer'});db.beforeQuery=null}};
 const r=await external(db,{status:'В работе'});assert.equal(r.status,409);assert.equal(r.body.error,'ORDER_CHANGED');assert.equal(db.tables.orders[0].report_upload_token,'report-1');assert.equal(db.tables.orders[0].amount,1000);
});
test('private production patch refuses an unknown or already patched import and preserves surrounding code',()=>{
 const source=fs.readFileSync('tests/fixtures/hands-v6-import.ts','utf8'),before='// private fixture preamble\n',after='\n// private fixture suffix';
 const result=patch(before+source+after);assert.ok(result.startsWith(before));assert.ok(result.endsWith(after));assert.throws(()=>patch(result));assert.throws(()=>patch(source.replace(".select('id')",".select('*')")));
});
