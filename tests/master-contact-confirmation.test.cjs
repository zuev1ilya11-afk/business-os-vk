const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee}=require('./helpers/edge.cjs');
function fixture(extra={}){
 return database({business_staff:[employee('m','master',{full_name:'Первый мастер'}),employee('other','master',{full_name:'Другой мастер'}),employee('owner','owner')],orders:[{id:'1',master_staff_id:'m',master_name:'Первый мастер',status:'В работе',master_workflow_stage:'assigned',amount:1000,original_amount:1000,source:'Hands',external_source:'hands',external_id:'hands:TEST-1',...extra}]});
}
const confirm=(db,uid='staff_m',extra={})=>edge('master-workflow-api',db)({action:'markCalled',id:'1',contact_confirmed:true,...extra},uid);
test('cached implicit call requests stay legacy and never acquire successful-contact provenance',async()=>{
 for(const value of [undefined,false,'true']){
  const db=fixture(),r=await edge('master-workflow-api',db)({action:'markCalled',id:'1',contact_confirmed:value},'staff_m');
  assert.equal(r.status,200);assert.ok(db.tables.orders[0].master_called_at);assert.equal(db.tables.orders[0].master_called_by_staff_id,undefined);assert.equal(db.tables.orders[0].master_called_by_name,undefined);
 }
});
test('explicit contact records server time and authenticated author snapshot, ignoring forged inputs',async()=>{
 const db=fixture(),before=Date.now();
 const result=await confirm(db,'staff_m',{master_called_at:'2000-01-01',master_called_by_staff_id:'other',master_called_by_name:'Подмена'});
 assert.equal(result.status,200);const o=db.tables.orders[0];
 assert.ok(Date.parse(o.master_called_at)>=before);assert.equal(o.master_called_by_staff_id,'m');assert.equal(o.master_called_by_name,'Первый мастер');
 assert.equal(result.body.order.master_called_by_name,'Первый мастер');assert.equal(o.master_workflow_stage,'assigned');assert.equal(o.master_agreed_at,undefined);
});
test('legacy call receives new provenance only after explicit confirmation, preserving later workflow',async()=>{
 const db=fixture({master_called_at:'2020-01-01T00:00:00Z',master_agreed_at:'2020-01-01T00:01:00Z',master_workflow_stage:'started'});
 const result=await confirm(db);assert.equal(result.status,200);assert.equal(db.tables.orders[0].master_called_by_staff_id,'m');assert.notEqual(db.tables.orders[0].master_called_at,'2020-01-01T00:00:00Z');assert.equal(db.tables.orders[0].master_agreed_at,'2020-01-01T00:01:00Z');assert.equal(db.tables.orders[0].master_workflow_stage,'started');
});
test('duplicate and concurrent confirmations preserve first receipt after rename and reassignment',async()=>{
 const db=fixture(),results=await Promise.all([confirm(db),confirm(db)]);
 assert.deepEqual(results.map(x=>x.status),[200,200]);const receipt={at:db.tables.orders[0].master_called_at,by:db.tables.orders[0].master_called_by_staff_id,name:db.tables.orders[0].master_called_by_name};
 assert.equal(receipt.by,'m');assert.equal(receipt.name,'Первый мастер');assert.equal(results[0].body.order.master_called_at,results[1].body.order.master_called_at);
 db.tables.business_staff[0].full_name='Новое имя';assert.equal((await confirm(db)).status,200);
 db.tables.orders[0].master_staff_id='other';assert.equal((await confirm(db)).status,403);assert.equal((await confirm(db,'staff_other')).status,200);
 assert.deepEqual({at:db.tables.orders[0].master_called_at,by:db.tables.orders[0].master_called_by_staff_id,name:db.tables.orders[0].master_called_by_name},receipt);
});
test('only the active assigned master may confirm; assignment/cancellation races never write',async()=>{
 for(const [uid,extra] of [['100',{}],['staff_other',{}],['staff_m',{status:'Отменена'}],['staff_m',{status:'Выполнена'}]]){const db=fixture(extra),before=structuredClone(db.tables.orders);assert.ok([403,409].includes((await confirm(db,uid)).status));assert.deepEqual(db.tables.orders,before)}
 const inactive=fixture();inactive.tables.business_staff[0].is_active=false;assert.equal((await confirm(inactive)).status,401);
 for(const change of [{master_staff_id:'other'},{status:'Отменена'}]){const db=fixture();let expected;db.beforeQuery=(table,mode)=>{if(table==='orders'&&mode==='update'){Object.assign(db.tables.orders[0],change);expected=structuredClone(db.tables.orders[0]);db.beforeQuery=null}};assert.ok([403,409].includes((await confirm(db)).status));assert.deepEqual(db.tables.orders[0],expected)}
});
test('ops cannot fabricate contact through general order update',async()=>{
 const db=fixture();const r=await edge('mini-app-api',db)({action:'updateOrder',id:'1',master_called_at:'2026-01-01',master_called_by_staff_id:'m',master_called_by_name:'Подмена'},'100');assert.equal(r.status,200);assert.equal(db.tables.orders[0].master_called_at,undefined);assert.equal(db.tables.orders[0].master_called_by_staff_id,undefined);
});
test('Hands synchronization preserves contact provenance and both manual detail overrides',async()=>{
 const db=fixture({apartment:'12А',comment:'Локально',hands_detail_overrides:{apartment:true,comment:true},hands_comment_source:{directions:'кв. 42',comment:'Старое'}});
 assert.equal((await confirm(db)).status,200);const first=structuredClone(db.tables.orders[0]);
 const remote={id:'TEST-1',specialist:'Другой мастер',status:'ACTIVE',price:'1000',client_name:'Тест',address:'Дом 1',work_time:'2099-09-10T10:00:00',directions:'кв. 43',comment:'Новое'};
 const sync=edge('hands-api',db,{env:{HANDS_API_KEY:'fixture'},fetch:async()=>Response.json({orders:[remote]})});assert.equal((await sync({action:'syncOrders',per_page:2,max_pages:1},'100')).status,200);
 const o=db.tables.orders[0];assert.equal(o.master_staff_id,'other');for(const key of ['master_called_at','master_called_by_staff_id','master_called_by_name','apartment','comment','hands_detail_overrides'])assert.deepEqual(o[key],first[key]);assert.equal(o.master_called_by_staff_id,'m');
});
test('Hands reactivation preserves first proven contact through the production restart guard',async()=>{
 const db=fixture();assert.equal((await confirm(db)).status,200);const first=structuredClone(db.tables.orders[0]);db.tables.orders[0].status='Отменена';
 db.beforeUpdate=(table,current,patch)=>table==='orders'?require('./helpers/order-guards.cjs').orderGuards(current,patch):patch;
 const remote={id:'TEST-1',specialist:'Другой мастер',status:'ACTIVE',price:'1000',client_name:'Тест',address:'Дом 1'};
 const sync=edge('hands-api',db,{env:{HANDS_API_KEY:'fixture'},fetch:async()=>Response.json({orders:[remote]})});assert.equal((await sync({action:'syncOrders',per_page:2,max_pages:1},'100')).status,200);
 assert.equal(db.tables.orders[0].status,'В работе');for(const key of ['master_called_at','master_called_by_staff_id','master_called_by_name'])assert.equal(db.tables.orders[0][key],first[key]);
});
test('shared contact renderer distinguishes provenance from legacy timestamps and agreement, in Moscow',()=>{
 const status=require('../contact-status.js');
 assert.match(status.html({master_agreed_at:'2026-10-01T21:05:00Z'}),/Связь не подтверждена/);
 assert.match(status.html({master_called_at:'2026-10-01T21:05:00Z'}),/Звонок отмечен · 02\.10, 00:05/);
 const order={master_called_at:'2026-10-01T21:05:00Z',master_called_by_staff_id:'m',master_called_by_name:'<Первый> & мастер',master_name:'Другой мастер'};
 assert.match(status.html(order),/Связался · 02\.10, 00:05/);assert.match(status.html(order,{details:true}),/&lt;Первый&gt; &amp; мастер/);assert.doesNotMatch(status.html(order,{details:true}),/Другой мастер/);
 assert.match(status.html({...order,master_called_at:'invalid'}),/Звонок отмечен/);assert.doesNotMatch(status.html({...order,master_called_at:'invalid'}),/Связался/);
});
