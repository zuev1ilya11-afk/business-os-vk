const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee}=require('./helpers/edge.cjs');
const row=id=>({id,client_name:'Fixture',client_phones:['+79990000001'],address:'Fixture street',title:'Замер',price:1000,status:'ACTIVE',creation_time:'2026-10-08T10:00:00',work_time:'2099-10-09T10:00:00',specialist:''});

for(const slug of ['hands-api','order-lifecycle-api']){
 function setup(feed){
  const db=database({business_staff:[employee('owner','owner')],orders:[]}),requests=[];
  const api=edge(slug,db,{env:{HANDS_API_KEY:'fixture'},fetch:async(url,init)=>{
   assert.equal(init?.method||'GET','GET');const u=new URL(url);assert.equal(u.pathname,'/api/v1/specialist/orders/');requests.push(u);
   return Response.json(feed(Number(u.searchParams.get('page'))));
  }});
  return {db,requests,sync:(extra={})=>api({action:slug==='hands-api'?'syncOrders':'syncHandsOrders',per_page:500,max_pages:4,...extra})};
 }
 test(`${slug}: follows advertised pages when Hands caps the requested page size`,async()=>{
  const {db,requests,sync}=setup(page=>({orders:[row(String(page))],page,per_page:1,pages:2,total:2}));
  const result=await sync();assert.equal(result.body.ok,true);assert.equal(db.tables.orders.length,2);assert.equal(result.body.pages,2);assert.equal(requests.length,2);
  await sync();assert.equal(db.tables.orders.length,2);
 });
 test(`${slug}: malformed upstream success is a failure, not an empty successful sync`,async()=>{
  const {db,sync}=setup(()=>({error:'temporarily unavailable'}));const result=await sync();assert.equal(result.body.ok,false);assert.match(result.body.error,/HANDS_RESPONSE_INVALID/);assert.equal(db.tables.orders.length,0);
 });
 test(`${slug}: total-only pagination counts received rows when provider omits page size`,async()=>{
  const {db,requests,sync}=setup(page=>({orders:[row(String(page))],page,total:2}));
  const result=await sync();assert.equal(result.body.ok,true);assert.equal(db.tables.orders.length,2);assert.equal(requests.length,2);
 });
 test(`${slug}: contradictory last-page metadata cannot conceal remaining records`,async()=>{
  const {sync}=setup(()=>({orders:[row('1')],page:1,per_page:1,pages:1,total:2}));
  const result=await sync();assert.equal(result.body.ok,false);assert.match(result.body.error,/HANDS_RESPONSE_INVALID/);
 });
 test(`${slug}: failed row does not strand following valid orders or report complete success`,async()=>{
  const {db,sync}=setup(()=>({orders:[row('bad'),row('good')],page:1,per_page:500,pages:1,total:2}));
  db.beforeQuery=(table,mode,payload)=>{if(table==='orders'&&mode==='insert'&&payload.external_id==='hands:bad')throw Error('private customer text must not appear')};
  const result=await sync();assert.equal(result.body.ok,false);assert.match(result.body.error,/HANDS_IMPORT_PARTIAL/);assert.doesNotMatch(result.body.error,/private customer/);assert.deepEqual(db.tables.orders.map(x=>x.external_id),['hands:good']);
 });
 test(`${slug}: refuses success when max_pages leaves advertised pages unread`,async()=>{
  const {db,sync}=setup(page=>({orders:[row(String(page))],page,per_page:1,pages:3,total:3}));const result=await sync({max_pages:1});assert.equal(result.body.ok,false);assert.match(result.body.error,/HANDS_SYNC_INCOMPLETE/);assert.equal(db.tables.orders.length,1);
 });
 test(`${slug}: missing external ID is reported while subsequent records are saved`,async()=>{
  const {db,sync}=setup(()=>({orders:[row(''),row('good')],page:1,per_page:500,pages:1,total:2}));const result=await sync();assert.equal(result.body.ok,false);assert.match(result.body.error,/HANDS_IMPORT_PARTIAL/);assert.equal(db.tables.orders.length,1);
 });
}
