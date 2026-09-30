(()=>{
'use strict';
if(window.BOS_UNIFIED_SCHEDULE_V102)return;window.BOS_UNIFIED_SCHEDULE_V102=true;
const FULL_START='10:00',FULL_END='20:00';
let month=new Date();month.setDate(1);month.setHours(12,0,0,0);
let selected='';
let draft={};
let bulkStart=FULL_START,bulkEnd=FULL_END;
const pad=n=>String(n).padStart(2,'0');
const localIso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const dateOnly=v=>String(v||'').slice(0,10);
const hm=v=>String(v||'').slice(0,5);
const working=r=>!!r&&r.is_working!==false&&String(r.is_working)!=='false';
const ids=x=>[x?.id,x?.staff_id,x?.master_staff_id,x?.master_id,x?.vk_user_id,x?.user_id,x?.external_id].filter(Boolean).map(String);
const intersects=(a,b)=>{const s=new Set(ids(a));return ids(b).some(v=>s.has(v))};
const isMaster=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview());
function allMasters(){
 const list=[...(state.masters||[]),...(state.users||[]).filter(u=>String(u.role)==='master')],out=[];
 for(const m of list){if(!m||m.is_active===false||String(m.is_active)==='false')continue;const key=ids(m)[0]||String(m.full_name||m.name||'');if(!key)continue;if(out.some(x=>intersects(x,m)||(!ids(x).length&&!ids(m).length&&String(x.full_name||x.name||'')===String(m.full_name||m.name||''))))continue;out.push(m)}
 return out;
}
function liveMaster(){const u=typeof liveMasterUser==='function'?liveMasterUser():(state.user||{});return allMasters().find(m=>intersects(m,u))||u}
function masterId(m){return String(m?.vk_user_id||m?.external_id||m?.id||m?.staff_id||'')}
function rowFor(m,date){const aliases=ids(m);return (state.masterSchedule||[]).find(r=>dateOnly(r.work_date||r.date)===date&&[r.staff_id,r.master_staff_id,r.master_id,r.master_vk_id,r.vk_user_id,r.user_id,r.external_id].filter(Boolean).some(id=>aliases.includes(String(id))))}
function orderFor(o,m){return window.BOS_SCHEDULE_CONTRACT.sameMaster(m,o)}
function ordersFor(date,m){return (state.orders||[]).filter(o=>dateOnly(o.scheduled_date)===date&&String(o.status||'')!=='Отменена'&&(!m||orderFor(o,m)))}
function kind(r){if(!r||r.is_working==null)return'unknown';if(!working(r))return'off';return hm(r.work_start)===FULL_START&&hm(r.work_end)===FULL_END?'full':'partial'}
function timeText(r){if(kind(r)==='unknown')return'Не задан';if(!working(r))return'Выходной';const a=hm(r.work_start)||'—',b=hm(r.work_end)||'—';return `${a}–${b}`}
function daySummary(masters,date){
 const counts={full:0,partial:0,off:0,unknown:0};for(const m of masters)counts[kind(rowFor(m,date))]++;
 const max=Math.max(counts.full,counts.partial,counts.off),leaders=['full','partial','off'].filter(k=>counts[k]===max);
 return {counts,kind:!max?'unknown':leaders.length===1?leaders[0]:'partial'};
}
const masterKey=m=>ids(m)[0]||String(m.full_name||m.name||'');
const dateLabel=date=>new Date(date+'T12:00:00').toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'long'});
const kindLabel={full:'Полный рабочий день',partial:'Неполный рабочий день',off:'Выходной',unknown:'График не задан'};
function orderCount(n){const a=n%10,b=n%100;return `${n} ${a===1&&b!==11?'заявка':a>=2&&a<=4&&(b<12||b>14)?'заявки':'заявок'}`}
function title(){return month.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}
function monthDates(){const y=month.getFullYear(),m=month.getMonth(),last=new Date(y,m+1,0,12).getDate();return Array.from({length:last},(_,i)=>`${y}-${pad(m+1)}-${pad(i+1)}`)}
function ownDraft(date){if(draft[date])return draft[date];const r=rowFor(liveMaster(),date);draft[date]={date,is_working:working(r),work_start:hm(r?.work_start)||FULL_START,work_end:hm(r?.work_end)||FULL_END};return draft[date]}
function hourOptions(value,from,to){let s='';for(let h=from;h<=to;h++){const v=pad(h)+':00';s+=`<option value="${v}" ${v===value?'selected':''}>${v}</option>`}return s}
function legend(){return isMaster()?'<div class="usLegend"><span><i class="usDot full"></i>Полный 10:00–20:00</span><span><i class="usDot partial"></i>Неполный день</span><span><i class="usDot off"></i>Выходной</span></div>':'<div class="usLegend"><span><i class="usDot full"></i>Больше полных дней</span><span><i class="usDot partial"></i>Больше неполных</span><span><i class="usDot off"></i>Больше выходных</span><span><i class="usDot unknown"></i>График не задан</span></div>'}
function dayCell(date,day){
 if(isMaster()){
  const d=ownDraft(date),k=d.is_working&&(d.work_start!==FULL_START||d.work_end!==FULL_END)?'partial':d.is_working?'full':'off',os=ordersFor(date,liveMaster());
  return `<button type="button" class="usDay ${k} ${selected===date?'selected':''}" data-date="${date}" onclick="selectUnifiedScheduleDay('${date}')"><b>${day}</b><small>${d.is_working?`${d.work_start}–${d.work_end}`:'выходной'}</small>${os.length?`<span>${os.length} заяв.</span>`:''}</button>`;
 }
 const masters=allMasters(),summary=daySummary(masters,date),os=ordersFor(date),other=os.filter(o=>!masters.some(m=>orderFor(o,m)));
 const rows=masters.map(m=>{const r=rowFor(m,date),k=kind(r),name=m.full_name||m.name||'Мастер',count=os.filter(o=>orderFor(o,m)).length;return `<button type="button" class="usPerson ${k}" data-schedule-master="${esc(masterKey(m))}" title="${esc(`${name} · ${timeText(r)} · ${orderCount(count)}`)}" aria-label="${esc(`${name}, ${dateLabel(date)}, ${timeText(r)}, ${orderCount(count)}. Открыть заявки`)}"><span class="usPersonName"><i class="usDot ${k}" aria-hidden="true"></i><span>${esc(name)}</span></span><span class="usPersonTime">${esc(timeText(r))}</span><strong class="usPersonCount">${count}</strong></button>`}).join('');
 const labels={full:'полн.',partial:'неполн.',off:'выходн.',unknown:'не задан'};
 const totals=Object.entries(summary.counts).filter(([,n])=>n).map(([k,n])=>`<span class="${k}">${n} ${labels[k]}</span>`).join('');
 return `<article class="usDay usTeamDay ${summary.kind}${selected===date?' selected':''}" data-date="${date}" aria-label="${esc(dateLabel(date))}"><button type="button" class="usDayHead" data-schedule-day aria-label="Открыть день: ${esc(dateLabel(date))}, ${orderCount(os.length)}"><span><b>${day}</b><small class="usDayWeekday">${esc(new Date(date+'T12:00:00').toLocaleDateString('ru-RU',{weekday:'long'}))}</small></span><strong class="usDayCount">${orderCount(os.length)}</strong></button><div class="usPersonColumns" aria-hidden="true"><span>Мастер</span><span>График</span><span>Заявки</span></div><div class="usPeople">${rows||'<p class="muted">Мастеров пока нет</p>'}</div><div class="usDayTotals">${totals||'<span class="unknown">График пока не заполнен</span>'}</div>${other.length?`<button type="button" class="usOtherOrders" data-schedule-day>Другие заявки: ${other.length}</button>`:''}</article>`;
}
function calendarGrid(){const y=month.getFullYear(),m=month.getMonth(),first=new Date(y,m,1,12),last=new Date(y,m+1,0,12),lead=(first.getDay()+6)%7;let cells='';for(let i=0;i<lead;i++)cells+='<span class="usEmptyDay" aria-hidden="true"></span>';for(let d=1;d<=last.getDate();d++){const date=`${y}-${pad(m+1)}-${pad(d)}`;cells+=dayCell(date,d)}const grid=`<div class="usWeek"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div><div class="usGrid">${cells}</div>`;return isMaster()?grid:`<div class="usMonthScroll" tabindex="0" role="region" aria-label="Календарь графиков мастеров">${grid}</div><p class="usCalendarNote">Полный день: 10:00–20:00. При равенстве — оранжевый. Незаполненный график не считается выходным.</p>`}
function editor(){if(!isMaster())return'';if(!selected)return '<div class="usEditor muted">Нажмите на день, чтобы изменить только его.</div>';const d=ownDraft(selected),label=new Date(selected+'T12:00:00').toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});return `<div class="usEditor"><div class="row"><div><b style="text-transform:capitalize">${label}</b><div class="muted">Настройка выбранного дня</div></div><label class="usSwitch"><input id="usWorking" type="checkbox" ${d.is_working?'checked':''}><span>Работаю</span></label></div><div class="two usTimes"><label>С<select id="usStart" ${d.is_working?'':'disabled'}>${hourOptions(d.work_start,7,22)}</select></label><label>До<select id="usEnd" ${d.is_working?'':'disabled'}>${hourOptions(d.work_end,8,23)}</select></label></div></div>`}
function masterControls(){if(!isMaster())return'';return `<div class="usQuick"><div><b>Быстро задать график</b><div class="muted">Все настройки находятся в этой же плашке с календарём.</div></div><div class="usQuickButtons"><button type="button" class="secondary" onclick="applyUnifiedSchedulePreset('all')">Все дни</button><button type="button" class="secondary" onclick="applyUnifiedSchedulePreset('weekdays')">Будни</button><button type="button" class="secondary" onclick="applyUnifiedSchedulePreset('off')">Убрать дни</button></div><div class="two usBulkTimes"><label>С<select id="usBulkStart" onchange="setUnifiedBulkTime()">${hourOptions(bulkStart,7,22)}</select></label><label>До<select id="usBulkEnd" onchange="setUnifiedBulkTime()">${hourOptions(bulkEnd,8,23)}</select></label></div></div>`}
function pageHtml(){const heading=isMaster()?'Мой график':'График мастеров',sub=isMaster()?'Рабочие дни, время и заявки':'Единый календарь рабочих дней и загрузки мастеров';return `${window.BOS_DISPATCHER_DAY_HTML?.()||''}<div class="usHeader"><div><h2>${heading}</h2><div class="muted">${sub}</div></div><button type="button" class="secondary" onclick="resetUnifiedScheduleMonth()">Этот месяц</button></div><section class="card usScheduleCard ${isMaster()?'':'usManagement'}"><div class="usMonthHead"><button type="button" class="secondary" onclick="shiftUnifiedScheduleMonth(-1)">←</button><div><h3>${title()}</h3><div class="muted">${isMaster()?'Нажмите на день для настройки':'Мастера, часы и заявки — сразу в календаре'}</div></div><button type="button" class="secondary" onclick="shiftUnifiedScheduleMonth(1)">→</button></div>${legend()}${masterControls()}${calendarGrid()}${editor()}${isMaster()?'<button type="button" class="primary wide usSave" onclick="saveUnifiedScheduleMonth()">Сохранить график</button><p id="usSaveMsg" class="muted"></p>':''}</section>`}
function render(){const host=document.getElementById('content');if(state.page!=='dispatch'||!host)return;host.innerHTML=pageHtml();bindEditor();document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page==='dispatch'))}
function bindEditor(){if(!isMaster()||!selected)return;const d=ownDraft(selected),w=document.getElementById('usWorking'),s=document.getElementById('usStart'),e=document.getElementById('usEnd');if(!w||!s||!e)return;w.onchange=()=>{d.is_working=w.checked;render()};s.onchange=()=>{d.work_start=s.value;if(d.work_end<=d.work_start)d.work_end=pad(Math.min(23,Number(d.work_start.slice(0,2))+1))+':00';render()};e.onchange=()=>{d.work_end=e.value>d.work_start?e.value:pad(Math.min(23,Number(d.work_start.slice(0,2))+1))+':00';render()}}
window.selectUnifiedScheduleDay=function(date){selected=date;render()};
window.shiftUnifiedScheduleMonth=function(n){month=new Date(month.getFullYear(),month.getMonth()+n,1,12);selected='';draft={};render()};
window.resetUnifiedScheduleMonth=function(){month=new Date();month.setDate(1);month.setHours(12,0,0,0);selected='';draft={};render()};
window.setUnifiedBulkTime=function(){bulkStart=document.getElementById('usBulkStart')?.value||bulkStart;bulkEnd=document.getElementById('usBulkEnd')?.value||bulkEnd;if(bulkEnd<=bulkStart)bulkEnd=pad(Math.min(23,Number(bulkStart.slice(0,2))+1))+':00'};
window.applyUnifiedSchedulePreset=function(mode){window.setUnifiedBulkTime();for(const date of monthDates()){const d=ownDraft(date),weekday=new Date(date+'T12:00:00').getDay(),on=mode==='all'||(mode==='weekdays'&&weekday>=1&&weekday<=5);d.is_working=mode==='off'?false:on;if(d.is_working){d.work_start=bulkStart;d.work_end=bulkEnd}}render()};
function selectManagementDay(date){
 selected=date;document.querySelectorAll('.usTeamDay').forEach(el=>el.classList.toggle('selected',el.dataset.date===date));
}
function orderButtons(orders){
 return [...orders].sort((a,b)=>String(a.scheduled_time||a.time_slot||'').localeCompare(String(b.scheduled_time||b.time_slot||''))).map(o=>`<button type="button" class="secondary wide miniOrder" data-schedule-order="${esc(o.id)}">№ ${esc(String(o.external_id||'').startsWith('hands:')?String(o.external_id).slice(6):o.id)} · ${esc(hm(o.scheduled_time||o.time_slot)||'—')} · ${esc(o.work||'Заявка')}${o.client?` · ${esc(o.client)}`:''}</button>`).join('');
}
function masterDetails(m,date,orders){
 const r=rowFor(m,date),k=kind(r),os=orders.filter(o=>orderFor(o,m));
 return `<section class="card usMasterRow ${k}"><div class="row"><div><b>${esc(m.full_name||m.name||'Мастер')}</b><div class="muted">${kindLabel[k]}</div></div><div class="usBadges"><span class="usTime ${k}">${esc(timeText(r))}</span><span class="softChip">${orderCount(os.length)}</span></div></div>${orderButtons(os)||'<p class="muted">Заявок на этот день нет.</p>'}</section>`;
}
window.openUnifiedScheduleDay=function(date){
 const masters=allMasters(),os=ordersFor(date),other=os.filter(o=>!masters.some(m=>orderFor(o,m)));selectManagementDay(date);
 openModal(`<h2>${esc(dateLabel(date))}</h2><p class="muted">${orderCount(os.length)}. Все мастера, включая выходных и без заявок.</p><div class="usMasterList">${masters.map(m=>masterDetails(m,date,os)).join('')||'<p class="muted">Мастеров пока нет.</p>'}${other.length?`<section class="card"><h3>Другие заявки</h3><p class="muted">Без назначения или с мастером вне текущего списка.</p>${orderButtons(other)}</section>`:''}</div>`);
};
window.openUnifiedScheduleMasterDay=function(date,key){
 if(isMaster())return;const m=allMasters().find(m=>masterKey(m)===key);if(!m)return;selectManagementDay(date);
 openModal(`<h2>Заявки мастера</h2><p class="muted">${esc(dateLabel(date))}</p><div class="usMasterList">${masterDetails(m,date,ordersFor(date))}</div>`);
};
document.addEventListener('click',event=>{
 const order=event.target.closest?.('[data-schedule-order]');if(order){window.closeModal?.();window.openOrder?.(order.dataset.scheduleOrder);return}
 const action=event.target.closest?.('[data-schedule-master],[data-schedule-day]'),day=action?.closest('.usTeamDay');if(!day)return;
 if(action.hasAttribute('data-schedule-master'))window.openUnifiedScheduleMasterDay(day.dataset.date,action.dataset.scheduleMaster);
 else window.openUnifiedScheduleDay(day.dataset.date);
});
const monday=date=>{const d=new Date(date+'T12:00:00'),shift=(d.getDay()+6)%7;d.setDate(d.getDate()-shift);return localIso(d)};
const addDays=(date,n)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+n);return localIso(d)};
window.saveUnifiedScheduleMonth=async function(){const msg=document.getElementById('usSaveMsg'),m=liveMaster(),id=masterId(m);if(msg)msg.textContent='Сохраняем…';if(!id){if(msg)msg.textContent='Не удалось определить мастера';return}const weeks=[...new Set(monthDates().map(monday))];try{for(const week of weeks){const days=Array.from({length:7},(_,i)=>{const date=addDays(week,i),d=ownDraft(date);return{date,weekday:i+1,is_working:!!d.is_working,work_start:d.is_working?d.work_start:'',work_end:d.is_working?d.work_end:''}});const r=await api('saveMasterSchedule',{master_vk_id:id,week_start:week,days});if(!r?.ok)throw new Error(r?.error||'Не удалось сохранить график')}const fresh=await api('bootstrap');if(fresh?.ok)state.masterSchedule=fresh.masterSchedule||[];draft={};if(msg)msg.textContent='График сохранён';render()}catch(e){if(msg)msg.textContent=e?.message||'Не удалось сохранить график'}};
const previous=pages.dispatch;pages.dispatch=function(){if(window.BOS_NORMALIZE_MASTER_SCHEDULE)window.BOS_NORMALIZE_MASTER_SCHEDULE();setTimeout(render,0);return pageHtml()};
const st=document.createElement('style');st.textContent=`.usHeader{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:12px}.usHeader h2,.usMonthHead h3{margin:0;text-transform:capitalize}.usScheduleCard{display:grid;gap:14px}.usMonthHead{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;text-align:center}.usWeek,.usGrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}.usWeek{text-align:center;color:var(--muted,#8ea0b5);font-size:12px}.usDay{min-height:74px;border-radius:13px;border:1px solid rgba(255,255,255,.11);padding:7px;background:#12202e;color:inherit;display:flex;flex-direction:column;justify-content:space-between;text-align:left;overflow:hidden}.usDay b{font-size:16px}.usDay small,.usDay span{font-size:9px;line-height:1.2;white-space:nowrap}.usDay span{color:#9dd4ff}.usDay.full{background:rgba(27,116,74,.30);border-color:rgba(46,190,116,.68)}.usDay.full small{color:#81e2b0}.usDay.partial{background:rgba(163,104,10,.22);border-color:rgba(245,170,42,.68)}.usDay.partial small{color:#ffd079}.usDay.off{background:rgba(82,101,121,.16);border-color:rgba(128,149,171,.28)}.usDay.off small{color:#7f93a7}.usDay.selected{outline:2px solid #50b5ff;outline-offset:2px}.usLegend{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted,#8ea0b5);font-size:11px}.usLegend span{display:flex;align-items:center;gap:5px}.usDot{width:9px;height:9px;border-radius:50%;display:inline-block}.usDot.full{background:#38b878}.usDot.partial{background:#e7a62d}.usDot.off{background:#68798b}.usQuick,.usEditor{display:grid;gap:10px;padding:12px;border:1px solid rgba(255,255,255,.09);border-radius:13px;background:rgba(255,255,255,.025)}.usQuickButtons{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.usTimes label,.usBulkTimes label{display:grid;gap:5px}.usSwitch{display:flex;align-items:center;gap:7px;font-weight:700}.usSwitch input{width:20px;height:20px}.usSave{margin-top:0}.usMasterList{display:grid;gap:10px}.usMasterRow{padding:12px}.usMasterRow.full{border-color:rgba(46,190,116,.35)}.usMasterRow.partial{border-color:rgba(245,170,42,.42)}.usMasterRow.off{opacity:.82}.usBadges{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}.usTime{display:inline-flex;align-items:center;min-height:26px;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap}.usTime.full{color:#8ce8b7;background:rgba(46,190,116,.14);border:1px solid rgba(46,190,116,.46)}.usTime.partial{color:#ffd079;background:rgba(245,170,42,.13);border:1px solid rgba(245,170,42,.46)}.usTime.off{color:#9fb0c1;background:rgba(128,149,171,.10);border:1px solid rgba(128,149,171,.25)}@media(max-width:520px){.usHeader{align-items:center}.usHeader .secondary{min-height:44px}.usScheduleCard{padding:12px}.usWeek,.usGrid{gap:4px}.usDay{min-height:64px;padding:5px;border-radius:10px}.usDay b{font-size:15px}.usDay small,.usDay span{font-size:8px}.usQuickButtons{grid-template-columns:1fr 1fr}.usQuickButtons button:last-child{grid-column:1/-1}.usBadges{justify-content:flex-start}.usMasterRow>.row{align-items:flex-start}}`;
st.textContent+=`
.usManagement{min-width:0;max-width:100%;box-sizing:border-box}
.usManagement .usMonthScroll{overflow-x:auto;max-width:100%;padding:3px;scrollbar-width:thin;scrollbar-color:#426782 #0c1d2b}
.usManagement .usMonthScroll:focus-visible{outline:2px solid #50b5ff;outline-offset:2px}
.usManagement .usWeek,.usManagement .usGrid{grid-template-columns:repeat(7,minmax(190px,1fr));gap:7px}
.usManagement .usWeek{margin-bottom:10px;font-size:13px}
.usManagement .usTeamDay{padding:7px;justify-content:flex-start;gap:9px;overflow:visible;min-width:0;border-radius:13px}
.usManagement .usTeamDay span{font-size:inherit;line-height:inherit;white-space:normal;color:inherit}
.usManagement .usTeamDay button{font:inherit;color:inherit;cursor:pointer;min-width:0;box-sizing:border-box}
.usManagement .usTeamDay button:focus-visible{outline:2px solid #50b5ff;outline-offset:2px}
.usManagement .usDayHead{display:flex;align-items:center;justify-content:space-between;gap:5px;background:transparent;border:0;padding:0;text-align:left;min-height:36px;width:100%}
.usManagement .usDayHead b{font-size:21px;line-height:1.2}.usManagement .usDayHead>span{display:grid;gap:4px}
.usManagement .usDayCount{font-size:12px;font-weight:700;white-space:nowrap;padding:5px 7px;border:1px solid rgba(255,255,255,.25);border-radius:20px;background:rgba(0,0,0,.15)}
.usManagement .usDayWeekday{display:none}
.usManagement .usPersonColumns,.usManagement .usPerson{display:grid;grid-template-columns:minmax(0,1fr) 66px 22px;gap:2px;align-items:center}
.usManagement .usPersonColumns{font-size:10px;color:#abc4db}.usManagement .usPersonColumns>span:last-child{text-align:right;white-space:nowrap;font-size:9px}
.usManagement .usPeople{display:grid;gap:1px}.usManagement .usTeamDay .usPerson{padding:5px 0;border:0;border-radius:5px;background:transparent;text-align:left;min-height:36px;width:100%;font-size:12px;line-height:1.4}
.usManagement .usPerson:hover{background:rgba(255,255,255,.08)}
.usManagement .usPersonName{display:flex;align-items:flex-start;gap:3px;overflow-wrap:anywhere}
.usManagement .usPersonName .usDot{flex:0 0 6px;height:6px;margin-top:5px}
.usManagement .usTeamDay .usPersonTime{white-space:nowrap;font-size:11px;letter-spacing:-.2px}
.usManagement .usPersonCount{text-align:center;font-size:13px;background:rgba(0,0,0,.12);border-radius:5px;padding:3px 0}
.usManagement .usDayTotals{display:flex;flex-wrap:wrap;gap:4px 8px;border-top:1px solid rgba(255,255,255,.12);padding-top:8px;margin-top:auto;font-size:10px;line-height:1.4}
.usManagement .usDayTotals .full{color:#89e4b5}.usManagement .usDayTotals .partial{color:#ffd079}.usManagement .usDayTotals .off{color:#ffaaaa}.usManagement .usDayTotals .unknown{color:#b0becd}
.usManagement .usOtherOrders{background:transparent;border:1px solid rgba(255,255,255,.2);border-radius:7px;padding:7px;font-size:11px!important}
.usManagement .usTeamDay.off{background:rgba(161,44,58,.2);border-color:#ca5861}
.usManagement .usTeamDay.unknown{background:rgba(82,101,121,.16);border-color:#68798b}
.usManagement .usDot.off{background:#f16b75}.usManagement .usDot.unknown{background:#8293a4}
.usManagement .usPerson.off .usPersonTime{color:#ffaaaa}.usManagement .usPerson.unknown .usPersonTime{color:#b0becd}
.usManagement .usCalendarNote{margin:0;font-size:12px;line-height:1.5;color:#abc4db}
.usMasterRow.off{border-color:#ca5861}.usTime.off{color:#ffaaaa;background:rgba(161,44,58,.15);border-color:#ca5861}.usTime.unknown{color:#b0becd;background:rgba(82,101,121,.16);border:1px solid #68798b}
@media(max-width:760px){
 .usManagement .usMonthScroll{overflow:visible;padding:3px}.usManagement .usWeek,.usManagement .usEmptyDay{display:none}
 .usManagement .usGrid{grid-template-columns:minmax(0,1fr);gap:14px}.usManagement .usTeamDay{padding:12px;gap:10px}
 .usManagement .usDayHead{min-height:44px}.usManagement .usDayWeekday{display:block;font-size:12px;color:#abc4db}
 .usManagement .usDayCount{font-size:14px}.usManagement .usPersonColumns,.usManagement .usPerson{grid-template-columns:minmax(0,1fr) 95px 40px;gap:8px}
 .usManagement .usPersonColumns{font-size:12px}.usManagement .usTeamDay .usPerson{font-size:14px;min-height:44px}.usManagement .usPersonColumns>span:last-child{font-size:11px}
 .usManagement .usTeamDay .usPersonTime{font-size:13px;letter-spacing:normal}.usManagement .usPersonCount{font-size:14px}
 .usManagement .usDayTotals{font-size:12px}.usManagement .usLegend{font-size:12px}
}
@media(max-width:360px){.usManagement .usTeamDay{padding:9px}.usManagement .usPersonColumns,.usManagement .usPerson{grid-template-columns:minmax(0,1fr) 83px 30px;gap:5px}.usManagement .usTeamDay .usPerson{font-size:13px}.usManagement .usPersonColumns>span:last-child{font-size:9px}.usManagement .usTeamDay .usPersonTime{font-size:12px}}
`;
document.head.appendChild(st);
})();
