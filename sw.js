const CACHE='business-os-shell-v10';
const REV='20260925-v167';
const SHELL=['./','./index.html','./manifest.webmanifest','./brand-logo.svg'];

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

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;

  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.includes('/api/')||url.pathname.includes('/.netlify/functions/'))return;

  event.respondWith((async()=>{
    try{
      let networkRequest=request;
      if(url.pathname.endsWith('/pwa-register.js')||url.pathname.endsWith('/master-order-focus-v126.js')||url.pathname.endsWith('/network-direct-v86.js')){
        const freshUrl=new URL(request.url);
        freshUrl.searchParams.set('_sw',REV);
        networkRequest=new Request(freshUrl.toString(),request);
      }
      const response=await fetch(networkRequest,{cache:'no-store'});
      if(response&&response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});
      }
      return response;
    }catch(error){
      const cached=await caches.match(request);
      if(cached)return cached;
      if(request.mode==='navigate'){
        const shell=await caches.match('./index.html');
        if(shell)return shell;
      }
      throw error;
    }
  })());
});
