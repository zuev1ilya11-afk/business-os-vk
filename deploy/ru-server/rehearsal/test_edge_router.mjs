import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {authorize, handle} from './edge_router.mjs';
const secret='synthetic-test-key';
const routes={secure:{verify_jwt:true},open:{verify_jwt:false}};
function token(payload,alg='HS256') {
  const data=[{alg,typ:'JWT'},payload].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');
}
const req=(path,auth,method='POST')=>new Request('http://127.0.0.1:9000'+path,{method,headers:auth?{authorization:'Bearer '+auth}:{}});
test('required JWT rejects absent invalid expired and other algorithms before worker creation',async()=>{
  let created=0;
  const config={routes,secret,worker:async()=>{created++;throw Error('must not run')}};
  for(const auth of [null,'bad',token({exp:1}),token({exp:9999999999},'none'),token({exp:9999999999})+'x']){
    assert.equal((await handle(req('/functions/v1/secure',auth),config)).status,401);
  }
  assert.equal(created,0);
});
test('JWT policy preserves open and OPTIONS; valid HS256 passes and future nbf fails',async()=>{
  assert.equal(await authorize(req('/'),routes.open,secret),true);
  assert.equal(await authorize(req('/',null,'OPTIONS'),routes.secure,secret),true);
  assert.equal(await authorize(req('/',token({exp:9999999999})),routes.secure,secret),true);
  assert.equal(await authorize(req('/',token({exp:9999999999,nbf:9999999998})),routes.secure,secret),false);
});
test('unknown paths never create workers; named handler gets original request and returns response',async()=>{
  let called=[];
  const worker=async slug=>{called.push(slug);return {fetch:async r=>new Response(new URL(r.url).pathname)}};
  for(const path of ['/functions/v1/nope','/functions/v1/%2e%2e/secure','/functions/v1/open%2fsecure','/admin']){
    assert.equal((await handle(req(path),{routes,secret,worker})).status,404);
  }
  assert.deepEqual(called,[]);
  const r=await handle(req('/functions/v1/open'),{routes,secret,worker});
  assert.equal(await r.text(),'/functions/v1/open');assert.deepEqual(called,['open']);
});
test('gateway uses only fixed loopback upstream, preserves body/path/query and refuses redirects',async()=>{
  let captured;
  const fetcher=async r=>{captured=r;return new Response('upstream')};
  const r=await handle(new Request('http://127.0.0.1:9000/rest/v1/orders?limit=1',{method:'POST',body:'{}'}),{routes,secret,fetcher});
  assert.equal(await r.text(),'upstream');assert.equal(captured.url,'http://127.0.0.1:3000/orders?limit=1');
  assert.equal(await captured.text(),'{}');assert.equal(captured.redirect,'error');
});
