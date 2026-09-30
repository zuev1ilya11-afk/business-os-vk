const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee,attachmentUrl}=require('./helpers/edge.cjs');

function fixture(){return database({business_staff:[employee('d','dispatcher')],orders:[{
 id:'o',status:'В работе',report_review_status:'pending',updated_at:'2026-09-30',
 report_upload_token:'r1',report_uploaded_at:'2026-09-30',
 report_act_url:attachmentUrl('o','r1'),report_photo_urls:JSON.stringify([attachmentUrl('o','r1','photo.jpg')])
}]})}
const archive={order_id:'o',expected_report_token:'r1',expected_report_uploaded_at:'2026-09-30'};
const review={action:'reviewReport',id:'o',decision:'approved',expected_report_token:'r1',expected_report_uploaded_at:'2026-09-30'};
const bridge=url=>String(url).startsWith('https://script.google.com/');

for(const body of [{ok:true},{ok:true,drive_folder_url:''},{ok:true,drive_folder_url:'javascript:alert(1)'}])test('incomplete or unusable Drive receipt never marks an archive complete: '+JSON.stringify(body),async()=>{
 const db=fixture(),before=structuredClone(db.tables.orders);let writes=0;
 const r=await edge('drive-archive-api',db,{fetch:async url=>{if(bridge(url)){writes++;return Response.json(body)}return new Response('file')}})(archive,'staff_d');
 assert.equal(r.status,502);assert.equal(writes,1);assert.deepEqual(db.tables.orders,before);
});

for(const phase of ['headers','body'])test('Drive '+phase+' timeout aborts once and preserves the pending report',async()=>{
 const db=fixture(),before=structuredClone(db.tables.orders);let sends=0,signal;const delays=[];
 const r=await edge('drive-archive-api',db,{
  setTimeout:(fn,ms)=>{delays.push(ms);return setTimeout(fn,5)},
  fetch:async(url,init)=>{
   if(!bridge(url))return new Response('file');sends++;signal=init.signal;assert.ok(signal,'bridge fetch must be cancellable');
   if(phase==='headers')return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
   return new Response(new ReadableStream({start(c){signal.addEventListener('abort',()=>c.error(new Error('aborted')),{once:true})}}));
  }
 })(archive,'staff_d');
 assert.equal(r.status,504);assert.match(r.body.error,/Архив|архив/);assert.equal(sends,1);assert.equal(signal.aborted,true);
 assert.ok(delays.every(ms=>ms>0&&ms<=60000));assert.deepEqual(db.tables.orders,before);
});

test('attachment time consumes one shared archive budget; expired work never reaches Drive',async()=>{
 const db=fixture(),before=structuredClone(db.tables.orders);let now=Date.now(),files=0,sends=0;
 class Clock extends Date{static now(){return now}}
 const r=await edge('drive-archive-api',db,{Date:Clock,fetch:async url=>{
  if(bridge(url)){sends++;return Response.json({ok:true,drive_folder_url:'https://drive.test/report'})}
  files++;now+=31000;return new Response('file');
 }})(archive,'staff_d');
 assert.equal(r.status,504);assert.equal(files,2);assert.equal(sends,0);assert.deepEqual(db.tables.orders,before);
});

for(const phase of ['headers','body'])test('approval '+phase+' timeout cannot complete or replay the report',async()=>{
 const db=fixture(),before=structuredClone(db.tables.orders);let calls=0,signal,deadline;
 const r=await edge('order-lifecycle-api',db,{
  setTimeout:(fn,ms)=>{deadline=ms;return setTimeout(fn,5)},
  fetch:async(url,init)=>{calls++;signal=init.signal;assert.ok(signal,'approval fetch must be cancellable');
   if(phase==='headers')return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
   return new Response(new ReadableStream({start(c){signal.addEventListener('abort',()=>c.error(new Error('aborted')),{once:true})}}));
  }
 })(review,'staff_d');
 assert.equal(r.status,504);assert.equal(deadline,75000);assert.equal(calls,1);assert.equal(signal.aborted,true);assert.deepEqual(db.tables.orders,before);
});

test('rejection and archived approval do not start archive requests or deadline timers',async()=>{
 for(const decision of ['rejected','approved']){
  const db=fixture();if(decision==='approved')Object.assign(db.tables.orders[0],{drive_archive_status:'archived',drive_archive_url:'https://drive.test/report'});
  const r=await edge('order-lifecycle-api',db,{setTimeout:()=>{throw new Error('Unexpected timer')},fetch:()=>{throw new Error('Unexpected fetch')}})({...review,decision},'staff_d');
  assert.equal(r.status,200);assert.equal(db.tables.orders[0].report_review_status,decision);
 }
});

test('archive timeout response reaches approval without a second send or a completion write',async()=>{
 const db=fixture(),before=structuredClone(db.tables.orders);let sends=0;
 const r=await edge('order-lifecycle-api',db,{fetch:async()=>{sends++;return Response.json({ok:false,error:'archive timeout'},{status:504})}})(review,'staff_d');
 assert.equal(r.status,504);assert.equal(sends,1);assert.deepEqual(db.tables.orders,before);
});
