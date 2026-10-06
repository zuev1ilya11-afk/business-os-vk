const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const base='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e/api/proxy/';
function network(fetch){
 const window={fetch};
 vm.runInNewContext(fs.readFileSync('network-direct-v86.js','utf8'),{window,location:{href:'https://app.test/'},URL,Request,Response,Headers,AbortController,setTimeout,clearTimeout});
 return window.fetch;
}
test('report finalization keeps the proven upload route after lifecycle service rewrite',async()=>{
 const calls=[];
 const fetch=network(async(url,init)=>{
  const action=JSON.parse(init.body).action;calls.push({url,action});
  if(url.includes('api-v2.appdeploy.ai'))return Response.json({code:'APP_TEMPORARILY_UNAVAILABLE'},{status:402,headers:{'X-AppDeploy-App-Availability':'temporarily-unavailable'}});
  if(url.includes('netlify'))throw new TypeError('Failed to fetch');
  return Response.json({ok:true});
 });
 await fetch(base+'report-api',{method:'POST',body:JSON.stringify({action:'uploadReportFile'})});
 const before=calls.length;
 // order-lifecycle-v106 rewrites the final report save to this different service.
 assert.equal((await fetch(base+'order-lifecycle-api',{method:'POST',body:JSON.stringify({action:'finalizeMasterReport'}),bosReconcileBeforeRetry:true})).status,200);
 assert.equal(calls.length,before+1);
 assert.match(calls.at(-1).url,/supabase\.co\/functions\/v1\/order-lifecycle-api$/);
});
for(const failure of ['network','503'])test(`a ${failure} on the proven finalization route never replays a write`,async()=>{
 const calls=[];
 const fetch=network(async(url,init)=>{
  const action=JSON.parse(init.body).action;calls.push({url,action});
  if(action==='uploadReportFile'){
   if(!url.includes('supabase'))throw new TypeError('Failed to fetch');
   return Response.json({ok:true});
  }
  if(failure==='network')throw new TypeError('Failed to fetch');
  return Response.json({error:'UPSTREAM_TIMEOUT'},{status:503});
 });
 await fetch(base+'report-api',{method:'POST',body:JSON.stringify({action:'uploadReportFile'})});
 const before=calls.length;
 const task=fetch(base+'order-lifecycle-api',{method:'POST',body:JSON.stringify({action:'finalizeMasterReport'}),bosReconcileBeforeRetry:true});
 if(failure==='network')await assert.rejects(task,/Обновите заявку/);else assert.equal((await task).status,503);
 assert.equal(calls.length,before+1);
 assert.match(calls.at(-1).url,/supabase\.co\/functions\/v1\/order-lifecycle-api$/);
});
