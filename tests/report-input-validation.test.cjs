const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee}=require('./helpers/edge.cjs');

function fixture(extra={}){
 const db=database({business_staff:[employee('m'),employee('owner','owner'),employee('d','dispatcher'),employee('mgr','manager')],orders:[{id:'o',master_staff_id:'m',status:'В работе',master_workflow_stage:'started',amount:1000,original_amount:1000,...extra}]});
 const uploads=[];
 db.storage={from:()=>({upload:async(path,data)=>{uploads.push({path,data});return {error:null}},createSignedUrl:async path=>({data:{signedUrl:'https://test.invalid/'+path}})})};
 return {db,uploads};
}
const body={action:'uploadMasterReport',order_id:'o',upload_token:'r1',act_data:'YQ==',act_name:'act.pdf',photos_json:JSON.stringify([{name:'photo.jpg',data:'YQ=='}])};

test('batch upload rejects missing, empty and malformed photo bytes before any file or order write',async()=>{
 for(const photo of [{},null,{data:''},{data:' '},{data:'data:image/jpeg;base64,'},{data:'%%%'}]){
  const {db,uploads}=fixture(),before=structuredClone(db.tables.orders);
  const r=await edge('report-api',db)({...body,photos_json:JSON.stringify([{data:'YQ=='},photo])},'staff_m');
  assert.equal(r.status,400,JSON.stringify(photo));assert.equal(r.body.error,'INVALID_FILE_DATA');
  assert.deepEqual(db.tables.orders,before);assert.equal(uploads.length,0);
 }
});
test('batch upload rejects non-array photos and malformed act without storing partial report',async()=>{
 for(const patch of [{photos_json:'{}'},{photos_json:'null'},{photos_json:'"photo"'},{act_data:'data:application/pdf;base64,'},{act_data:'%%%'}]){
  const {db,uploads}=fixture(),before=structuredClone(db.tables.orders);
  const r=await edge('report-api',db)({...body,...patch},'staff_m');
  assert.equal(r.status,400);assert.deepEqual(db.tables.orders,before);assert.equal(uploads.length,0);
 }
});
test('single JSON and multipart uploads refuse zero bytes',async()=>{
 const {db,uploads}=fixture();
 const json=await edge('report-api',db)({action:'uploadReportFile',order_id:'o',upload_token:'r1',file_kind:'photo',file_data:'data:image/jpeg;base64,'},'staff_m');
 assert.equal(json.status,400);assert.equal(json.body.error,'INVALID_FILE_DATA');
 const form=new FormData();for(const [k,v] of Object.entries({order_id:'o',upload_token:'r1',file_kind:'photo'}))form.set(k,v);form.set('file',new File([],'empty.jpg',{type:'image/jpeg'}));
 const multipart=await edge('report-file-upload',db)(form,'staff_m');
 assert.equal(multipart.status,400);assert.equal(multipart.body.error,'INVALID_FILE_DATA');assert.equal(uploads.length,0);
});
test('batch upload keeps valid data URI support and replay receipt without duplicate writes',async()=>{
 const {db,uploads}=fixture(),api=edge('report-api',db);
 const request={...body,act_data:'data:application/pdf;base64,YQ==',photos_json:JSON.stringify([{data:'data:image/jpeg;base64,Yg=='}])};
 assert.equal((await api(request,'staff_m')).status,200);assert.equal(db.tables.orders[0].report_review_status,'pending');assert.equal(uploads.length,2);
 const before=structuredClone(db.tables.orders);
 assert.equal((await api(request,'staff_m')).status,200);assert.deepEqual(db.tables.orders,before);assert.equal(uploads.length,2);
});

const review={action:'reviewReport',id:'o',decision:'rejected',expected_report_token:'r1',expected_report_uploaded_at:'2026-11-11T09:00:00Z'};
const pending={report_review_status:'pending',report_upload_token:'r1',report_uploaded_at:review.expected_report_uploaded_at};
test('every reviewer role must provide a rejection reason at the server boundary',async()=>{
 for(const uid of ['100','staff_d','staff_mgr'])for(const comment of [undefined,null,'',' \n ',42,{}]){
  const {db}=fixture(pending),before=structuredClone(db.tables.orders);
  const r=await edge('order-lifecycle-api',db)({...review,comment},uid);
  assert.equal(r.status,400);assert.equal(r.body.error,'REJECTION_REASON_REQUIRED');assert.deepEqual(db.tables.orders,before);
 }
});
test('valid rejection preserves the reason and repeated rejection remains read-only',async()=>{
 const {db}=fixture(pending),api=edge('order-lifecycle-api',db),comment='Добавьте фото креплений';
 assert.equal((await api({...review,comment})).status,200);assert.equal(db.tables.orders[0].report_review_comment,comment);
 const before=structuredClone(db.tables.orders),writes=db.calls.filter(x=>x.mode==='update').length;
 assert.equal((await api(review)).status,200);assert.deepEqual(db.tables.orders,before);assert.equal(db.calls.filter(x=>x.mode==='update').length,writes);
});
