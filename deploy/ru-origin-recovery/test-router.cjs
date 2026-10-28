const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(process.env.BOS_TEST_BUNDLE,'utf8');
const marker='// Source: network-direct-v86.js\n';
const start=source.indexOf(marker)+marker.length;
assert(start>=marker.length);
const script=source.slice(start,source.indexOf('\n;\n// Source:',start));
const old='https://139.100.237.167', next='https://136.234.17.113';
function context(origin=next, reject=false){
 const calls=[];
 const c={URL,Request,location:{origin,href:origin+'/'},window:{fetch:async(input,init)=>{calls.push([input,init]);if(reject)throw Error('offline');return {ok:true}}}};
 vm.runInNewContext(script,c);
 return {c,calls,rewrite:c.window.BOS_RU_NETWORK.rewrite};
}
test('password login moves from old deployment to current origin',()=>{
 assert.equal(context().rewrite(old+'/api/proxy/password-session-api'),next+'/functions/v1/password-session-api');
});
test('direct API calls and queries use the current origin',()=>{
 for(const api of ['functions','storage','auth','rest'])
  assert.equal(context().rewrite(old+'/'+api+'/v1/resource?x=1'),next+'/'+api+'/v1/resource?x=1');
});
test('legacy gateways, reports and Supabase still route correctly',()=>{
 const {rewrite}=context();
 assert.equal(rewrite('https://business-os-api-gateway.netlify.app/api/proxy/mini-app-api?a=1'),next+'/functions/v1/mini-app-api?a=1');
 assert.equal(rewrite('https://obsropbslfwtanyspjbi.supabase.co/auth/v1/token'),next+'/auth/v1/token');
 assert.equal(rewrite(old+'/api/gas-report?x=1'),next+'/api/gas-report?x=1');
});
test('unrelated paths and deceptive origins stay unchanged',()=>{
 for(const url of [old+'/news',old+'.example/api/proxy/test','https://example.com/functions/v1/test'])assert.equal(context().rewrite(url),url);
});
test('old origin remains compatible',()=>{
 const {rewrite}=context(old);
 assert.equal(rewrite(old+'/api/proxy/mini-app-api'),old+'/functions/v1/mini-app-api');
 assert.equal(rewrite(old+'/auth/v1/token'),old+'/auth/v1/token');
});
test('Request POST keeps body, headers and abort signal, and runs once',async()=>{
 const {c,calls}=context(); const abort=new AbortController();
 const input=new Request(old+'/api/proxy/password-session-api',{method:'POST',headers:{'content-type':'application/json','x-test':'yes'},body:'{"action":"login"}',signal:abort.signal});
 await c.window.fetch(input);
 assert.equal(calls.length,1);const out=calls[0][0];
 assert.equal(out.url,next+'/functions/v1/password-session-api');assert.equal(out.method,'POST');
 assert.equal(out.headers.get('x-test'),'yes');assert.equal(await out.text(),'{"action":"login"}');
 abort.abort();assert.equal(out.signal.aborted,true);
});
test('failed writes never retry or fall back to an old host',async()=>{
 const {c,calls}=context(next,true);
 await assert.rejects(c.window.fetch(old+'/api/proxy/mini-app-api',{method:'POST',body:'write'}),/offline/);
 assert.equal(calls.length,1);assert.equal(calls[0][0],next+'/functions/v1/mini-app-api');
});
