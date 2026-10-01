const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee,attachmentUrl}=require('./helpers/edge.cjs');
const order={id:'o',master_workflow_stage:'started',master_staff_id:'m',status:'В работе',amount:1000,original_amount:1000,updated_at:'2026-01-01',report_review_status:'pending',report_upload_token:'r1',report_uploaded_at:'2026-01-01',report_act_url:attachmentUrl('o','r1'),report_photo_urls:JSON.stringify([attachmentUrl('o','r1','photo.jpg')])};
const fixture=(override={})=>database({business_staff:[employee('m'),employee('other'),employee('d','dispatcher')],orders:[{...order,...override}]});
const invalid=['http://127.0.0.1/a','http://[::1]/a','file:///etc/passwd','javascript:alert(1)','https://evil.test/a',attachmentUrl('other','r1'),attachmentUrl('o','other'),attachmentUrl('o','r1').replace('business-os-vk-files','another-bucket'),attachmentUrl('o','r1').replace('test.invalid','test.invalid:8443'),attachmentUrl('o','r1').replace('https://','https://user@'),attachmentUrl('o','r1').replace('/act.pdf','/%2e%2e/act.pdf'),attachmentUrl('o','r1').split('?')[0]];
for(const slug of ['order-lifecycle-api','report-api'])test(`${slug}: attachment URLs are bound to the own signed order/token path`,async()=>{
 for(const url of invalid){
  const db=fixture({report_uploaded_at:null,report_review_status:'not_submitted',report_upload_token:null}),before=structuredClone(db.tables.orders);
  const r=await edge(slug,db)({action:'finalizeMasterReport',order_id:'o',upload_token:'r1',act_url:url,photo_urls:[attachmentUrl('o','r1','photo.jpg')]},'staff_m');
  assert.equal(r.status,400,url);assert.equal(r.body.error,'INVALID_ATTACHMENT_URL');assert.deepEqual(db.tables.orders,before);
 }
 const db=fixture({report_uploaded_at:null,report_review_status:'not_submitted',report_upload_token:null});
 const api=edge(slug,db);
 assert.equal((await api({action:'finalizeMasterReport',order_id:'o',upload_token:'r1',act_url:attachmentUrl('o','r1'),photo_urls:[invalid[0]]},'staff_m')).status,400);
 assert.equal((await api({action:'finalizeMasterReport',order_id:'o',upload_token:'r1',act_url:attachmentUrl('o','r1'),photo_urls:[attachmentUrl('o','r1','photo.jpg')]},'staff_m')).status,200);
});
test('archiver refuses unsafe URLs without attempting any network request',async()=>{
 for(const url of invalid){let calls=0;const db=fixture({report_act_url:url}),before=structuredClone(db.tables.orders);
  const r=await edge('drive-archive-api',db,{fetch:async()=>{calls++;throw Error('Forbidden network call')}})({order_id:'o',expected_report_token:db.tables.orders[0].report_upload_token,expected_report_uploaded_at:db.tables.orders[0].report_uploaded_at},'staff_d');
  assert.equal(r.status,400,url);assert.equal(calls,0);assert.deepEqual(db.tables.orders,before);
 }
});
test('attachment redirects are refused, not followed',async()=>{
 let calls=0;const db=fixture();const r=await edge('drive-archive-api',db,{fetch:async(url,init)=>{calls++;assert.equal(init.redirect,'error');return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})}})({order_id:'o',expected_report_token:db.tables.orders[0].report_upload_token,expected_report_uploaded_at:db.tables.orders[0].report_uploaded_at},'staff_d');
 assert.equal(r.status,502);assert.equal(calls,1);assert.equal(db.tables.orders[0].drive_archive_status,undefined);
});
test('declared oversized body is rejected and the request is aborted',async()=>{
 let signal;const db=fixture();const r=await edge('drive-archive-api',db,{fetch:async(url,init)=>{signal=init.signal;return new Response('small',{headers:{'content-length':String(11*1024*1024)}})}})({order_id:'o',expected_report_token:db.tables.orders[0].report_upload_token,expected_report_uploaded_at:db.tables.orders[0].report_uploaded_at},'staff_d');
 assert.equal(r.status,413);assert.equal(signal.aborted,true);assert.equal(db.calls.filter(x=>x.mode==='update').length,0);
});
test('streaming byte limit works without content-length and cancels the stream',async()=>{
 let cancelled=false;const db=fixture();const r=await edge('drive-archive-api',db,{fetch:async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(6*1024*1024))},cancel(){cancelled=true}}))})({order_id:'o',expected_report_token:db.tables.orders[0].report_upload_token,expected_report_uploaded_at:db.tables.orders[0].report_uploaded_at},'staff_d');
 assert.equal(r.status,413);assert.equal(cancelled,true);assert.equal(db.calls.filter(x=>x.mode==='update').length,0);
});
test('aggregate report limit bounds a series of individually valid files',async()=>{
 const db=fixture({report_photo_urls:JSON.stringify([attachmentUrl('o','r1','1.jpg'),attachmentUrl('o','r1','2.jpg')])});let calls=0;
 const r=await edge('drive-archive-api',db,{fetch:async()=>{calls++;return new Response(new Uint8Array(9*1024*1024))}})({order_id:'o',expected_report_token:db.tables.orders[0].report_upload_token,expected_report_uploaded_at:db.tables.orders[0].report_uploaded_at},'staff_d');
 assert.equal(r.status,413);assert.equal(calls,3);assert.equal(db.calls.filter(x=>x.mode==='update').length,0);
});
test('attachment read deadline aborts the fetch and preserves pending report',async()=>{
 const db=fixture();const r=await edge('drive-archive-api',db,{setTimeout:fn=>setTimeout(fn,2),fetch:async(url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted'))))})({order_id:'o',expected_report_token:db.tables.orders[0].report_upload_token,expected_report_uploaded_at:db.tables.orders[0].report_uploaded_at},'staff_d');
 assert.equal(r.status,504);assert.equal(db.tables.orders[0].report_review_status,'pending');
});
for(const timing of ['during-read','during-bridge'])test(`archive cannot attach stale metadata after report changes ${timing}`,async()=>{
 const db=fixture();let bridge=0;
 const r=await edge('drive-archive-api',db,{fetch:async(url)=>{
  if(String(url).startsWith('https://script.google.com/')){bridge++;Object.assign(db.tables.orders[0],{report_upload_token:'r2',updated_at:'2026-01-02'});return Response.json({ok:true,drive_folder_url:'https://drive.test/folder',drive_folder_id:'folder'})}
  if(timing==='during-read')Object.assign(db.tables.orders[0],{report_upload_token:'r2',updated_at:'2026-01-02'});
  return new Response('file');
 }})({order_id:'o',expected_report_token:db.tables.orders[0].report_upload_token,expected_report_uploaded_at:db.tables.orders[0].report_uploaded_at},'staff_d');
 assert.equal(r.status,409);assert.equal(bridge,timing==='during-read'?0:1);assert.equal(db.tables.orders[0].report_upload_token,'r2');assert.equal(db.tables.orders[0].drive_archive_url,undefined);
});
test('archived receipt causes no repeated external write',async()=>{
 const db=fixture({drive_archive_status:'archived',drive_archive_url:'https://drive.test/folder'}),before=structuredClone(db.tables.orders);
 assert.equal((await edge('drive-archive-api',db)({order_id:'o',expected_report_token:db.tables.orders[0].report_upload_token,expected_report_uploaded_at:db.tables.orders[0].report_uploaded_at},'staff_d')).status,200);assert.deepEqual(db.tables.orders,before);
});
function upload(){const f=new FormData();f.set('order_id','o');f.set('upload_token','r1');f.set('file_kind','act');f.set('file',new File(['bytes'],'act.pdf',{type:'application/pdf'}));return f}
test('multipart uploads are immutable and closed reports reject uploads',async()=>{
 const db=fixture({report_uploaded_at:null,report_review_status:'not_submitted'}),uploads=[];
 db.storage={from:()=>({upload:async(path,bytes,options)=>{uploads.push({path,options});return {error:null}},createSignedUrl:async path=>({data:{signedUrl:'https://test.invalid/'+path}})})};
 const api=edge('report-file-upload',db);
 assert.equal((await api(upload(),'staff_m')).status,200);assert.equal((await api(upload(),'staff_m')).status,200);
 assert.notEqual(uploads[0].path,uploads[1].path);assert.ok(uploads.every(x=>x.options.upsert===false));
 for(const state of [{report_review_status:'pending'},{report_review_status:'approved'},{status:'Выполнена'},{status:'Отменена'}]){Object.assign(db.tables.orders[0],state);assert.equal((await api(upload(),'staff_m')).status,409)}
 assert.equal((await api(upload(),'staff_other')).status,403);assert.equal(uploads.length,2);
});

test('multipart upload fails closed when the signing secret is missing',async()=>{
 const db=fixture();const r=await edge('report-file-upload',db,{env:{VK_APP_SECRET:''}})(upload(),'staff_m');
 assert.equal(r.status,500);assert.equal(r.body.error,'Server configuration missing');assert.equal(db.calls.length,0);
});
