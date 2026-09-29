const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const edge='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/push-api';
const api='https://business-os-api-gateway.netlify.app/api/proxy/push-api';
function network(fetch){const window={fetch};vm.runInNewContext(fs.readFileSync('network-direct-v86.js','utf8'),{window,location:{href:'https://app.test/'},URL,Request,Response,Headers,AbortController,setTimeout,clearTimeout});return window.fetch}
for(const action of ['status','subscribe','revoke','test'])test(`push ${action}: existing gateway service-miss fallback reaches Edge once`,async()=>{
 const calls=[];
 const fetch=network(async(url,init)=>{calls.push({url,init});return url===edge?Response.json({ok:true}):Response.json({ok:false,error:'SERVICE_NOT_ALLOWED'},{status:404})});
 const body=JSON.stringify({action});
 const r=await fetch(api,{method:'POST',headers:{'X-BOS-Session':'signed-session'},body});
 assert.equal(r.status,200);assert.equal(calls.length,4);assert.equal(calls.filter(c=>c.url===edge).length,1);
 for(const c of calls){assert.equal(new Headers(c.init.headers).get('x-bos-session'),'signed-session');assert.equal(c.init.body,body)}
 if(action!=='test'){calls.length=0;await fetch(api,{method:'POST',body});assert.deepEqual(calls.map(c=>c.url),[edge]);}
});
test('push test: uncertain provider-path failure never repeats a possibly queued test',async()=>{
 let calls=0;const fetch=network(async()=>{calls++;throw new TypeError('Failed to fetch')});
 await assert.rejects(fetch(api,{method:'POST',body:'{"action":"test"}'}));assert.equal(calls,1);
});
test('push subscription: an authorization error does not try another service endpoint',async()=>{
 let calls=0;const fetch=network(async()=>{calls++;return Response.json({ok:false,error:'Unauthorized'},{status:401})});
 assert.equal((await fetch(api,{method:'POST',body:'{"action":"subscribe"}'})).status,401);assert.equal(calls,1);
});
