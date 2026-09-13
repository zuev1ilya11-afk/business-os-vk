(()=>{
'use strict';

const STAFF_GATEWAY='https://business-os-api-gateway.netlify.app/api/proxy/staff-admin-api';
const STAFF_DIRECT='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/staff-admin-api';

// The production Netlify gateway is deployed separately from GitHub Pages and can lag behind.
// Retry staff-admin directly only when the gateway explicitly does not know the service or is unreachable.
if(!window.BOS_STAFF_ADMIN_LIVE_FALLBACK_V60){
  window.BOS_STAFF_ADMIN_LIVE_FALLBACK_V60=true;
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:String(input?.url||'');
    if(url!==STAFF_GATEWAY)return nativeFetch(input,init);
    try{
      const response=await nativeFetch(input,init);
      if(response.status!==404)return response;
      let body={};
      try{body=await response.clone().json()}catch(_){ }
      if(String(body?.error||'')!=='SERVICE_NOT_ALLOWED')return response;
      return nativeFetch(STAFF_DIRECT,init);
    }catch(err){
      if(!/load failed|failed to fetch|networkerror|network request failed/i.test(String(err?.message||err||'')))throw err;
      return nativeFetch(STAFF_DIRECT,init);
    }
  };
}

function visibleDates(){
  return [...document.querySelectorAll('#masterMonthCalendar .bosCalDay')]
    .map(btn=>String(btn.getAttribute('onclick')||'').match(/(\d{4}-\d{2}-\d{2})/)?.[1]||'')
    .filter(Boolean);
}
function workFor(date,kind){
  if(kind==='all')return true;
  if(kind==='off')return false;
  const day=new Date(date+'T12:00:00').getDay();
  return day>=1&&day<=5;
}
function syncPreset(kind){
  document.querySelectorAll('.bosMiniPreset').forEach(label=>{
    const input=label.querySelector('input');
    const click=String(input?.getAttribute('onclick')||'');
    const active=click.includes(`'${kind}'`);
    label.classList.toggle('active',active);
    if(input)input.checked=active;
  });
}

// Override the broken preset bridge. It uses the public day selector and therefore mutates
// the same calendar draft that the Save button later sends to the API.
window.setMasterSchedulePreset=function(kind){
  if(!['all','weekdays','off'].includes(kind))return;
  const dates=visibleDates();
  for(const date of dates){
    if(typeof window.selectMasterCalendarDay!=='function')break;
    window.selectMasterCalendarDay(date);
    const checkbox=document.getElementById('calWorking');
    if(!checkbox)continue;
    const next=workFor(date,kind);
    if(checkbox.checked!==next){
      checkbox.checked=next;
      checkbox.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }
  syncPreset(kind);
};

function networkLike(err){
  return /не удалось связаться|сервер не ответил|load failed|failed to fetch|networkerror|network request failed|upstream_timeout|upstream_unavailable/i.test(String(err?.message||err||''));
}

// saveMasterSchedule is an upsert by staff/date, so one retry after a transport failure is safe.
if(typeof window.api==='function'&&!window.BOS_SCHEDULE_SAVE_RETRY_V60){
  window.BOS_SCHEDULE_SAVE_RETRY_V60=true;
  const previousApi=window.api;
  const retryingApi=async function(action,payload={}){
    if(action!=='saveMasterSchedule')return previousApi(action,payload);
    try{return await previousApi(action,payload)}catch(first){
      if(!networkLike(first))throw first;
      await new Promise(resolve=>setTimeout(resolve,450));
      return previousApi(action,payload);
    }
  };
  window.api=retryingApi;
  try{api=retryingApi}catch(_){ }
}
})();
