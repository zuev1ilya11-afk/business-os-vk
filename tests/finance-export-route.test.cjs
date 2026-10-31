const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const primary='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e/api/proxy/mini-app-api';
function network(fetch,scale=1){const window={fetch};vm.runInNewContext(fs.readFileSync('network-direct-v86.js','utf8'),{window,location:{href:'https://app.test/'},URL,Request,Response,Headers,AbortController,setTimeout:(fn,ms)=>setTimeout(fn,ms*scale),clearTimeout});return window.fetch}
const request=action=>({method:'POST',body:JSON.stringify({action,filters:{period:{start:'2026-10-01',end:'2026-10-31'}},revision:'snapshot'}),headers:{'X-BOS-Session':'test'}});
for(const action of ['previewFinanceExport','downloadFinanceExport'])test(`${action} safely retries a remembered gateway 504 and reaches the direct endpoint`,async()=>{
 const calls=[];const fetch=network(async(url,init)=>{
  const a=JSON.parse(init.body).action;calls.push({url,body:init.body});
  if(a==='bootstrap')return url.includes('netlify')?Response.json({ok:true}):Response.json({ok:false},{status:503});
  if(url.includes('supabase'))return new Response(new Uint8Array([80,75,3,4]),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
  return Response.json({error:'UPSTREAM_TIMEOUT'},{status:504});
 });
 await fetch(primary,request('bootstrap'));const before=calls.length,r=await fetch(primary,request(action));
 assert.equal(r.status,200);assert.ok(calls[before].url.includes('netlify'));assert.ok(calls.at(-1).url.includes('supabase'));assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[80,75,3,4]);assert.ok(calls.slice(before).every(c=>c.body===request(action).body));
});
for(const status of [401,403,409])test(`export never retries authoritative status ${status}`,async()=>{
 let calls=0;const fetch=network(async()=>{calls++;return Response.json({ok:false},{status})});assert.equal((await fetch(primary,request('downloadFinanceExport'))).status,status);assert.equal(calls,1);
});
test('slow direct export uses its longer read budget instead of the ordinary 5-second budget',async()=>{
 let calls=0;const fetch=network(async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,80));return Response.json({ok:true})},0.01);
 const r=await fetch('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api',request('previewFinanceExport'));assert.equal(r.status,200);assert.equal(calls,1);
});
