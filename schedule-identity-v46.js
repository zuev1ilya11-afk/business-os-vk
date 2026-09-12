(()=>{
'use strict';
function ids(x){return [x?.id,x?.staff_id,x?.master_staff_id,x?.master_id,x?.vk_user_id,x?.user_id,x?.external_id].filter(Boolean).map(String)}
function intersects(a,b){const s=new Set(ids(a));return ids(b).some(x=>s.has(x))}
function normalizeSchedule(){
  const masters=state.masters||[];
  state.masterSchedule=(state.masterSchedule||[]).map(r=>{
    if(r.master_vk_id||r.master_id||r.external_id)return r;
    const m=masters.find(x=>ids(x).includes(String(r.staff_id||r.master_staff_id||'')));
    if(!m)return r;
    return {...r,master_vk_id:String(m.vk_user_id||m.external_id||m.id||''),master_id:String(m.id||r.staff_id||''),external_id:String(m.external_id||m.vk_user_id||'')};
  });
  try{if(typeof masterSchedule!=='undefined')masterSchedule=state.masterSchedule}catch(_){ }
}
function liveMaster(){const u=typeof liveMasterUser==='function'?liveMasterUser():(state.user||{});return (state.masters||[]).find(m=>intersects(m,u))||u}
window.BOS_NORMALIZE_MASTER_SCHEDULE=normalizeSchedule;
const render=window.renderMonthCalendar;if(typeof render==='function')window.renderMonthCalendar=function(){normalizeSchedule();return render.apply(this,arguments)};
const dispatch=pages.dispatch;pages.dispatch=function(){normalizeSchedule();return dispatch.apply(this,arguments)};
const home=pages.home;pages.home=function(){normalizeSchedule();return home.apply(this,arguments)};
const oldReload=window.reloadData||reloadData;
const wrappedReload=async function(){const out=await oldReload.apply(this,arguments);normalizeSchedule();return out};
try{reloadData=wrappedReload}catch(_){ }
window.reloadData=wrappedReload;
normalizeSchedule();
})();
(()=>{
  if(window.BOS_CREATE_ORDER_IDEMPOTENCY_V56||typeof window.api!=='function')return;
  const nextApi=window.api;
  window.BOS_CREATE_ORDER_IDEMPOTENCY_V56=true;
  window.api=function(action,payload={}){
    if(action==='createOrder'&&!payload.request_id){
      const form=document.querySelector('#orderForm');
      let requestId=form?.dataset?.requestId||'';
      if(!requestId){
        requestId=globalThis.crypto?.randomUUID?.()||('req_'+Date.now()+'_'+Math.random().toString(36).slice(2));
        if(form?.dataset)form.dataset.requestId=requestId;
      }
      payload={...payload,request_id:requestId};
    }
    return nextApi(action,payload);
  };
})();
(()=>{
  if(window.BOS_STAFF_ADMIN_TEAM_V58||typeof pages==='undefined'||typeof pages.team!=='function')return;
  window.BOS_STAFF_ADMIN_TEAM_V58=true;
  const previousTeam=pages.team;
  pages.team=function(){
    const html=String(previousTeam.apply(this,arguments)||'');
    const role=String(state?.user?.role||'');
    if(!['owner','manager'].includes(role)||html.includes('Логины и пароли'))return html;
    return html+`<section class="card"><h3>Управление сотрудниками</h3><p class="muted">Логины, пароли и восстановление отключённых сотрудников.</p><div class="two"><button class="secondary" onclick="openStaffAccess('all')">Логины и пароли</button><button class="secondary" onclick="openStaffAccess('inactive')">Отключённые</button></div></section>`;
  };
})();
(()=>{
  if(window.BOS_FIELD_SCHEDULE_FIX_V59)return;
  window.BOS_FIELD_SCHEDULE_FIX_V59=true;
  function networkLike(err){const m=String(err?.message||err||'');return /не удалось связаться|сервер не ответил|load failed|failed to fetch|networkerror|network request failed|upstream_(?:timeout|unavailable)/i.test(m)}
  if(typeof window.api==='function'){
    const nextApi=window.api;
    const wrapped=async function(action,payload={}){
      if(action!=='saveMasterSchedule')return nextApi(action,payload);
      try{return await nextApi(action,payload)}catch(first){
        if(!networkLike(first))throw first;
        await new Promise(r=>setTimeout(r,500));
        return await nextApi(action,payload);
      }
    };
    window.api=wrapped;
    try{api=wrapped}catch(_){ }
  }
  function visibleDates(){return [...document.querySelectorAll('#masterMonthCalendar .bosCalDay')].map(btn=>String(btn.getAttribute('onclick')||'').match(/(\d{4}-\d{2}-\d{2})/)?.[1]||'').filter(Boolean)}
  function shouldWork(date,kind){if(kind==='all')return true;if(kind==='off')return false;const day=new Date(date+'T12:00:00').getDay();return day>=1&&day<=5}
  function syncPreset(kind){document.querySelectorAll('.bosMiniPreset').forEach(label=>{const input=label.querySelector('input'),click=String(input?.getAttribute('onclick')||''),active=click.includes(`'${kind}'`);label.classList.toggle('active',active);if(input)input.checked=active})}
  window.setMasterSchedulePreset=function(kind){
    if(!['all','weekdays','off'].includes(kind))return;
    const dates=visibleDates();if(!dates.length)return;
    for(const date of dates){
      window.selectMasterCalendarDay?.(date);
      const box=document.getElementById('calWorking');if(!box)continue;
      const next=shouldWork(date,kind);
      if(box.checked!==next){box.checked=next;box.dispatchEvent(new Event('change',{bubbles:true}))}
    }
    syncPreset(kind);
  };
})();