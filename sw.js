const BUILD_ID='6f4f61bdb8469b18b1f8';
importScripts('./build-version.js?build='+BUILD_ID);
if(self.BOS_BUILD.id!==BUILD_ID)throw new Error('Mixed deployment: build manifest mismatch');
const PREFIX='business-os-build-';
const CACHE=PREFIX+BUILD_ID;
const assets=self.BOS_BUILD.assets;
const scope=new URL('./',self.location.href);
const assetURL=name=>new URL(name+'?build='+BUILD_ID,scope).href;
async function matchesDigest(response,expected){
 if(!response.ok)return false;
 const digest=await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer());
 return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')===expected;
}
async function verifiedAsset(name){
 const response=await fetch(assetURL(name),{cache:'no-store'});
 if(!await matchesDigest(response,assets[name]))throw new Error('Missing or mixed deployment asset: '+name);
 return response;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 const names=Object.keys(assets);
 // Bound concurrency; activate only when the entire shell and role assets are available.
 await Promise.all(Array.from({length:6},async()=>{while(names.length){const name=names.pop();await cache.put(assetURL(name),await verifiedAsset(name))}}));
 const manifest=await fetch(new URL('build-version.js?build='+BUILD_ID,scope),{cache:'no-store'});
 if(!manifest.ok||!(await manifest.clone().text()).includes('"id":"'+BUILD_ID+'"'))throw new Error('Mixed deployment manifest');
 await cache.put(assetURL('build-version.js'),manifest);
 const shell=await fetch(new URL('index.html?build='+BUILD_ID,scope),{cache:'no-store'});
 if(!await matchesDigest(shell,self.BOS_BUILD.shell))throw new Error('Mixed deployment shell');
 await cache.put(new URL('index.html',scope),shell);
 // A waiting update is activated only after the user has saved their work.
})()));
self.addEventListener('message',event=>{
 if(event.data?.type==='BOS_ACTIVATE_BUILD')event.waitUntil(self.skipWaiting());
 if(event.data?.type==='BOS_GET_BUILD')event.ports?.[0]?.postMessage({build:BUILD_ID});
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=await caches.keys();
 // Keep the previous build for tabs which have not accepted the update yet.
 const complete=[];
 for(const key of keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE)){if(await (await caches.open(key)).match(new URL('index.html',scope)))complete.push(key)}
 const previous=complete.slice(-1)[0];
 const multipleTabs=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).length>1;
 await Promise.all(keys.filter(key=>(key.startsWith('business-os-shell-')||key.startsWith(PREFIX))&&key!==CACHE&&key!==previous&&!(multipleTabs&&(complete.includes(key)||key.startsWith('business-os-shell-')))).map(key=>caches.delete(key)));
 await self.clients.claim();
})()));
async function navigation(request){
 // The installed shell is digest-verified and matches this worker's assets.
 // Worker update checks still discover new builds without delaying navigation.
 const cache=await caches.open(CACHE);
 const shell=await cache.match(new URL('index.html',scope));
 if(shell)return shell;
 try{
  const response=await fetch(request,{cache:'no-store'});
  if(await matchesDigest(response,self.BOS_BUILD.shell))return response;
  throw new Error('Navigation unavailable');
 }catch(error){const cache=await caches.open(CACHE);const shell=await cache.match(new URL('index.html',scope));if(shell)return shell;throw error}
}
async function staticAsset(request,url,name){
 // Legacy tabs keep their exact cached URLs during migration.
 if(url.searchParams.has('v')&&!url.searchParams.has('build'))return (await caches.match(request))||new Response('Reload to update this application',{status:409});
 const version=url.searchParams.get('build')||BUILD_ID;
 const cache=await caches.open(PREFIX+version);
 const key=new URL(name+'?build='+version,scope).href;
 const hit=await cache.match(key);if(hit)return hit;
 // Do not silently substitute another build, or HTML for a missing script.
 if(version===BUILD_ID&&assets[name]){const response=await verifiedAsset(name);await cache.put(key,response.clone());return response}
 return new Response('Requested build is unavailable; reload to update',{status:409});
}
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET')return;
 const url=new URL(request.url);if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
 const name=url.pathname.slice(scope.pathname.length);
 if(request.mode==='navigate'){event.respondWith(navigation(request));return}
 // Bundled source URLs still belong to older tabs; serve their exact previous cache.
 if(Object.hasOwn(assets,name)||Object.hasOwn(self.BOS_BUILD.assetBundles||{},name)||name==='build-version.js')event.respondWith(staticAsset(request,url,name));
});

// Web Push uses a separate small state cache; app-build cache rotation must not remove the device binding.
const PUSH_STATE='bos-push-state-v1';
let pushStateChanges=Promise.resolve();
const pushStateURL=new URL('__push_binding__',scope).href;
async function pushBinding(){try{await pushStateChanges.catch(()=>{});return await (await (await caches.open(PUSH_STATE)).match(pushStateURL))?.json()||null}catch{return null}}
function pushOrderURL(id){
 const url=new URL('./',scope);
 if(/^\d{1,20}$/.test(String(id||'')))url.searchParams.set('bos_push_order',String(id));
 return url.href;
}
self.addEventListener('message',event=>{
 if(!['BOS_PUSH_BIND','BOS_PUSH_CLEAR'].includes(event.data?.type))return;
 const task=pushStateChanges.catch(()=>{}).then(async()=>{
  const source=event.source;
  if(!source?.url||new URL(source.url).origin!==scope.origin||!new URL(source.url).pathname.startsWith(scope.pathname))throw new Error('Invalid push client');
  const cache=await caches.open(PUSH_STATE);
  if(event.data.type==='BOS_PUSH_CLEAR'){
   await cache.delete(pushStateURL);
   const shown=await self.registration.getNotifications();
   shown.filter(n=>String(n.tag||'').startsWith('bos-push-')).forEach(n=>n.close());
  }else{
   const id=String(event.data.binding_id||'');
   if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error('Invalid binding');
   await cache.put(pushStateURL,new Response(JSON.stringify({binding_id:id}),{headers:{'Content-Type':'application/json'}}));
  }
 });
 pushStateChanges=task;
 event.waitUntil(task.then(()=>event.ports?.[0]?.postMessage({ok:true}),()=>event.ports?.[0]?.postMessage({ok:false})));
});
self.addEventListener('push',event=>event.waitUntil((async()=>{
 let data;try{data=event.data?.json()}catch{return}
 const binding=await pushBinding();
 if(!binding||data?.v!==1||data.binding_id!==binding.binding_id||!(/^[a-f0-9-]{36}$/i.test(String(data.event_id||''))))return;
 const expires=Date.parse(data.expires_at);
 if(!Number.isFinite(expires)||expires<=Date.now())return;
 const id=/^\d{1,20}$/.test(String(data.order_id||''))?String(data.order_id):null;
 await self.registration.showNotification(String(data.title||'Business OS').slice(0,100),{
  body:String(data.body||'Откройте приложение.').slice(0,180),
  icon:new URL('app-icon.svg',scope).href,
  tag:'bos-push-'+data.event_id,renotify:false,
  data:{order_id:id,binding_id:binding.binding_id,url:pushOrderURL(id)}
 });
})()));
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const data=event.notification.data||{},binding=await pushBinding();
  if(!binding||binding.binding_id!==data.binding_id)return;
  const url=pushOrderURL(data.order_id),windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const client=windows.find(c=>{const u=new URL(c.url);return u.origin===scope.origin&&u.pathname.startsWith(scope.pathname)});
  if(client){client.postMessage({type:'BOS_PUSH_OPEN',order_id:data.order_id,binding_id:binding.binding_id});await client.focus()}
  else await self.clients.openWindow(url);
 })());
});
self.addEventListener('pushsubscriptionchange',event=>event.waitUntil((async()=>{
 await (await caches.open(PUSH_STATE)).delete(pushStateURL);
 const windows=await self.clients.matchAll({type:'window'});
 windows.forEach(client=>client.postMessage({type:'BOS_PUSH_RECONNECT'}));
})()));
