(()=>{
'use strict';
if(window.BOS_MASTER_SCHEDULE_COMPACT_V65)return;
window.BOS_MASTER_SCHEDULE_COMPACT_V65=true;
let activeKind='';
let activeTime=null;
let observer=null;
let observedHost=null;
const normTime=v=>String(v||'').slice(0,5);
const truthy=v=>v===true||v===1||String(v).toLowerCase()==='true'||String(v)==='1';
const visibleDates=()=>[...document.querySelectorAll('#masterMonthCalendar .bosCalDay')].map(btn=>String(btn.getAttribute('onclick')||'').match(/(\d{4}-\d{2}-\d{2})/)?.[1]||'').filter(Boolean);
const shouldWork=(date,kind)=>kind==='all'||(kind==='weekdays'&&(()=>{const d=new Date(date+'T12:00:00').getDay();return d>=1&&d<=5})());
function myIds(){
  const u=typeof liveMasterUser==='function'?liveMasterUser():(state?.user||{});
  const master=(state?.masters||[]).find(m=>[m?.id,m?.staff_id,m?.master_id,m?.vk_user_id,m?.external_id].filter(Boolean).map(String).some(id=>[u?.id,u?.staff_id,u?.master_id,u?.vk_user_id,u?.external_id].filter(Boolean).map(String).includes(id)))||u;
  const id=typeof liveMasterId==='function'?liveMasterId():'';
  return new Set([id,master?.id,master?.staff_id,master?.master_id,master?.vk_user_id,master?.external_id,u?.id,u?.staff_id,u?.master_id,u?.vk_user_id,u?.external_id].filter(Boolean).map(String));
}
function rowIsMine(row,ids){return [row?.master_vk_id,row?.master_id,row?.master_staff_id,row?.staff_id,row?.vk_user_id,row?.external_id].filter(Boolean).map(String).some(x=>ids.has(x))}
function storedTime(){
  const ids=myIds();
  const rows=(state?.masterSchedule||[]).filter(r=>rowIsMine(r,ids)&&normTime(r?.work_start)&&normTime(r?.work_end));
  if(!rows.length)return null;
  const counts=new Map();
  rows.filter(r=>truthy(r?.is_working)).forEach(r=>{const key=normTime(r.work_start)+'|'+normTime(r.work_end);counts.set(key,(counts.get(key)||0)+1)});
  const best=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
  const pair=best?best.split('|'):[normTime(rows[0].work_start),normTime(rows[0].work_end)];
  return {start:pair[0],end:pair[1]};
}
function editorTime(){
  const selected=document.querySelector('#masterMonthCalendar .bosCalDay.selected');
  const working=document.getElementById('calWorking'),start=document.getElementById('calStart'),end=document.getElementById('calEnd');
  if(!selected||!working?.checked||!start?.value||!end?.value)return null;
  return {start:normTime(start.value),end:normTime(end.value)};
}
function preferredTime(){
  const t=editorTime()||storedTime()||{start:'10:00',end:'20:00'};
  if(t.end<=t.start){const h=Math.min(23,Number(t.start.slice(0,2))+1);t.end=String(h).padStart(2,'0')+':00'}
  return t;
}
function setValue(id,value){const el=document.getElementById(id);if(!el||el.value===value)return;el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))}
function apply(kind){
  if(!['all','weekdays','off'].includes(kind))return;
  const time=kind==='off'?null:preferredTime();
  activeKind=kind;
  if(time)activeTime=time;
  for(const date of visibleDates()){
    window.selectMasterCalendarDay?.(date);
    const working=document.getElementById('calWorking');
    if(!working)continue;
    const next=kind!=='off'&&shouldWork(date,kind);
    if(working.checked!==next){working.checked=next;working.dispatchEvent(new Event('change',{bubbles:true}))}
    if(next&&time){setValue('calStart',time.start);setValue('calEnd',time.end)}
  }
  queueInject();
}
window.setMasterSchedulePreset=apply;
window.applyMasterScheduleBulk=apply;
async function save(){
  const btn=document.getElementById('bosCompactScheduleSave');
  if(btn){btn.disabled=true;btn.textContent='Сохраняем…'}
  try{await window.saveMasterCalendarMonth?.()}finally{queueInject()}
}
window.saveCompactMasterSchedule=save;
function summary(){const t=activeTime||storedTime()||preferredTime();return t?`${t.start}–${t.end}`:'время из графика'}
function inject(){
  const host=document.getElementById('masterMonthCalendar');if(!host)return;
  const box=host.querySelector('.bosSchedulePresets.compact');if(!box)return;
  if(box.querySelector('.bosCompactSchedule'))return;
  box.classList.add('bosCompactRoot');
  box.innerHTML=`<div class="bosCompactSchedule"><div class="bosCompactButtons"><button type="button" class="secondary ${activeKind==='all'?'active':''}" data-compact-kind="all">Все дни</button><button type="button" class="secondary ${activeKind==='weekdays'?'active':''}" data-compact-kind="weekdays">Будни</button><button type="button" class="secondary ${activeKind==='off'?'active':''}" data-compact-kind="off">Убрать</button></div><div class="bosCompactBottom"><span>Время: <b>${summary()}</b></span><button id="bosCompactScheduleSave" type="button" class="primary" onclick="saveCompactMasterSchedule()">Сохранить</button></div><small>Нажмите день в календаре, чтобы изменить только его.</small></div>`;
  box.querySelectorAll('[data-compact-kind]').forEach(btn=>btn.addEventListener('click',()=>apply(btn.dataset.compactKind)));
}
function watch(){
  const host=document.getElementById('masterMonthCalendar');if(!host)return;
  if(host!==observedHost){observer?.disconnect();observedHost=host;observer=new MutationObserver(()=>{if(!host.querySelector('.bosCompactSchedule'))setTimeout(inject,0)});observer.observe(host,{childList:true,subtree:true})}
  inject();
}
function queueInject(){watch();setTimeout(watch,0);setTimeout(watch,45);setTimeout(watch,90)}
const render=window.renderMonthCalendar;if(typeof render==='function')window.renderMonthCalendar=function(){const out=render.apply(this,arguments);queueInject();return out};
const select=window.selectMasterCalendarDay;if(typeof select==='function')window.selectMasterCalendarDay=function(){const out=select.apply(this,arguments);queueInject();return out};
const dispatch=pages?.dispatch;if(typeof dispatch==='function')pages.dispatch=function(){const out=dispatch.apply(this,arguments);setTimeout(queueInject,0);return out};
const st=document.createElement('style');st.textContent='.bosSchedulePresets.compact.bosCompactRoot{width:100%;margin:8px 0 0!important;padding:0!important;border:0!important;background:transparent!important;display:block!important}.bosCompactSchedule{display:grid;gap:6px;padding:8px 9px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.025)}.bosCompactButtons{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.bosCompactButtons button{min-height:34px!important;padding:6px 8px!important;font-size:12px!important}.bosCompactButtons button.active{background:rgba(51,160,93,.2);border-color:rgba(72,190,116,.65)}.bosCompactBottom{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--muted,#8ea0b5)}.bosCompactBottom b{color:inherit}.bosCompactBottom .primary{padding:7px 12px!important;min-height:34px!important;width:auto!important}.bosCompactSchedule small{font-size:10px;color:var(--muted,#8ea0b5);line-height:1.2}.bosBulkTitle,.bosBulkTimes{display:none!important}@media(max-width:420px){.bosCompactSchedule{padding:7px}.bosCompactButtons{gap:4px}.bosCompactButtons button{font-size:11px!important;padding:5px!important}.bosCompactBottom{font-size:11px}}';document.head.appendChild(st);
queueInject();
})();