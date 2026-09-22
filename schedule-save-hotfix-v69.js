(()=>{
'use strict';
if(window.BOS_SCHEDULE_SAVE_HOTFIX_V69)return;
window.BOS_SCHEDULE_SAVE_HOTFIX_V69=true;
const baseSave=window.saveMasterCalendarMonth;
if(typeof baseSave!=='function')return;

const dirtyDates=new Set();
const dateOnly=v=>String(v||'').slice(0,10);
const hm=v=>String(v||'').slice(0,5);
const truthy=v=>v===true||v===1||String(v).toLowerCase()==='true'||String(v)==='1';
const addIds=(set,x)=>[x?.id,x?.staff_id,x?.master_staff_id,x?.master_id,x?.vk_user_id,x?.user_id,x?.external_id].filter(Boolean).forEach(v=>set.add(String(v)));
const rowIds=r=>[r?.staff_id,r?.master_staff_id,r?.master_id,r?.master_vk_id,r?.vk_user_id,r?.user_id,r?.external_id].filter(Boolean).map(String);
const addDays=(value,n)=>{const d=new Date(value+'T12:00:00');d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const monday=value=>{const d=new Date(value+'T12:00:00');d.setDate(d.getDate()-((d.getDay()+6)%7));return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

function selectedDate(){
  const btn=document.querySelector('#masterMonthCalendar .bosCalDay.selected');
  return String(btn?.getAttribute('onclick')||'').match(/(\d{4}-\d{2}-\d{2})/)?.[1]||'';
}
function markSelectedDirty(){const date=selectedDate();if(date)dirtyDates.add(date)}
function currentMasterIds(){
  const ids=new Set();
  const user=typeof liveMasterUser==='function'?(liveMasterUser()||state?.user):(state?.user||{});
  addIds(ids,user);
  try{const id=typeof liveMasterId==='function'?liveMasterId():'';if(id)ids.add(String(id))}catch(_){ }
  let grew=true;
  while(grew){
    grew=false;
    for(const master of state?.masters||[]){
      const values=[master?.id,master?.staff_id,master?.master_id,master?.vk_user_id,master?.external_id].filter(Boolean).map(String);
      if(values.some(v=>ids.has(v))){const before=ids.size;addIds(ids,master);if(ids.size!==before)grew=true}
    }
  }
  return ids;
}
function savedRow(date,ids){
  return (state?.masterSchedule||[]).find(r=>dateOnly(r?.work_date||r?.date)===date&&rowIds(r).some(id=>ids.has(id)));
}
function draftDay(date){
  const dr=window.BOS_MASTER_CALENDAR?.draftFor?.(date);
  return dr?{is_working:!!dr.is_working,work_start:hm(dr.work_start)||'10:00',work_end:hm(dr.work_end)||'20:00'}:null;
}
function dayPayload(date,weekday,ids){
  if(dirtyDates.has(date)){
    const dr=draftDay(date)||{is_working:false,work_start:'10:00',work_end:'20:00'};
    return{date,weekday,is_working:dr.is_working,work_start:dr.is_working?dr.work_start:'',work_end:dr.is_working?dr.work_end:''};
  }
  const row=savedRow(date,ids);
  if(row){
    const working=truthy(row.is_working);
    return{date,weekday,is_working:working,work_start:working?(hm(row.work_start)||'10:00'):'',work_end:working?(hm(row.work_end)||'20:00'):''};
  }
  const dr=draftDay(date)||{is_working:false,work_start:'10:00',work_end:'20:00'};
  return{date,weekday,is_working:dr.is_working,work_start:dr.is_working?dr.work_start:'',work_end:dr.is_working?dr.work_end:''};
}

document.addEventListener('change',event=>{
  const id=event?.target?.id;
  if(id==='calWorking'||id==='calStart'||id==='calEnd')markSelectedDirty();
},true);

window.saveMasterCalendarMonth=async function(){
  const msg=document.getElementById('calendarSaveMsg');
  if(!dirtyDates.size){
    if(msg)msg.textContent='Изменений нет';
    try{window.BOS_NORMALIZE_MASTER_SCHEDULE?.()}catch(_){ }
    try{window.renderMonthCalendar?.()}catch(_){ }
    return{ok:true,unchanged:true};
  }
  if(msg)msg.textContent='Сохраняем…';
  const id=typeof liveMasterId==='function'?String(liveMasterId()||''):'';
  if(!id){if(msg)msg.textContent='Не удалось определить мастера';return{ok:false}}
  const ids=currentMasterIds();
  const weeks=[...new Set([...dirtyDates].map(monday))].sort();
  const savedNow=[...dirtyDates];
  try{
    for(const week of weeks){
      const days=Array.from({length:7},(_,i)=>dayPayload(addDays(week,i),i+1,ids));
      const result=await api('saveMasterSchedule',{master_vk_id:id,week_start:week,days});
      if(!result?.ok)throw new Error(result?.error||'Не удалось сохранить график');
    }
    const fresh=await api('bootstrap');
    if(fresh?.ok){
      state.masterSchedule=fresh.masterSchedule||[];
      try{if(typeof masterSchedule!=='undefined')masterSchedule=state.masterSchedule}catch(_){ }
    }
    savedNow.forEach(date=>dirtyDates.delete(date));
    try{window.BOS_NORMALIZE_MASTER_SCHEDULE?.()}catch(_){ }
    if(msg)msg.textContent='График сохранён';
    try{window.renderMonthCalendar?.()}catch(_){ }
    return{ok:true};
  }catch(error){
    if(msg)msg.textContent=error?.message||'Не удалось сохранить график';
    return{ok:false,error:error?.message||String(error||'')};
  }
};
})();
