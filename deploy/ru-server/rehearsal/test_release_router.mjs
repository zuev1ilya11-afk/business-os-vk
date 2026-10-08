import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRelease} from './release_router.mjs';
test('gateway readiness works before database services or workers start',async()=>{
 const unexpected=()=>{throw Error('readiness must not start a function or contact a database')};
 const response=await handleRelease(new Request('http://127.0.0.1:19000/__bos_ready'),
   {routes:{},worker:unexpected,fetcher:unexpected,upstreams:{'/auth/v1/':'http://not-started:9999'}});
 assert.equal(response.status,200);
 assert.equal(await response.text(),'{"ready":true}');
});
test('one-off functions blocked, required JWT denied, proxy alias preserved with CORS',async()=>{
 let called=[];const cfg={routes:{'archive-order-2-once':{verify_jwt:false},secure:{verify_jwt:true},open:{verify_jwt:false}},
 secret:'test',worker:async slug=>{called.push(slug);return{fetch:async req=>new Response(await req.text())}}};
 for(const p of ['/functions/v1/archive-order-2-once','/api/proxy/archive-order-2-once'])
  assert.equal((await handleRelease(new Request('https://139.100.237.167'+p),cfg)).status,404);
 assert.equal((await handleRelease(new Request('https://139.100.237.167/functions/v1/secure'),cfg)).status,401);
 const response=await handleRelease(new Request('https://139.100.237.167/api/proxy/open',{method:'POST',body:'content'}),cfg);
 assert.equal(await response.text(),'content');assert.equal(response.headers.get('access-control-allow-origin'),'*');
 assert.deepEqual(called,['open']);
});
