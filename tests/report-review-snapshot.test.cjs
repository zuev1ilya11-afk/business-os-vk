const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee,attachmentUrl}=require('./helpers/edge.cjs');
const snapshot={expected_report_token:'r1',expected_report_uploaded_at:'2026-01-01T10:00:00Z'};
function fixture(extra={}){return database({business_staff:[employee('owner','owner'),employee('d','dispatcher'),employee('m')],orders:[{id:'o',status:'В работе',master_staff_id:'m',updated_at:'v1',report_review_status:'pending',report_upload_token:'r1',report_uploaded_at:snapshot.expected_report_uploaded_at,report_act_url:attachmentUrl('o','r1'),report_photo_urls:JSON.stringify([attachmentUrl('o','r1','photo.jpg')]),...extra}]})}
for(const decision of ['approved','rejected'])test(`${decision}: an old or missing displayed report version cannot decide a new submission`,async()=>{
 for(const shown of [{},{...snapshot,expected_report_token:'old'},{...snapshot,expected_report_uploaded_at:'2025-01-01T10:00:00Z'}]){
  const db=fixture(),before=structuredClone(db.tables.orders);let fetches=0;
  const r=await edge('order-lifecycle-api',db,{fetch:async()=>{fetches++;return Response.json({ok:true,order:{...db.tables.orders[0],drive_archive_status:'archived',drive_archive_url:'https://drive.test/f'}})}})({action:'reviewReport',id:'o',decision,...shown});
  assert.equal(r.status,409);assert.match(r.body.message,/Обновите/);assert.equal(fetches,0);assert.deepEqual(db.tables.orders,before);
 }
});
test('approval sends the displayed version to the archiver and stale archive conflict stays 409',async()=>{
 const db=fixture(),before=structuredClone(db.tables.orders);
 const r=await edge('order-lifecycle-api',db,{fetch:async(url,init)=>{
  assert.deepEqual(JSON.parse(init.body),{order_id:'o',...snapshot});
  return Response.json({ok:false,error:'REPORT_CHANGED',message:'Отчёт изменён. Обновите заявку.'},{status:409});
 }})({action:'reviewReport',id:'o',decision:'approved',...snapshot});
 assert.equal(r.status,409);assert.deepEqual(db.tables.orders,before);
});
test('approved receipt also requires the displayed version and leaves completion time untouched',async()=>{
 const db=fixture({status:'Выполнена',report_review_status:'approved',completed_at:'2026-01-02'}),before=structuredClone(db.tables.orders),api=edge('order-lifecycle-api',db);
 assert.equal((await api({action:'reviewReport',id:'o',decision:'approved',...snapshot,expected_report_token:'old'})).status,409);
 assert.equal((await api({action:'reviewReport',id:'o',decision:'approved',...snapshot})).status,200);assert.deepEqual(db.tables.orders,before);
});
test('archive rejects missing or stale displayed versions before reading any file, including archived receipts',async()=>{
 for(const archived of [false,true])for(const shown of [{},{...snapshot,expected_report_token:'old'},{...snapshot,expected_report_uploaded_at:'old'}]){
  const db=fixture(archived?{drive_archive_status:'archived',drive_archive_url:'https://drive.test/f'}:{}),before=structuredClone(db.tables.orders);let fetches=0;
  const r=await edge('drive-archive-api',db,{fetch:async()=>{fetches++;return new Response('x')}})({order_id:'o',...shown},'staff_d');
  assert.equal(r.status,409);assert.equal(fetches,0);assert.deepEqual(db.tables.orders,before);
 }
});
