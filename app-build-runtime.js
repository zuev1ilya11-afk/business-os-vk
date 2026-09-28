(()=>{
'use strict';
const build=window.BOS_BUILD?.id;
if(!build)throw new Error('Missing application build');
window.BOS_ASSET_URL=src=>{
 const url=new URL(src,document.baseURI);
 if(url.origin!==location.origin)return src;
 url.searchParams.delete('v');url.searchParams.delete('_sw');url.searchParams.set('build',build);
 return url.href;
};
window.BOS_APP_VERSION=build;
let reloading=false,requested=false;
window.BOS_WATCH_UPDATE=registration=>{
 function offer(){
  if(!registration.waiting||document.getElementById('bosBuildUpdate'))return;
  const box=document.createElement('aside');box.id='bosBuildUpdate';box.setAttribute('role','status');
  box.style.cssText='position:fixed;bottom:80px;left:12px;right:12px;z-index:9999999;padding:12px;background:#14273a;color:#fff;border:1px solid #49779b;border-radius:12px;display:flex;gap:12px;align-items:center;justify-content:space-between';
  const text=document.createElement('span');text.textContent='Доступна новая версия. Сохраните изменения перед обновлением.';
  const button=document.createElement('button');button.type='button';button.textContent='Обновить';
  button.onclick=()=>{if(!registration.waiting)return;requested=true;button.disabled=true;registration.waiting.postMessage({type:'BOS_ACTIVATE_BUILD'})};
  box.append(text,button);document.body.appendChild(box);
 }
 offer();registration.addEventListener('updatefound',()=>{
  const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed')offer()});
 });
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(!requested||reloading)return;reloading=true;location.reload();
 });
 let lastCheck=Date.now();
 document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&Date.now()-lastCheck>60000){lastCheck=Date.now();registration.update().catch(()=>{})}
 });
};
})();
