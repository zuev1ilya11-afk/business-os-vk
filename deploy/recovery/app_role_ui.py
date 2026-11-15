"""Inject local account controls without modifying captured frontend files."""

_SCRIPT = r'''(()=>{
'use strict';
if(window.BOS_LOCAL_DRILL!==true||location.hostname!=='127.0.0.1')return;
const SESSION='bos_vk_session_v2',GRANT='bos_local_roles_v1',ENDPOINT='/__bos_local_roles';
const roles={owner:'Владелец',manager:'Руководитель',dispatcher:'Диспетчер',master:'Мастер'};
let generation=0,pending=false,internalLogout=false,everReady=false,observedToken='';
let model=null,host=null,shadow=null,label=null,select=null,switchButton=null,ownerButton=null,retry=null,message=null,controls=null;
const controllers=new Set();
const getToken=()=>{try{return sessionStorage.getItem(SESSION)||localStorage.getItem(SESSION)||''}catch(_){return ''}};
const getGrant=()=>{try{return sessionStorage.getItem(GRANT)||''}catch(_){return ''}};
const validGrant=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{24,256}$/.test(value);
const ready=()=>!!getToken()&&document.body?.classList.contains('bos-auth-ok');
function clearGrant(){try{sessionStorage.removeItem(GRANT)}catch(_){}}
function appUser(){try{return typeof state!=='undefined'?state?.user:null}catch(_){return null}}
function user(value){
 if(!value||typeof value!=='object'||typeof value.id!=='string'||!value.id||value.id.length>128||!Object.hasOwn(roles,value.role)||typeof value.name!=='string')throw new Error('INVALID_RESPONSE');
 return {id:value.id,name:value.name.slice(0,200),role:value.role};
}
function view(data){
 if(!data||data.ok!==true||!Array.isArray(data.accounts)||data.accounts.length>1000)throw new Error('INVALID_RESPONSE');
 const accounts=data.accounts.map(user),owner=user(data.owner),current=user(data.current);
 if(owner.role!=='owner'||!accounts.some(x=>x.id===owner.id)||!accounts.some(x=>x.id===current.id)||new Set(accounts.map(x=>x.id)).size!==accounts.length)throw new Error('INVALID_RESPONSE');
 return {accounts,owner,current};
}
function revoke(grant,token){
 if(!validGrant(grant))return;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 void fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','X-BOS-Session':token,'X-BOS-Role-Control':grant},
  body:JSON.stringify({action:'revoke'}),credentials:'same-origin',cache:'no-store',signal:controller.signal})
  .catch(()=>{}).finally(()=>clearTimeout(timer));
}
function cancel(){generation++;for(const controller of controllers)controller.abort();controllers.clear()}
async function call(action,payload={},grant=getGrant()){
 const token=getToken(),epoch=generation,controller=new AbortController();controllers.add(controller);
 const timer=setTimeout(()=>controller.abort(),15000);
 try{
  const headers={'Content-Type':'application/json','X-BOS-Session':token};
  if(grant)headers['X-BOS-Role-Control']=grant;
  const response=await fetch(ENDPOINT,{method:'POST',headers,body:JSON.stringify({action,...payload}),
   credentials:'same-origin',cache:'no-store',signal:controller.signal});
  const data=await response.json();
  if(epoch!==generation||getToken()!==token||!ready()){
   if(action==='authorize'&&validGrant(data?.grant))revoke(data.grant,token);
   const error=new Error('STALE');error.stale=true;throw error;
  }
  if(!response.ok||data?.ok!==true){const error=new Error('CONTROL_FAILED');error.status=response.status;throw error}
  return data;
 }finally{clearTimeout(timer);controllers.delete(controller)}
}
function render(){
 if(!host)return;
 const current=model?.current||appUser();
 const name=typeof current?.name==='string'?current.name:typeof current?.full_name==='string'?current.full_name:'';
 label.textContent=ready()&&Object.hasOwn(roles,current?.role||'')?'Локальная копия · '+roles[current.role]+(name?' — '+name:''):'Локальная копия · Войдите в приложение';
 controls.hidden=!model||!validGrant(getGrant())||!ready();
 select.disabled=pending;ownerButton.disabled=pending||!model||model.current.id===model.owner.id;
 switchButton.disabled=pending||!model||select.value===model.current.id||!select.value;
 retry.disabled=pending;
 host.setAttribute('aria-busy',pending?'true':'false');
}
function apply(data){
 model=view(data);
 select.replaceChildren();
 for(const [role,title] of Object.entries(roles)){
  const members=model.accounts.filter(account=>account.role===role);if(!members.length)continue;
  const group=document.createElement('optgroup');group.label=title;
  for(const account of members){const option=document.createElement('option');option.value=account.id;option.textContent=account.name||title;group.append(option)}
  select.append(group);
 }
 select.value=model.current.id;message.textContent='Несохранённые формы закроются.';retry.hidden=true;render();
}
async function synchronize(){
 if(pending||!ready())return;
 const token=getToken(),epoch=generation;everReady=true;observedToken=token;pending=true;retry.hidden=true;render();
 try{
  let data,grant=getGrant();
  if(grant){
   try{data=await call('list',{},grant)}catch(error){
    if(error.stale||error.status!==403)throw error;
    clearGrant();grant='';model=null;
   }
  }
  if(!grant){
   data=await call('authorize',{},'');
   if(!validGrant(data.grant))throw new Error('INVALID_RESPONSE');
   view(data);
   try{sessionStorage.setItem(GRANT,data.grant)}catch(error){revoke(data.grant,token);throw error}
  }
  apply(data);
 }catch(error){
  if(epoch!==generation||error.stale)return;
  model=null;
  if(error.status===401||error.status===403||error.status===410){clearGrant();message.textContent=error.status===401?'Сессия завершена. Войдите в приложение.':'';retry.hidden=true}
  else{message.textContent='Не удалось загрузить переключение. Повторите попытку.';retry.hidden=false}
 }finally{if(epoch===generation){pending=false;render()}}
}
function leave(){
 if(internalLogout)return;
 const grant=getGrant(),token=getToken()||observedToken;cancel();pending=false;model=null;clearGrant();observedToken='';everReady=false;
 if(message)message.textContent='';if(retry)retry.hidden=true;revoke(grant,token);render();
}
async function switchTo(id){
 if(pending||!model||!ready()||!model.accounts.some(account=>account.id===id)||id===model.current.id)return;
 const epoch=generation,grant=getGrant();pending=true;message.textContent='Переключаем аккаунт…';render();
 try{
  const data=await call('switch',{staff_id:id},grant),next=view(data);
  if(next.current.id!==id||typeof data.session_token!=='string'||!/^[A-Za-z0-9_-]{1,128}\.[0-9]{1,16}\.[A-Za-z0-9_-]{20,128}$/.test(data.session_token))throw new Error('INVALID_RESPONSE');
  // Commit synchronously: old callbacks cannot run between the storage writes
  // and navigation. Full reload resets the captured lexical state and modules.
  document.body.inert=true;document.documentElement.setAttribute('aria-busy','true');
  internalLogout=true;
  try{window.dispatchEvent(new Event('bos:logout'));window.BOS_CANCEL_SESSION_REFRESH?.()}finally{internalLogout=false}
  generation++;
  window.BOS_STORE_SESSION=()=>{};
  sessionStorage.clear();localStorage.clear();
  sessionStorage.setItem(GRANT,grant);
  sessionStorage.setItem(SESSION,data.session_token);localStorage.setItem(SESSION,data.session_token);
  if(getToken()!==data.session_token||getGrant()!==grant)throw new Error('STORAGE_FAILED');
  location.replace(location.origin+'/');
 }catch(error){
  if(epoch!==generation){
   if(document.body.inert){clearGrant();document.body.inert=false;document.documentElement.removeAttribute('aria-busy');location.replace(location.origin+'/')}
   return;
  }
  if(error.stale)return;
  if(error.status===401||error.status===403||error.status===410){clearGrant();model=null;message.textContent='Доступ к переключению завершён. Войдите владельцем.'}
  else message.textContent='Переключение не выполнено. Попробуйте ещё раз.';
 }finally{if(epoch===generation){pending=false;render()}}
}
function mount(){
 if(host||!document.body)return;
 host=document.createElement('aside');host.id='bos-local-role-toolbar';host.setAttribute('aria-label','Аккаунт локальной копии');
 shadow=host.attachShadow({mode:'open'});
 const style=document.createElement('style');style.textContent=`
 :host{display:block;position:relative;z-index:2147483000;width:100%;box-sizing:border-box;font:13px/1.35 system-ui,sans-serif;color:#1b2b3a}
 *{box-sizing:border-box}.bar{display:flex;flex-wrap:wrap;align-items:center;gap:7px 12px;padding:8px 12px;background:#eef6ff;border-bottom:1px solid #b9d0e9}
 .identity{font-weight:650;overflow-wrap:anywhere;min-width:0}.controls{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0}.controls[hidden],[hidden]{display:none!important}
 select,button{font:inherit;border:1px solid #7e9bb8;border-radius:6px;background:white;color:#163755;padding:6px 8px;min-height:32px;max-width:100%}
 select{min-width:140px;max-width:280px}button{cursor:pointer}button:disabled,select:disabled{opacity:.55;cursor:default}button:focus-visible,select:focus-visible{outline:2px solid #0875cf;outline-offset:2px}
 .note{font-size:11px;color:#476178;flex-basis:100%;overflow-wrap:anywhere}@media(max-width:480px){.bar{padding:7px 9px;gap:6px}.identity{flex-basis:100%}.controls{width:100%}select{flex:1;min-width:120px;max-width:100%}button{padding:6px}.note{font-size:11px}}
 `;
 const bar=document.createElement('div');bar.className='bar';
 label=document.createElement('span');label.className='identity';label.setAttribute('role','status');
 controls=document.createElement('div');controls.className='controls';controls.hidden=true;
 select=document.createElement('select');select.id='bos-local-role-account';select.setAttribute('aria-label','Сотрудник локальной копии');select.addEventListener('change',render);
 switchButton=document.createElement('button');switchButton.id='bos-local-role-switch';switchButton.type='button';switchButton.textContent='Переключиться';switchButton.addEventListener('click',()=>switchTo(select.value));
 ownerButton=document.createElement('button');ownerButton.id='bos-local-role-owner';ownerButton.type='button';ownerButton.textContent='К владельцу';ownerButton.addEventListener('click',()=>switchTo(model?.owner.id));
 retry=document.createElement('button');retry.id='bos-local-role-retry';retry.type='button';retry.textContent='Повторить';retry.hidden=true;retry.addEventListener('click',synchronize);
 message=document.createElement('span');message.className='note';message.setAttribute('aria-live','polite');
 controls.append(select,switchButton,ownerButton);bar.append(label,controls,retry,message);shadow.append(style,bar);document.body.insertBefore(host,document.body.firstChild);render();
 if(ready())void synchronize();
}
window.addEventListener('bos:auth-ready',()=>{mount();void synchronize()});
window.addEventListener('bos:logout',leave);
window.addEventListener('storage',event=>{
 if(event.key!==null&&event.key!==SESSION)return;
 setTimeout(()=>{
  let shared;try{shared=localStorage.getItem(SESSION)||''}catch(_){return}
  const current=getToken();if(shared===current)return;
  cancel();window.BOS_CANCEL_SESSION_REFRESH?.();
  const grant=getGrant();sessionStorage.clear();if(grant)sessionStorage.setItem(GRANT,grant);if(shared)sessionStorage.setItem(SESSION,shared);
  location.replace(location.origin+'/');
 },0);
});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
setInterval(()=>{
 if(!host)mount();
 if(everReady&&!ready()){leave();return}
 if(ready()&&!pending&&getToken()!==observedToken)void synchronize();
},1000);
})();'''


def role_script():
    """Return only the fixed injected script; it contains no session or grant."""
    return _SCRIPT.encode('utf-8')
