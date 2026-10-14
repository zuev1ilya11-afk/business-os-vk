const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {MessageChannel}=require('node:worker_threads');
const source=fs.readFileSync('web-push-v211.js','utf8');
const publicKey=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url');
const previousKey=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,2)]).toString('base64url');
const endpoint='https://web.push.apple.com/old-device';
const binding='b1111111-1111-4111-8111-111111111111';
const renewedBinding='c1111111-1111-4111-8111-111111111111';
const savedDevice=()=>({account:'staff_1',endpoint,binding_id:binding,revoke_token:'a'.repeat(43),updated_at:new Date().toISOString()});

function fixture(options={}){
 const elements=new Map(),events={},documentEvents={},requests=[],messages=[],browserCalls=[];
 const memory=new Map([['bos_vk_session_v2','staff_1.signed-session']]);
 if(options.saved)memory.set('bos_push_device_v1',JSON.stringify(options.saved));
 const storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key)};
 const notification={permission:options.permission||'granted',requestPermission(){browserCalls.push('permission');return Promise.resolve(notification.permission)}};
 const makeSubscription=(url,key)=>({endpoint:url,options:{applicationServerKey:Uint8Array.from(Buffer.from(key,'base64url')).buffer},toJSON:()=>({endpoint:url,keys:{p256dh:publicKey,auth:'a'.repeat(22)}}),unsubscribe:async()=>{browserCalls.push('unsubscribe');subscription=null;return true}});
 let subscription=options.subscription===false?null:makeSubscription(endpoint,options.subscriptionKey||publicKey);
 const registration={active:{postMessage:(data,ports)=>{messages.push(data);ports[0].postMessage({ok:true})}},pushManager:{
  getSubscription:async()=>subscription,
  subscribe:async config=>{browserCalls.push('subscribe');if(options.subscribeError)throw new Error(options.subscribeError);subscription=makeSubscription('https://web.push.apple.com/new-device',Buffer.from(config.applicationServerKey).toString('base64url'));return subscription}
 }};
 const document={body:{classList:{contains:()=>true}},hidden:false,getElementById:id=>elements.get(id)||null,querySelector:()=>null,addEventListener:(name,handler)=>{documentEvents[name]=handler}};
 const navigator={userAgent:options.ios?'iPhone':'Chrome',standalone:!!options.ios,serviceWorker:{ready:Promise.resolve(registration),addEventListener(){}},maxTouchPoints:0};
 const window={PushManager:function(){},Notification:notification,matchMedia:()=>({matches:!!options.ios}),addEventListener:(name,handler)=>{events[name]=handler},confirm:()=>true};
 const fetch=async(url,init)=>{
  const data=JSON.parse(init.body);requests.push(data);
  if(options.beforeResponse)await options.beforeResponse(data);
  let result={ok:true};
  if(data.action==='status')result={ok:true,account:'staff_1',public_key:publicKey,connected:options.connected!==false,device:options.connected===false?null:{binding_id:options.serverBinding||binding}};
  if(data.action==='subscribe')result={ok:true,account:'staff_1',device:{binding_id:renewedBinding,expires_at:new Date(Date.now()+86400000).toISOString()}};
  return Response.json(result);
 };
 const context={window,document,navigator,Notification:notification,isSecureContext:true,localStorage:storage,sessionStorage:storage,crypto:webcrypto,MessageChannel,fetch,AbortController,URL,Response,Uint8Array,atob,btoa,setTimeout,clearTimeout,requestAnimationFrame:()=>{},MutationObserver:class{observe(){}},location:new URL('https://139.100.237.167/'),history:{replaceState(){}},openModal(){
  for(const id of ['bosPushMessage','bosPushEnable','bosPushTest','bosPushDisable'])elements.set(id,{textContent:'',hidden:id!=='bosPushMessage'&&id!=='bosPushEnable',disabled:true});
 }};
 vm.runInNewContext(source,context);
 return {push:window.BOS_PUSH,events,documentEvents,notification,requests,messages,browserCalls,elements,storage,get saved(){return JSON.parse(storage.getItem('bos_push_device_v1')||'null')},get subscription(){return subscription}};
}
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2))}assert.fail('Push client did not reach the expected state')}

test('push client: recent consented device repairs a changed server binding without prompting or resubscribing',async()=>{
 const f=fixture({saved:savedDevice(),serverBinding:renewedBinding});
 await until(()=>f.messages.some(message=>message.type==='BOS_PUSH_BIND'));
 assert.equal(f.saved.binding_id,renewedBinding);
 assert.equal(f.requests.filter(request=>request.action==='subscribe').length,1);
 assert.deepEqual(f.browserCalls,[]);
 assert.equal(f.messages.at(-1).binding_id,renewedBinding);
});

test('push client: recent consented device restores a missing migrated server subscription',async()=>{
 const f=fixture({saved:savedDevice(),connected:false});
 await until(()=>f.messages.some(message=>message.type==='BOS_PUSH_BIND'));
 assert.equal(f.requests.filter(request=>request.action==='subscribe').length,1);
 assert.equal(f.saved.binding_id,renewedBinding);
 assert.deepEqual(f.browserCalls,[]);
});

test('push client: current server binding does not recreate or renew a recent subscription',async()=>{
 const f=fixture({saved:savedDevice()});
 await until(()=>f.messages.some(message=>message.type==='BOS_PUSH_BIND'));
 assert.equal(f.requests.filter(request=>request.action==='status').length,1);
 assert.equal(f.requests.some(request=>request.action==='subscribe'),false);
 assert.equal(f.saved.binding_id,binding);
 assert.deepEqual(f.browserCalls,[]);
});

test('push client: granted permission without a saved device never opts in on resume',async()=>{
 const f=fixture({subscription:false});
 f.events.pageshow();f.documentEvents.visibilitychange();
 f.push.open();await f.push.refresh();
 assert.equal(f.requests.some(request=>request.action==='subscribe'),false);
 assert.equal(f.messages.some(message=>message.type==='BOS_PUSH_BIND'),false);
 assert.deepEqual(f.browserCalls,[]);
 assert.equal(f.elements.get('bosPushEnable').disabled,false);
});

test('push client: logout during migration renewal cannot restore the previous worker binding',async()=>{
 let release;const waiting=new Promise(resolve=>{release=resolve});
 const f=fixture({saved:savedDevice(),connected:false,beforeResponse:data=>data.action==='subscribe'?waiting:undefined});
 await until(()=>f.requests.some(request=>request.action==='subscribe'));
 const clearing=f.push.disconnect({logout:true});release();await clearing;
 await until(()=>f.requests.some(request=>request.action==='revoke'));
 assert.equal(f.saved,null);
 assert.equal(f.messages.some(message=>message.type==='BOS_PUSH_BIND'),false);
 assert.equal(f.subscription,null);
});

test('push client: VAPID rotation requires an explicit reconnect and replaces the old browser subscription',async()=>{
 const f=fixture({saved:savedDevice(),subscriptionKey:previousKey});
 await new Promise(resolve=>setTimeout(resolve,20));
 f.push.open();await f.push.refresh();
 assert.equal(f.elements.get('bosPushEnable').hidden,false);
 assert.equal(f.elements.get('bosPushEnable').disabled,false);
 assert.match(f.elements.get('bosPushMessage').textContent,/Переподключите/);
 assert.deepEqual(f.browserCalls,[]);
 assert.equal(f.requests.some(request=>request.action==='subscribe'),false);
 assert.equal(f.messages.some(message=>message.type==='BOS_PUSH_BIND'),false);
 await f.elements.get('bosPushEnable').onclick();
 assert.deepEqual(f.browserCalls,['unsubscribe','subscribe']);
 assert.equal(f.subscription.endpoint,'https://web.push.apple.com/new-device');
 assert.equal(f.saved.public_key,publicKey);
 assert.equal(f.saved.binding_id,renewedBinding);
 assert.equal(f.requests.find(request=>request.action==='subscribe').subscription.endpoint,f.subscription.endpoint);
});

test('push client: failed key rotation retires the old device and keeps an explicit retry available',async()=>{
 const f=fixture({saved:savedDevice(),subscriptionKey:previousKey,subscribeError:'Browser subscription unavailable'});
 await until(()=>f.messages.some(message=>message.type==='BOS_PUSH_CLEAR'));
 f.push.open();await f.push.refresh();
 await f.elements.get('bosPushEnable').onclick();
 assert.equal(f.subscription,null);
 assert.equal(f.saved,null);
 assert.equal(f.elements.get('bosPushEnable').hidden,false);
 assert.equal(f.elements.get('bosPushEnable').disabled,false);
 assert.equal(f.elements.get('bosPushTest').hidden,true);
 assert.match(f.elements.get('bosPushMessage').textContent,/Browser subscription unavailable/);
 assert.equal(f.requests.some(request=>request.action==='subscribe'),false);
 assert.equal(f.requests.some(request=>request.action==='revoke'&&request.endpoint===endpoint),true);
});

test('push client: late same-account repair never revokes the device another tab still owns',async()=>{
 let release;const waiting=new Promise(resolve=>{release=resolve});
 const f=fixture({saved:savedDevice(),connected:false,beforeResponse:data=>data.action==='subscribe'?waiting:undefined});
 await until(()=>f.requests.some(request=>request.action==='subscribe'));
 f.push.open();await f.push.refresh();
 const statusBefore=f.requests.filter(request=>request.action==='status').length;
 const repaired={...savedDevice(),binding_id:renewedBinding,public_key:publicKey};
 f.storage.setItem('bos_push_device_v1',JSON.stringify(repaired));
 f.events.storage({key:'bos_push_device_v1'});f.events.pageshow();release();
 await until(()=>f.requests.filter(request=>request.action==='status').length>statusBefore);
 assert.equal(f.requests.some(request=>request.action==='revoke'),false);
 assert.deepEqual(f.saved,repaired);
 assert.deepEqual(f.browserCalls,[]);
});

test('push client: late explicit enable preserves a subscription another same-account tab repaired',async()=>{
 let release;const waiting=new Promise(resolve=>{release=resolve});
 const f=fixture({serverBinding:renewedBinding,beforeResponse:data=>data.action==='subscribe'?waiting:undefined});
 f.push.open();await f.push.refresh();
 const enabling=f.elements.get('bosPushEnable').onclick();
 await until(()=>f.requests.some(request=>request.action==='subscribe'));
 const repaired={...f.saved,binding_id:renewedBinding,public_key:publicKey,updated_at:new Date().toISOString()};
 f.storage.setItem('bos_push_device_v1',JSON.stringify(repaired));f.events.storage({key:'bos_push_device_v1'});release();await enabling;
 assert.equal(f.requests.some(request=>request.action==='revoke'),false);
 assert.deepEqual(f.saved,repaired);
 assert.equal(f.subscription.endpoint,repaired.endpoint);
 assert.deepEqual(f.browserCalls,['unsubscribe','subscribe']);
 assert.equal(f.elements.get('bosPushEnable').hidden,true);
 assert.equal(f.elements.get('bosPushTest').hidden,false);
});

test('push client: late failed enable preserves a subscription another same-account tab repaired',async()=>{
 let reject;const waiting=new Promise((resolve,rejectRequest)=>{reject=rejectRequest});
 const f=fixture({serverBinding:renewedBinding,beforeResponse:data=>data.action==='subscribe'?waiting:undefined});
 f.push.open();await f.push.refresh();
 const enabling=f.elements.get('bosPushEnable').onclick();
 await until(()=>f.requests.some(request=>request.action==='subscribe'));
 const repaired={...f.saved,binding_id:renewedBinding,public_key:publicKey,updated_at:new Date().toISOString()};
 f.storage.setItem('bos_push_device_v1',JSON.stringify(repaired));f.events.storage({key:'bos_push_device_v1'});reject(new TypeError('Failed to fetch'));await enabling;
 assert.equal(f.requests.some(request=>request.action==='revoke'),false);
 assert.deepEqual(f.saved,repaired);
 assert.equal(f.subscription.endpoint,repaired.endpoint);
 assert.deepEqual(f.browserCalls,['unsubscribe','subscribe']);
 assert.equal(f.elements.get('bosPushEnable').hidden,true);
 assert.equal(f.elements.get('bosPushTest').hidden,false);
});

test('push client: current enable failure cleans up its incomplete device and leaves retry available',async()=>{
 const f=fixture({beforeResponse:data=>{if(data.action==='subscribe')throw new TypeError('Failed to fetch')}});
 f.push.open();await f.push.refresh();
 await f.elements.get('bosPushEnable').onclick();
 assert.equal(f.saved,null);
 assert.equal(f.subscription,null);
 assert.equal(f.requests.some(request=>request.action==='revoke'&&request.endpoint==='https://web.push.apple.com/new-device'),true);
 assert.equal(f.elements.get('bosPushEnable').hidden,false);
 assert.equal(f.elements.get('bosPushTest').hidden,true);
});

test('push client: logout before a late enable failure still revokes and clears the incomplete device',async()=>{
 let reject;const waiting=new Promise((resolve,rejectRequest)=>{reject=rejectRequest});
 const f=fixture({beforeResponse:data=>data.action==='subscribe'?waiting:undefined});
 f.push.open();await f.push.refresh();
 const enabling=f.elements.get('bosPushEnable').onclick();
 await until(()=>f.requests.some(request=>request.action==='subscribe'));
 await f.push.disconnect({logout:true});reject(new TypeError('Failed to fetch'));await enabling;
 assert.equal(f.saved,null);
 assert.equal(f.subscription,null);
 assert.equal(f.requests.some(request=>request.action==='revoke'&&request.endpoint==='https://web.push.apple.com/new-device'),true);
 assert.equal(f.messages.some(message=>message.type==='BOS_PUSH_BIND'),false);
});

test('push client: denied iPhone permission explains settings and the current Home Screen address',async()=>{
 const f=fixture({permission:'denied',subscription:false,ios:true});
 f.push.open();await f.push.refresh();
 assert.equal(f.elements.get('bosPushEnable').disabled,true);
 assert.match(f.elements.get('bosPushMessage').textContent,/Настройки.*Уведомления.*Business OS/);
 assert.match(f.elements.get('bosPushMessage').textContent,/139\.100\.237\.167/);
 assert.deepEqual(f.browserCalls,[]);
 assert.equal(f.requests.some(request=>request.action==='subscribe'),false);
});

test('push client: returning from system settings refreshes denied controls without requesting permission',async()=>{
 const f=fixture({permission:'denied',subscription:false,ios:true});
 f.push.open();await f.push.refresh();
 assert.equal(f.elements.get('bosPushEnable').disabled,true);
 f.notification.permission='granted';f.documentEvents.visibilitychange();
 await until(()=>f.elements.get('bosPushEnable').disabled===false);
 assert.deepEqual(f.browserCalls,[]);
 assert.equal(f.requests.some(request=>request.action==='subscribe'),false);
});
