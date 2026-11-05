'use strict';
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {setupStaging}=require('../staging/setup.cjs');
const {processNotifications,createLocalNotificationTransport,createSuppressedNotificationTransport}=require('../server/notifications.cjs');
let stage,directory,sequence=100;
before(async()=>{directory=await fs.mkdtemp(path.join(os.tmpdir(),'bos-client-notifications-'));stage=await setupStaging({dataDir:path.join(directory,'db'),privateDir:path.join(directory,'private')});});
after(async()=>{if(stage)await stage.close();if(directory)await fs.rm(directory,{recursive:true,force:true});});
beforeEach(async()=>{await stage.db.query('delete from client_notifications');});
async function enqueue(){
  const account=crypto.randomUUID();await stage.db.query('insert into client_accounts(id,phone,name) values($1,$2,$3)',[account,'+7999000'+String(++sequence).padStart(4,'0'),'Синтетический клиент']);
  const order=(await stage.db.query("insert into orders(client,phone,address,work,status,amount,source,external_source,client_account_id) values('Тест',$1,'Синтетический адрес','Тестовая работа','Новая',0,'Кабинет клиента','client_portal',$2) returning id",['+7999000'+String(sequence).padStart(4,'0'),account])).rows[0];
  const notification=(await stage.db.query('select * from client_notifications where account_id=$1',[account])).rows[0];
  assert.ok(notification,'order creation produces a notification in the same database');return {account,order:order.id,...notification};
}
const options=extra=>({db:stage.db,environment:'staging',batchSize:10,...extra});
const due=notification=>stage.db.query("update client_notifications set next_attempt_at=now()-interval '1 second' where id=$1",[notification.id]);
const stored=async notification=>(await stage.db.query('select * from client_notifications where id=$1',[notification.id])).rows[0];

test('real queue delivers only to private test outbox and survives delivery/ack crash without duplicate files',async()=>{
  const notification=await enqueue(),privateDir=path.join(directory,'delivery-dedup');
  const transport=createLocalNotificationTransport({environment:'staging',isolated:true,privateDir});
  assert.equal((await processNotifications(options({transport}))).sent,1);
  assert.equal((await stored(notification)).status,'sent');
  const files=await fs.readdir(path.join(privateDir,'notifications'));assert.equal(files.length,1);
  const filename=path.join(privateDir,'notifications',files[0]),outbox=JSON.parse(await fs.readFile(filename,'utf8'));
  assert.equal(outbox.idempotency_key,'client-event:'+notification.event_id);assert.equal(outbox.envelope.recipientId,notification.account_id);
  assert.equal((await fs.stat(filename)).mode&0o777,0o600);
  assert.equal((await processNotifications(options({transport}))).claimed,0);
  // Emulate process crash after durable delivery but before DB acknowledgement.
  await stage.db.query("update client_notifications set status='pending',attempts=0,delivered_at=null,next_attempt_at=now() where id=$1",[notification.id]);
  assert.equal((await processNotifications(options({transport}))).sent,1);
  assert.equal((await fs.readdir(path.join(privateDir,'notifications'))).length,1);
  assert.equal((await stored(notification)).status,'sent');
});

test('concurrent workers do not deliver the same leased notification twice',async()=>{
  const notification=await enqueue();let deliveries=0;
  const transport={kind:'test',idempotent:true,async deliver(){deliveries++;await new Promise(resolve=>setTimeout(resolve,20));return {status:'sent'}}};
  const results=await Promise.all([processNotifications(options({transport,batchSize:1})),processNotifications(options({transport,batchSize:1}))]);
  assert.equal(deliveries,1);assert.equal(results.reduce((sum,x)=>sum+x.sent,0),1);assert.equal((await stored(notification)).attempts,1);
});

test('delivery failure backs off, exhausts retries and never loses the saved order or logs secrets',async()=>{
  const notification=await enqueue(),logs=[];
  const transport={kind:'test',idempotent:true,async deliver(){throw Error('provider credential SECRET_TOKEN and +79990001111')}};
  let result=await processNotifications(options({transport,maxAttempts:2,baseDelayMs:100,log:x=>logs.push(x)}));
  assert.equal(result.failed,1);let row=await stored(notification);assert.equal(row.status,'failed');assert.equal(row.last_error,'DELIVERY_FAILED');assert.equal(row.attempts,1);assert.ok(new Date(row.next_attempt_at)>new Date());
  assert.equal((await processNotifications(options({transport,maxAttempts:2}))).claimed,0);
  await due(notification);result=await processNotifications(options({transport,maxAttempts:2,log:x=>logs.push(x)}));assert.equal(result.exhausted,1);
  await due(notification);assert.equal((await processNotifications(options({transport,maxAttempts:2}))).claimed,0);
  assert.equal((await stored(notification)).attempts,2);
  assert.equal((await stage.db.query('select status from orders where id=$1',[notification.order])).rows[0].status,'Новая');
  assert.doesNotMatch(JSON.stringify(logs),/SECRET_TOKEN|79990001111|recipientId|account_id/);
});

test('timeout aborts a test adapter and clears the lease for a later retry',async()=>{
  const notification=await enqueue();let aborted=false;
  const transport={kind:'test',idempotent:true,deliver(_envelope,{signal}){signal.addEventListener('abort',()=>{aborted=true});return new Promise(()=>{})}};
  const result=await processNotifications(options({transport,timeoutMs:20}));assert.equal(result.failed,1);assert.equal(aborted,true);
  const row=await stored(notification);assert.equal(row.last_error,'DELIVERY_TIMEOUT');assert.equal(row.lease_token,null);assert.equal(row.lease_until,null);
});

test('active lease is respected and expired worker lease can be recovered',async()=>{
  const notification=await enqueue(),transport=createSuppressedNotificationTransport({environment:'staging',isolated:true});
  await stage.db.query("update client_notifications set lease_token=$2,lease_until=now()+interval '1 minute' where id=$1",[notification.id,crypto.randomUUID()]);
  assert.equal((await processNotifications(options({transport}))).claimed,0);
  await stage.db.query("update client_notifications set lease_until=now()-interval '1 second' where id=$1",[notification.id]);
  assert.equal((await processNotifications(options({transport}))).suppressed,1);assert.equal((await stored(notification)).status,'suppressed');
});

test('a stale worker cannot overwrite a replacement lease acknowledgement',async()=>{
  const notification=await enqueue(),replacement=crypto.randomUUID();
  const transport={kind:'test',idempotent:true,async deliver(){await stage.db.query('update client_notifications set lease_token=$2 where id=$1',[notification.id,replacement]);return {status:'sent'}}};
  const result=await processNotifications(options({transport,batchSize:1}));assert.equal(result.leaseLost,1);assert.equal(result.sent,0);
  const row=await stored(notification);assert.equal(row.lease_token,replacement);assert.equal(row.status,'pending');
});

test('production with no provider fails visibly, and test/suppression transports cannot be used there',async()=>{
  const notification=await enqueue();
  let result=await processNotifications(options({environment:'production'}));assert.equal(result.failed,1);assert.equal((await stored(notification)).last_error,'TRANSPORT_UNCONFIGURED');
  let calls=0;await due(notification);
  result=await processNotifications(options({environment:'production',transport:{kind:'test',idempotent:true,async deliver(){calls++;return {status:'sent'}}}}));
  assert.equal(result.failed,1);assert.equal(calls,0);assert.equal((await stored(notification)).last_error,'UNSAFE_TRANSPORT');
  assert.throws(()=>createLocalNotificationTransport({environment:'production',isolated:true,privateDir:directory}));
  assert.throws(()=>createSuppressedNotificationTransport({environment:'production',isolated:true}));
});

test('test outbox refuses a reused event key with different content',async()=>{
  const transport=createLocalNotificationTransport({environment:'test',isolated:true,privateDir:path.join(directory,'mismatch')});
  const envelope={idempotencyKey:'client-event:98765',eventId:'98765',recipientId:crypto.randomUUID(),kind:'message',text:'Синтетическое сообщение',createdAt:new Date().toISOString()};
  await transport.deliver(envelope);await assert.rejects(transport.deliver({...envelope,text:'Другой текст'}),{code:'DELIVERY_PAYLOAD_CONFLICT'});
  assert.equal((await fs.readdir(path.join(directory,'mismatch','notifications'))).length,1);
});

test('general conversation notifications without order events each retain a unique delivery identity',async()=>{
  const original=await enqueue();await stage.db.query('delete from client_notifications');
  const a=(await stage.db.query("insert into client_notifications(account_id,kind) values($1,'message') returning id",[original.account])).rows[0];
  const b=(await stage.db.query("insert into client_notifications(account_id,kind) values($1,'message') returning id",[original.account])).rows[0];
  const envelopes=[],transport={kind:'test',idempotent:true,async deliver(envelope){envelopes.push(envelope);return {status:'sent'}}};
  const result=await processNotifications(options({transport}));assert.equal(result.sent,2);
  assert.deepEqual(envelopes.map(x=>x.idempotencyKey),['client-notification:'+a.id,'client-notification:'+b.id]);
  for(const envelope of envelopes){assert.equal(envelope.eventId,null);assert.equal(envelope.createdAt,null);assert.equal(envelope.text,'Новое сообщение компании')}
});

test('a crash on the last attempt becomes an explicit unconfirmed failure',async()=>{
  const notification=await enqueue();
  await stage.db.query("update client_notifications set attempts=5,lease_token=$2,lease_until=now()-interval '1 second' where id=$1",[notification.id,crypto.randomUUID()]);
  const result=await processNotifications(options({transport:createSuppressedNotificationTransport({environment:'staging',isolated:true})}));
  assert.equal(result.expiredExhausted,1);assert.equal(result.claimed,0);
  const row=await stored(notification);assert.equal(row.status,'failed');assert.equal(row.last_error,'DELIVERY_UNCONFIRMED');assert.equal(row.lease_token,null);
});
