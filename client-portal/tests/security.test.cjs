'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {setupStaging}=require('../staging/setup.cjs');
const {createPortal,configCheck}=require('../server/api.cjs');
let stage,handle,temporary;
let phoneSequence=2001;
const nextPhone=()=>'+7999000'+String(++phoneSequence);
before(async()=>{
 temporary=await fs.mkdtemp(path.join(os.tmpdir(),'bos-client-security-'));
 stage=await setupStaging({dataDir:path.join(temporary,'db'),privateDir:path.join(temporary,'private')});
 const portal=await createPortal({db:stage.db,config:stage.config});handle=typeof portal==='function'?portal:portal.handle;
});
after(async()=>{if(stage)await stage.close();if(temporary)await fs.rm(temporary,{recursive:true,force:true})});
async function call(route,{method='GET',body,session,headers={},noOrigin=false,ip}={}){
 const request=new Request(stage.config.origin+'/client-api'+route,{method,headers:{
  ...(noOrigin?{}:{Origin:stage.config.origin}),...(body===undefined?{}:{'content-type':'application/json'}),
  ...(session?{Cookie:session.cookie,'x-csrf-token':session.csrf}:{}),...headers
 },...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(ip)request.portalClientIp=ip;
 const response=await handle(request);
 const contentType=response.headers.get('content-type')||'';
 return {response,status:response.status,body:contentType.includes('json')?await response.json():null};
}
async function challenge(phone=nextPhone()){
 const result=await call('/auth/request',{method:'POST',body:{phone}});
 assert.equal(result.status,200);
 const file=path.join(stage.config.privateDir,'otp',result.body.challenge_id+'.json');
 const outbox=JSON.parse(await fs.readFile(file,'utf8'));
 return {...result,phone,file,id:result.body.challenge_id,code:outbox.code};
}
function consents(){return stage.config.legalDocuments.filter(d=>d.required).map(d=>({document:d.document,version:d.version}))}
async function verify(c){return call('/auth/verify',{method:'POST',body:{challenge_id:c.id,code:c.code,consents:consents()}})}
async function login(phone){const c=await challenge(phone);const result=await verify(c);assert.equal(result.status,200);return {cookie:result.response.headers.get('set-cookie').split(';')[0],csrf:result.body.csrf_token,profile:result.body.profile,result,challenge:c}}
function staffToken(id='stage_owner') {const text=id+'.'+(Math.floor(Date.now()/1000)+3600);return text+'.'+crypto.createHmac('sha256',stage.config.staffSecret).update(text).digest('base64url')}

test('OTP is private, normalized, random, expires and cannot be reused',async()=>{
 const a=await challenge('8 (999) 000-20-01');
 assert.equal(Object.hasOwn(a.body,'code'),false);
 const file=JSON.parse(await fs.readFile(a.file,'utf8'));
 assert.equal(file.phone,'+79990002001');
 assert.ok(/^\d{6}$/.test(file.code));
 assert.equal((await fs.stat(a.file)).mode&0o777,0o600);
 const first=await verify(a);assert.equal(first.status,200);
 const reused=await verify(a);assert.equal(reused.status,400);assert.equal(reused.body.code,'INVALID_CODE');
 const b=await challenge();
 await stage.db.query("update client_otps set expires_at=now()-interval '1 second' where id=$1",[b.id]);
 const expired=await verify(b);assert.equal(expired.status,400);assert.equal(expired.body.code,'INVALID_CODE');
});

test('OTP wrong attempts and resend delay persist even when the API rejects requests',async()=>{
 const c=await challenge();
 assert.equal((await call('/auth/request',{method:'POST',body:{phone:c.phone}})).status,429);
 for(let i=0;i<5;i++){
  const wrong=await call('/auth/verify',{method:'POST',body:{challenge_id:c.id,code:'000000',consents:consents()}});
  assert.equal(wrong.status,400);
 }
 const attempts=(await stage.db.query('select attempts from client_otps where id=$1',[c.id])).rows[0].attempts;
 assert.equal(attempts,5);
 assert.equal((await verify(c)).status,400);
});

test('cookie is scoped and HttpOnly; state changes require matching origin and CSRF',async()=>{
 const a=await login();
 const cookie=a.result.response.headers.get('set-cookie');
 assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Path=\/client-api/);assert.doesNotMatch(cookie,/Domain=/i);
 assert.equal(a.result.response.headers.get('cache-control'),'no-store');
 const payload={version:a.profile.version,name:'Тест'};
 for(const headers of [{'x-csrf-token':''},{Origin:'https://untrusted.example'}]){
  const result=await call('/profile',{method:'PATCH',body:payload,session:a,headers});assert.equal(result.status,403);
 }
 assert.equal((await call('/profile',{method:'PATCH',body:payload,session:a,noOrigin:true})).status,403);
 assert.equal((await call('/profile',{method:'PATCH',body:payload,session:a})).status,200);
});

test('client body cannot create staff privileges, set final price or rewrite verified phone',async()=>{
 const a=await login();
 const before=(await stage.db.query('select count(*)::int as n from business_staff')).rows[0].n;
 for(const injected of [{role:'owner'},{client_id:a.profile.id},{phone:'+79990009999'}]){
  const r=await call('/profile',{method:'PATCH',session:a,body:{version:a.profile.version,name:'Тест',...injected}});assert.equal(r.status,400);
 }
 const order=await call('/orders',{method:'POST',session:a,body:{request_id:crypto.randomUUID(),name:'Тест',address:'Синтетический адрес',description:'Тест',items:[],amount:1}});assert.equal(order.status,400);
 assert.equal((await stage.db.query('select count(*)::int as n from business_staff')).rows[0].n,before);
 assert.equal((await call('/staff/orders',{session:a})).status,401);
});

test('staff endpoint denies unknown/inactive roles and does not trust a body role',async()=>{
 const id=crypto.randomUUID();
 await stage.db.query("insert into business_staff(id,external_id,full_name,role,is_active) values($1,'stage_unrecognized','Тест','client',true)",[id]);
 const r=await call('/staff/orders',{headers:{'x-bos-session':staffToken('stage_unrecognized')}});assert.equal(r.status,403);
 await stage.db.query('update business_staff set role=$1,is_active=false where id=$2',['owner',id]);
 assert.equal((await call('/staff/orders',{headers:{'x-bos-session':staffToken('stage_unrecognized')}})).status,403);
});

test('logout all devices revokes both stored sessions and rejects old mutations',async()=>{
 const a=await login();
 await stage.db.query("update client_otps set created_at=now()-interval '2 minutes' where phone=$1",[a.profile.phone]);
 const b=await login(a.profile.phone);
 assert.equal((await call('/auth/logout',{method:'POST',session:a,body:{all_devices:true}})).status,200);
 for(const session of [a,b]){
  const status=await call('/session',{session});assert.equal(status.body.authenticated,false);
  assert.equal((await call('/addresses',{method:'POST',session,body:{label:'Дом',address:'Тест'}})).status,401);
 }
});

test('a stale client session cannot initiate phone change; profile route never bypasses reauthentication',async()=>{
 const a=await login();
 await stage.db.query("update client_sessions set created_at=now()-interval '6 minutes' where account_id=$1",[a.profile.id]);
 const result=await call('/auth/phone/request',{method:'POST',session:a,body:{phone:nextPhone()}});
 assert.equal(result.status,409);assert.equal(result.body.code,'REAUTH_REQUIRED');
});

test('client tables are not directly available to anonymous or generic authenticated database roles',async()=>{
 for(const role of ['anon','authenticated']){
  await stage.db.exec('SET ROLE '+role);
  try{await assert.rejects(stage.db.query('select * from client_accounts'));await assert.rejects(stage.db.query('select * from client_sessions'));}
  finally{await stage.db.exec('RESET ROLE')}
 }
});

test('production refuses test delivery, draft documents and missing operator details',async()=>{
 const base={...stage.config,environment:'production',origin:'https://client.example',isolated:false};
 await assert.rejects(createPortal({db:stage.db,config:base}));
 await assert.rejects(createPortal({db:stage.db,config:{...base,smsTransport:'gateway',smsGatewayUrl:'https://sms.example/send',smsGatewayToken:'synthetic'}}));
 await assert.rejects(createPortal({db:stage.db,config:{...base,smsTransport:'gateway',smsGatewayUrl:'https://sms.example/send',smsGatewayToken:'synthetic',legalDocuments:base.legalDocuments.map(d=>({...d,reviewed:true,version:'v1'}))}}));
});

test('production requires the complete document set and actual text, not only a readiness flag',async()=>{
 const base={...stage.config,environment:'production',origin:'https://client.example',isolated:false,
  smsTransport:'gateway',smsGatewayUrl:'https://sms.example/send',smsGatewayToken:'synthetic',
  smsDailyLimit:2,smsBudgetKopecks:200,smsCostKopecks:100,
  operator:{legal_name:'Synthetic test operator',inn:'synthetic',address:'Synthetic',privacy_email:'test@example.invalid'},
  legalDocuments:stage.config.legalDocuments.map(d=>({...d,status:'published',reviewed:true,version:'review-fixture-v1',body:'Synthetic test document '+d.document}))};
 assert.doesNotThrow(()=>configCheck(base));
 for(const document of ['privacy','terms','services','personal-data']){
  assert.throws(()=>configCheck({...base,legalDocuments:base.legalDocuments.filter(d=>d.document!==document)}));
  assert.throws(()=>configCheck({...base,legalDocuments:base.legalDocuments.map(d=>d.document===document?{...d,body:''}:d)}));
 }
 assert.throws(()=>configCheck({...base,operator:null}));
 assert.throws(()=>configCheck({...base,smsTransport:'test'}));
 assert.throws(()=>configCheck({...base,smsBudgetKopecks:100}));
});

test('accepted document text cannot be silently replaced under its existing version',async()=>{
 const changed=stage.config.legalDocuments.map(d=>d.document==='terms'?{...d,body:d.body+'\nChanged text'}:d);
 await assert.rejects(createPortal({db:stage.db,config:{...stage.config,legalDocuments:changed}}),/new version/);
 const archived=(await stage.db.query('select body_hash from client_document_versions where document=$1 and version=$2',['terms','draft-2026-11-05'])).rows;
 assert.equal(archived.length,1);
});

test('images are decoded, reencoded without metadata, and downloadable only by their owner or staff',async()=>{
 const {createRequire}=require('node:module');
 let sharp;try{sharp=require('sharp')}catch{sharp=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','_security.cjs'))('sharp')}
 const a=await login(),b=await login();
 const made=await call('/orders',{method:'POST',session:a,body:{request_id:crypto.randomUUID(),name:'Тест',address:'Тестовый адрес',description:'Проверка файла',items:[]}});
 assert.equal(made.status,200);const id=made.body.order.id;
 const input=await sharp({create:{width:2,height:2,channels:3,background:'#223344'}}).png().withMetadata({exif:{IFD0:{Artist:'Private metadata'}}}).toBuffer();
 const body={name:'фото.png',mime:'image/png',data_base64:input.toString('base64')};
 assert.equal((await call('/orders/'+id+'/attachments',{method:'POST',session:b,body})).status,404);
 const disguised=await call('/orders/'+id+'/attachments',{method:'POST',session:a,body:{...body,data_base64:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')}});
 assert.equal(disguised.status,400);
 const uploaded=await call('/orders/'+id+'/attachments',{method:'POST',session:a,body});
 assert.equal(uploaded.status,200);assert.equal(uploaded.body.attachment.mime,'image/webp');
 const url=uploaded.body.attachment.url.replace('/client-api','');
 assert.equal((await call(url,{session:b})).status,404);
 assert.equal((await call(url)).status,401);
 const own=await handle(new Request(stage.config.origin+'/client-api'+url,{headers:{Cookie:a.cookie}}),{ip:'127.0.0.1'});
 assert.equal(own.status,200);assert.match(own.headers.get('cache-control'),/no-store/);assert.match(own.headers.get('content-security-policy'),/sandbox/);
 const output=Buffer.from(await own.arrayBuffer());const metadata=await sharp(output).metadata();
 assert.equal(metadata.format,'webp');assert.equal(metadata.exif,undefined);assert.equal(metadata.xmp,undefined);
 const asStaff=await call('/staff'+url,{headers:{'x-bos-session':staffToken()}});assert.equal(asStaff.status,200);
});

test('legacy staff price edits invalidate the effective agreement without erasing accepted history',async()=>{
 const a=await login();
 const made=await call('/orders',{method:'POST',session:a,body:{request_id:crypto.randomUUID(),name:'Тест',address:'Синтетический адрес',description:'Полка',items:[]}});
 assert.equal(made.status,200);const id=made.body.order.id;
 const proposed=await call('/staff/orders/'+id+'/estimates',{method:'POST',headers:{'x-bos-session':staffToken()},body:{version:made.body.order.version,items:[{name:'Тестовая работа',unit:'шт.',quantity:1,unit_price:100}],conditions:'Синтетический расчёт'}});
 assert.equal(proposed.status,200);
 const accepted=await call('/orders/'+id+'/estimate/accept',{method:'POST',session:a,body:{version:proposed.body.order.estimate.version}});
 assert.equal(accepted.status,200);const acceptedAt=accepted.body.order.estimate.accepted_at;
 await stage.db.query('update orders set amount=210,original_amount=210,updated_at=now() where id=$1',[id]);
 const changed=await call('/orders/'+id,{session:a});
 assert.equal(changed.body.order.price_review_required,true);
 assert.equal(changed.body.order.estimate.current,false);
 assert.equal(changed.body.order.estimate.accepted_at,acceptedAt);
 assert.equal(changed.body.order.estimate.total,100);
 assert.ok(changed.body.order.events.some(e=>e.type==='price'));
 assert.equal((await call('/orders/'+id+'/estimate/accept',{method:'POST',session:a,body:{version:1}})).status,409);
 const replacement=await call('/staff/orders/'+id+'/estimates',{method:'POST',headers:{'x-bos-session':staffToken()},body:{version:changed.body.order.version,items:[{name:'Тестовая работа',unit:'шт.',quantity:1,unit_price:210}],conditions:'Новая синтетическая версия'}});
 assert.equal(replacement.status,200);
 const confirmed=await call('/orders/'+id+'/estimate/accept',{method:'POST',session:a,body:{version:replacement.body.order.estimate.version}});
 assert.equal(confirmed.status,200);assert.equal(confirmed.body.order.price_review_required,false);
 assert.equal((await stage.db.query('select count(*)::int as n from client_estimates where order_id=$1 and accepted_at is not null',[id])).rows[0].n,2);
});

test('manual linking retains old source and finance while excluding internal notes and metadata',async()=>{
 const a=await login();
 const stored=(await stage.db.query("insert into orders(client,phone,address,work,comment,report_review_comment,work_items,source,external_source,external_id,amount,original_amount,master_payout) values($1,$2,$3,$4,$5,$6,$7,'Руки','hands',$8,900,900,497.25) returning id,client_portal_revision",['Синтетический клиент',a.profile.phone,'Тестовый адрес','Монтаж карниза','private-internal-note','private-review-note',JSON.stringify([{name:'Карниз',quantity:1,unit:'шт.',unit_price:900,amount:900,internal_payroll:'private-payroll'}]),'hands:synthetic-'+crypto.randomUUID()])).rows[0];
 const id=String(stored.id);
 assert.equal((await call('/orders/'+id,{session:a})).status,404);
 const linked=await call('/staff/orders/'+id+'/link',{method:'POST',headers:{'x-bos-session':staffToken()},body:{version:stored.client_portal_revision,client_id:a.profile.id,verification_note:'Проверено по синтетическому документу для теста'}});
 assert.equal(linked.status,200);
 const client=await call('/orders/'+id,{session:a});assert.equal(client.status,200);
 const serialized=JSON.stringify(client.body);
 for(const secret of ['private-internal-note','private-review-note','private-payroll','497.25'])assert.equal(serialized.includes(secret),false);
 const preserved=(await stage.db.query('select source,external_source,amount,master_payout from orders where id=$1',[id])).rows[0];
 assert.equal(preserved.source,'Руки');assert.equal(preserved.external_source,'hands');assert.equal(Number(preserved.amount),900);assert.equal(Number(preserved.master_payout),497.25);
 assert.equal((await stage.db.query('select count(*)::int as n from client_link_audit where order_id=$1',[id])).rows[0].n,1);
});

test('general chat photos cannot cross accounts or threads, and attaching them is one-time and idempotent',async()=>{
 const {createRequire}=require('node:module');
 let sharp;try{sharp=require('sharp')}catch{sharp=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','_security.cjs'))('sharp')}
 const a=await login(),b=await login();
 const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#558833'}}).png().toBuffer();
 const upload=await call('/attachments',{method:'POST',session:a,body:{name:'../unsafe <name>.png',mime:'image/png',data_base64:bytes.toString('base64')}});
 assert.equal(upload.status,200);const file=upload.body.attachment;
 assert.equal(/[<>/\\]/.test(file.name),false);
 assert.equal((await call(file.url.replace('/client-api',''),{session:b})).status,404);
 assert.equal((await call('/messages',{method:'POST',session:b,body:{request_id:crypto.randomUUID(),body:'Чужое фото',attachment_ids:[file.id]}})).status,404);
 const made=await call('/orders',{method:'POST',session:a,body:{request_id:crypto.randomUUID(),name:'Тест',address:'Тест',description:'Другая ветка',items:[]}});
 assert.equal(made.status,200);
 assert.equal((await call('/messages',{method:'POST',session:a,body:{request_id:crypto.randomUUID(),order_id:made.body.order.id,body:'Другая ветка',attachment_ids:[file.id]}})).status,404);
 const message={request_id:crypto.randomUUID(),body:'Фото к общему вопросу',attachment_ids:[file.id]};
 const sent=await call('/messages',{method:'POST',session:a,body:message});assert.equal(sent.status,200);
 assert.equal(sent.body.message.attachments[0].id,file.id);
 const retry=await call('/messages',{method:'POST',session:a,body:message});assert.equal(retry.status,200);assert.equal(retry.body.message.id,sent.body.message.id);
 assert.equal((await call('/messages',{method:'POST',session:a,body:{...message,request_id:crypto.randomUUID()}})).status,404);
 const own=await call('/messages',{session:a});assert.equal(own.body.messages.length,1);assert.equal(own.body.messages[0].attachments[0].id,file.id);
 const foreign=await call('/messages',{session:b});assert.equal(foreign.body.messages.length,0);
 const injected=await call('/messages?client_id='+a.profile.id,{session:b});assert.equal(injected.body.messages.length,0);
});

test('a privacy response appears only for its owner and contributes to general unread count',async()=>{
 const a=await login(),b=await login();
 const request=await call('/privacy-requests',{method:'POST',session:a,body:{request_id:crypto.randomUUID(),kind:'access',text:'Синтетический запрос на копию'}});
 assert.equal(request.status,200);
 const response=await call('/staff/requests/'+request.body.request.id+'/resolve',{method:'POST',headers:{'x-bos-session':staffToken()},body:{version:request.body.request.version,status:'accepted',response:'Синтетический ответ только владельцу запроса'}});
 assert.equal(response.status,200);
 const own=await call('/privacy-requests',{session:a});assert.equal(own.body.requests[0].status,'accepted');
 assert.ok(own.body.requests[0].response.includes('только владельцу'));
 assert.equal((await call('/privacy-requests',{session:b})).body.requests.length,0);
 const unread=await call('/unread',{session:a});assert.equal(unread.body.general_count,1);
 assert.equal((await call('/unread',{session:b})).body.count,0);
 const thread=await call('/messages',{session:a});assert.equal(thread.body.messages.length,1);
 await call('/messages/read',{method:'POST',session:a,body:{through_id:thread.body.messages[0].id}});
 assert.equal((await call('/unread',{session:a})).body.count,0);
});

test('paid repeat recalculates current catalog and preserves work constraints without carrying assignment or old price',async()=>{
 const a=await login(),headers={'x-bos-session':staffToken()},serviceId='security_repeat_fixture';
 const service=await call('/staff/catalog',{method:'POST',headers,body:{id:serviceId,category:'Тест',name:'Синтетическая работа',description:'Только тест',unit:'шт.',price_type:'unit',price:100,conditions:'Тестовые условия',city:'Санкт-Петербург',published:true,confirmed:true,available:true}});
 assert.equal(service.status,200);
 const made=await call('/orders',{method:'POST',session:a,body:{request_id:crypto.randomUUID(),name:'Тест',address:'Синтетический адрес',description:'Требуется стремянка',items:[{service_id:serviceId,quantity:2}],parameters:{height:4,dismantling:true,wall_material:'бетон'}}});
 assert.equal(made.status,200);const original=made.body.order;
 assert.equal(original.preliminary.minimum_total,200);assert.equal(original.preliminary.requires_clarification,true);
 const repriced=await call('/staff/catalog/'+serviceId,{method:'PATCH',headers,body:{version:service.body.service.version,price:200}});assert.equal(repriced.status,200);
 const request_id=crypto.randomUUID();
 const repeated=await call('/orders/'+original.id+'/repeat',{method:'POST',session:a,body:{request_id}});
 assert.equal(repeated.status,200);const next=repeated.body.order;
 assert.notEqual(next.id,original.id);assert.equal(next.preliminary.minimum_total,400);
 assert.equal(next.preliminary.requires_clarification,true);assert.equal(next.parameters.height,4);assert.equal(next.parameters.dismantling,true);
 assert.equal(next.description,'Требуется стремянка');assert.equal(next.master,null);assert.equal(next.visit,null);assert.equal(next.estimate,null);
 const retried=await call('/orders/'+original.id+'/repeat',{method:'POST',session:a,body:{request_id}});assert.equal(retried.status,200);assert.equal(retried.body.order.id,next.id);
 assert.equal((await call('/orders/'+original.id,{session:a})).body.order.preliminary.minimum_total,200);
 const raw=(await stage.db.query('select source,external_source from orders where id=$1',[next.id])).rows[0];
 assert.equal(raw.source,'Кабинет клиента');assert.equal(raw.external_source,'client_portal');
});

test('storage quota covers sent general photos and upload retry never creates a duplicate file',async()=>{
 const {createRequire}=require('node:module');
 let sharp;try{sharp=require('sharp')}catch{sharp=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','_security.cjs'))('sharp')}
 const a=await login();
 const png=await sharp({create:{width:2,height:2,channels:3,background:'#553388'}}).png().toBuffer();
 const body={request_id:crypto.randomUUID(),name:'quota.png',mime:'image/png',data_base64:png.toString('base64')};
 const first=await call('/attachments',{method:'POST',session:a,body});assert.equal(first.status,200);
 const oldQuota=stage.config.maxStorageBytes;stage.config.maxStorageBytes=first.body.attachment.size+1;
 try{
  const retry=await call('/attachments',{method:'POST',session:a,body});assert.equal(retry.status,200);assert.equal(retry.body.attachment.id,first.body.attachment.id);
  assert.equal((await call('/messages',{method:'POST',session:a,body:{request_id:crypto.randomUUID(),body:'Отправлено',attachment_ids:[first.body.attachment.id]}})).status,200);
  const second=await call('/attachments',{method:'POST',session:a,body:{...body,request_id:crypto.randomUUID()}});
  assert.equal(second.status,409);assert.equal(second.body.code,'STORAGE_QUOTA');
  assert.equal((await stage.db.query('select count(*)::int as n from client_attachments where account_id=$1',[a.profile.id])).rows[0].n,1);
 }finally{stage.config.maxStorageBytes=oldQuota}
});

test('trusted client IP rate limits survive failures and spoofed forwarding headers do not reset them',async()=>{
 const oldOtpLimit=stage.config.otpIpLimit,oldRequestLimit=stage.config.requestIpLimit;
 stage.config.otpIpLimit=1;stage.config.requestIpLimit=1000;
 try{
  const first=await call('/auth/request',{method:'POST',ip:'192.0.2.80',body:{phone:nextPhone()},headers:{'x-forwarded-for':'192.0.2.81'}});assert.equal(first.status,200);
  const second=await call('/auth/request',{method:'POST',ip:'192.0.2.80',body:{phone:nextPhone()},headers:{'x-forwarded-for':'192.0.2.82','x-real-ip':'192.0.2.83'}});assert.equal(second.status,429);
  const key=crypto.createHash('sha256').update('otp-ip:192.0.2.80').digest('hex');
  assert.equal((await stage.db.query('select hits from client_rate_limits where key=$1',[key])).rows[0].hits,2);
  stage.config.requestIpLimit=1;
  const rejected=await call('/quote',{method:'POST',ip:'192.0.2.90',body:{items:[],city:'invalid'}});assert.equal(rejected.status,400);
  const blocked=await call('/quote',{method:'POST',ip:'192.0.2.90',body:{items:[],city:'Санкт-Петербург'}});assert.equal(blocked.status,429);
 }finally{stage.config.otpIpLimit=oldOtpLimit;stage.config.requestIpLimit=oldRequestLimit}
});
