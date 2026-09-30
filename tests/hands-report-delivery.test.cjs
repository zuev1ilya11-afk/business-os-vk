const {test}=require('node:test'),assert=require('node:assert/strict');
const {edge,database,employee,attachmentUrl}=require('./helpers/edge.cjs');
const workerKey='b'.repeat(64);
function worker(options={}){
 const order={id:12,external_id:'hands:1234',report_upload_token:'receipt-1',report_type:'work',report_act_url:attachmentUrl(12,'receipt-1','act.jpg'),report_photo_urls:JSON.stringify([attachmentUrl(12,'receipt-1','photo.jpg')]),work:'Установка',...options.snapshot};
 const job={id:'job',order_id:12,report_token:'receipt-1',snapshot:order,step:0,lease:'lease',state:'queued',inflight:false,...options.job};
 const calls=[];let enabled=options.enabled!==false;
 const db={rpc:async(name,p={})=>{
  calls.push({name,p:structuredClone(p)});
  if(name==='bos_hands_report_runtime')return {data:{enabled,workerKey},error:null};
  if(name==='bos_hands_report_claim'){
   if(!['queued','retry','processing'].includes(job.state))return {data:null};
   if(job.inflight){job.state='attention';job.uncertain=true;return {data:{attention:true}}}
   job.state='processing';return {data:structuredClone(job)};
  }
  if(name==='bos_hands_report_step'){
   if(options.failCommit&&['advance','sent'].includes(p.p_action))return {error:{message:'database lost'}};
   if(p.p_action==='begin'){if(options.changed){job.state='cancelled';return {data:false}}job.inflight=true}
   if(['advance','sent'].includes(p.p_action)){job.inflight=false;job.step++;if(p.p_action==='sent')job.state='sent'}
   if(['attention','retry','yield'].includes(p.p_action))Object.assign(job,{state:p.p_action==='yield'?'queued':p.p_action,inflight:false,uncertain:!!p.p_uncertain,error:p.p_error});
   return {data:true};
  }
  throw Error('Unexpected RPC '+name);
 }};
 const send=edge('hands-report-api',db,{Blob,env:{HANDS_API_KEY:options.noKey?'':'private-hands-key'},fetch:async(url,init)=>{
  calls.push({url,init});
  if(url.includes('/storage/')){
   assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer test-key');
   assert.ok(!url.includes('?token='));return options.storage?options.storage(url,init):new Response(new Uint8Array([255,216,255]),{headers:{'Content-Type':'image/jpeg'}});
  }
  assert.equal(init.headers['X-Api-Key'],'private-hands-key');assert.equal(init.headers.Authorization,undefined);assert.equal(init.redirect,'error');
  return options.provider?options.provider(url,init):new Response('{}',{status:201});
 }});
 return {job,calls,call:(key=workerKey)=>send({action:'worker'},'100','',{'x-bos-hands-worker':key}),setEnabled:v=>enabled=v};
}
test('worker authorization, configuration and disabled mode never reach Hands',async()=>{
 for(const [options,key,status] of [[{},'',401],[{},'c'.repeat(64),401],[{noKey:true},workerKey,503],[{enabled:false},workerKey,200]]){
  const x=worker(options),r=await x.call(key);assert.equal(r.status,status);assert.equal(x.calls.filter(c=>c.url).length,0);
 }
});
test('approved files precede the completed report; receipt replay does not resend',async()=>{
 const x=worker({snapshot:{extra_work_done:true,extra_work_description:'Подводка',extra_work_amount:700,uncompleted_work_done:true,uncompleted_work_description:'Полка',uncompleted_work_amount:500,report_review_comment:'Принято'}});
 assert.equal((await x.call()).status,200);assert.equal(x.job.state,'sent');
 const posts=x.calls.filter(c=>c.url?.startsWith('https://api.hands.ru'));
 assert.equal(posts.length,3);assert.match(posts[0].url,/\/1234\/files\/$/);assert.match(posts[2].url,/\/1234\/report\/$/);
 assert.equal(posts[0].init.body.get('relation'),'SPECIALIST_REPORT');assert.match(posts[0].init.body.get('file').name,/_act\.jpg$/);
 assert.equal(posts[1].init.body.get('relation'),'SPECIALIST_PHOTO');
 const report=JSON.parse(posts[2].init.body);assert.equal(report.kind,'COMPLETED');assert.equal(report.outcome,'SUCCESS');
 assert.match(report.comment,/Не выполнено: Полка/);assert.match(report.comment,/700 руб/);assert.match(report.comment,/Принято/);
 assert.equal(report.price,undefined);await x.call();assert.equal(x.calls.filter(c=>c.url?.startsWith('https://api.hands.ru')).length,3);
});
test('expired signed URLs are reauthorized only for exact current order objects',async()=>{
 const good=attachmentUrl(12,'receipt-1','акт.jpg');const x=worker({snapshot:{report_act_url:good}});await x.call();assert.equal(x.job.state,'sent');
 assert.ok(x.calls.some(c=>c.url?.includes('%D0%B0%D0%BA%D1%82.jpg')));
 for(const url of ['https://evil.invalid/file',attachmentUrl(11,'receipt-1'),attachmentUrl(12,'other'),attachmentUrl(12,'receipt-1','nested%2Ffile.jpg')]){
  const y=worker({snapshot:{report_act_url:url}});await y.call();assert.equal(y.job.state,'attention');assert.equal(y.calls.filter(c=>c.url).length,0);
 }
});
test('unavailable storage and rejected rate limit retry only the unfinished step',async()=>{
 let files=0;
 const x=worker({provider:()=>++files===2?new Response('private-error',{status:429}):new Response('{}',{status:200})});
 await x.call();assert.equal(x.job.state,'retry');assert.equal(x.job.step,1);await x.call();assert.equal(x.job.state,'sent');
 const uploads=x.calls.filter(c=>c.url?.endsWith('/files/'));assert.equal(uploads.filter(c=>c.init.body.get('file').name.endsWith('_act.jpg')).length,1);
 const y=worker({storage:()=>{throw Error('private URL')}});await y.call();assert.equal(y.job.state,'retry');assert.equal(y.job.inflight,false);assert.equal(y.calls.filter(c=>c.url?.includes('api.hands')).length,0);
});
test('ambiguous POST results are held for review and never blindly retried',async()=>{
 for(const provider of [()=>{throw Error('secret customer detail')},()=>new Response('secret detail',{status:503})]){
  const x=worker({provider});await x.call();assert.equal(x.job.state,'attention');assert.equal(x.job.uncertain,true);assert.ok(!x.job.error.includes('secret'));
  await x.call();assert.equal(x.calls.filter(c=>c.url?.includes('api.hands')).length,1);
 }
});
test('a lost database acknowledgement after successful POST cannot duplicate it',async()=>{
 const x=worker({failCommit:true});assert.equal((await x.call()).status,503);assert.equal(x.job.inflight,true);
 await x.call();assert.equal(x.job.state,'attention');assert.equal(x.calls.filter(c=>c.url?.includes('api.hands')).length,1);
});
test('changed approval, bad content type and oversized storage body never send to Hands',async()=>{
 for(const options of [{changed:true},{storage:()=>new Response('html',{headers:{'content-type':'text/html'}})},{storage:()=>new Response('large',{headers:{'content-type':'image/jpeg','content-length':String(11*1024*1024)}})}]){
  const x=worker(options);await x.call();assert.equal(x.calls.filter(c=>c.url?.includes('api.hands')).length,0);assert.ok(['attention','cancelled'].includes(x.job.state));
 }
});
test('measurement approval sends its own document before completion',async()=>{
 const x=worker({snapshot:{report_type:'measurement',report_act_url:null,report_measurement_url:attachmentUrl(12,'receipt-1','measurement.pdf'),report_photo_urls:'[]'}});
 await x.call();assert.equal(x.job.state,'sent');assert.equal(x.calls.filter(c=>c.url?.includes('api.hands')).length,2);
});
test('only active operations staff can inspect/retry a queue receipt and confirmation is explicit',async()=>{
 for(const role of ['owner','manager','dispatcher','master']){
  const user=employee('owner',role),db=database({business_staff:[user],orders:[{id:'12',external_source:'hands'}]});let rpcs=[];
  db.rpc=async(name,p)=>{rpcs.push({name,p});return {data:name.endsWith('_retry')?true:{state:'queued'}}};
  const api=edge('order-lifecycle-api',db);
  const get=await api({action:'getHandsReportDelivery',order_id:'12'});assert.equal(get.status,role==='master'?403:200);
  const retry=await api({action:'retryHandsReportDelivery',order_id:'12',version:'00000000-0000-4000-8000-000000000001',checked_in_hands:'true'});
  assert.equal(retry.status,role==='master'?403:200);
  if(role==='master')assert.equal(rpcs.length,0);else assert.equal(rpcs.find(x=>x.name.endsWith('_retry')).p.p_confirm,false);
  assert.equal((await api({action:'getHandsReportDelivery',order_id:'12'},'100','bad')).status,401);
 }
});
test('authenticated connectivity probe is read-only and never returns order contents',async()=>{
 const db=database({orders:[{id:'12',external_source:'hands',external_id:'hands:1234'}]});
 db.rpc=async()=>({data:{enabled:false,workerKey}});const calls=[];
 const api=edge('hands-report-api',db,{env:{HANDS_API_KEY:'private-key'},fetch:async(url,init)=>{
  calls.push({url,method:init.method||'GET'});
  if(init.method==='OPTIONS')return new Response(null,{status:405,headers:{Allow:'POST'}});
  return Response.json({orders:[{client:'Private customer',phone:'private phone'}]});
 }});
 const r=await api({action:'probe'},'100','',{'x-bos-hands-worker':workerKey});
 assert.equal(r.status,200);assert.equal(r.body.contract.connection.status,200);
 assert.deepEqual(calls.map(x=>x.method),['GET','OPTIONS','OPTIONS']);
 assert.ok(!JSON.stringify(r).includes('Private customer'));assert.ok(!JSON.stringify(r).includes('private phone'));
 assert.equal((await api({action:'probe'},'100','')).status,401);assert.equal(calls.length,3);
});
