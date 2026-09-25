const CACHE='business-os-shell-v11';
const REV='20260925-v169';
const SHELL=['./','./index.html','./manifest.webmanifest','./brand-logo.svg'];
const VERSIONED_STATIC=/\.(?:js|css|svg|png|webp|ico|woff2?|webmanifest)$/i;
const NETWORK_FIRST_PATHS=[
  '/index.html',
  '/pwa-register.js',
  '/network-direct-v86.js',
  '/config.js',
  '/mandatory-auth-v29.js',
  '/auth-api-session-v41.js',
  '/employee-live-refresh-v27.js'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

async function networkFirst(networkRequest,cacheKey=networkRequest){
  try{
    const response=await fetch(networkRequest,{cache:'no-store'});
    if(response&&response.ok){
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(cacheKey,copy)).catch(()=>{});
    }
    return response;
  }catch(error){
    const cached=await caches.match(cacheKey);
    if(cached)return cached;
    if(cacheKey.mode==='navigate'){
      const shell=await caches.match('./index.html');
      if(shell)return shell;
    }
    throw error;
  }
}

async function cacheFirst(request){
  const cached=await caches.match(request);
  if(cached)return cached;
  const response=await fetch(request,{cache:'no-store'});
  if(response&&response.ok){
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});
  }
  return response;
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;

  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.includes('/api/')||url.pathname.includes('/.netlify/functions/'))return;

  const networkFirstRequired=request.mode==='navigate'||NETWORK_FIRST_PATHS.some(path=>url.pathname.endsWith(path));
  if(networkFirstRequired){
    let networkRequest=request;
    if(request.mode!=='navigate'&&url.pathname!=='/'&&url.pathname!=='/index.html'){
      const freshUrl=new URL(request.url);
      freshUrl.searchParams.set('_sw',REV);
      networkRequest=new Request(freshUrl.toString(),request);
    }
    event.respondWith(networkFirst(networkRequest,request));
    return;
  }

  if(VERSIONED_STATIC.test(url.pathname)&&url.searchParams.has('v')){
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
