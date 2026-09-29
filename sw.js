const BUILD_ID='50954e94c3087dc0c83b';
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
 if(Object.hasOwn(assets,name)||name==='build-version.js')event.respondWith(staticAsset(request,url,name));
});
