const {test}=require('node:test');
const assert=require('node:assert/strict');
const {edge,database,employee,secret}=require('./helpers/edge.cjs');
const {webcrypto}=require('node:crypto');
function setup(fetcher,role='owner',connected=true,configured=true){
 const db=database({business_staff:[employee('owner',role),employee('dispatch','dispatcher')],avito_connections:connected?[{id:1,is_active:true,avito_user_id:42,account_name:'Shop',client_secret:'never-return'}]:[]});
 // Model singleton connection upsert separately from the schedule-only shared mock.
 const originalFrom=db.from;
 db.from=function(table){const q=originalFrom.call(db,table);if(table==='avito_connections')q.upsert=payload=>db.tables.avito_connections.some(x=>x.id===payload.id)?q.update(payload).eq('id',payload.id):q.insert(payload);return q};
 let handler;const calls=[];
 edge('avito-api',db,{AbortController,setTimeout,clearTimeout,crypto:webcrypto,Deno:{env:{get:k=>({VK_APP_SECRET:secret,SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test',...(configured?{AVITO_CLIENT_ID:'server-id',AVITO_CLIENT_SECRET:'server-secret'}:{})}[k])},serve:fn=>handler=fn},fetch:async(url,init)=>{calls.push({url,init});return fetcher(url,init,calls)}});
 const {token}=require('./helpers/edge.cjs');
 const call=async(body,session=token('100'))=>{const r=await handler(new Request('https://test.invalid',{method:'POST',headers:{'Content-Type':'application/json','x-bos-session':session},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()}};
 return {db,calls,call};
}
const response=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers});
const normal=(url)=>url.endsWith('/token')?response({access_token:'private-token',expires_in:3600}):response({chats:[{id:'chat-1',users:[{id:42,name:'Shop'},{id:99,name:'Клиент'}],context:{value:{id:10,title:'Карниз',url:'https://www.avito.ru/ad'}},last_message:{content:{text:'Здравствуйте'},created:1700000000,author_id:99,is_read:false}}]});
test('Avito role/session gate precedes every provider request; status never exposes credentials',async()=>{
 const master=setup(normal,'master');assert.equal((await master.call({action:'chats'})).status,403);assert.equal(master.calls.length,0);
 const owner=setup(normal);assert.equal((await owner.call({action:'chats'},'invalid')).status,401);
 const status=await owner.call({action:'status'});assert.equal(status.body.connected,true);assert.equal(JSON.stringify(status).includes('never-return'),false);assert.equal(owner.calls.length,0);
 const dispatcher=setup(normal,'dispatcher');assert.equal((await dispatcher.call({action:'connect'})).status,403);
});
test('chat normalization, pagination and token reuse',async()=>{
 const x=setup(normal);const a=await x.call({action:'chats',offset:100});await x.call({action:'chats'});
 assert.equal(a.status,200);assert.equal(a.body.chats[0].client,'Клиент');assert.equal(a.body.chats[0].client_id,'99');assert.equal(a.body.chats[0].unread_count,1);assert.equal(a.body.chats[0].item_title,'Карниз');
 assert.equal(x.calls.filter(x=>x.url.endsWith('/token')).length,1);assert.match(x.calls[1].url,/offset=100/);
 assert.equal(JSON.stringify(a).includes('private-token'),false);
});
test('401 on GET renews once; no unbounded retry',async()=>{
 let gets=0;const x=setup(url=>url.endsWith('/token')?normal(url):++gets===1?response({},401):response({chats:[]}));
 assert.equal((await x.call({action:'chats'})).status,200);assert.equal(x.calls.filter(x=>x.url.endsWith('/token')).length,2);
 const bad=setup(url=>url.endsWith('/token')?normal(url):response({error:'secret'},401));const r=await bad.call({action:'chats'});assert.equal(r.body.code,'AVITO_AUTH');assert.equal(bad.calls.length,4);assert.equal(JSON.stringify(r).includes('secret'),false);
});
test('missing server credentials cannot be supplied by frontend',async()=>{
 const x=setup(normal,'owner',false,false);const r=await x.call({action:'connect',client_id:'browser',client_secret:'browser'});assert.equal(r.body.code,'NOT_CONFIGURED');assert.equal(x.calls.length,0);
});
test('provider failures are sanitized; rate limit preserved; send never retries',async()=>{
 for(const [status,code] of [[401,'AVITO_AUTH'],[403,'AVITO_FORBIDDEN'],[429,'AVITO_RATE_LIMIT'],[500,'AVITO_UNAVAILABLE']]){
  const x=setup(url=>url.endsWith('/token')?normal(url):response({message:'private secret'},status,{'Retry-After':'90'}));
  const r=await x.call({action:'sendMessage',chat_id:'chat-1',text:'Ответ'});assert.equal(r.body.code,code);assert.equal(JSON.stringify(r).includes('private secret'),false);assert.equal(x.calls.length,2);
  if(status===429){assert.equal(r.status,429);assert.equal(r.body.retry_after,90)}
 }
 const x=setup(url=>{if(url.endsWith('/token'))return normal(url);throw new Error('network secret')});assert.equal((await x.call({action:'messages',chat_id:'x'})).body.code,'AVITO_UNAVAILABLE');
});
test('timeout aborts request and returns a readable error',async()=>{
 const x=setup((url,init)=>url.endsWith('/token')?normal(url):new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted')))));
 assert.equal((await x.call({action:'messages',chat_id:'chat-1'})).body.code,'AVITO_TIMEOUT');
});
test('send payload and message direction; invalid input causes no send',async()=>{
 const x=setup((url,init)=>url.endsWith('/token')?normal(url):init.method==='POST'?response({id:'sent'}):response({messages:[{id:'1',author_id:42,content:{text:'Ответ'},created:1700000000},{id:'2',author_id:99,content:{text:'Вопрос'},created:1700000001}]}));
 assert.equal((await x.call({action:'sendMessage',chat_id:'../bad',text:'x'})).status,400);
 assert.equal((await x.call({action:'sendMessage',chat_id:'good',text:'x'.repeat(1001)})).status,400);assert.equal(x.calls.length,0);
 assert.equal((await x.call({action:'sendMessage',chat_id:'good',text:'Ответ'})).body.message_id,'sent');assert.deepEqual(JSON.parse(x.calls[1].init.body),{type:'text',message:{text:'Ответ'}});
 const r=await x.call({action:'messages',chat_id:'good'});assert.deepEqual(r.body.messages.map(x=>x.direction),['out','in']);
});
test('sync only updates metadata on linked orders, never creates or overwrites business data',async()=>{
 const x=setup(normal);x.db.tables.orders.push({id:'1',avito_chat_id:'chat-1',client:'Сохранённый клиент',work:'Работы',comment:'Сохранить',amount:1000});
 assert.equal((await x.call({action:'sync'})).body.updated,1);assert.equal(x.db.tables.orders.length,1);assert.equal(x.db.tables.orders[0].comment,'Сохранить');assert.equal(x.db.tables.orders[0].client,'Сохранённый клиент');assert.equal(x.db.tables.orders[0].avito_unread_count,1);
});
test('failed read does not clear local unread',async()=>{
 const x=setup(url=>url.endsWith('/token')?normal(url):response({},403));x.db.tables.orders.push({id:'1',avito_chat_id:'chat-1',avito_unread_count:2});await x.call({action:'read',chat_id:'chat-1'});assert.equal(x.db.tables.orders[0].avito_unread_count,2);
});
test('Avito createOrder is linked and idempotent across dispatchers, payroll unchanged',async()=>{
 const db=database({business_staff:[employee('owner','owner'),employee('d','dispatcher')],orders:[]});const call=edge('mini-app-api',db);
 const data={action:'createOrder',client:'Клиент',address:'Адрес',work:'Карниз',amount:1000,avito_chat_id:'chat-1',avito_item_id:'10',avito_item_url:'https://www.avito.ru/ad'};
 const a=await call(data);assert.equal(a.status,200);assert.equal(a.body.order.avito_chat_id,'chat-1');assert.equal(a.body.order.external_source,'avito');assert.equal(a.body.order.source,'Авито');
 const b=await call(data,'staff_d');assert.equal(b.body.idempotent,true);assert.equal(a.body.order.id,b.body.order.id);assert.equal(db.tables.orders.length,1);
 assert.equal((await call({...data,avito_chat_id:'../bad'})).status,400);
});

test('connect validates provider access, stores no secrets, disconnect revokes local access',async()=>{
 const x=setup(url=>url.endsWith('/token')?normal(url):url.endsWith('/self')?response({id:42,name:'Account'}):response({chats:[]}),'owner',false);
 assert.equal((await x.call({action:'connect'})).status,200);assert.equal(x.db.tables.avito_connections[0].client_secret,'');assert.equal(x.db.tables.avito_connections[0].is_active,true);
 assert.equal((await x.call({action:'disconnect'})).status,200);assert.equal((await x.call({action:'chats'})).body.code,'NOT_CONNECTED');
 const denied=setup(url=>url.endsWith('/token')?normal(url):url.endsWith('/self')?response({id:42}):response({},403),'owner',false);
 assert.equal((await denied.call({action:'connect'})).status,403);assert.equal(denied.db.tables.avito_connections.length,0);
});
test('expired token is renewed and simultaneous order creates converge',async()=>{
 const x=setup(url=>url.endsWith('/token')?response({access_token:'short',expires_in:1}):response({chats:[]}));await x.call({action:'chats'});await x.call({action:'chats'});assert.equal(x.calls.filter(x=>x.url.endsWith('/token')).length,2);
 const db=database({business_staff:[employee('owner','owner')],orders:[]}),call=edge('mini-app-api',db);
 const order={action:'createOrder',client:'C',address:'A',work:'W',avito_chat_id:'same-chat'};
 const results=await Promise.all([call(order),call(order)]);assert.equal(db.tables.orders.length,1);assert.ok(results.every(x=>x.status===200));
});
test('Avito gateway failures never replay a send through direct fallback',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');const calls=[];
 const window={fetch:async(url)=>{calls.push(url);throw new TypeError('network unavailable')}};
 vm.runInNewContext(fs.readFileSync('network-direct-v86.js','utf8'),{window,URL,Request,Headers,AbortController,setTimeout,clearTimeout,location:{href:'https://app.invalid'}});
 await assert.rejects(window.fetch('https://business-os-api-gateway.netlify.app/api/proxy/avito-api',{method:'POST',body:JSON.stringify({action:'sendMessage'})}));assert.equal(calls.length,1);
});
