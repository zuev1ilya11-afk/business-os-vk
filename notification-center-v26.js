(()=>{
'use strict';
if(window.BOS_NOTIFICATION_CENTER_V26)return;window.BOS_NOTIFICATION_CENTER_V26=true;
const STORAGE='bos_notifications_v26';
const SNAP='bos_notification_snapshot_v26';
const MAX_EVENTS=30;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const role=()=>String(state?.user?.role||'');
const authReady=()=>{
  const gate=document.getElementById('authGate');
  return !!document.body?.classList.contains('bos-auth-ok')&&(!gate||gate.style.display==='none'||getComputedStyle(gate).display==='none');
};
const isMaster=()=>role()==='master';
const isDispatch=()=>['dispatcher','manager','owner'].includes(role())||(typeof isDispatcherPreview==='function'&&isDispatcherPreview());
const userIds=()=>new Set([state?.user?.staff_id,state?.user?.id,state?.user?.vk_user_id,state?.user?.external_id].filter(Boolean).map(String));
const active=o=>!['выполнена','отменена','completed','cancelled'].includes(String(o?.status||'').toLowerCase());
const masterOwns=o=>{const ids=userIds();return [o?.master_staff_id,o?.master_vk_id,o?.master_external_id,o?.master_id].some(v=>v!=null&&v!==''&&ids.has(String(v)))};
const hasMaster=o=>[o?.master_staff_id,o?.master_vk_id,o?.master_external_id,o?.master_id].some(v=>v!=null&&String(v)!=='');
const orders=()=>Array.isArray(state?.orders)?state.orders:[];
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const timeMinutes=t=>{const m=String(t||'').match(/(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null};
const fingerprint=o=>[o?.master_staff_id||o?.master_vk_id||o?.master_external_id||o?.master_id||'',o?.scheduled_date||'',o?.scheduled_time||o?.time_slot||'',o?.status||''].join('|');
const keyBase=()=>`${role()}:${state?.user?.external_id||state?.user?.vk_user_id||state?.user?.id||state?.user?.staff_id||'anon'}`;
const readStore=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(`${key}:${keyBase()}`)||'')||fallback}catch(_){return fallback}};
const writeStore=(key,value)=>{try{localStorage.setItem(`${key}:${keyBase()}`,JSON.stringify(value))}catch(_){}};
const getEvents=()=>readStore(STORAGE,[]);
const setEvents=v=>writeStore(STORAGE,v.slice(0,MAX_EVENTS));
const pushEvent=event=>{const all=getEvents();if(all.some(x=>x.key===event.key))return;all.unshift({...event,created_at:new Date().toISOString(),read:false});setEvents(all)};
function captureChanges(){
  if(!authReady()||!state?.user)return;
  const current={};orders().forEach(o=>current[String(o.id)]=fingerprint(o));
  const prev=readStore(SNAP,null);
  if(isMaster())for(const o of orders().filter(x=>active(x)&&masterOwns(x))){
    const id=String(o.id),old=prev?.[id],now=current[id];
    if(!old)pushEvent({key:`new:${id}:${now}`,type:'new',order_id:id,title:`Новая заявка №${id}`,text:[o.scheduled_date,o.scheduled_time||o.time_slot,o.address].filter(Boolean).join(' · ')});
    else if(old!==now){
      const [oldMaster,oldDate,oldTime]=old.split('|'),[nowMaster,nowDate,nowTime]=now.split('|');
      if(oldMaster!==nowMaster)pushEvent({key:`new:${id}:${now}`,type:'new',order_id:id,title:`Новая заявка №${id}`,text:[o.scheduled_date,o.scheduled_time||o.time_slot,o.address].filter(Boolean).join(' · ')});
      else if(oldDate!==nowDate||oldTime!==nowTime)pushEvent({key:`changed:${id}:${now}`,type:'changed',order_id:id,title:`Изменено время заявки №${id}`,text:[o.scheduled_date,o.scheduled_time||o.time_slot,o.address].filter(Boolean).join(' · ')})
    }
  }
  writeStore(SNAP,current);
}
function liveAlerts(){
  const out=[],now=new Date(),mins=now.getHours()*60+now.getMinutes(),day=today();
  if(isDispatch())for(const o of orders().filter(active)){
    const id=String(o.id);
    if(o.reschedule_requested)out.push({key:`reschedule:${id}:${o.reschedule_requested_at||o.reschedule_reason||'1'}`,type:'reschedule',order_id:id,title:`Перенос заявки №${id}`,text:o.reschedule_reason||'Мастер запросил перенос'});
    if(!hasMaster(o))out.push({key:`unassigned:${id}`,type:'unassigned',order_id:id,title:`Без мастера · №${id}`,text:[o.scheduled_date,o.scheduled_time||o.time_slot,o.address].filter(Boolean).join(' · ')});
    const d=String(o.scheduled_date||''),tm=timeMinutes(o.scheduled_time||o.time_slot);
    if(d&&(d<day||(d===day&&tm!=null&&tm+15<mins)))out.push({key:`overdue:${id}:${d}:${tm}`,type:'overdue',order_id:id,title:`Время прошло · №${id}`,text:[d,o.scheduled_time||o.time_slot,o.master_name].filter(Boolean).join(' · ')})
  }
  return out;
}
const reads=()=>readStore(`${STORAGE}:reads`,{});
const markRead=k=>{const r=reads();r[k]=Date.now();writeStore(`${STORAGE}:reads`,r)};
function allNotifications(){if(!authReady())return[];captureChanges();const r=reads(),live=liveAlerts().map(x=>({...x,read:!!r[x.key],live:true})),events=getEvents().map(x=>({...x,read:x.read||!!r[x.key]})),seen=new Set();return[...live,...events].filter(x=>x.key&&!seen.has(x.key)&&seen.add(x.key)).slice(0,40)}
function ensureStyle(){if(document.getElementById('bosNotifyStyle'))return;const s=document.createElement('style');s.id='bosNotifyStyle';s.textContent=`#bosNotificationBell{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;border:1px solid rgba(148,163,184,.28);background:#111c2b;color:#fff;border-radius:14px;min-width:44px;height:44px;padding:0 12px;font:600 14px/1 system-ui;box-shadow:0 8px 26px rgba(0,0,0,.18);cursor:pointer}#bosNotificationBell .bosNB{display:none;position:absolute;right:-5px;top:-7px;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:#dc2626;color:#fff;font:700 11px/19px system-ui;text-align:center}#bosNotificationBell.hasUnread .bosNB{display:block}.bosNotifyBackdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1997}.bosNotifyPanel{position:fixed;right:18px;top:72px;width:min(420px,calc(100vw - 24px));max-height:calc(100vh - 92px);overflow:auto;z-index:1998;background:#101b2a;color:#e5eefc;border:1px solid rgba(148,163,184,.22);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.42);padding:14px}.bosNotifyHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.bosNotifyHead h3{margin:0;font:750 18px/1.2 system-ui}.bosNotifyClose{border:1px solid rgba(148,163,184,.2);background:#162335;color:#e5eefc;border-radius:10px;padding:8px 10px;cursor:pointer}.bosNotifyItem{display:block;width:100%;text-align:left;border:1px solid rgba(148,163,184,.18);background:#111c2b;color:#e5eefc;border-radius:14px;padding:12px;margin:8px 0;cursor:pointer}.bosNotifyItem.unread{border-color:#3b82f6;background:#13233a}.bosNotifyTitle{font:700 14px/1.35 system-ui}.bosNotifyText{font:400 12px/1.45 system-ui;color:#9fb0c8;margin-top:4px}.bosNotifyEmpty{padding:28px 10px;text-align:center;color:#9fb0c8;font:500 14px/1.4 system-ui}@media(max-width:700px){#bosNotificationBell{height:40px;min-width:40px;padding:0 10px}.bosNotifyPanel{left:8px;right:8px;top:58px;width:auto;max-height:calc(100vh - 70px)}}`;document.head.appendChild(s)}
function closePanel(){document.querySelector('.bosNotifyBackdrop')?.remove();document.querySelector('.bosNotifyPanel')?.remove()}
function removeUi(){closePanel();document.getElementById('bosNotificationBell')?.remove()}
function ensureBell(){
  if(!authReady()||!state?.user?.role){removeUi();return}
  ensureStyle();let b=document.getElementById('bosNotificationBell');
  if(!b){b=document.createElement('button');b.id='bosNotificationBell';b.type='button';b.setAttribute('aria-label','Уведомления');b.innerHTML='🔔<span class="bosNB"></span>';b.onclick=()=>window.openBosNotifications();const profile=document.getElementById('profileBtn');if(profile?.parentNode)profile.parentNode.insertBefore(b,profile);else document.body.appendChild(b)}
  const count=allNotifications().filter(x=>!x.read).length;b.classList.toggle('hasUnread',count>0);b.querySelector('.bosNB').textContent=count>99?'99+':String(count||'')
}
window.openBosNotifications=function(){if(!authReady()){removeUi();return}ensureBell();closePanel();const items=allNotifications(),back=document.createElement('div'),panel=document.createElement('section');back.className='bosNotifyBackdrop';back.onclick=closePanel;panel.className='bosNotifyPanel';panel.setAttribute('role','region');panel.setAttribute('aria-label','Центр уведомлений');panel.innerHTML=`<div class="bosNotifyHead"><h3>Уведомления</h3><button class="bosNotifyClose" type="button" aria-label="Закрыть">✕</button></div>${items.length?items.map(n=>`<button type="button" class="bosNotifyItem ${n.read?'':'unread'}" data-key="${esc(n.key)}" data-order="${esc(n.order_id||'')}"><div class="bosNotifyTitle">${esc(n.title)}</div><div class="bosNotifyText">${esc(n.text||'')}</div></button>`).join(''):'<div class="bosNotifyEmpty">Новых уведомлений нет</div>'}`;panel.querySelector('.bosNotifyClose').onclick=closePanel;panel.querySelectorAll('.bosNotifyItem').forEach(btn=>btn.onclick=()=>{const k=btn.dataset.key;markRead(k);const ev=getEvents(),found=ev.find(x=>x.key===k);if(found){found.read=true;setEvents(ev)}const id=btn.dataset.order;closePanel();ensureBell();if(id&&typeof openOrder==='function')openOrder(id)});document.body.append(back,panel)};
window.bosRefreshNotifications=()=>{ensureBell()};
setTimeout(ensureBell,0);setTimeout(ensureBell,500);setInterval(ensureBell,15000);window.addEventListener('pageshow',ensureBell);
const gate=document.getElementById('authGate');
if(window.MutationObserver){
  const observer=new MutationObserver(()=>ensureBell());
  if(gate)observer.observe(gate,{attributes:true,attributeFilter:['style','class','hidden']});
  if(document.body)observer.observe(document.body,{attributes:true,attributeFilter:['class']});
}
})();
