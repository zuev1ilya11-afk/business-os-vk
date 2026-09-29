const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const primary='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e/api/proxy/avito-api';
const reserve='https://business-os-api-gateway.netlify.app/api/proxy/avito-api';
function fixture(respond){const calls=[],window={fetch:async(url,init)=>{calls.push({url,init});return respond(url,init)}};vm.runInNewContext(fs.readFileSync('network-direct-v86.js','utf8'),{window,URL,Request,Response,Headers,AbortController,setTimeout,clearTimeout,location:{href:'https://fixture.invalid/'}});return {fetch:window.fetch,calls};}
const unavailable=()=>Response.json({code:'APP_TEMPORARILY_UNAVAILABLE'},{status:402,headers:{'X-AppDeploy-App-Availability':'temporarily-unavailable'}});
for(const action of ['chats','sendMessage'])test(`Avito ${action}: explicit platform rejection reaches one business handler`,async()=>{
 let business=0;const x=fixture((url,init)=>{if(url.includes('appdeploy.ai'))return unavailable();business++;assert.equal(JSON.parse(init.body).action,action);return Response.json({ok:true})});
 assert.equal((await x.fetch(primary,{method:'POST',body:JSON.stringify({action})})).status,200);assert.equal(x.calls.length,3);assert.equal(business,1);
});
for(const status of [402,429,502,503,504])test(`Avito provider ${status} is returned unchanged without replay`,async()=>{
 const x=fixture(()=>Response.json({ok:false,error:'provider',retry_after:90},{status}));const r=await x.fetch(reserve,{method:'POST',body:'{"action":"sendMessage"}'});
 assert.equal(x.calls.length,1);assert.equal(x.calls[0].url,reserve);assert.equal(r.status,status);assert.equal((await r.json()).retry_after,90);
});
test('Avito uncertain transport failure after platform denial never sends again',async()=>{
 const x=fixture(url=>{if(url===primary)return unavailable();throw new TypeError('network unavailable')});await assert.rejects(x.fetch(primary,{method:'POST',body:'{"action":"sendMessage"}'}));assert.equal(x.calls.length,2);
});
test('Avito preserves Request body, headers and caller abort across safe fallback',async()=>{
 const controller=new AbortController();let business=0;
 const x=fixture((url,init)=>{if(url.includes('appdeploy.ai'))return unavailable();business++;assert.equal(new Headers(init.headers).get('x-bos-session'),'fixture-session');assert.equal(new TextDecoder().decode(init.body),'{"action":"sendMessage"}');assert.ok(init.signal);return Response.json({ok:true})});
 await x.fetch(new Request(primary,{method:'POST',headers:{'X-BOS-Session':'fixture-session'},body:'{"action":"sendMessage"}',signal:controller.signal}));assert.equal(business,1);
 controller.abort();await assert.rejects(x.fetch(primary,{method:'POST',signal:controller.signal,body:'{}'}),{name:'AbortError'});assert.equal(x.calls.length,3);
});
