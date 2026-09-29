const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const primary='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e/api/proxy/';
function fixture(){
 const calls=[],timers=new Map();let timerId=0;
 const window={fetch:async(url,init)=>{
  calls.push(url);
  if(url.includes('appdeploy.ai'))return Response.json({code:'APP_TEMPORARILY_UNAVAILABLE'},{status:402,headers:{'X-AppDeploy-App-Availability':'temporarily-unavailable'}});
  if(url.includes('netlify')){queueMicrotask(()=>[...timers.values()].at(-1)());return new Promise(()=>{})}
  return Response.json({ok:true});
 }};
 const Clock=class extends Date{static now(){return 0}};
 vm.runInNewContext(fs.readFileSync('network-direct-v86.js','utf8'),{window,Date:Clock,location:{href:'https://app.test/'},URL,Request,Response,Headers,AbortController,setTimeout:fn=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id)});
 return {fetch:window.fetch,calls};
}
for(const [service,action] of [['staff-admin-api','listStaff'],['integration-api','listIntegrations'],['integration-api','testMapping'],['integration-api','listOrders'],['integration-api','getOrder']])test(`${service}/${action} reaches direct after explicit denials and stalled reserve`,async()=>{
 const {fetch,calls}=fixture();
 assert.equal((await fetch(primary+service,{method:'POST',body:JSON.stringify({action})})).status,200);
 assert.equal(calls.length,4);assert.match(calls[3],/supabase\.co/);
});
for(const action of ['setCredentials','createIntegration','upsertOrder','unknownWrite'])test(`${action} never replays an uncertain reserve write`,async()=>{
 const {fetch,calls}=fixture();
 await assert.rejects(fetch(primary+'integration-api',{method:'POST',body:JSON.stringify({action})}),/Обновите заявку/);
 assert.equal(calls.length,3);
});
