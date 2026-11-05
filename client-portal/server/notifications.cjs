'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');

const ENVIRONMENTS=new Set(['test','staging','production']);
const coded=code=>Object.assign(new Error(code),{code});
const safeLog=(log,value)=>{try{log?.(value)}catch{/* Logging cannot change queue ownership. */}};
function integer(value,fallback,min,max){const n=value===undefined?fallback:value;if(!Number.isInteger(n)||n<min||n>max)throw Error('Invalid notification worker option');return n}
function validateEnvironment(environment){if(!ENVIRONMENTS.has(environment))throw Error('Explicit notification environment required')}
function canonical(value){if(Array.isArray(value))return'['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value)}
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

/** Test transport only: atomic, private, idempotent filesystem outbox. No network. */
function createLocalNotificationTransport({environment,isolated,privateDir}){
  validateEnvironment(environment);
  if(environment==='production'||isolated!==true||!privateDir||!path.isAbsolute(privateDir))throw Error('Local notification transport requires an isolated non-production directory');
  const directory=path.join(privateDir,'notifications');
  return Object.freeze({kind:'test',idempotent:true,async deliver(envelope,{signal}={}){
    if(signal?.aborted)throw coded('DELIVERY_ABORTED');
    if(!envelope||!/^client-(?:event|notification):\d+$/.test(envelope.idempotencyKey))throw coded('INVALID_EVENT_KEY');
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const key=hash(envelope.idempotencyKey),target=path.join(directory,key+'.json'),temporary=path.join(directory,'.'+key+'.'+crypto.randomUUID()+'.tmp');
    const payloadHash=hash(canonical(envelope));
    const record={transport:'isolated-local-outbox',idempotency_key:envelope.idempotencyKey,payload_hash:payloadHash,envelope};
    let handle;
    try{
      handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify(record));await handle.sync();await handle.close();handle=null;
      if(signal?.aborted)throw coded('DELIVERY_ABORTED');
      try{await fs.link(temporary,target)}catch(error){
        if(error.code!=='EEXIST')throw error;
        const existing=JSON.parse(await fs.readFile(target,'utf8'));
        if(existing.idempotency_key!==record.idempotency_key||existing.payload_hash!==payloadHash)throw coded('DELIVERY_PAYLOAD_CONFLICT');
      }
      return {status:'sent',receipt:'isolated-local-outbox:'+key};
    }finally{if(handle)await handle.close().catch(()=>{});await fs.unlink(temporary).catch(()=>{})}
  }});
}

function createSuppressedNotificationTransport({environment,isolated}){
  validateEnvironment(environment);if(environment==='production'||isolated!==true)throw Error('Suppression is restricted to isolated non-production');
  return Object.freeze({kind:'test',idempotent:true,deliver:async()=>({status:'suppressed'})});
}

async function attemptDelivery(transport,envelope,{environment,timeoutMs}){
  if(!transport)throw coded('TRANSPORT_UNCONFIGURED');
  if(typeof transport.deliver!=='function'||transport.idempotent!==true)throw coded('UNSAFE_TRANSPORT');
  if(environment==='production'&&transport.kind!=='provider')throw coded('UNSAFE_TRANSPORT');
  if(environment!=='production'&&transport.kind!=='test')throw coded('UNSAFE_TRANSPORT');
  const controller=new AbortController();let timer;
  try{
    const ack=await Promise.race([
      Promise.resolve().then(()=>transport.deliver(envelope,{signal:controller.signal})),
      new Promise((_,reject)=>{timer=setTimeout(()=>{reject(coded('DELIVERY_TIMEOUT'));controller.abort()},timeoutMs)})
    ]);
    if(!ack||!['sent','suppressed'].includes(ack.status)||environment==='production'&&ack.status!=='sent')throw coded('INVALID_DELIVERY_ACK');
    return ack.status;
  }finally{clearTimeout(timer)}
}

/**
 * One bounded pass. It never mutates orders or rolls back a saved client action.
 * Production adapters must implement durable idempotency for envelope.idempotencyKey.
 * A lease prevents concurrent attempts; durable transport dedup handles a crash
 * between delivery acknowledgement and the following DB update.
 */
async function processNotifications({db,environment,transport,batchSize,maxAttempts,timeoutMs,leaseMs,baseDelayMs,maxDelayMs,log}={}){
  validateEnvironment(environment);
  if(!db?.transaction||!db?.query)throw Error('Transactional notification database required');
  const limit=integer(batchSize,20,1,100),attemptLimit=integer(maxAttempts,5,1,20),timeout=integer(timeoutMs,10000,10,60000);
  const lease=integer(leaseMs,Math.max(45000,timeout*2+5000),timeout+1000,300000),baseDelay=integer(baseDelayMs,15000,100,3600000),maxDelay=integer(maxDelayMs,900000,baseDelay,86400000);
  const result={claimed:0,sent:0,suppressed:0,failed:0,exhausted:0,leaseLost:0,expiredExhausted:0};
  // If the final allowed attempt crashed, make the unconfirmed delivery visible
  // to monitoring instead of leaving an unclaimable pending row forever.
  const expired=await db.query(`update client_notifications set status='failed',last_error='DELIVERY_UNCONFIRMED',lease_token=null,lease_until=null
    where status in ('pending','failed') and attempts>=$1 and lease_token is not null and lease_until<=now() returning id`,[attemptLimit]);
  result.expiredExhausted=expired.rows.length;
  for(let i=0;i<limit;i++){
    const claimed=await db.transaction(async tx=>{
      const found=await tx.query(`select n.id,n.event_id,n.account_id,n.kind,n.attempts,e.text,e.created_at
        from client_notifications n left join client_events e on e.id=n.event_id
        where n.status in ('pending','failed') and n.attempts<$1 and n.next_attempt_at<=now()
          and (n.lease_until is null or n.lease_until<=now())
        order by n.next_attempt_at,n.id for update of n skip locked limit 1`,[attemptLimit]);
      if(!found.rows.length)return null;
      const notification=found.rows[0],token=crypto.randomUUID();
      await tx.query("update client_notifications set lease_token=$2,lease_until=now()+($3::int*interval '1 millisecond'),attempts=attempts+1 where id=$1",[notification.id,token,lease]);
      return {...notification,attempts:Number(notification.attempts)+1,leaseToken:token};
    });
    if(!claimed)break;
    result.claimed++;
    // General company conversations have no order event. Their own immutable
    // queue ID is the delivery identity, so unrelated messages never collide.
    const envelope={idempotencyKey:claimed.event_id==null?'client-notification:'+String(claimed.id):'client-event:'+String(claimed.event_id),eventId:claimed.event_id==null?null:String(claimed.event_id),recipientId:String(claimed.account_id),kind:claimed.kind,text:claimed.text||(claimed.kind==='message'?'Новое сообщение компании':'Есть обновление в кабинете'),createdAt:claimed.created_at?new Date(claimed.created_at).toISOString():null};
    let status,errorCode=null;
    try{status=await attemptDelivery(transport,envelope,{environment,timeoutMs:timeout})}
    catch(error){
      const allowedCodes=new Set(['TRANSPORT_UNCONFIGURED','UNSAFE_TRANSPORT','DELIVERY_TIMEOUT','DELIVERY_ABORTED','DELIVERY_PAYLOAD_CONFLICT','INVALID_DELIVERY_ACK']);
      status='failed';errorCode=allowedCodes.has(error.code)?error.code:'DELIVERY_FAILED';
    }
    const delay=Math.min(maxDelay,baseDelay*2**Math.min(claimed.attempts-1,20));
    const saved=await db.query(`update client_notifications set status=$3,last_error=$4,
      next_attempt_at=now()+($5::int*interval '1 millisecond'),lease_token=null,lease_until=null,
      delivered_at=case when $3='sent' then now() else null end
      where id=$1 and lease_token=$2 returning id`,[claimed.id,claimed.leaseToken,status,errorCode,delay]);
    if(!saved.rows.length){result.leaseLost++;safeLog(log,{component:'client-notifications',status:'lease_lost'});continue}
    result[status]++;
    if(status==='failed'&&claimed.attempts>=attemptLimit)result.exhausted++;
    safeLog(log,{component:'client-notifications',status,attempt:claimed.attempts,...(errorCode?{code:errorCode}:{})});
  }
  return result;
}

/** Non-overlapping poller; caller must stop before closing the database. */
function startNotificationWorker(options){
  validateEnvironment(options?.environment);
  const interval=integer(options.intervalMs,30000,100,3600000);let stopped=false,timer=null,inflight=null;
  const tick=async()=>{
    if(stopped)return;
    inflight=processNotifications(options);
    try{await inflight}catch{safeLog(options.log,{component:'client-notifications',status:'worker_error',code:'QUEUE_UNAVAILABLE'})}
    finally{inflight=null;if(!stopped){timer=setTimeout(tick,interval);timer.unref?.()}}
  };
  timer=setTimeout(tick,0);timer.unref?.();
  return Object.freeze({async stop(){stopped=true;clearTimeout(timer);if(inflight)await inflight.catch(()=>{})}});
}

module.exports={processNotifications,startNotificationWorker,createLocalNotificationTransport,createSuppressedNotificationTransport};
