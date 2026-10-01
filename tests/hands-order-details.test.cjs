const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {edge,database,employee}=require('./helpers/edge.cjs');
const {patch}=require('../scripts/patch-live-hands-details.cjs');
// Keys/types captured from real authenticated specialist /orders/ on 2026-10-01.
// All values below are synthetic. The feed does not expose a structured apartment.
const remote=()=>({id:'123',client_name:'Тестовый клиент',client_phones:['+79990000002'],address:'Тестовая улица, дом 10',directions:'Тестовый вход',title:'Тестовые работы',price:'1000.00',creation_time:'2026-10-01T10:00:00',work_time:'2099-09-10T10:00:00',specialist:'m',status:'ACTIVE',payment_status:'PAID',shop_name:'Тестовый магазин',comment:'Исходный комментарий',works:[{name:'Полное название работы',description:'Описание',quantity:'1.5',price:'1000.00',unit:'METER'}],files:[]});
const shared=stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/hands-details.ts','utf8').replace(/^export /gm,''),{mode:'transform'});
const seed=()=>database({business_staff:[employee('owner','owner'),employee('m'),employee('dispatcher','dispatcher'),employee('manager','manager')],orders:[]});
function importer(kind,db,r){
 if(kind==='production-hands'){
  const src=patch(fs.readFileSync('tests/fixtures/hands-v8-import.ts','utf8')).replace(/^import .*;\n/,'');
  const ctx=vm.createContext({clean:v=>String(v??'').trim(),externalId:String,localExternalId:v=>'hands:'+v,money:Number,schedule:()=>({scheduled_date:'2099-09-10',scheduled_time:'10:00'}),phones:o=>o.client_phones?.[0]||'',workText:()=> 'Fixture × 1.5 METER',cityFrom:()=> 'Fixture',localStatus:()=> 'В работе',externalComment:o=>[o.comment,o.directions&&'Как добраться: '+o.directions,o.shop_name&&'Магазин: '+o.shop_name,o.payment_status&&'Оплата: '+o.payment_status].filter(Boolean).join('\n'),errText:String});
  vm.runInContext(shared+stripTypeScriptTypes(src,{mode:'transform'}),ctx);
  return ()=>ctx.importOrder(db,r,new Map([['m',db.tables.business_staff[1]]]));
 }
 const h=edge(kind,db,{env:{HANDS_API_KEY:'fixture'},fetch:async()=>Response.json({orders:[r]})});
 return async()=>{const x=await h({action:kind==='hands-api'?'syncOrders':'syncHandsOrders',per_page:2,max_pages:1});if(!x.body.ok)throw Error(x.body.error);return x};
}
for(const kind of ['hands-api','order-lifecycle-api','production-hands']){
 test(`${kind}: import and repeat update comment, keep one order, never guess apartment`,async()=>{
  const db=seed(),r=remote(),sync=importer(kind,db,r);await sync();const o=db.tables.orders[0];assert.match(o.comment,/Исходный комментарий/);assert.equal(o.apartment,undefined);
  r.comment='Обновление Hands';await sync();assert.match(o.comment,/Обновление Hands/);assert.equal(db.tables.orders.length,1);
  delete r.comment;delete r.directions;r.shop_name=null;await sync();assert.match(o.comment,/Обновление Hands/);assert.match(o.comment,/Тестовый вход/);
 });
 test(`${kind}: apartment edit leaves comment syncing; comment edit and clear survive sync`,async()=>{
  const db=seed(),r=remote(),sync=importer(kind,db,r);await sync();const o=db.tables.orders[0],api=edge('mini-app-api',db);
  let x=await api({action:'updateOrder',id:o.id,apartment:'кв. 42'},'staff_dispatcher');assert.equal(x.status,200);assert.equal(o.apartment,'кв. 42');
  r.comment='Новый комментарий';await sync();assert.match(o.comment,/Новый комментарий/);assert.equal(o.apartment,'кв. 42');assert.equal(o.hands_detail_overrides.comment,undefined);
  for(const value of ['Локальная инструкция','']){x=await api({action:'updateOrder',id:o.id,comment:value},'staff_manager');assert.equal(x.status,200);r.comment+='!';await sync();assert.equal(o.comment,value);assert.equal(o.hands_detail_overrides.comment,true);assert.equal(o.apartment,'кв. 42')}
  x=await api({action:'updateOrder',id:o.id,apartment:''},'100');assert.equal(x.status,200);await sync();assert.equal(o.apartment,'');assert.equal(o.hands_detail_overrides.apartment,true);
  const boot=await api({action:'bootstrap'},'staff_m');assert.equal(boot.body.orders[0].comment,'');assert.equal(boot.body.orders[0].apartment,'');assert.equal(boot.body.orders[0].amount,undefined);
 });
 test(`${kind}: legacy unknown comment is preserved; empty legacy comment is backfilled`,async()=>{
  for(const comment of ['Старое локальное исправление','']){
   const db=seed();db.tables.orders.push({id:'9',external_source:'hands',external_id:'hands:123',status:'В работе',comment,amount:1000});
   await importer(kind,db,remote())();assert.equal(db.tables.orders.length,1);if(comment){assert.equal(db.tables.orders[0].comment,comment);assert.equal(db.tables.orders[0].hands_detail_overrides.comment,true)}else assert.match(db.tables.orders[0].comment,/Исходный/);
  }
 });
 test(`${kind}: accepted legacy report receives descriptive data without repricing or reopening`,async()=>{
  const db=seed(),r=remote();db.tables.orders.push({id:'9',external_source:'hands',external_id:'hands:123',status:'Выполнена',report_review_status:'approved',amount:250,original_amount:300,master_payout:123,report_upload_token:'accepted',comment:''});
  const sync=importer(kind,db,r);await sync();const o=db.tables.orders[0];assert.match(o.comment,/Исходный/);assert.equal(o.amount,250);assert.equal(o.original_amount,300);assert.equal(o.master_payout,123);assert.equal(o.status,'Выполнена');assert.equal(o.report_upload_token,'accepted');const writes=db.calls.filter(c=>c.mode==='update').length;await sync();assert.equal(db.calls.filter(c=>c.mode==='update').length,writes);
 });
 test(`${kind}: concurrent manual correction cannot be overwritten by import`,async()=>{
  const db=seed(),r=remote(),sync=importer(kind,db,r);await sync();const o=db.tables.orders[0];r.comment='Upstream';
  db.beforeQuery=(table,mode)=>{if(table==='orders'&&mode==='update'){Object.assign(o,{comment:'Concurrent local',hands_detail_overrides:{comment:true},updated_at:'newer'});db.beforeQuery=null}};
  await assert.rejects(sync,/ORDER_CHANGED/);assert.equal(o.comment,'Concurrent local');
 });
}
for(const role of ['owner','manager','dispatcher'])test(`${role} can save both fields without changing money or existing overrides`,async()=>{
 const me=employee(role,role),db=database({business_staff:[me],orders:[{id:'1',source:'Hands',amount:1000,original_amount:1000,master_payout:552.5,status:'В работе',comment:'x',hands_detail_overrides:{apartment:true}}]}),api=edge('mini-app-api',db);
 const x=await api({action:'updateOrder',id:'1',comment:'changed',apartment:'5'},me.external_id);assert.equal(x.status,200);assert.equal(x.body.order.comment,'changed');assert.equal(x.body.order.apartment,'5');assert.equal(x.body.order.master_payout,552.5);assert.deepEqual(x.body.order.hands_detail_overrides,{apartment:true,comment:true});
});
test('master cannot edit own or foreign fields, but legitimate stage changes still work',async()=>{
 const me=employee('m'),db=database({business_staff:[me],orders:[{id:'1',master_staff_id:'m',source:'Hands',status:'В работе',master_workflow_stage:'assigned',scheduled_date:'2099-09-10',scheduled_time:'10:00',apartment:'5',comment:'x'},{id:'2',master_staff_id:'other',comment:'foreign'}]});
 for(const id of ['1','2'])assert.equal((await edge('mini-app-api',db)({action:'updateOrder',id,comment:'hack',apartment:'999'},me.external_id)).status,403);
 const stage=await edge('master-workflow-api',db)({action:'setStage',id:'1',stage:'departed',comment:'hack',apartment:'999'},me.external_id);assert.equal(stage.status,200);assert.equal(db.tables.orders[0].comment,'x');assert.equal(db.tables.orders[0].apartment,'5');
});
test('invalid values rejected; unchanged form submission does not freeze Hands updates',async()=>{
 const db=seed(),r=remote();await importer('hands-api',db,r)();const o=db.tables.orders[0],api=edge('mini-app-api',db);
 for(const fields of [{apartment:{}},{apartment:'x'.repeat(121)},{comment:5},{comment:'x'.repeat(10001)},{edited_detail_fields:['amount']},{edited_detail_fields:['comment']}])assert.equal((await api({action:'updateOrder',id:o.id,...fields})).status,400);
 assert.equal((await api({action:'updateOrder',id:o.id,comment:o.comment,apartment:''})).status,200);assert.equal(o.hands_detail_overrides?.comment,undefined);
 assert.equal((await api({action:'updateOrder',id:o.id,comment:o.comment,edited_detail_fields:['comment']})).status,200);assert.equal(o.hands_detail_overrides.comment,true);
});
test('private patch preserves every byte outside import and refuses drift',()=>{
 const source=fs.readFileSync('tests/fixtures/hands-v8-import.ts','utf8');const result=patch('// prefix\n'+source+'\n// suffix');assert.ok(result.includes('// prefix\n'));assert.ok(result.endsWith('\n// suffix'));assert.throws(()=>patch(result));assert.throws(()=>patch(source.replace(".select('id,status", ".select('other,status")));
});
