(()=>{
'use strict';
if(window.BOS_PUSH)return;
const STORAGE='bos_push_device_v1',REVOKES='bos_push_revokes_v1';
const API='https://business-os-api-gateway.netlify.app/api/proxy/push-api';
const SESSION='bos_vk_session_v2';
let busy=false,configValue=null,registration=null,connectPromise=null,lastAccount='',deepLinkBusy=false,generation=0,pendingOrder=null;
const read=(key,fallback=null)=>{try{return JSON.parse(localStorage.getItem(key)||'null')||fallback}catch{return fallback}};
function write(key,value){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(value))}
const token=()=>{try{return sessionStorage.getItem(SESSION)||localStorage.getItem(SESSION)||''}catch{return ''}};
const account=()=>token().split('.')[0]||''; // Only change detection; the server validates the complete signed session.
function currentTab(){try{const shared=localStorage.getItem(SESSION)||'';return localStorage.getItem('bos_manual_logout_v1')!=='1'&&(!shared||shared.split('.')[0]===account())}catch{return false}}
const ready=()=>document.body.classList.contains('bos-auth-ok')&&!!token()&&currentTab();
const supported=()=>isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const ios=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const installed=()=>navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches;
const toBytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const randomToken=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
function message(text){const target=document.getElementById('bosPushMessage');if(target)target.textContent=text}
function timeout(promise,milliseconds=10000){let id;return Promise.race([promise,new Promise((_,reject)=>{id=setTimeout(()=>reject(new Error('Телефон не ответил. Повторите попытку.')),milliseconds)})]).finally(()=>clearTimeout(id))}
async function serviceWorker(){
  if(registration?.active)return registration;
  registration=await timeout(navigator.serviceWorker.ready);
  return registration;
}
async function swMessage(type,value){
  const reg=await serviceWorker(),worker=reg.active;
  if(type==='BOS_PUSH_BIND'&&(!ready()||read(STORAGE)?.binding_id!==value.binding_id))throw new Error('Подключение изменилось.');
  if(!worker)throw new Error('Перезапустите приложение для подключения уведомлений.');
  const channel=new MessageChannel();
  const result=new Promise((resolve,reject)=>{
    channel.port1.onmessage=event=>event.data?.ok?resolve(true):reject(new Error('Не удалось сохранить настройки телефона.'));
    worker.postMessage({type,...value},[channel.port2]);
  });
  try{return await timeout(result,5000)}finally{channel.port1.close();channel.port2.close()}
}
async function request(action,data={},options={}){
  const headers={'Content-Type':'application/json'},session=options.session===undefined?token():options.session;
  if(session)headers['X-BOS-Session']=session;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
  try{
    const response=await fetch(API,{method:'POST',headers,body:JSON.stringify({action,...data}),signal:controller.signal,keepalive:!!options.keepalive});
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok){const error=new Error(result.error||'Не удалось связаться с сервером уведомлений.');error.status=response.status;error.resetRequired=!!result.reset_required;throw error}
    return result;
  }catch(error){if(error.name==='AbortError')throw new Error('Сервер уведомлений не ответил. Проверьте интернет.');throw error}
  finally{clearTimeout(timer)}
}
function revokeLater(device){
  if(!device?.endpoint||!device.revoke_token)return;
  const all=read(REVOKES,[]).filter(x=>x.endpoint!==device.endpoint);
  all.push({endpoint:device.endpoint,revoke_token:device.revoke_token});
  write(REVOKES,all.slice(-8));
}
async function flushRevokes(){
  for(const item of read(REVOKES,[])){
    try{
      await request('revoke',item,{session:'',keepalive:true});
      write(REVOKES,read(REVOKES,[]).filter(x=>x.endpoint!==item.endpoint||x.revoke_token!==item.revoke_token));
    }catch{return}
  }
}
async function disconnect({logout=false}={}){
  generation++;pendingOrder=null;
  const saved=read(STORAGE);if(saved)revokeLater(saved);
  write(STORAGE,null);configValue=null;
  // Clear the worker binding before network cleanup, including when the device is offline.
  if('serviceWorker' in navigator){
    try{await swMessage('BOS_PUSH_CLEAR',{})}catch{}
    try{const reg=await serviceWorker();const sub=await reg.pushManager.getSubscription();if(sub)await sub.unsubscribe()}catch{}
  }
  const revoke=flushRevokes();
  if(!logout)await revoke;
}
function uiState(){
  if(ios()&&!installed())return 'На iPhone откройте меню браузера → «На экран Домой», затем запустите приложение с новой иконки.';
  if(!supported())return 'Откройте установленное приложение или Chrome / Firefox. Встроенный браузер VK может не поддерживать Web Push.';
  if(Notification.permission==='denied')return 'Уведомления запрещены. Разрешите их в настройках браузера и телефона, затем вернитесь сюда.';
  return 'Проверяем подключение…';
}
function controls(enabled){
  const enable=document.getElementById('bosPushEnable'),test=document.getElementById('bosPushTest'),disable=document.getElementById('bosPushDisable');
  if(enable){enable.hidden=enabled;enable.disabled=busy||!ready()||!supported()||(ios()&&!installed())||Notification.permission==='denied'||!configValue}
  if(test){test.hidden=!enabled;test.disabled=busy}
  if(disable){disable.hidden=!enabled&&!read(STORAGE);disable.disabled=busy}
}
async function refresh(){
  if(!document.getElementById('bosPushMessage'))return;
  message(uiState());controls(false);
  if(!ready()||!supported()||(ios()&&!installed()))return;
  const run=generation;
  try{
    const reg=await serviceWorker(),sub=await reg.pushManager.getSubscription(),saved=read(STORAGE);
    const result=await request('status',{endpoint:sub?.endpoint||''});
    if(run!==generation||!ready()||result.account!==account())return;
    configValue=result;
    const enabled=Notification.permission==='granted'&&!!sub&&saved?.account===result.account&&saved?.endpoint===sub.endpoint&&
      result.connected&&saved?.binding_id===result.device?.binding_id;
    controls(enabled);
    if(enabled){
      await swMessage('BOS_PUSH_BIND',{binding_id:saved.binding_id});
      message('Подключены на этом телефоне. Уведомления приходят для вашего аккаунта, даже когда приложение закрыто.');
    }else message(Notification.permission==='denied'?uiState():'Не подключены на этом телефоне. Нажмите «Включить уведомления».');
  }catch(error){message(error.message);controls(false)}
}
async function enable(){
  if(busy||!ready()||!supported()||!configValue)return;
  busy=true;controls(false);message('Запрашиваем разрешение телефона…');
  // Permission is requested directly in the click handler, before the first await (required on iOS).
  const permission=Notification.permission==='granted'?Promise.resolve('granted'):Notification.requestPermission();
  const currentAccount=account(),run=generation,publicKey=configValue.public_key;
  let subscribed=null,device=null;
  try{
    if(await permission!=='granted')throw new Error('Разрешение не получено. Уведомления не включены.');
    if(run!==generation||!ready()||account()!==currentAccount)throw new Error('Аккаунт изменился. Войдите снова.');
    const reg=await serviceWorker();
    const existing=await reg.pushManager.getSubscription(),saved=read(STORAGE);
    if(existing&&saved?.account===currentAccount&&saved?.endpoint===existing.endpoint){subscribed=existing;device=saved}
    else{if(existing)await existing.unsubscribe();subscribed=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:toBytes(publicKey)})}
    if(run!==generation||!ready()||account()!==currentAccount)throw new Error('Аккаунт изменился. Подключение отменено.');
    device=device||{account:currentAccount,endpoint:subscribed.endpoint,revoke_token:randomToken()};
    // Persist the revocation capability before the server request so an interrupted registration can be cleaned up.
    write(STORAGE,device);
    const response=await request('subscribe',{subscription:subscribed.toJSON(),revoke_token:device.revoke_token});
    device={...device,...response.device,account:response.account};
    if(run!==generation||!ready()||account()!==currentAccount||read(STORAGE)?.revoke_token!==device.revoke_token){
      revokeLater(device);await flushRevokes();throw new Error('Аккаунт изменился. Подключение отменено.');
    }
    write(STORAGE,device);
    await swMessage('BOS_PUSH_BIND',{binding_id:device.binding_id});
    message('Уведомления включены. Нажмите «Отправить тестовое уведомление».');
  }catch(error){
    if(device){revokeLater(device);if(read(STORAGE)?.revoke_token===device.revoke_token)write(STORAGE,null);void flushRevokes()}
    if(subscribed)try{await subscribed.unsubscribe()}catch{}
    message(error.message);
  }finally{busy=false;controls(!!read(STORAGE)?.binding_id)}
}
async function test(){
  const saved=read(STORAGE);if(busy||!saved||saved.account!==account())return;
  busy=true;controls(true);
  try{await request('test',{endpoint:saved.endpoint,revoke_token:saved.revoke_token});message('Тест поставлен в очередь. Заблокируйте экран и проверьте уведомление Business OS. Доставка может задерживаться из-за сети или настроек телефона.')}
  catch(error){message(error.message)}finally{busy=false;controls(true)}
}
function open(){
  if(!ready())return;
  openModal('<h2>Уведомления на этом телефоне</h2><section class="card"><p id="bosPushMessage" class="muted" role="status" aria-live="polite"></p><button id="bosPushEnable" type="button" class="primary wide" disabled>Включить уведомления</button><button id="bosPushTest" type="button" class="primary wide" hidden>Отправить тестовое уведомление</button><button id="bosPushDisable" type="button" class="secondary wide" style="margin-top:10px" hidden>Отключить на этом телефоне</button></section><p class="muted">Подписка относится к аккаунту, с которым выполнен вход. Просмотр кабинета другого сотрудника не меняет получателя. Адреса, телефоны клиентов и суммы в уведомлениях не показываются.</p>');
  document.getElementById('bosPushEnable').onclick=enable;
  document.getElementById('bosPushTest').onclick=test;
  document.getElementById('bosPushDisable').onclick=async()=>{if(busy)return;busy=true;controls(true);try{await disconnect();message('Уведомления на этом телефоне отключены.')}catch{message('Не удалось завершить отключение. Повторите попытку.')}finally{busy=false;await refresh()}};
  void refresh();
}
function addProfileEntry(){
  if(!ready())return;
  const modal=document.querySelector('#modalRoot .modal');
  let root=modal&&/профиль|business os/i.test(modal.querySelector('h2')?.textContent||'')?modal:null;
  try{if(!root&&state.page==='team'&&state.user?.role==='master')root=document.getElementById('content')}catch{}
  if(!root||root.querySelector('[data-bos-push-entry]'))return;
  const section=document.createElement('section');section.className='card';section.dataset.bosPushEntry='1';
  section.innerHTML='<h3>Уведомления</h3><button type="button" class="secondary wide">Уведомления на этом телефоне</button>';
  section.querySelector('button').onclick=open;
  root.appendChild(section);
}
async function reconcile(){
  // Another tab may be signed in as a different account. Never touch that tab's shared binding.
  if(!currentTab())return;
  if(connectPromise)return connectPromise;
  const run=generation;
  connectPromise=(async()=>{
    const saved=read(STORAGE);
    if(saved&&(!ready()||saved.account!==account())){await disconnect({logout:true});return}
    void flushRevokes();
    if(!saved||!ready()||!supported())return;
    if(Notification.permission!=='granted'){await disconnect({logout:true});return}
    // Renew only an already consented device; never prompt or silently subscribe on page load.
    try{
      const reg=await serviceWorker(),sub=await reg.pushManager.getSubscription();
      if(run!==generation||!currentTab()||read(STORAGE)?.revoke_token!==saved.revoke_token)return;
      if(!sub||sub.endpoint!==saved.endpoint){await disconnect({logout:true});return}
      if(!saved.updated_at||Date.now()-Date.parse(saved.updated_at)>24*3600*1000){
        const result=await request('subscribe',{subscription:sub.toJSON(),revoke_token:saved.revoke_token});
        if(run!==generation||!ready()||saved.account!==account()||read(STORAGE)?.revoke_token!==saved.revoke_token){revokeLater(saved);void flushRevokes();return}
        write(STORAGE,{...saved,...result.device,updated_at:new Date().toISOString()});
      }
      if(run===generation&&ready()&&read(STORAGE)?.revoke_token===saved.revoke_token)await swMessage('BOS_PUSH_BIND',{binding_id:read(STORAGE)?.binding_id});
    }catch{}
  })().finally(()=>{connectPromise=null});
  return connectPromise;
}
async function openLinkedOrder(id){
  if(!/^\d{1,20}$/.test(String(id||''))||!ready()||deepLinkBusy)return false;
  deepLinkBusy=true;
  try{
    if(document.querySelector('#modalRoot form')&&!window.confirm('Открыть заявку из уведомления? Несохранённые изменения текущей формы будут потеряны.'))return false;
    if(typeof reloadData==='function')await reloadData(true);
    if(!ready())return false;
    const order=(state.orders||[]).find(row=>String(row.id)===String(id));
    if(!order){openModal('<h2>Заявка недоступна</h2><p>Назначение или права доступа изменились. Откройте список актуальных заявок.</p>');return true}
    if(typeof window.openOrder==='function')window.openOrder(String(id));
    return true;
  }catch{message('Не удалось открыть заявку. Проверьте подключение и повторите попытку.');return false}
  finally{deepLinkBusy=false}
}
async function initialLink(){
  const u=new URL(location.href),id=pendingOrder||u.searchParams.get('bos_push_order');
  if(!id||!ready())return;
  if(await openLinkedOrder(id)){pendingOrder=null;u.searchParams.delete('bos_push_order');history.replaceState(history.state,'',u.href)}
}
function onAuth(){
  const current=ready()?account():'';
  if(current!==lastAccount){const was=lastAccount;lastAccount=current;configValue=null;if(current||was)void reconcile()}
  addProfileEntry();if(current)void initialLink();
}
window.BOS_PUSH={open,disconnect,refresh};
window.addEventListener('bos:logout',()=>{configValue=null;void disconnect({logout:true})});
window.addEventListener('storage',event=>{if([SESSION,STORAGE,'bos_manual_logout_v1'].includes(event.key)){generation++;configValue=null;if(currentTab())void reconcile();controls(false)}});
window.addEventListener('online',()=>{void flushRevokes();if(ready())void reconcile()});
window.addEventListener('pageshow',()=>{if(ready())void reconcile();onAuth()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&ready())void reconcile()});
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',event=>{
  const data=event.data||{},saved=read(STORAGE);
  if(data.type==='BOS_PUSH_OPEN'&&saved?.binding_id===data.binding_id&&currentTab()){
    if(/^\d{1,20}$/.test(String(data.order_id||''))){pendingOrder=String(data.order_id);void initialLink()}
    else if(ready())open();
  }
  if(data.type==='BOS_PUSH_RECONNECT')void refresh();
});
let profileQueued=false;
const queueProfile=()=>{if(profileQueued)return;profileQueued=true;requestAnimationFrame(()=>{profileQueued=false;addProfileEntry()})};
for(const id of ['content','modalRoot']){const root=document.getElementById(id);if(root)new MutationObserver(queueProfile).observe(root,{childList:true,subtree:true})}
new MutationObserver(onAuth).observe(document.body,{attributes:true,attributeFilter:['class']});
// Do not revoke a persisted device while the application's initial authentication is still loading.
if(ready())onAuth();
else{try{if(localStorage.getItem('bos_manual_logout_v1')==='1')void disconnect({logout:true})}catch{}}
})();
