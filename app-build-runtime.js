(()=>{
'use strict';
const build=window.BOS_BUILD?.id;
if(!build)throw new Error('Missing application build');
window.BOS_ASSET_URL=src=>{
 const url=new URL(src,document.baseURI);
 if(url.origin!==location.origin)return src;
 const root=new URL('./',document.baseURI);
 const name=url.pathname.startsWith(root.pathname)?url.pathname.slice(root.pathname.length):'';
 const bundle=window.BOS_BUILD.assetBundles?.[name];
 if(bundle)url.pathname=new URL(bundle,root).pathname;
 url.searchParams.delete('v');url.searchParams.delete('_sw');url.searchParams.set('build',build);
 return url.href;
};
window.BOS_APP_VERSION=build;
let reloading=false,requested=false,deferred=false,activeMismatch=false;
window.BOS_WATCH_UPDATE=registration=>{
 function offer(activeChanged=false){
  activeMismatch=activeMismatch||activeChanged;
  activeChanged=activeMismatch;
  if(!navigator.serviceWorker.controller&&!activeChanged)return;
  if((!registration.waiting&&!activeChanged)||document.getElementById('bosBuildUpdate'))return;
  const box=document.createElement('aside');box.id='bosBuildUpdate';box.setAttribute('role','status');
  box.style.cssText='position:fixed;bottom:80px;left:12px;right:12px;z-index:9999999;padding:12px;background:#14273a;color:#fff;border:1px solid #49779b;border-radius:12px;display:flex;gap:12px;align-items:center;justify-content:space-between';
  const text=document.createElement('span');text.textContent='Доступна новая версия. Сохраните изменения перед обновлением.';
  const button=document.createElement('button');button.type='button';button.textContent='Обновить';
  button.onclick=()=>{requested=true;button.disabled=true;if(registration.waiting)registration.waiting.postMessage({type:'BOS_ACTIVATE_BUILD'});else if(!reloading){reloading=true;location.reload()}};
  const later=document.createElement('button');later.type='button';later.textContent='Позже';later.onclick=()=>{deferred=true;box.remove()};
  box.append(text,button,later);document.body.appendChild(box);
 }
 offer();registration.addEventListener('updatefound',()=>{
  const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed')offer()});
 });
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(reloading)return;
  if(requested){reloading=true;location.reload();return}
  // Another tab may activate the waiting worker; preserve this tab's draft.
  const channel=new MessageChannel();
  channel.port1.onmessage=event=>{if(event.data?.build&&event.data.build!==build)offer(true);channel.port1.close()};
  navigator.serviceWorker.controller?.postMessage({type:'BOS_GET_BUILD'},[channel.port2]);
 });
 let lastCheck=Date.now();
 const resume=()=>{
  if(document.visibilityState!=='visible')return;
  if(deferred){deferred=false;offer()}
  if(Date.now()-lastCheck>60000){lastCheck=Date.now();registration.update().catch(()=>{})}
 };
 window.addEventListener('focus',resume);
 document.addEventListener('visibilitychange',resume);
};
})();
