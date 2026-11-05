'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID,createHmac}=require('node:crypto');
const {createIntegratedStaging}=require('../staging/integrated.cjs');
const ORIGIN='http://127.0.0.1:4180';
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQcLBQcLBggFAAEE4CYfopkxgAAAAASUVORK5CYII=';
const day=()=>new Date(Date.now()+86400000*7).toISOString().slice(0,10);
const orderPayload=(extra={})=>({request_id:randomUUID(),items:[],city:'Санкт-Петербург',name:'Синтетический клиент',address:'Тестовая улица, 10, кв. 1',description:'Закрепить полку',desired_date:day(),desired_interval:'10:00–13:00',parameters:{},...extra});

async function fixture(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bos-portal-e2e-'));
 const stage=await createIntegratedStaging({dataDir:path.join(directory,'db'),privateDir:path.join(directory,'private'),origin:ORIGIN});
 const portal=stage.portal;
 const token=role=>{const msg=`stage_${role}.${Math.floor(Date.now()/1000)+3600}`;return msg+'.'+createHmac('sha256',stage.config.staffSecret).update(msg).digest('base64url')};
 const request=async(actor,route,method='GET',body,extra={})=>{
  const headers={Origin:ORIGIN,...(body?{'content-type':'application/json'}:{}),...(actor?.cookie?{Cookie:actor.cookie}:{}),...(actor?.csrf?{'x-csrf-token':actor.csrf}:{}),...(actor?.staff?{'x-bos-session':actor.staff}:{}),...extra};
  const response=await portal.handle(new Request(ORIGIN+'/client-api'+route,{method,headers,...(body?{body:JSON.stringify(body)}:{})}));
  const ct=response.headers.get('content-type')||'';
  const data=ct.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());
  if(actor&&response.headers.get('set-cookie'))actor.cookie=response.headers.get('set-cookie').split(';')[0];
  if(actor&&data.csrf_token)actor.csrf=data.csrf_token;
  return {status:response.status,data,headers:response.headers};
 };
 const good=async(...args)=>{const result=await request(...args);assert.ok(result.status>=200&&result.status<300,JSON.stringify({status:result.status,code:result.data.code,error:result.data.error}));return result.data};
 const login=async(phone='+79995551001')=>{const actor={};const documents=(await good(null,'/documents')).documents;const challenge=await good(actor,'/auth/request','POST',{phone});const otp=JSON.parse(await fs.readFile(path.join(stage.config.privateDir,'otp',challenge.challenge_id+'.json'),'utf8'));const verified=await good(actor,'/auth/verify','POST',{challenge_id:challenge.challenge_id,code:otp.code,consents:documents.filter(d=>d.required).map(({document,version})=>({document,version}))});actor.profile=verified.profile;return actor};
 return {...stage,directory,portal,token,request,good,login,owner:{staff:token('owner')},dispatcher:{staff:token('dispatcher')},cleanup:async()=>{await stage.close();await fs.rm(directory,{recursive:true,force:true})}};
}
module.exports={fixture,orderPayload,PNG};

if(require.main===module||process.env.NODE_TEST_CONTEXT)test('persistent client/staff journey and hostile API boundaries',async t=>{
 const f=await fixture();t.after(()=>f.cleanup());let alice,bob,order,catalog,attachment;
 await t.test('OTP creates separate normalized client, requires current documents, has no HTTP code',async()=>{
  const before=(await f.db.query('select count(*)::int as n from business_staff')).rows[0].n;
  alice=await f.login('8 (999) 555-10-01');bob=await f.login('+79995551002');
  assert.equal(alice.profile.phone,'+79995551001');assert.equal((await f.db.query('select count(*)::int as n from business_staff')).rows[0].n,before);
  const session=await f.request(alice,'/session');assert.equal(session.data.authenticated,true);assert.match(session.headers.get('cache-control'),/no-store/);
  assert.equal((await f.request(alice,'/staff/orders')).status,401);
  assert.equal((await f.request({staff:f.token('master')},'/staff/orders')).status,403);
  for(const role of ['owner','manager','dispatcher'])assert.equal((await f.request({staff:f.token(role)},'/staff/orders')).status,200,role);
  assert.equal((await f.request(alice,'/profile','PATCH',{version:1,name:'Проверка'},{Origin:'https://attacker.invalid'})).status,403);
  const noCsrf={cookie:alice.cookie};assert.equal((await f.request(noCsrf,'/messages','POST',{request_id:randomUUID(),body:'Нет CSRF'})).status,403);
 });
 await t.test('catalog management and quote reject client prices and negative quantities',async()=>{
  const s={id:'test_shelf_qa',category:'Тестовые услуги',name:'Тестовая полка',description:'Синтетическая услуга для проверки',unit:'шт.',price_type:'unit',price:1500,conditions:'Только тест',city:'Санкт-Петербург',available:true,published:true,confirmed:true};
  catalog=(await f.good(f.owner,'/staff/catalog','POST',s)).service;
  assert.equal((await f.request(f.dispatcher,'/staff/catalog','POST',{...s,id:'forbidden-service'})).status,403);
  const quote=await f.good(null,'/quote','POST',{items:[{service_id:catalog.id,quantity:2}],city:'Санкт-Петербург',parameters:{}});assert.equal(quote.quote.total,3000);
  assert.equal((await f.request(null,'/quote','POST',{items:[{service_id:catalog.id,quantity:-1}],city:'Санкт-Петербург'})).status,400);
  assert.equal((await f.request(null,'/quote','POST',{items:[{service_id:catalog.id,quantity:2,unit_price:1}],city:'Санкт-Петербург'})).status,400);
 });
 await t.test('same shared order is idempotent, public-safe and initially unconfirmed',async()=>{
  const payload=orderPayload({items:[{service_id:catalog.id,quantity:2}],comment:'<img src=x onerror=alert(1)>'});
  const created=await f.good(alice,'/orders','POST',payload);order=created.order;
  const retry=await f.good(alice,'/orders','POST',payload);assert.equal(retry.order.id,order.id);assert.equal(retry.idempotent,true);
  assert.equal((await f.request(alice,'/orders','POST',{...payload,address:'Другой адрес'})).status,409);
  assert.equal((await f.request(alice,'/orders','POST',{...payload,request_id:randomUUID(),client_id:bob.profile.id})).status,400);
  const stored=(await f.db.query('select source,external_source,status,client_account_id,work_items from orders where id=$1',[order.id])).rows[0];
  assert.equal(stored.source,'Кабинет клиента');assert.equal(stored.external_source,'client_portal');assert.equal(stored.client_account_id,alice.profile.id);assert.equal(stored.status,'В работе');assert.equal(stored.work_items[0].quantity,2);
  assert.equal(order.visit,null);assert.equal(order.master,null);assert.equal(order.status,'no_master');assert.equal(order.preliminary.total,3000);
  for(const forbidden of ['master_payout','manager_payout','dispatcher_payout','password_hash','business_staff','internal_status','report_review_comment','phone'])assert.equal(Object.hasOwn(order,forbidden),false,forbidden);
  const staff=await f.good(f.dispatcher,'/staff/orders');assert.ok(staff.orders.some(x=>x.id===order.id));
 });
 await t.test('A/B ownership applies to reads, writes, messages, requests and uploads',async()=>{
  for(const [route,method,body]of [[`/orders/${order.id}`,'GET'],[`/messages?order_id=${order.id}`,'GET'],['/messages','POST',{request_id:randomUUID(),order_id:order.id,body:'Чужое'}],[`/orders/${order.id}/requests`,'POST',{request_id:randomUUID(),type:'cancel',text:'Чужое'}],[`/orders/${order.id}/estimate/accept`,'POST',{version:1}],[`/orders/${order.id}/attachments`,'POST',{name:'test.png',mime:'image/png',data_base64:PNG}]])assert.equal((await f.request(bob,route,method,body)).status,404,route);
 });
 await t.test('catalog and saved address changes do not rewrite order snapshots',async()=>{
  catalog=(await f.good(f.owner,'/staff/catalog/'+catalog.id,'PATCH',{version:catalog.version,price:1900})).service;
  const current=(await f.good(alice,'/orders/'+order.id)).order;assert.equal(current.preliminary.total,3000);assert.equal(current.work_items[0].unit_price,1500);
  const addr=(await f.good(alice,'/addresses','POST',{label:'Дом',address:'Сохранённый адрес',entrance:'1',floor:'2',intercom:'3'})).address;
  await f.good(alice,'/addresses/'+addr.id,'PATCH',{version:addr.version,label:'Дом',address:'Другой сохранённый адрес',entrance:'',floor:'',intercom:''});
  assert.equal((await f.good(alice,'/orders/'+order.id)).order.address,order.address);
  assert.equal((await f.request(bob,'/addresses/'+addr.id,'DELETE',{})).status,404);
 });
 await t.test('master and visit sync with explicit public card; optimistic conflicts rejected',async()=>{
  await f.good(f.owner,'/staff/masters/'+f.staffIds.master+'/public-profile','POST',{name:'Алексей',specialization:'Карнизы',photo_url:''});
  order=(await f.good(f.dispatcher,'/staff/orders/'+order.id,'PATCH',{version:order.version,master_staff_id:f.staffIds.master,visit:{date:day(),time:'11:00',interval:'11:00–13:00'}})).order;
  assert.equal(order.master.name,'Алексей');assert.equal(order.master.specialization,'Карнизы');assert.equal(Object.hasOwn(order.master,'phone'),false);assert.equal(order.visit.time,'11:00');
  assert.equal((await f.request(f.dispatcher,'/staff/orders/'+order.id,'PATCH',{version:order.version-1,master_staff_id:f.staffIds.master})).status,409);
  const client=(await f.good(alice,'/orders/'+order.id)).order;assert.equal(client.master.name,'Алексей');assert.equal(client.visit.time,'11:00');
 });
 await t.test('client accepts exact estimate version; stale estimate cannot be accepted',async()=>{
  order=(await f.good(f.dispatcher,'/staff/orders/'+order.id+'/estimates','POST',{version:order.version,items:[{name:'Полка',unit:'шт.',quantity:2,unit_price:1700}],conditions:'Согласованная тестовая смета'})).order;
  assert.equal(order.estimate.total,3400);assert.equal(order.estimate.accepted_at,null);
  assert.equal((await f.request(alice,'/orders/'+order.id+'/estimate/accept','POST',{version:order.estimate.version+1})).status,409);
  order=(await f.good(alice,'/orders/'+order.id+'/estimate/accept','POST',{version:order.estimate.version})).order;assert.ok(order.estimate.accepted_at);
 });
 await t.test('messages persist, retries deduplicate, general threads and unread stay isolated',async()=>{
  const message={request_id:randomUUID(),order_id:order.id,body:'<svg onload=alert(1)>Сохранённый текст</svg>'};
  const first=await f.good(alice,'/messages','POST',message),again=await f.good(alice,'/messages','POST',message);assert.equal(again.message.id,first.message.id);
  const staff=await f.good(f.dispatcher,'/staff/messages?order_id='+order.id);assert.equal(staff.messages[0].body,message.body);assert.equal(staff.unread_count,1);
  await f.good(f.dispatcher,'/staff/messages/read','POST',{order_id:order.id,through_id:first.message.id});assert.equal((await f.good(f.dispatcher,'/staff/messages?order_id='+order.id)).unread_count,0);
  const reply=await f.good(f.dispatcher,'/staff/messages','POST',{request_id:randomUUID(),order_id:order.id,body:'Стоимость согласована, ждём вас.'});
  assert.equal((await f.good(alice,'/messages?order_id='+order.id)).unread_count,1);
  await f.good(alice,'/messages/read','POST',{order_id:order.id,through_id:reply.message.id});assert.equal((await f.good(alice,'/messages?order_id='+order.id)).unread_count,0);
  await f.good(alice,'/messages','POST',{request_id:randomUUID(),body:'Общий вопрос'});
  assert.equal((await f.good(bob,'/messages')).messages.length,0);
 });
 await t.test('private upload decodes actual image and denies foreign or executable attachment',async()=>{
  attachment=(await f.good(alice,'/orders/'+order.id+'/attachments','POST',{name:'../../test.png',mime:'image/png',data_base64:PNG})).attachment;
  assert.ok(attachment.url.startsWith('/client-api/attachments/'));assert.doesNotMatch(attachment.name,/\.\.\//);
  const data=await f.request(alice,'/attachments/'+attachment.id);assert.equal(data.status,200);assert.match(data.headers.get('content-type'),/^image\/(png|jpeg|webp)/);
  assert.equal((await f.request(bob,'/attachments/'+attachment.id)).status,404);
  assert.equal((await f.request(null,'/attachments/'+attachment.id)).status,401);
  assert.equal((await f.request(alice,'/orders/'+order.id+'/attachments','POST',{name:'evil.png',mime:'image/png',data_base64:Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64')})).status,400);
 });
 await t.test('request workflows never imply a confirmed reschedule or create paid warranty order',async()=>{
  assert.equal((await f.request(alice,'/orders/'+order.id+'/requests','POST',{request_id:randomUUID(),type:'warranty',text:'Рано'})).status,409);
  const request=(await f.good(alice,'/orders/'+order.id+'/requests','POST',{request_id:randomUUID(),type:'reschedule',text:'Нужен другой день',desired_date:day(),desired_interval:'16:00–19:00'})).request;
  const before=(await f.good(alice,'/orders/'+order.id)).order;assert.equal(before.status,'reschedule_requested');assert.equal(before.visit.time,'11:00');
  await f.good(f.dispatcher,'/staff/requests/'+request.id+'/resolve','POST',{version:request.version,status:'accepted',response:'Уточним время'});
  assert.equal((await f.good(alice,'/orders/'+order.id)).order.visit.time,'11:00');
  const staffCall=async(slug,body,role)=>{const result=await f.edgeHandlers[slug](body,'',f.token(role));assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.ok,true);return result.body};
  for(const stage of ['departed','started'])await staffCall('master-workflow-api',{action:'setStage',id:order.id,stage},'master');
  const report=await staffCall('report-api',{action:'uploadMasterReport',order_id:order.id,upload_token:randomUUID(),act_name:'act.png',act_mime:'image/png',act_data:PNG,photos_json:JSON.stringify([{name:'photo.png',mime:'image/png',data:PNG}])},'master');
  await staffCall('order-lifecycle-api',{action:'reviewReport',id:order.id,decision:'approved',expected_report_token:report.order.report_upload_token,expected_report_uploaded_at:report.order.report_uploaded_at},'dispatcher');
  const completed=(await f.good(alice,'/orders/'+order.id)).order;assert.equal(completed.status,'completed');assert.equal(completed.final_total,3400);
  const count=(await f.db.query('select count(*)::int as n from orders')).rows[0].n;
  await f.good(alice,'/orders/'+order.id+'/requests','POST',{request_id:randomUUID(),type:'warranty',text:'Проверьте крепление'});
  assert.equal((await f.db.query('select count(*)::int as n from orders')).rows[0].n,count);
 });
 await t.test('split native master report finalizes, archives files, and closes the same order',async()=>{
  let split=(await f.good(bob,'/orders','POST',orderPayload({items:[{service_id:catalog.id,quantity:1}]}))).order;
  split=(await f.good(f.dispatcher,'/staff/orders/'+split.id,'PATCH',{version:split.version,master_staff_id:f.staffIds.master,visit:{date:day(),time:'14:00',interval:'13:00–16:00'}})).order;
  const native=async(slug,body,role)=>{const result=await f.edgeHandlers[slug](body,'',f.token(role));assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.ok,true);return result.body};
  await native('master-workflow-api',{action:'setStage',id:split.id,stage:'departed'},'master');
  await native('master-workflow-api',{action:'setStage',id:split.id,stage:'started'},'master');
  const token=randomUUID();
  const act=await native('report-api',{action:'uploadReportFile',order_id:split.id,upload_token:token,file_kind:'act',file_name:'act.png',file_mime:'image/png',file_data:PNG},'master');
  const photo=await native('report-api',{action:'uploadReportFile',order_id:split.id,upload_token:token,file_kind:'photo',file_index:0,file_name:'photo.png',file_mime:'image/png',file_data:PNG},'master');
  const report=await native('report-api',{action:'finalizeMasterReport',order_id:split.id,upload_token:token,act_url:act.url,photo_urls:[photo.url]},'master');
  assert.equal(report.order.report_upload_token,token);
  await native('order-lifecycle-api',{action:'reviewReport',id:split.id,decision:'approved',expected_report_token:token,expected_report_uploaded_at:report.order.report_uploaded_at},'dispatcher');
  const done=(await f.good(bob,'/orders/'+split.id)).order;assert.equal(done.status,'completed');assert.equal(done.id,split.id);
  const manifest=JSON.parse(await fs.readFile(path.join(f.config.privateDir,'archives',String(split.id),token,'manifest.json'),'utf8'));
  assert.equal(manifest.files,2);assert.equal(manifest.transport,'isolated-disk');
 });
 await t.test('custom order works without catalog; logout and used/expired OTPs fail closed',async()=>{
  const custom=await f.good(bob,'/orders','POST',orderPayload());assert.equal(custom.order.preliminary.total,null);
  const oldCookie=alice.cookie;await f.good(alice,'/auth/logout','POST',{all_devices:true});assert.equal((await f.good({cookie:oldCookie},'/session')).authenticated,false);
  const challenge=await f.good(null,'/auth/request','POST',{phone:'+79995551003'});const otp=JSON.parse(await fs.readFile(path.join(f.config.privateDir,'otp',challenge.challenge_id+'.json'),'utf8'));
  await f.db.query("UPDATE client_otps SET expires_at=now()-interval '1 second' WHERE id=$1",[challenge.challenge_id]);
  assert.equal((await f.request(null,'/auth/verify','POST',{challenge_id:challenge.challenge_id,code:otp.code,consents:[]})).status,400);
  const used=(await f.db.query('select id from client_otps where used_at is not null limit 1')).rows[0];assert.equal((await f.request(null,'/auth/verify','POST',{challenge_id:used.id,code:'000000',consents:[]})).status,400);
 });
});
