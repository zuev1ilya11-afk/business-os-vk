let teamCalendarWeek='';
const masterCalendarBaseDispatch=pages.dispatch;

function teamWeekRows(week){
  return (masterSchedule||[]).filter(x=>String(x.week_start||'')===String(week));
}
function teamDaySchedule(masterId,date,week){
  return teamWeekRows(week).find(x=>String(x.master_vk_id)===String(masterId)&&String(x.date)===String(date))||null;
}
function teamOrdersForMasterDay(masterId,date){
  return state.orders.filter(o=>String(o.master_vk_id||'')===String(masterId)&&String(o.scheduled_date||'')===String(date)&&o.status!=='Отменена').sort((a,b)=>String(a.scheduled_time||'').localeCompare(String(b.scheduled_time||'')));
}
function changeTeamCalendarWeek(delta){
  teamCalendarWeek=addDaysIso(teamCalendarWeek||mondayOf(),delta);
  show('dispatch');
}
function resetTeamCalendarWeek(){
  teamCalendarWeek=mondayOf();
  show('dispatch');
}
function masterAvailabilityRow(master,date,week){
  const day=teamDaySchedule(master.vk_user_id,date,week);
  if(!day||!extraTruthy(day.is_working))return '';
  const orders=teamOrdersForMasterDay(master.vk_user_id,date);
  return `<section class="card" style="margin:10px 0;padding:12px"><div class="row"><div><b>${esc(master.full_name)}</b><div class="muted">${esc(master.specialization||master.city||'Мастер')}</div></div><span class="status info">${esc((day.work_start||'')+'–'+(day.work_end||''))}</span></div>${orders.length?`<div style="margin-top:10px">${orders.map(o=>`<button class="secondary wide" style="margin-top:6px;text-align:left" onclick="openOrder('${esc(o.id)}')"><b>${esc(o.scheduled_time||'Без времени')}</b> · ${esc(o.work)}<br><span class="muted">${esc(o.address)} · ${esc(o.status)}</span></button>`).join('')}</div>`:'<p class="muted" style="margin:8px 0 0">Свободен — заявок нет</p>'}</section>`;
}
function teamCalendarHtml(){
  const week=teamCalendarWeek||mondayOf();
  teamCalendarWeek=week;
  const days=Array.from({length:7},(_,i)=>addDaysIso(week,i));
  const scheduledIds=new Set(teamWeekRows(week).map(x=>String(x.master_vk_id)));
  const missing=state.masters.filter(m=>!scheduledIds.has(String(m.vk_user_id)));
  return `<div class="row"><div><h2>График мастеров</h2><div class="muted">Кто работает и какие заявки назначены</div></div><button class="secondary" onclick="resetTeamCalendarWeek()">Эта неделя</button></div><section class="card"><div class="row"><button class="secondary" onclick="changeTeamCalendarWeek(-7)">←</button><div style="text-align:center"><b>${humanDay(week)}–${humanDay(addDaysIso(week,6))}</b><div class="muted">Недельный календарь</div></div><button class="secondary" onclick="changeTeamCalendarWeek(7)">→</button></div></section>${days.map((date,i)=>{const working=state.masters.map(m=>masterAvailabilityRow(m,date,week)).filter(Boolean);return `<section class="card"><div class="row"><div><b>${ruWeek[i]} · ${humanDay(date)}</b><div class="muted">Работают: ${working.length}</div></div><span class="status info">${state.orders.filter(o=>String(o.scheduled_date||'')===date&&o.status!=='Отменена').length} заявок</span></div>${working.join('')||'<p class="muted">Никто не отметил рабочий день</p>'}</section>`}).join('')}${missing.length?`<section class="card"><h3>График недели не заполнен</h3><p class="muted">${missing.map(m=>esc(m.full_name)).join(', ')}</p></section>`:''}`;
}

pages.dispatch=function(){
  const masterNow=(typeof liveMasterMode==='function'&&liveMasterMode())||String(state.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview());
  if(masterNow)return masterCalendarBaseDispatch();
  return teamCalendarHtml();
};