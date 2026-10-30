const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {edge,database,employee,attachmentUrl}=require('./helpers/edge.cjs');
const current='https://homemaster.qd.je',internal='http://gateway:8000',old='https://139.100.237.167:8443';
const env={SUPABASE_URL:internal,BOS_PUBLIC_URL:current,BOS_LEGACY_STORAGE_ORIGINS:old,BOS_DRIVE_WORKER_KEY:'a'.repeat(48)};
const o={id:'11',status:'Выполнена',report_review_status:'approved',report_type:'work',report_upload_token:'r1',report_uploaded_at:'2026-10-30T08:00:00Z',report_act_url:attachmentUrl('11','r1').replace('https://test.invalid',old),report_photo_urls:JSON.stringify([attachmentUrl('11','r1','photo.jpg').replace('https://test.invalid',old)])};
const job={order_id:11,report_token:'r1',report_uploaded_at:o.report_uploaded_at,snapshot:o,lease:'lease'};
test('Drive worker fetches old signed objects through internal authenticated Storage and persists receipt',async()=>{
 const db=database(),finished=[];let sends=0;
 db.rpc=async(name,p)=>{if(name==='bos_drive_claim')return {data:job};finished.push(p);return {data:true}};
 const api=edge('drive-archive-api',db,{env,fetch:async(url,init)=>{
  if(String(url).startsWith(internal+'/storage/v1/object/authenticated/')){assert.equal(init.headers.Authorization,'Bearer test-key');assert.equal(init.redirect,'error');return new Response('bytes')}
  assert.ok(String(url).startsWith('https://script.google.com/'));sends++;
  assert.equal(new URLSearchParams(init.body).get('upload_token'),'r1@'+o.report_uploaded_at);
  return Response.json({ok:true,drive_folder_url:'https://drive.google.com/drive/folders/fixture'});
 }});
 assert.equal((await api({action:'worker'},'', '',{'x-bos-drive-worker':env.BOS_DRIVE_WORKER_KEY})).status,200);
 assert.equal(sends,1);assert.equal(finished.length,1);assert.equal(finished[0].p_uploaded_at,o.report_uploaded_at);assert.ok(finished[0].p_result);assert.equal(finished[0].p_error,null);
});
test('worker error persists a retry independently of report acceptance and never leaks provider body',async()=>{
 const db=database(),finished=[];db.rpc=async(name,p)=>name==='bos_drive_claim'?{data:job}:(finished.push(p),{data:true});
 const api=edge('drive-archive-api',db,{env,fetch:async url=>String(url).startsWith(internal)?new Response('bytes'):Response.json({ok:false,error:'secret-provider-response'})});
 const r=await api({action:'worker'},'','',{'x-bos-drive-worker':env.BOS_DRIVE_WORKER_KEY});
 assert.equal(r.body.archive_status,'failed');assert.equal(finished[0].p_error,'DRIVE_UNAVAILABLE');assert.equal(finished[0].p_result,null);
 assert.equal(o.report_review_status,'approved');
});
test('worker requires a separate machine credential; user and missing key cannot claim jobs',async()=>{
 const db=database();let called=0;db.rpc=async()=>{called++;return {data:null}};
 for(const key of ['', 'wrong'])assert.equal((await edge('drive-archive-api',db,{env})({action:'worker'},'100',undefined,{'x-bos-drive-worker':key})).status,401);
 assert.equal(called,0);
});
test('current public origin is accepted with an internal Supabase URL; unlisted origin stays blocked',async()=>{
 for(const host of [current,old,'https://evil.test']){
  const db=database({business_staff:[employee('m')],orders:[{id:'11',master_staff_id:'m',status:'В работе',master_workflow_stage:'started',amount:1000}]});
  const body={action:'finalizeMasterReport',order_id:'11',upload_token:'r1',act_url:attachmentUrl('11','r1').replace('https://test.invalid',host),photo_urls:[attachmentUrl('11','r1','photo.jpg').replace('https://test.invalid',host)]};
  assert.equal((await edge('order-lifecycle-api',db,{env})(body,'staff_m')).status,host.includes('evil')?400:200);
 }
});
test('public report upload never returns a Docker hostname',async()=>{
 const db=database({business_staff:[employee('m')],orders:[{id:'11',master_staff_id:'m',status:'В работе'}]});
 db.storage={from:()=>({upload:async()=>({}),createSignedUrl:async path=>({data:{signedUrl:internal+'/storage/v1/object/sign/business-os-vk-files/'+path+'?token=test'}})})};
 const r=await edge('report-api',db,{env})({action:'uploadReportFile',order_id:'11',upload_token:'r1',file_kind:'act',file_name:'act.pdf',file_data:'eA=='},'staff_m');
 assert.equal(r.status,200);assert.ok(r.body.url.startsWith(current+'/storage/v1/'));assert.equal(r.body.url.includes('gateway:8000'),false);
});
test('production report links and API calls use current origin, preserving tokens and external Drive links',async()=>{
 const calls=[],window={fetch:async(input,init)=>{calls.push({input,init});return new Response('{}')}};
 vm.runInNewContext(fs.readFileSync('report-origin.js','utf8'),{window,location:new URL(current),URL,Request});
 const before=old+'/storage/v1/object/sign/a/b?token=a%2Fb#photo';
 assert.equal(window.BOS_REPORT_URL(before),current+'/storage/v1/object/sign/a/b?token=a%2Fb#photo');
 assert.equal(window.BOS_REPORT_URL('https://drive.google.com/a'),'https://drive.google.com/a');
 assert.equal(window.BOS_REPORT_URL('javascript:alert(1)'),'');
 const payload='{"action":"reviewReport"}';await window.fetch('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/order-lifecycle-api',{method:'POST',body:payload});
 assert.equal(calls.length,1);assert.equal(calls[0].input,current+'/functions/v1/order-lifecycle-api');assert.equal(calls[0].init.body,payload);
});
test('GAS immutable archive file is reused, never deleted on a retry',()=>{
 const existing={getUrl:()=> 'saved'},folder={getFilesByName:()=>({hasNext:()=>true,next:()=>existing}),createFile:()=>{throw Error('Duplicate file')}};
 const out=vm.runInNewContext(fs.readFileSync('google-apps-script/ReportUpload.gs','utf8')+';saveNamedReportBlob_(folder,"Акт","act.pdf","application/pdf","eA==")',{folder});
 assert.equal(out,existing);
});
test('manual retry failure leaves approval intact and saves archive error separately',async()=>{
 const db=database({business_staff:[employee('d','dispatcher')],orders:[structuredClone(o)]});
 const r=await edge('drive-archive-api',db,{env,fetch:async()=>{throw Error('Network down')}})({order_id:'11',expected_report_token:'r1',expected_report_uploaded_at:o.report_uploaded_at},'staff_d');
 assert.equal(r.status,500);assert.equal(db.tables.orders[0].report_review_status,'approved');assert.equal(db.tables.orders[0].status,'Выполнена');assert.equal(db.tables.orders[0].drive_archive_status,'failed');assert.equal(db.tables.orders[0].drive_archive_error,'DRIVE_UNAVAILABLE');
});
test('parallel approvals commit once and preserve one receipt without Drive calls',async()=>{
 const db=database({business_staff:[employee('owner','owner')],orders:[{...o,status:'В работе',report_review_status:'pending'}]});
 const api=edge('order-lifecycle-api',db),body={action:'reviewReport',id:'11',decision:'approved',expected_report_token:'r1',expected_report_uploaded_at:o.report_uploaded_at};
 const responses=await Promise.all([api(body),api(body)]);
 assert.deepEqual(responses.map(x=>x.status),[200,200]);assert.equal(responses[0].body.order.report_reviewed_at,responses[1].body.order.report_reviewed_at);
 assert.equal(db.tables.orders[0].report_reviewer_staff_id,'owner');
});
test('late manual failure cannot overwrite a concurrently completed archive',async()=>{
 const db=database({business_staff:[employee('d','dispatcher')],orders:[{...o,drive_archive_status:'pending'}]});
 const api=edge('drive-archive-api',db,{env,fetch:async()=>{Object.assign(db.tables.orders[0],{drive_archive_status:'archived',drive_archive_url:'https://drive.google.com/done'});throw Error('Late network error')}});
 await api({order_id:'11',expected_report_token:'r1',expected_report_uploaded_at:o.report_uploaded_at},'staff_d');
 assert.equal(db.tables.orders[0].drive_archive_status,'archived');assert.equal(db.tables.orders[0].drive_archive_error,undefined);
});
