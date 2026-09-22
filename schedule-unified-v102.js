(()=>{
'use strict';
if(window.BOS_UNIFIED_SCHEDULE_V102)return;
window.BOS_UNIFIED_SCHEDULE_V102=true;

const pad=n=>String(n).padStart(2,'0');
const dateOnly=v=>String(v||'').slice(0,10);
const hm=v=>String(v||'').slice(0,5);
const truthy=v=>v===true||v===1||String(v).toLowerCase()==='true'||String(v)==='1';
const ids=x=>[x?.id,x?.staff_id,x?.master_staff_id,x?.master_id,x?.vk_user_id,x?.user_id,x?.external_id].filter(Boolean).map(String);
const same=(a,b)=>{const set=new Set(ids(a));return ids(b).some(id=>set.has(id))};
const isMasterMode=()=>String(state?.user?.role||'')==='master'||(typeof liveMasterMode==='function'&&liveMasterMode());
const activeMaster=m=>m&&String(m.role||'master')==='master'&&m.is_active!==false&&String(m.status||'').toLowerCase()!=='inactive';
const workTime=r=>{const start=hm(r?.work_start),end=hm(r?.work_end);return start&&end?`${start}–${end}`:start||end||'Время не указано'};
const isWorking=r=>!!r&&truthy(r.is_working);
const isFullDay=r=>isWorking(r)&&hm(r.work_start)==='10:00'&&hm(r.work_end)==='20:00';
const workKind=r=>!isWorking(r)?'off':isFullDay(r)?'full':'partial';

function allMasters(){
  const result=[];
  const add=master=>{
    if(!activeMaster(master))return;
    const match=result.find(x=>same(x,master)||(String(x.full_name||'').trim()&&String(x.full_name||'').trim()===String(master.full_name||'').trim()));
    if(match)Object.assign(match,master);
    else result.push({...master});
  };
  (state?.masters||[]).forEach(add);
  (state?.users||[]).filter(u=>String(u?.role||'')==='master').forEach(add);
  return result.sort((a,b)=>String(a.full_name||'').localeCompare(String(b.full_name||''),'ru'));
}
function scheduleFor(master,date){return (state?.masterSchedule||[]).find(r=>dateOnly(r.work_date||r.date)===date&&same(master,r))}
function orderBelongs(order,master){return ids(master).includes(String(order?.master_vk_id||order?.master_id||order?.master_staff_id||''))||String(order?.master_name||'').trim()===String(master?.full_name||'').trim()}
function dayOrders(date){return (state?.orders||[]).filter(o=>dateOnly(o.scheduled_date)===date&&String(o.status||'')!=='Отменена')}

let calendarMonth=new Date();
calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),1,12);
const localIso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
function monthTitle(){return calendarMonth.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}
function managementCalendar(){
  const masters=allMasters(),y=calendarMonth.getFullYear(),m=calendarMonth.getMonth(),first=new Date(y,m,1,12),last=new Date(y,m+1,0,12),lead=(first.getDay()+6)%7;
  let cells='';
  for(let i=0;i<lead;i++)cells+='<span></span>';
  for(let day=1;day<=last.getDate();day++){
    const date=localIso(new Date(y,m,day,12));
    const rows=masters.map(master=>scheduleFor(master,date));
    const working=rows.filter(isWorking),partial=working.filter(r=>!isFullDay(r)),orders=dayOrders(date);
    const kind=partial.length?'partial':working.length?'full':'off';
    cells+=`<button type="button" class="bosUnifiedDay ${kind}" data-schedule-date="${date}" onclick="openUnifiedScheduleDay('${date}')"><b>${day}</b><small>${working.length?working.length+' маст.':'выходной'}</small>${orders.length?`<span>${orders.length} заяв.</span>`:''}</button>`;
  }
  return `<div class="bosSchedulePageHead"><h2>График</h2><div class="muted">Рабочие дни мастеров и загрузка по заявкам</div></div><section class="card bosUnifiedScheduleCard"><div class="bosScheduleToolbar"><button class="secondary" type="button" onclick="shiftUnifiedScheduleMonth(-1)">←</button><div><h3>${esc(monthTitle())}</h3><div class="bosScheduleLegend"><span class="full">Полный день 10:00–20:00</span><span class="partial">Неполный день</span></div></div><button class="secondary" type="button" onclick="shiftUnifiedScheduleMonth(1)">→</button></div><div class="bosUnifiedWeek"><b>Пн</b><b>Вт</b><b>Ср</b><b>Чт</b><b>Пт</b><b>Сб</b><b>Вс</b></div><div class="bosUnifiedGrid">${cells}</div></section>`;
}
window.shiftUnifiedScheduleMonth=function(delta){calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+Number(delta||0),1,12);show('dispatch')};
window.openUnifiedScheduleDay=function(date){
  const masters=allMasters(),orders=dayOrders(date),title=new Date(date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
  const body=masters.map(master=>{
    const row=scheduleFor(master,date),working=isWorking(row),kind=workKind(row),assigned=orders.filter(o=>orderBelongs(o,master));
    const label=!working?'Выходной':isFullDay(row)?'Полный рабочий день':'Неполный рабочий день';
    const chip=!working?'<span class="bosWorkChip off">Выходной</span>':`<span class="bosWorkChip ${kind}">${esc(workTime(row))}</span>`;
    return `<section class="bosMasterDayRow" data-master-name="${esc(master.full_name||'Мастер')}"><div class="bosMasterDayTop"><div><b>${esc(master.full_name||'Мастер')}</b><div class="muted">${label}</div></div><div class="bosMasterDayBadges">${chip}<span class="softChip">${assigned.length} заяв.</span></div></div>${assigned.map(o=>`<button class="secondary wide bosScheduleOrder" onclick="closeModal();openOrder('${esc(o.id)}')">${esc(String(o.scheduled_time||o.time_slot||'').slice(0,5)||'—')} · ${esc(o.client||o.work||'Заявка')}</button>`).join('')}</section>`;
  }).join('');
  openModal(`<div class="bosUnifiedDayModal"><h2>${esc(title)}</h2><p class="muted">Все мастера и загрузка по заявкам</p>${body||'<p class="muted">Мастеров пока нет.</p>'}</div>`);
};

function decorateMasterCalendar(){
  if(!isMasterMode())return;
  const host=document.getElementById('masterMonthCalendar');
  if(!host)return;
  host.querySelectorAll('.bosCalDay').forEach(btn=>{
    const date=String(btn.getAttribute('onclick')||'').match(/(\d{4}-\d{2}-\d{2})/)?.[1]||'';
    const draft=date&&window.BOS_MASTER_CALENDAR?.draftFor?.(date);
    btn.classList.remove('fullDay','partialDay');
    if(draft?.is_working)btn.classList.add(draft.work_start==='10:00'&&draft.work_end==='20:00'?'fullDay':'partialDay');
  });
  let root=host.querySelector(':scope > .bosUnifiedMasterCard');
  if(!root){
    root=document.createElement('section');
    root.className='card bosUnifiedMasterCard';
    host.prepend(root);
  }
  [...host.children].filter(node=>node!==root).forEach(node=>root.appendChild(node));
  if(!root.querySelector('.bosMasterScheduleInlineHead')){
    const bar=document.createElement('div');
    bar.className='bosMasterScheduleInlineHead';
    bar.innerHTML='<div><b>Мой график</b><small>Полный день — 10:00–20:00, сокращённый день отмечен отдельно</small></div><button type="button" class="secondary" onclick="resetMasterCalendarMonth()">Этот месяц</button>';
    root.prepend(bar);
  }
  root.querySelectorAll(':scope > .card').forEach(card=>card.classList.add('bosUnifiedInnerCard'));
  root.querySelectorAll('#masterDayEditor > .card').forEach(card=>card.classList.add('bosUnifiedInnerCard','bosDayEditorInner'));
}
const finalRender=window.renderMonthCalendar;
if(typeof finalRender==='function')window.renderMonthCalendar=function(){const out=finalRender.apply(this,arguments);setTimeout(decorateMasterCalendar,0);setTimeout(decorateMasterCalendar,60);return out};

const previousDispatch=pages.dispatch;
pages.dispatch=function(){
  if(!isMasterMode())return managementCalendar();
  setTimeout(()=>window.renderMonthCalendar?.(),0);
  return `<div class="bosSchedulePageHead"><h2>График</h2><div class="muted">Мой рабочий график</div></div><div id="masterMonthCalendar"></div>`;
};

const style=document.createElement('style');
style.textContent=`
.bosSchedulePageHead{margin-bottom:14px}.bosSchedulePageHead h2{margin:0 0 4px}.bosUnifiedScheduleCard,.bosUnifiedMasterCard{overflow:hidden}.bosScheduleToolbar{display:grid;grid-template-columns:auto 1fr auto;align-items:start;gap:10px}.bosScheduleToolbar>div{text-align:center;min-width:0}.bosScheduleToolbar h3{margin:2px 0;text-transform:capitalize}.bosScheduleLegend{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:5px;font-size:10px}.bosScheduleLegend span{padding:4px 7px;border-radius:999px;border:1px solid transparent}.bosScheduleLegend .full{color:#75d9a2;background:rgba(31,143,80,.15);border-color:rgba(52,190,107,.35)}.bosScheduleLegend .partial{color:#fbbf24;background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.35)}.bosUnifiedWeek,.bosUnifiedGrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}.bosUnifiedWeek{margin:16px 0 6px;text-align:center;color:#8fa3b8;font-size:12px}.bosUnifiedDay{min-height:68px;padding:7px;border:1px solid #293f58;border-radius:12px;background:#0d1b2b;color:#fff;display:flex;flex-direction:column;justify-content:space-between;text-align:left;overflow:hidden}.bosUnifiedDay b{font-size:15px}.bosUnifiedDay small,.bosUnifiedDay span{font-size:9px}.bosUnifiedDay small{color:#7e93aa}.bosUnifiedDay span{color:#a8d7ff}.bosUnifiedDay.full{background:rgba(20,92,58,.34);border-color:rgba(52,190,107,.58)}.bosUnifiedDay.full small{color:#75d9a2}.bosUnifiedDay.partial{background:rgba(120,78,8,.28);border-color:rgba(245,158,11,.58)}.bosUnifiedDay.partial small{color:#fbbf24}.bosMasterDayRow{padding:14px 0;border-bottom:1px solid rgba(255,255,255,.09)}.bosMasterDayRow:last-child{border-bottom:0}.bosMasterDayTop{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.bosMasterDayBadges{display:flex;justify-content:flex-end;align-items:center;gap:7px;flex-wrap:wrap}.bosWorkChip{display:inline-flex;align-items:center;min-height:28px;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap;border:1px solid}.bosWorkChip.full{color:#75d9a2;background:rgba(31,143,80,.15);border-color:rgba(52,190,107,.55)}.bosWorkChip.partial{color:#fbbf24;background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.55)}.bosWorkChip.off{color:#9db0c5;background:rgba(125,145,165,.09);border-color:rgba(125,145,165,.25)}.bosScheduleOrder{margin-top:8px;text-align:left}.bosMasterScheduleInlineHead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:10px}.bosMasterScheduleInlineHead>div{display:flex;flex-direction:column;gap:3px}.bosMasterScheduleInlineHead small{color:var(--muted,#8ea0b5);font-size:11px}.bosUnifiedMasterCard>.bosUnifiedInnerCard,.bosUnifiedMasterCard #masterDayEditor>.bosUnifiedInnerCard{background:transparent!important;border:0!important;box-shadow:none!important;padding-left:0!important;padding-right:0!important;margin:0!important}.bosUnifiedMasterCard>.bosUnifiedInnerCard+.bosUnifiedInnerCard,.bosUnifiedMasterCard #masterDayEditor>.bosDayEditorInner{border-top:1px solid rgba(255,255,255,.08)!important;padding-top:14px!important;margin-top:12px!important}.bosUnifiedMasterCard>.bosSchedulePresets{background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important;margin:0 0 10px!important}.bosCalDay.working.fullDay{background:rgba(20,92,58,.34)!important;border-color:rgba(52,190,107,.62)!important}.bosCalDay.working.fullDay small{color:#75d9a2!important}.bosCalDay.working.partialDay{background:rgba(120,78,8,.28)!important;border-color:rgba(245,158,11,.62)!important}.bosCalDay.working.partialDay small{color:#fbbf24!important}
@media(max-width:520px){.bosUnifiedWeek,.bosUnifiedGrid{gap:4px}.bosUnifiedDay{min-height:60px;padding:5px;border-radius:10px}.bosUnifiedDay small,.bosUnifiedDay span{font-size:8px}.bosScheduleLegend{justify-content:flex-start}.bosScheduleToolbar{grid-template-columns:48px 1fr 48px}.bosMasterDayTop{align-items:flex-start}.bosMasterDayBadges{max-width:48%;}.bosMasterScheduleInlineHead{align-items:flex-start}.bosMasterScheduleInlineHead .secondary{white-space:nowrap}}
`;
document.head.appendChild(style);
})();
