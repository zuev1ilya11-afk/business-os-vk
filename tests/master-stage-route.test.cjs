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
test('setStage uses the working bootstrap route without a write to failed gateways',async()=>{
 const calls=[];
 const fetch=network(async(url,init)=>{
  const body=JSON.parse(init.body);calls.push({url,body});
  if(!url.includes('supabase'))throw new TypeError('Failed to fetch');
  return Response.json({ok:true,order:{id:1,master_workflow_stage:'started'}});
 });
 await fetch(base+'mini-app-api',{method:'POST',body:JSON.stringify({action:'bootstrap'})});
 const before=calls.length;
 const response=await fetch(base+'master-workflow-api',{method:'POST',body:JSON.stringify({action:'setStage',id:1,stage:'started'}),bosReconcileBeforeRetry:true});
 assert.equal((await response.json()).order.master_workflow_stage,'started');
 assert.equal(calls.length,before+1);
 assert.match(calls.at(-1).url,/supabase\.co\/functions\/v1\/master-workflow-api$/);
 assert.deepEqual(calls.at(-1).body,{action:'setStage',id:1,stage:'started'});
});
for(const failure of ['network','503'])test(`setStage never replays an uncertain ${failure} on the bootstrap route`,async()=>{
 const calls=[];
 const fetch=network(async(url,init)=>{
  const body=JSON.parse(init.body);calls.push({url,body});
  if(body.action==='bootstrap'){
   if(!url.includes('supabase'))throw new TypeError('Failed to fetch');
   return Response.json({ok:true});
  }
  if(failure==='network')throw new TypeError('Failed to fetch');
  return Response.json({error:'UPSTREAM_TIMEOUT'},{status:503});
 });
 await fetch(base+'mini-app-api',{method:'POST',body:JSON.stringify({action:'bootstrap'})});
 const before=calls.length;
 const task=fetch(base+'master-workflow-api',{method:'POST',body:JSON.stringify({action:'setStage',id:1,stage:'started'}),bosReconcileBeforeRetry:true});
 if(failure==='network')await assert.rejects(task,/Обновите заявку/);else assert.equal((await task).status,503);
 assert.equal(calls.length,before+1);
 assert.match(calls.at(-1).url,/supabase\.co\/functions\/v1\/master-workflow-api$/);
});
