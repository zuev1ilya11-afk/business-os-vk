const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const gateway='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e/api/proxy/';
const edge='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/';
const actions=['recordContactAttempt','recordContactResult','confirmAgreement','setAgreementSchedule'];
function network(fetch,scale=1){
 const window={fetch};
 vm.runInNewContext(fs.readFileSync('network-direct-v86.js','utf8'),{window,location:{href:'https://app.test/'},URL,Request,Response,Headers,AbortController,setTimeout:(fn,ms)=>setTimeout(fn,ms*scale),clearTimeout});
 return window.fetch;
}
const payload=action=>({action,id:'11',phone:'+79990000002',attempt_id:'contact_attempt_11',result:'agreed',comment:'Договорились',scheduled_date:'2099-09-10',scheduled_time:'12:00'});
for(const action of actions)for(const working of ['edge','gateway'])test(`${action}: use the authenticated bootstrap route (${working}), not a failing route`,async()=>{
 const calls=[];
 const fetch=network(async(url,init)=>{
  const body=JSON.parse(init.body);calls.push({url,body});
  if(working==='edge'?!url.startsWith(edge):!url.startsWith(gateway))throw new TypeError('Failed to fetch');
  return Response.json({ok:true,order:{id:'11',master_contact_status:'agreed'}});
 });
 await fetch(gateway+'mini-app-api',{method:'POST',body:JSON.stringify({action:'bootstrap'})});
 const before=calls.length,body=payload(action);
 const response=await fetch((working==='edge'?gateway:edge)+'master-workflow-api',{method:'POST',body:JSON.stringify(body),bosReconcileBeforeRetry:true});
 assert.equal((await response.json()).ok,true);
 assert.equal(calls.length,before+1,'exactly one business write');
 assert.equal(calls.at(-1).url,(working==='edge'?edge:gateway)+'master-workflow-api');
 assert.deepEqual(calls.at(-1).body,body);
});
for(const action of actions)test(`${action}: slow contact response is not cut off by the read deadline`,async()=>{
 const calls=[];
 const fetch=network(async(url,init)=>{
  const body=JSON.parse(init.body);calls.push(body.action);
  if(body.action!=='bootstrap')await new Promise(resolve=>setTimeout(resolve,85));
  return Response.json({ok:true,order:{id:'11'}});
 },0.01);
 await fetch(edge+'mini-app-api',{method:'POST',body:JSON.stringify({action:'bootstrap'})});
 const response=await fetch(edge+'master-workflow-api',{method:'POST',body:JSON.stringify(payload(action)),bosReconcileBeforeRetry:true});
 assert.equal((await response.json()).ok,true);
 assert.deepEqual(calls,['bootstrap',action]);
});
for(const failure of ['network','503'])test(`contact result never replays an ambiguous ${failure}`,async()=>{
 let writes=0;
 const fetch=network(async(url,init)=>{
  const body=JSON.parse(init.body);
  if(body.action==='bootstrap')return Response.json({ok:true});
  writes++;
  if(failure==='network')throw new TypeError('Failed to fetch');
  return Response.json({ok:false,error:'UPSTREAM_TIMEOUT'},{status:503});
 });
 await fetch(edge+'mini-app-api',{method:'POST',body:JSON.stringify({action:'bootstrap'})});
 const task=fetch(edge+'master-workflow-api',{method:'POST',body:JSON.stringify(payload('recordContactResult')),bosReconcileBeforeRetry:true});
 if(failure==='network')await assert.rejects(task,/Обновите заявку/);else assert.equal((await task).status,503);
 assert.equal(writes,1);
});
