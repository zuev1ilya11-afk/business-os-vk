const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto,createHash}=require('node:crypto');
const {edge,database,employee,token,secret}=require('./helpers/edge.cjs');
const SOURCE=stripTypeScriptTypes(fs.readFileSync('supabase/functions/push-api/index.ts','utf8').replace(/^import .*;\s*$/gm,''),{mode:'transform'});
const endpoint='https://fcm.googleapis.com/fcm/send/device-v211';
const p256dh=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url');
const auth=Buffer.alloc(16,2).toString('base64url'),cap=Buffer.alloc(32,3).toString('base64url');
const hash=createHash('sha256').update(cap).digest('hex');
const sub={endpoint,keys:{p256dh,auth}};
const workerKey='a'.repeat(64);
function fixture(options={}){
 const owner=employee('owner','owner'),db=database({business_staff:[owner,employee('m1'),employee('disabled','master',{is_active:false})],bos_push_subscriptions:[]});
 const cfg={enabled:true,publicKey:'public-not-a-secret',privateKey:'private-test-sentinel',workerKey,...options.cfg};
 const calls=[],prepared=[],sent=[];
 db.rpc=async(name,p)=>{calls.push({name,p});if(options.rpc){const value=await options.rpc(name,p);if(value!==undefined)return {data:value,error:null}}
  const defaults={bos_push_runtime:cfg,bos_push_subscribe:{id:'device',binding_id:'binding'},bos_push_test:{queued:true},bos_push_revoke:true,bos_push_claim:[],bos_push_delivery:null,bos_push_finish:null};
  if(!(name in defaults))throw Error('Unexpected RPC '+name);return {data:defaults[name],error:null};};
 let handler;
 const webpush={generateVAPIDKeys(){throw Error('Unexpected key generation')},generateRequestDetails(s,p,o){prepared.push({s,p:JSON.parse(p),o});return {endpoint:s.endpoint,headers:{'Content-Encoding':'aes128gcm'},body:Buffer.from('encrypted-only')}}};
 vm.runInNewContext(SOURCE,{createClient:()=>db,webpush,Deno:{env:{get:k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'server-test-key',VK_APP_SECRET:secret}[k])},serve:fn=>handler=fn},crypto:webcrypto,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,btoa,atob,AbortController,setTimeout,clearTimeout,fetch:async(url,init)=>{sent.push({url,init});return options.fetch?options.fetch(url,init):new Response(null,{status:201})}});
 const invoke=async(body,session=token('100'),extra={})=>{const r=await handler(new Request('https://test.invalid',{method:extra.method||'POST',headers:{'Content-Type':'application/json','X-BOS-Session':session,...extra.headers},body:extra.method==='OPTIONS'?undefined:typeof body==='string'?body:JSON.stringify(body)}));return {status:r.status,body:r.status===204?null:await r.json(),headers:r.headers}};
 return {db,cfg,calls,prepared,sent,invoke};
}
test('push: rejects missing, forged, expired, excessive-lifetime and launch-only authentication',async()=>{
 for(const session of ['',token('100').slice(0,-1)+'!',token('100',0),token('100',Math.floor(Date.now()/1000)+86400*366)]){
  const f=fixture();assert.equal((await f.invoke({action:'subscribe',subscription:sub,revoke_token:cap},session, {headers:{'X-VK-Launch-Params':'vk_user_id=100&sign=untrusted'}})).status,401);assert.equal(f.calls.length,0);
 }
});
for(const role of ['owner','manager','dispatcher','master']){
 test(`push: ${role} login and refresh tokens work for status, subscribe and test`,async()=>{
  const actor=employee('login-'+role,role),f=fixture();
  f.db.tables.business_staff=[actor];
  const issuer=edge('password-session-api',database({business_staff:[actor]}));
  const login=await issuer({action:'login',login:actor.login,password:actor.password_hash});
  assert.equal(login.status,200);
  assert(Number(login.body.session_token.split('.')[1])-Math.floor(Date.now()/1000)>86400*364);
  const refreshed=await issuer({action:'refresh'},actor.external_id,login.body.session_token);
  assert.equal(refreshed.status,200);
  for(const session of [login.body.session_token,refreshed.body.session_token]){
   for(const body of [{action:'status'},{action:'subscribe',subscription:sub,revoke_token:cap},{action:'test',endpoint,revoke_token:cap}]){
    const result=await f.invoke(body,session);
    assert.equal(result.status,200,`${role}: ${body.action}`);
    if(body.action!=='test')assert.equal(result.body.account,actor.external_id);
   }
   const before=f.calls.length;
   assert.equal((await f.invoke({action:'status'},session.slice(0,-1)+'!')).status,401);
   assert.equal(f.calls.length,before,'invalid signatures never read push configuration');
  }
  for(const call of f.calls.filter(c=>['bos_push_subscribe','bos_push_test'].includes(c.name))){
   assert.equal(call.p.p_staff,actor.id);
   if(call.name==='bos_push_subscribe')assert.equal(call.p.p_external,actor.external_id);
  }
  actor.is_active=false;
  assert.equal((await f.invoke({action:'status'},login.body.session_token)).status,403);
 });
}
test('push: inactive or unknown staff rejected before accessing configuration',async()=>{
 for(const uid of ['staff_disabled','unknown']){const f=fixture();assert.equal((await f.invoke({action:'status'},token(uid))).status,403);assert.equal(f.calls.length,0)}
});
test('push: subscribe takes actor solely from verified BOS session and hashes revocation capability',async()=>{
 const f=fixture();const r=await f.invoke({action:'subscribe',subscription:sub,revoke_token:cap,user_id:'owner',staff_id:'owner',acting_master_vk_id:'100'},token('staff_m1'));
 assert.equal(r.status,200);const p=f.calls.find(c=>c.name==='bos_push_subscribe').p;assert.equal(p.p_staff,'m1');assert.equal(p.p_external,'staff_m1');assert.equal(p.p_revoke_hash,hash);assert.equal(p.p_auth,auth);
 assert(!JSON.stringify(r.body).includes('private-test'));assert.equal(r.body.account,'staff_m1');
});
test('push: rejects SSRF, redirects, credentials, non-HTTPS, unsupported providers, query strings and malformed keys',async()=>{
 for(const url of ['http://fcm.googleapis.com/fcm/send/a','https://localhost/a','https://127.0.0.1/a','https://fcm.googleapis.com.attacker.invalid/fcm/send/a','https://u:p@fcm.googleapis.com/fcm/send/a','https://fcm.googleapis.com:8443/fcm/send/a',endpoint+'?url=evil',endpoint+'#fragment','https://web.push.apple.com/../evil/path']){
  const f=fixture();assert.equal((await f.invoke({action:'subscribe',subscription:{...sub,endpoint:url},revoke_token:cap})).status,400,url);assert(!f.calls.some(c=>c.name==='bos_push_subscribe'));
 }
 for(const keys of [{p256dh:'x',auth},{p256dh,auth:'x'},{p256dh:Buffer.alloc(65).toString('base64url'),auth}])assert.equal((await fixture().invoke({action:'subscribe',subscription:{endpoint,keys},revoke_token:cap})).status,400);
});
test('push: accepts only known Chromium, Firefox and Apple endpoint shapes',async()=>{
 for(const url of [endpoint,'https://fcm.googleapis.com/wp/abc:def_123','https://updates.push.services.mozilla.com/wpush/v2/abc_123','https://web.push.apple.com/abc-123'])assert.equal((await fixture().invoke({action:'subscribe',subscription:{...sub,endpoint:url},revoke_token:cap})).status,200,url);
});
test('push: status scopes device to actor and never serializes signing material or endpoints',async()=>{
 const f=fixture();f.db.tables.bos_push_subscriptions.push({id:'other',staff_id:'m1',external_id:'staff_m1',endpoint,binding_id:'binding',active:true,expires_at:new Date(Date.now()+86400000).toISOString()});
 const r=await f.invoke({action:'status',endpoint});assert.equal(r.status,200);assert.equal(r.body.connected,false);assert.equal(r.body.device,null);assert.equal(r.body.public_key,f.cfg.publicKey);
 for(const value of ['private-test',workerKey,endpoint,cap])assert(!JSON.stringify(r.body).includes(value));
});
test('push: capability revocation works after logout, cannot send or read',async()=>{
 const f=fixture();const r=await f.invoke({action:'revoke',endpoint,revoke_token:cap},'');assert.equal(r.status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'bos_push_revoke');assert.equal(f.calls[0].p.p_revoke_hash,hash);
 assert.equal((await f.invoke({action:'test',endpoint,revoke_token:cap},'')).status,401);
 assert.equal((await f.invoke({action:'revoke',endpoint,revoke_token:'bad'},'')).status,400);
});
test('push: test rate limit, missing device, subscription limit and conflict are explicit',async()=>{
 for(const [name,value,action,status] of [['bos_push_test',{limited:true},'test',429],['bos_push_test',{missing:true},'test',409],['bos_push_subscribe',{limit:true},'subscribe',409],['bos_push_subscribe',{conflict:true},'subscribe',409]]){
  const f=fixture({rpc:n=>n===name?value:undefined});assert.equal((await f.invoke({action,endpoint,subscription:sub,revoke_token:cap})).status,status);
 }
});
test('push: disabled server does not allow subscription or test',async()=>{const f=fixture({cfg:{enabled:false}});assert.equal((await f.invoke({action:'test',endpoint,revoke_token:cap})).status,503);assert(!f.calls.some(c=>c.name==='bos_push_test'))});
test('push: worker requires separate secret, neither BOS nor fake bearer suffices',async()=>{
 for(const bearer of ['',token('100'),'b'.repeat(64)]){const f=fixture();assert.equal((await f.invoke({action:'worker'},token('100'),{headers:{Authorization:'Bearer '+bearer}})).status,401);assert.equal(f.sent.length,0);assert(!f.calls.some(c=>c.name==='bos_push_claim'))}
});
function delivery(){return {event_id:'a1111111-1111-4111-8111-111111111111',binding_id:'b1111111-1111-4111-8111-111111111111',event_type:'assigned',order_id:'123',endpoint,p256dh,auth,expires_at:new Date(Date.now()+600000).toISOString(),phone:'sensitive-phone',address:'sensitive-address',amount:9999}}
function workerFixture(row=delivery(),extra={}){return fixture({...extra,rpc:n=>n==='bos_push_claim'?[{id:'delivery',lease_token:'lease'}]:n==='bos_push_delivery'?row:undefined})}
const runWorker=f=>f.invoke({action:'worker'},'',{headers:{Authorization:'Bearer '+workerKey}});
test('push: worker rechecks authorization and binding before sending; stale rows discarded',async()=>{const f=workerFixture(null);await runWorker(f);assert.equal(f.sent.length,0);assert.equal(f.calls.at(-1).p.p_retry,false);assert.equal(f.calls.at(-1).p.p_status,0)});
test('push: encryption boundary gets only minimal payload, bounded TTL, stable topic and no redirect following',async()=>{
 const f=workerFixture();const r=await runWorker(f);assert.equal(r.status,200);assert.equal(r.body.accepted,1);assert.equal(f.sent.length,1);assert.equal(f.sent[0].init.redirect,'error');assert.equal(Buffer.from(f.sent[0].init.body).toString(),'encrypted-only');
 const p=f.prepared[0];assert.equal(p.p.order_id,'123');assert(!JSON.stringify(p.p).includes('sensitive'));assert.equal(p.o.contentEncoding,'aes128gcm');assert(p.o.TTL>0&&p.o.TTL<=600);assert.equal(p.o.topic.length,32);assert.equal(f.calls.at(-1).p.p_lease,'lease');
});
test('push: invalid stored provider or expired payload is not sent',async()=>{for(const changes of [{endpoint:'https://127.0.0.1/private'},{expires_at:'2000-01-01T00:00:00Z'}]){const f=workerFixture({...delivery(),...changes});await runWorker(f);assert.equal(f.sent.length,0)}});
test('push: provider 410 invalidation, bounded transient retry and non-retryable 403 classification',async()=>{
 for(const [status,retry] of [[410,false],[404,false],[403,false],[429,true],[503,true]]){const f=workerFixture(delivery(),{fetch:async()=>new Response(null,{status})});await runWorker(f);assert.equal(f.calls.at(-1).p.p_status,status);assert.equal(f.calls.at(-1).p.p_retry,retry)}
});
test('push: network error retries without exposing endpoint or credentials',async()=>{const f=workerFixture(delivery(),{fetch:async()=>{throw Error('private-test-sentinel')}});const r=await runWorker(f);assert.equal(f.calls.at(-1).p.p_retry,true);assert(!JSON.stringify(r.body).includes('private-test'))});
test('push: body limit and malformed JSON fail before any database access',async()=>{
 for(const [body,status] of [['x'.repeat(8193),413],['{oops',400],['null',400],['[]',400]]){const f=fixture();assert.equal((await f.invoke(body)).status,status);assert.equal(f.db.calls.length,0);assert.equal(f.calls.length,0)}
});
test('push: internal errors masked; preflight exposes only intended headers',async()=>{
 const f=fixture({rpc:()=>{throw Error('private-test-sentinel SQL secret')}});const r=await f.invoke({action:'status'});assert.equal(r.status,500);assert(!JSON.stringify(r.body).includes('SQL'));assert(!JSON.stringify(r.body).includes('private-test'));
 const p=await f.invoke('', '',{method:'OPTIONS',headers:{Origin:'https://zuev1ilya11-afk.github.io'}});assert.equal(p.status,204);assert.equal(p.headers.get('access-control-allow-origin'),'https://zuev1ilya11-afk.github.io');
});
