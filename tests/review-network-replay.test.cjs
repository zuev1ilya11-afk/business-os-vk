const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
// These tests replace timers; use the same fixed clock for deadline arithmetic.
function network(fetch,timeout){
 const Clock=class extends Date{static now(){return 0}};
 const window={fetch};vm.runInNewContext(fs.readFileSync('network-direct-v86.js','utf8'),{window,Date:Clock,location:{href:'https://app.test/'},URL,Request,Response,Headers,AbortController,setTimeout:timeout||setTimeout,clearTimeout});return window.fetch;
}
for(const action of ['reviewReport','updateOrder'])for(const failure of ['network','503','timeout'])test(`${action}: ${failure} never replays a possibly committed write`,async()=>{
 let calls=0;const timers=[];
 const fetch=network(async()=>{calls++;if(failure==='network')throw new TypeError('Failed to fetch');if(failure==='503')return new Response('{}',{status:503});return new Promise(()=>{})},(fn,ms)=>{timers.push(ms);if(failure==='timeout')queueMicrotask(fn);return 0});
 const task=fetch('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/order-lifecycle-api',{method:'POST',body:JSON.stringify({action})});
 if(failure==='503')assert.equal((await task).status,503);else await assert.rejects(task,/Обновите заявку/);
 assert.equal(calls,1);if(action==='reviewReport')assert.equal(timers[0],90000);
});
test('deterministic pre-forward gateway denial still permits one working route',async()=>{
 const calls=[];const fetch=network(async url=>{calls.push(url);return calls.length===1?Response.json({ok:false,error:'SERVICE_NOT_ALLOWED'},{status:404}):Response.json({ok:true})});
 assert.equal((await fetch('https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e/api/proxy/mini-app-api',{method:'POST',body:'{"action":"updateOrder"}'})).status,200);assert.equal(calls.length,2);
});

const primary='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e/api/proxy/order-lifecycle-api';
const unavailable=()=>Response.json({code:'APP_TEMPORARILY_UNAVAILABLE',message:'This app is temporarily unavailable. Please try again later. If the problem continues, contact the app’s support team.'},{status:402,headers:{'X-AppDeploy-App-Availability':'temporarily-unavailable'}});
for(const decision of ['rejected','approved'])test(`${decision}: platform pre-forward denials reach one working backend and remember it`,async()=>{
 const calls=[],body=JSON.stringify({action:'reviewReport',id:'11',decision,comment:'Не тот акт',expected_report_token:'r1',expected_report_uploaded_at:'2026-01-01'});
 const fetch=network(async(url,init)=>{calls.push(url);assert.equal(init.body,body);assert.equal(new Headers(init.headers).get('x-bos-session'),'fixture-session');return url.includes('api-v2.appdeploy.ai')?unavailable():Response.json({ok:true})});
 for(let i=0;i<2;i++)assert.equal((await fetch(primary,{method:'POST',headers:{'X-BOS-Session':'fixture-session'},body})).status,200);
 assert.equal(calls.length,4);assert.match(calls[0],/3y8h7e/);assert.match(calls[1],/ukp6ew/);assert.match(calls[2],/netlify/);assert.equal(calls[3],calls[2]);
});
for(const kind of ['generic-402','missing-header','wrong-code','edge'])test(`${kind}: an unproven 402 never replays a write`,async()=>{
 let calls=0;
 const fetch=network(async()=>{calls++;if(kind==='edge')return unavailable();return Response.json({code:kind==='missing-header'?'APP_TEMPORARILY_UNAVAILABLE':'PAYMENT_REQUIRED'},{status:402,headers:kind==='wrong-code'?{'X-AppDeploy-App-Availability':'temporarily-unavailable'}:{}})});
 const url=kind==='edge'?'https://obsropbslfwtanyspjbi.supabase.co/functions/v1/order-lifecycle-api':primary;
 assert.equal((await fetch(url,{method:'POST',body:'{"action":"reviewReport"}'})).status,402);assert.equal(calls,1);
});
for(const failure of ['network','503'])test(`after a platform denial, ${failure} on the next route stops write failover`,async()=>{
 let calls=0;const fetch=network(async()=>{if(++calls===1)return unavailable();if(failure==='network')throw new TypeError('Failed to fetch');return Response.json({error:'UPSTREAM_TIMEOUT'},{status:503})});
 const task=fetch(primary,{method:'POST',body:'{"action":"reviewReport"}'});
 if(failure==='network')await assert.rejects(task,/Обновите заявку/);else assert.equal((await task).status,503);
 assert.equal(calls,2);
});
test('platform denials and an outdated reserve allow direct Supabase without replaying a backend write',async()=>{
 const calls=[];const fetch=network(async url=>{calls.push(url);return url.includes('api-v2.appdeploy.ai')?unavailable():url.includes('netlify')?Response.json({error:'SERVICE_NOT_ALLOWED'},{status:404}):Response.json({ok:true})});
 assert.equal((await fetch(primary,{method:'POST',body:'{"action":"reviewReport"}'})).status,200);
 assert.equal(calls.length,4);assert.match(calls[3],/supabase\.co/);
});

for(const action of ['setStage','finalizeMasterReport'])for(const failure of ['network','503','timeout'])test(`${action}: explicit reconciliation stops hidden transport retries on ${failure}`,async()=>{
 let calls=0;const fetch=network(async()=>{calls++;if(failure==='network')throw new TypeError('Failed to fetch');if(failure==='503')return new Response('{}',{status:503});return new Promise(()=>{})},(fn)=>{if(failure==='timeout')queueMicrotask(fn);return 0});
 const task=fetch('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/master-workflow-api',{method:'POST',body:JSON.stringify({action}),bosReconcileBeforeRetry:true});
 if(failure==='503')assert.equal((await task).status,503);else await assert.rejects(task,/Обновите заявку/);assert.equal(calls,1);
});
