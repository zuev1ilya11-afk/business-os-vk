(()=>{
'use strict';
if(window.BOS_MASTER_PROFILE_SUMMARY_V129)return;
window.BOS_MASTER_PROFILE_SUMMARY_V129=true;

let queued=false;
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const moneyv=v=>typeof money==='function'?money(v):`${num(v).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})} ₽`;
const masterMode=()=>String(state?.user?.role||'')==='master';
const completed=o=>String(o?.status||'')==='Выполнена'||String(o?.report_review_status||'')==='approved';
const active=o=>o&&!['Выполнена','Отменена'].includes(String(o?.status||''));
const truthy=v=>v===true||v===1||String(v).toLowerCase()==='true'||String(v)==='1';
const dateOnly=v=>String(v||'').slice(0,10);
const pad=n=>String(n).padStart(2,'0');
const localIso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

function mine(){
  if(typeof ownOrders==='function')return (ownOrders()||[]).filter(Boolean);
  const all=(state?.orders||[]).filter(Boolean),u=state?.user||{};
  const ids=new Set([u.id,u.staff_id,u.master_id,u.vk_user_id,u.external_id].filter(Boolean).map(String));
  if(!ids.size)return all;
  return all.filter(o=>[o.master_staff_id,o.master_id,o.master_vk_id,o.staff_id,o.vk_user_id,o.external_id].filter(Boolean).map(String).some(x=>ids.has(x)));
}
function liveUser(){return typeof liveMasterUser==='function'?(liveMasterUser()||state?.user||{}):(state?.user||{})}
function masterRow(){
  const u=liveUser(),ids=new Set([u.id,u.staff_id,u.master_id,u.vk_user_id,u.user_id,u.external_id,typeof liveMasterId==='function'?liveMasterId():null].filter(Boolean).map(String));
  return (state?.masters||[]).find(m=>[m?.id,m?.staff_id,m?.master_id,m?.vk_user_id,m?.user_id,m?.external_id].filter(Boolean).map(String).some(x=>ids.has(x)))||u;
}
function masterIds(){
  const u=liveUser(),m=masterRow();
  return new Set([u.id,u.staff_id,u.master_id,u.vk_user_id,u.user_id,u.external_id,m?.id,m?.staff_id,m?.master_id,m?.vk_user_id,m?.user_id,m?.external_id,typeof liveMasterId==='function'?liveMasterId():null].filter(Boolean).map(String));
}
function scheduleMine(r){return [r?.master_vk_id,r?.master_id,r?.master_staff_id,r?.staff_id,r?.vk_user_id,r?.user_id,r?.external_id].filter(Boolean).map(String).some(x=>masterIds().has(x))}
function mondayOf(value=new Date()){
  const d=value instanceof Date?new Date(value):new Date(`${value}T12:00:00`);
  d.setHours(12,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return localIso(d);
}
function addDays(iso,n){const d=new Date(`${iso}T12:00:00`);d.setDate(d.getDate()+n);return localIso(d)}
function completedDay(o){
  if(o?.completed_at){const d=new Date(o.completed_at);if(!Number.isNaN(d.getTime()))return localIso(d)}
  if(o?.report_reviewed_at){const d=new Date(o.report_reviewed_at);if(!Number.isNaN(d.getTime()))return localIso(d)}
  return dateOnly(o?.scheduled_date);
}
function payout(o){
  const raw=o?.amount;
  if(raw!==undefined&&raw!==null&&raw!==''){
    const amount=Number(raw);
    if(Number.isFinite(amount))return Math.round(amount*.85*.65*100)/100;
  }
  return num(o?.master_payout);
}
const extra=o=>num(o?.extra_work_amount);
const deduction=o=>num(o?.uncompleted_work_amount);
const salary=o=>payout(o)+extra(o);
function periodOrders(done,start,end){return done.filter(o=>{const d=completedDay(o);return d&&d>=start&&d<=end})}
function totals(){
  const orders=mine(),done=orders.filter(completed),now=new Date(),weekStart=mondayOf(now),weekEnd=addDays(weekStart,6),monthStart=`${now.getFullYear()}-${pad(now.getMonth()+1)}-01`,monthEnd=localIso(new Date(now.getFullYear(),now.getMonth()+1,0,12));
  const week=periodOrders(done,weekStart,weekEnd),month=periodOrders(done,monthStart,monthEnd);
  const base=done.reduce((a,o)=>a+payout(o),0),extras=done.reduce((a,o)=>a+extra(o),0),deductions=done.reduce((a,o)=>a+deduction(o),0);
  return{orders,done,active:orders.filter(active),base,extras,deductions,total:base+extras,weekSalary:week.reduce((a,o)=>a+salary(o),0),monthSalary:month.reduce((a,o)=>a+salary(o),0),weekStart,weekEnd,monthStart,monthEnd};
}
function dayOrders(date){return mine().filter(o=>dateOnly(o?.scheduled_date)===date&&String(o?.status||'')!=='Отменена')}
function scheduleRow(date){return (state?.masterSchedule||[]).find(r=>scheduleMine(r)&&dateOnly(r?.work_date||r?.date)===date)}
function dayLabel(date){const d=new Date(`${date}T12:00:00`);return d.toLocaleDateString('ru-RU',{weekday:'short'}).replace('.','').replace(/^./,c=>c.toUpperCase())}
function scheduleHtml(t){
  const days=Array.from({length:7},(_,i)=>addDays(t.weekStart,i));
  const u=liveUser(),m=masterRow(),place=[u?.city||m?.city,m?.district||m?.area||m?.work_area||u?.district||u?.area||u?.work_area].filter(Boolean).join(' / '),phone=u?.phone||m?.phone||'';
  return `<section class="masterV129Schedule"><div class="masterV129ScheduleHead"><div><h3>Мой график</h3><p>Нажмите на день, чтобы посмотреть заявки</p>${place||phone?`<small>${escv(place)}${place&&phone?' · ':''}${escv(phone)}</small>`:''}</div><button type="button" class="secondary" onclick="show('dispatch')">Изменить</button></div><div class="masterV129Week">${days.map(date=>{const row=scheduleRow(date),working=truthy(row?.is_working),orders=dayOrders(date),d=new Date(`${date}T12:00:00`);const time=working&&row?(String(row.work_start||'').slice(0,5)&&String(row.work_end||'').slice(0,5)?`${String(row.work_start).slice(0,5)}–${String(row.work_end).slice(0,5)}`:'Работаю'):row?'Выходной':'Не задан';return `<button type="button" class="masterV129Day ${working?'working':row?'off':'unset'}" onclick="openMasterProfileDayV129('${date}')"><small>${escv(dayLabel(date))}</small><b>${d.getDate()}</b><span>${working?(orders.length?`Работаю · ${orders.length} заяв.`:time):time}</span></button>`}).join('')}</div></section>`;
}
function metric(label,value,cls=''){return `<div class="masterV129Metric ${cls}"><span>${escv(label)}</span><strong>${escv(value)}</strong></div>`}
function profileHtml(t){
  return `<section id="masterProfileSummaryV129" class="masterV129Panel">${scheduleHtml(t)}<div class="masterV129Metrics">${metric('В работе',String(t.active.length))}${metric('Выполнено',String(t.done.length))}${metric('Моя выплата',moneyv(t.base))}${metric('Допработы',`+ ${moneyv(t.extras)}`,'positive')}${metric('Вычеты',t.deductions?`− ${moneyv(t.deductions)}`:moneyv(0),'negative')}${metric('ЗП за неделю',moneyv(t.weekSalary),'period')}${metric('ЗП за месяц',moneyv(t.monthSalary),'period')}</div><div class="masterV129Total"><span><small>Общая зарплата</small><em>Вычеты уже учтены в суммах завершённых заявок и повторно не вычитаются</em></span><strong>${escv(moneyv(t.total))}</strong></div></section>`;
}
function removeByHeading(root,names){
  [...root.querySelectorAll('h2,h3')].forEach(h=>{
    if(h.closest('#masterProfileSummaryV129')||!names.includes((h.textContent||'').trim()))return;
    const block=h.closest('section.card,section');
    if(block)block.remove();
  });
}
function cleanupHome(root){
  root.querySelectorAll('.masterKpis').forEach(el=>el.remove());
  removeByHeading(root,['Мой график','Расчёт зарплаты','Зарплата','График работы']);
}
function cleanupProfile(root){
  removeByHeading(root,['Зарплата','Расчёт зарплаты','График этой недели','График работы']);
}
function signature(t){return JSON.stringify({orders:t.orders.map(o=>[o.id,o.status,o.report_review_status,o.completed_at,o.report_reviewed_at,o.scheduled_date,o.amount,o.master_payout,o.extra_work_amount,o.uncompleted_work_amount]),schedule:(state?.masterSchedule||[]).filter(scheduleMine).map(r=>[r.work_date||r.date,r.is_working,r.work_start,r.work_end]),user:[liveUser()?.city,liveUser()?.district,liveUser()?.phone]})}
function render(){
  queued=false;
  const root=document.getElementById('content');if(!root||!masterMode())return;
  const page=String(state?.page||'');
  if(page==='home'){document.getElementById('masterProfileSummaryV129')?.remove();cleanupHome(root);return}
  if(page!=='team'){document.getElementById('masterProfileSummaryV129')?.remove();return}
  cleanupProfile(root);
  const t=totals(),sig=signature(t),old=document.getElementById('masterProfileSummaryV129');if(old?.dataset.sig===sig)return;
  const wrap=document.createElement('div');wrap.innerHTML=profileHtml(t);const panel=wrap.firstElementChild;panel.dataset.sig=sig;
  if(old)old.replaceWith(panel);else{const info=root.querySelector('.masterInfoCompact');if(info)info.insertAdjacentElement('afterend',panel);else{const title=root.querySelector('.bosMasterCabinetProfileTitle');if(title)title.insertAdjacentElement('afterend',panel);else root.prepend(panel)}}
}
function schedule(){if(!masterMode()||queued)return;queued=true;requestAnimationFrame(render)}
window.openMasterProfileDayV129=function(date){
  if(typeof window.setMasterOrderDay==='function'){window.setMasterOrderDay(date);return}
  window.show?.('orders');
};
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
setTimeout(schedule,0);
window.BOS_MASTER_PROFILE_SUMMARY_V129_API={refresh:schedule,totals,payout,completedDay};

const style=document.createElement('style');style.textContent=`
.masterV129Panel{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;margin:0 0 14px}.masterV129Schedule{padding:14px 16px;border:1px solid rgba(96,165,250,.18);border-radius:17px;background:rgba(15,30,45,.58)}.masterV129ScheduleHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.masterV129ScheduleHead h3{margin:0;font-size:17px}.masterV129ScheduleHead p{margin:3px 0 0;color:var(--muted,#91a3b7);font-size:12px}.masterV129ScheduleHead small{display:block;margin-top:10px;color:#b7cff2;font-size:12px}.masterV129ScheduleHead button{flex:0 0 auto;min-height:40px}.masterV129Week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin-top:14px}.masterV129Day{min-width:0;min-height:78px;padding:8px 5px;border-radius:11px;border:1px solid rgba(148,163,184,.22);background:rgba(100,116,139,.08);color:inherit;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer}.masterV129Day small{font-size:10px;font-weight:800}.masterV129Day b{font-size:16px}.masterV129Day span{max-width:100%;font-size:8.5px;color:var(--muted,#91a3b7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.masterV129Day.working{border-color:rgba(34,197,94,.52);background:rgba(34,197,94,.11)}.masterV129Day.working span{color:#8ed8ad}.masterV129Day.off{opacity:.72}.masterV129Metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.masterV129Metric{min-width:0;padding:13px 15px;border:1px solid rgba(255,255,255,.09);border-radius:15px;background:rgba(15,30,45,.68)}.masterV129Metric span,.masterV129Metric strong{display:block}.masterV129Metric span{color:#a9c8f4;font-size:11px;margin-bottom:7px}.masterV129Metric strong{font-size:20px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.masterV129Metric.positive{border-color:rgba(34,197,94,.2)}.masterV129Metric.negative{border-color:rgba(239,68,68,.18)}.masterV129Metric.period{border-color:rgba(96,165,250,.32);background:rgba(37,99,235,.07)}.masterV129Total{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 17px;border:1px solid rgba(255,255,255,.1);border-radius:15px;background:rgba(15,30,45,.68)}.masterV129Total>span{min-width:0}.masterV129Total small,.masterV129Total em{display:block}.masterV129Total small{color:#a9c8f4;font-size:12px}.masterV129Total em{margin-top:4px;color:var(--muted,#91a3b7);font-size:9.5px;font-style:normal}.masterV129Total strong{flex:0 0 auto;font-size:17px}
@media(max-width:760px){.masterV129Metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.masterV129Week{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(78px,1fr);grid-template-columns:none;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}.masterV129Week::-webkit-scrollbar{display:none}}
@media(max-width:520px){.masterV129Panel{gap:10px}.masterV129Schedule{padding:12px}.masterV129ScheduleHead p{font-size:11px}.masterV129ScheduleHead small{font-size:11px}.masterV129ScheduleHead button{padding:8px 10px}.masterV129Week{grid-auto-columns:82px}.masterV129Day{min-height:70px}.masterV129Metrics{gap:7px}.masterV129Metric{padding:11px}.masterV129Metric span{font-size:10px}.masterV129Metric strong{font-size:17px}.masterV129Total{align-items:flex-start;padding:12px;flex-direction:column;gap:8px}.masterV129Total strong{font-size:18px}}
`;document.head.appendChild(style);
})();