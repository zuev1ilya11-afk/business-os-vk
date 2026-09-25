(()=>{
'use strict';
if(window.BOS_EMPLOYEE_LIVE_REFRESH_V27)return;
window.BOS_EMPLOYEE_LIVE_REFRESH_V27=true;

const POLL_MS=15000;
const MIN_AUTO_GAP=2500;
const PRESENCE_MS=45000;
const ONLINE_MS=120000;
const PRESENCE_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/profile-self-api';
let inFlight=false;
let lastSync=0;
let lastError='';
let presenceInFlight=false;
let lastPresence=0;

const authReady=()=>{
  const gate=document.getElementById('authGate');
  return !!state?.user&&document.body?.classList.contains('bos-auth-ok')&&(!gate||gate.style.display==='none'||getComputedStyle(gate).display==='none');
};
const idsOf=u=>[u?.vk_user_id,u?.external_id,u?.staff_id,u?.user_id,u?.id].filter(v=>v!=null&&v!=='').map(String);
const matchesId=(u,id)=>idsOf(u).includes(String(id));
const normalizeOrders=list=>(list||[]).map(o=>({...o,status:['В работе','Выполнена','Отменена'].includes(String(o?.status))?String(o.status):String(o?.status||'В работе')}));
const dataSignature=data=>JSON.stringify({
  user:data.user,settings:data.settings,users:data.users||[],masters:data.masters||[],
  orders:data.orders||[],schedule:data.masterSchedule||[]
});
const stateSignature=()=>dataSignature(state||{});
const getSession=()=>{try{return sessionStorage.getItem('bos_vk_session_v2')||localStorage.getItem('bos_vk_session_v2')||''}catch(_){return ''}};
const isPresenceViewer=()=>['owner','manager','dispatcher'].includes(String(state?.user?.role||''));

function presenceState(master,now=Date.now()){
  const stamp=Date.parse(master?.last_seen_at||'');
  const online=Number.isFinite(stamp)&&now-stamp<=ONLINE_MS;
  return {online,stamp:Number.isFinite(stamp)?stamp:0};
}
function lastSeenText(master,now=Date.now()){
  const p=presenceState(master,now);
  if(p.online)return 'Онлайн';
  if(!p.stamp)return 'Офлайн · ещё не заходил';
  const diff=Math.max(0,now-p.stamp),mins=Math.floor(diff/60000);
  if(mins<60)return `Офлайн · был(а) ${Math.max(1,mins)} мин назад`;
  const d=new Date(p.stamp),n=new Date(now);
  const time=d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  if(d.toDateString()===n.toDateString())return `Офлайн · был(а) сегодня в ${time}`;
  const y=new Date(n);y.setDate(n.getDate()-1);
  if(d.toDateString()===y.toDateString())return `Офлайн · был(а) вчера в ${time}`;
  return `Офлайн · был(а) ${d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})} в ${time}`;
}
function decoratePresence(){
  if(!isPresenceViewer()||String(state?.page||'')!=='team')return;
  const root=document.getElementById('content');
  if(!root)return;
  const cards=[...root.querySelectorAll('.card,button')];
  for(const master of state?.masters||[]){
    const name=String(master?.full_name||'').trim();
    if(!name)continue;
    const card=cards.find(el=>el.textContent?.includes(name)&&!el.querySelector(`.bosMasterPresence[data-master-presence="${CSS.escape(String(master?.id||master?.external_id||name))}"]`));
    if(!card)continue;
    const p=presenceState(master),badge=document.createElement('div');
    badge.className=`bosMasterPresence ${p.online?'isOnline':'isOffline'}`;
    badge.dataset.masterPresence=String(master?.id||master?.external_id||name);
    badge.innerHTML=`<span class="bosPresenceDot" aria-hidden="true"></span><span>${lastSeenText(master)}</span>`;
    card.appendChild(badge);
  }
}

async function touchPresence(force=false){
  if(presenceInFlight||document.hidden||!authReady())return false;
  if(!force&&lastPresence&&Date.now()-lastPresence<PRESENCE_MS-3000)return false;
  const session=getSession();
  if(!session)return false;
  presenceInFlight=true;
  try{
    const r=await fetch(PRESENCE_URL,{method:'POST',headers:{'Content-Type':'application/json','X-BOS-Session':session},body:JSON.stringify({action:'presence'})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d?.ok)return false;
    lastPresence=Date.now();
    if(state?.user&&d.last_seen_at)state.user.last_seen_at=d.last_seen_at;
    return true;
  }catch(_){return false}finally{presenceInFlight=false}
}

function employeeProfileModal(){return document.querySelector('#modalRoot .modal[data-bos-employee-profile-id]')}
function editingInline(){
  return [...document.querySelectorAll('#content input,#content select,#content textarea')].some(el=>
    el===document.activeElement||(el.tagName==='SELECT'
      ? el.value!==([...el.options].find(o=>o.defaultSelected)||el.options[0])?.value
      : ['checkbox','radio'].includes(el.type)?el.checked!==el.defaultChecked:el.value!==el.defaultValue));
}
function renderChanged(){
  const profile=employeeProfileModal();
  if(profile&&typeof window.openEmployeeProfile==='function'){
    const id=profile.dataset.bosEmployeeProfileId;
    const exists=(state.users||[]).some(u=>matchesId(u,id));
    if(exists){if(typeof show==='function'&&state.page)show(state.page);window.openEmployeeProfile(id);setTimeout(decoratePresence,0);return;}
    if(typeof closeModal==='function')closeModal();
    if(typeof show==='function')show('team');
    setTimeout(decoratePresence,0);
    return;
  }
  if(!document.querySelector('#modalRoot .modal')&&typeof show==='function'&&state?.page)show(state.page);
  setTimeout(decoratePresence,0);
}

async function syncEmployeeData(reason='manual'){
  const urgent=['manual','modal-close','mutation'].includes(reason);
  const modal=document.querySelector('#modalRoot .modal');
  if(!urgent&&lastSync&&Date.now()-lastSync<MIN_AUTO_GAP)return false;
  if(inFlight||document.hidden||state?.busy||!authReady()||editingInline()||typeof api!=='function'||(modal&&!employeeProfileModal()))return false;
  inFlight=true;
  lastError='';
  window.BOS_LAST_REFRESH_ERROR='';
  try{
    const before=stateSignature();
    const d=await api('bootstrap');
    if(!d?.ok||state.busy||before!==stateSignature()||!authReady()||editingInline()||
      (document.querySelector('#modalRoot .modal')&&!employeeProfileModal()))return false;
    const normalizedOrders=normalizeOrders(d.orders||[]);
    Object.assign(state,{
      user:d.user||state.user,
      orders:normalizedOrders,
      masters:d.masters||[],
      users:d.users||[],
      sources:d.sources||state.sources||[],
      settings:d.settings||state.settings||{},
      masterSchedule:d.masterSchedule||[]
    });
    window.BOS_NORMALIZE_MASTER_SCHEDULE?.();
    if(typeof isMasterPreview==='function'&&isMasterPreview()&&typeof previewUser!=='undefined'&&previewUser){
      const current=(state.users||[]).find(u=>idsOf(previewUser).some(id=>matchesId(u,id)));
      if(current)previewUser={...current};
      else if(typeof exitMasterPreview==='function')exitMasterPreview();
    }
    const changed=before!==stateSignature();
    lastSync=Date.now();
    if(changed)renderChanged();else decoratePresence();
    window.bosRefreshNotifications?.();
    window.dispatchEvent(new CustomEvent('bos:employee-data-refreshed',{detail:{changed,reason,at:lastSync}}));
    return changed;
  }catch(err){
    lastError=String(err?.message||'Не удалось обновить данные');
    window.BOS_LAST_REFRESH_ERROR=lastError;
    window.dispatchEvent(new CustomEvent('bos:employee-data-refresh-error',{detail:{reason,error:lastError}}));
    return false;
  }finally{
    inFlight=false;
  }
}

window.BOS_REFRESH_EMPLOYEE_DATA=syncEmployeeData;
window.BOS_REFRESH_NOW=()=>syncEmployeeData('manual');
window.BOS_MASTER_PRESENCE_V147={onlineMs:ONLINE_MS,presenceState,lastSeenText,touch:touchPresence,decorate:decoratePresence};

function ensureRefreshButton(){
  if(typeof document.createElement!=='function')return;
  if(document.getElementById('bosManualRefresh'))return;
  const profile=document.getElementById('profileBtn');
  if(!profile?.parentNode)return;
  const btn=document.createElement('button');
  btn.id='bosManualRefresh';
  btn.type='button';
  btn.className='avatar bosManualRefresh';
  btn.setAttribute('aria-label','Обновить данные');
  btn.title='Обновить данные';
  btn.textContent='↻';
  btn.onclick=async()=>{
    if(inFlight)return;
    btn.disabled=true;btn.classList.add('isRefreshing');btn.title='Обновляем…';
    await Promise.all([touchPresence(true),syncEmployeeData('manual')]);
    btn.classList.remove('isRefreshing');btn.disabled=false;
    if(window.BOS_LAST_REFRESH_ERROR){btn.title=window.BOS_LAST_REFRESH_ERROR;btn.textContent='!'}
    else{btn.title='Данные обновлены';btn.textContent='✓'}
    setTimeout(()=>{btn.textContent='↻';btn.title='Обновить данные'},1200);
  };
  profile.parentNode.insertBefore(btn,profile);
}

if(typeof document.createElement==='function'&&document.head?.appendChild){
  const style=document.createElement('style');
  style.textContent=`.bosManualRefresh{margin-left:auto!important;margin-right:8px!important;font-size:22px!important;line-height:1!important}.bosManualRefresh.isRefreshing{animation:bosRefreshSpin .75s linear infinite}@keyframes bosRefreshSpin{to{transform:rotate(360deg)}}.bosMasterPresence{display:flex;align-items:center;gap:7px;margin-top:9px;font-size:12px;font-weight:700;line-height:1.35}.bosPresenceDot{width:8px;height:8px;border-radius:50%;flex:0 0 8px}.bosMasterPresence.isOnline{color:#55d68b}.bosMasterPresence.isOnline .bosPresenceDot{background:#55d68b;box-shadow:0 0 0 3px rgba(85,214,139,.12)}.bosMasterPresence.isOffline{color:#8f9bab}.bosMasterPresence.isOffline .bosPresenceDot{background:#748094}`;
  document.head.appendChild(style);
  ensureRefreshButton();
  setTimeout(ensureRefreshButton,500);
}

const baseOpenEmployeeProfile=window.openEmployeeProfile;
if(typeof baseOpenEmployeeProfile==='function'){
  window.openEmployeeProfile=function(id){
    const out=baseOpenEmployeeProfile.apply(this,arguments);
    const modal=document.querySelector('#modalRoot .modal');
    if(modal)modal.dataset.bosEmployeeProfileId=String(id);
    return out;
  };
}

const baseCloseModal=window.closeModal;
if(typeof baseCloseModal==='function'){
  window.closeModal=function(){
    const out=baseCloseModal.apply(this,arguments);
    setTimeout(()=>syncEmployeeData('modal-close'),300);
    return out;
  };
}

const observer=new MutationObserver(()=>{if(String(state?.page||'')==='team')queueMicrotask(decoratePresence)});
const content=document.getElementById('content');if(content)observer.observe(content,{childList:true,subtree:true});
window.addEventListener('focus',()=>{touchPresence(true);syncEmployeeData('focus')});
window.addEventListener('pageshow',()=>{touchPresence(true);syncEmployeeData('pageshow')});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){touchPresence(true);syncEmployeeData('visible')}});
window.addEventListener('bos:data-mutated',()=>setTimeout(()=>syncEmployeeData('mutation'),250));
setTimeout(()=>touchPresence(true),900);
setInterval(()=>touchPresence(false),PRESENCE_MS);
setInterval(()=>syncEmployeeData('poll'),POLL_MS);
})();
