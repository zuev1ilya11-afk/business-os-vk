(()=>{
'use strict';

function networkLike(err){
  const m=String(err?.message||err||'');
  return /не удалось связаться|сервер не ответил|load failed|failed to fetch|networkerror|network request failed|upstream_(?:timeout|unavailable)/i.test(m);
}

if(typeof window.api==='function'&&!window.BOS_SCHEDULE_SAVE_RETRY_V59){
  window.BOS_SCHEDULE_SAVE_RETRY_V59=true;
  const baseApi=window.api;
  const wrapped=async function(action,payload={}){
    if(action!=='saveMasterSchedule')return baseApi(action,payload);
    try{return await baseApi(action,payload)}catch(first){
      if(!networkLike(first))throw first;
      await new Promise(r=>setTimeout(r,500));
      return await baseApi(action,payload);
    }
  };
  window.api=wrapped;
  try{api=wrapped}catch(_){ }
}

function visibleCalendarDates(){
  return [...document.querySelectorAll('#masterMonthCalendar .bosCalDay')]
    .map(btn=>String(btn.getAttribute('onclick')||'').match(/(\d{4}-\d{2}-\d{2})/)?.[1]||'')
    .filter(Boolean);
}

function shouldWork(date,kind){
  if(kind==='all')return true;
  if(kind==='off')return false;
  const day=new Date(date+'T12:00:00').getDay();
  return day>=1&&day<=5;
}

function syncPresetVisual(kind){
  document.querySelectorAll('.bosMiniPreset').forEach(label=>{
    const input=label.querySelector('input');
    const click=String(input?.getAttribute('onclick')||'');
    const active=click.includes(`'${kind}'`);
    label.classList.toggle('active',active);
    if(input)input.checked=active;
  });
}

window.setMasterSchedulePreset=function(kind){
  if(!['all','weekdays','off'].includes(kind))return;
  const dates=visibleCalendarDates();
  if(!dates.length)return;
  for(const date of dates){
    window.selectMasterCalendarDay?.(date);
    const box=document.getElementById('calWorking');
    if(!box)continue;
    const next=shouldWork(date,kind);
    if(box.checked!==next){
      box.checked=next;
      box.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }
  syncPresetVisual(kind);
};
})();
