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
