(()=>{
'use strict';
if(window.BOS_MASTER_DAILY_HOME_V127)return;
window.BOS_MASTER_DAILY_HOME_V127=true;

let queued=false;
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const active=o=>o&&!['Выполнена','Отменена'].includes(String(o.status||''));
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10);
const timeOf=o=>window.BOS_SCHEDULE_CONTRACT.timeOf(o);
const stageOf=o=>{const s=String(o?.master_workflow_stage||'assigned');return s==='arrived'?'departed':['assigned','departed','started','completed'].includes(s)?s:'assigned'};
const reportUploaded=o=>!!o?.report_uploaded_at||!!o?.report_act_url;
const reportRejected=o=>String(o?.report_review_status||'')==='rejected';
const reportApproved=o=>String(o?.status||'')==='Выполнена'||String(o?.report_review_status||'')==='approved';
const progressed=o=>['departed','started','completed'].includes(stageOf(o))||reportUploaded(o);
const calledDone=o=>!!o?.master_called_at||progressed(o);
const agreementDone=o=>!!o?.master_agreed_at||progressed(o);
const workDone=o=>['started','completed'].includes(stageOf(o))||reportUploaded(o);

function mine(){
  if(typeof ownOrders==='function')return (ownOrders()||[]).filter(Boolean);
  const all=(state?.orders||[]).filter(Boolean),u=state?.user||{};
  const ids=new Set([u.id,u.staff_id,u.master_id,u.vk_user_id,u.external_id].filter(Boolean).map(String));
  if(!ids.size)return String(u.role||'')==='master'?all:[];
  return all.filter(o=>[o.master_staff_id,o.master_id,o.master_vk_id,o.staff_id,o.vk_user_id].filter(Boolean).map(String).some(x=>ids.has(x)));
}
function scheduleTs(o){
  const d=dateOf(o),t=timeOf(o)||'23:59';
  if(!d)return Number.POSITIVE_INFINITY;
  const ts=new Date(`${d}T${t}:00`).getTime();
  return Number.isFinite(ts)?ts:Number.POSITIVE_INFINITY;
}
function scheduleEndTs(o){const start=scheduleTs(o),r=window.BOS_SCHEDULE_CONTRACT.range(o);return Number.isFinite(start)&&r?start+r.duration*60000:Number.POSITIVE_INFINITY}
const reportOverdue=(o,now=Date.now())=>active(o)&&!reportUploaded(o)&&Number.isFinite(scheduleEndTs(o))&&now>=scheduleEndTs(o)+90*60000;
const currentPending=(o,now)=>active(o)&&!reportUploaded(o)&&Number.isFinite(scheduleTs(o))&&scheduleTs(o)<=now;
function dateLabel(o){
  const d=dateOf(o);if(!d)return'Дата не назначена';
  const target=new Date(`${d}T00:00:00`),now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),diff=Math.round((target-today)/86400000);
  if(diff===0)return'Сегодня';if(diff===1)return'Завтра';
  return target.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});
}
function orderNo(o){const ext=String(o?.external_id||'');return ext.startsWith('hands:')?ext.slice(6):String(o?.id||'')}
function step(o){
  if(reportApproved(o))return'Заявка завершена';
  if(reportRejected(o))return'Исправить отчёт';
  if(reportUploaded(o))return'Отчёт на проверке';
  if(workDone(o))return'Заполнить отчёт';
  if(agreementDone(o))return stageOf(o)==='departed'?'Начать работу':'Подтвердить выезд';
  if(calledDone(o))return'Зафиксировать договорённость';
  return'Позвонить клиенту';
}
function attentionReason(o,now){
  if(!active(o))return'';
  if(reportRejected(o))return'Отчёт вернули на доработку';
  if(reportOverdue(o,now))return'Отчёт не отправлен вовремя';
  if(calledDone(o)&&!agreementDone(o))return'Нужно согласовать дату и время';
  if(!calledDone(o)&&!dateOf(o))return'Нужно связаться с клиентом';
  const ts=scheduleTs(o);
  if(Number.isFinite(ts)&&ts<now-30*60000&&!workDone(o)&&!reportUploaded(o))return'Время заявки уже наступило';
  return'';
}
function nextOrder(orders,now){
  const pending=orders.filter(active).filter(o=>!reportUploaded(o));
  const current=pending.filter(o=>currentPending(o,now)).sort((a,b)=>scheduleTs(a)-scheduleTs(b))[0];
  if(current)return current;
  const scheduled=pending.filter(o=>Number.isFinite(scheduleTs(o))).sort((a,b)=>scheduleTs(a)-scheduleTs(b));
  return scheduled.find(o=>scheduleTs(o)>=now)||pending.find(o=>!Number.isFinite(scheduleTs(o)))||null;
}
function queue(orders,next,now){
  const entries=new Map(orders.map(o=>[String(o.id),{o,reasons:[],claims:[]}])) ,orphans=[];
  for(const entry of entries.values()){const reason=attentionReason(entry.o,now);if(reason)entry.reasons.push(reason)}
  const claimsApi=window.BOS_MASTER_UPCOMING_CLAIMS_API;
  for(const c of claimsApi?.openClaims()||[]){
    const linked=claimsApi.linkedOrder(c),id=linked?String(linked.id):null;
    let entry=id?entries.get(id):null;
    if(!entry&&linked){entry={o:linked,reasons:[],claims:[]};entries.set(id,entry)}
    if(entry)entry.claims.push(c);else orphans.push({o:null,reasons:[],claims:[c]});
  }
  const primary=next?entries.get(String(next.id)):null;
  const rest=[...entries.values()].filter(e=>e!==primary&&(active(e.o)||e.claims.length));
  const important=rest.filter(e=>e.reasons.length||e.claims.length).sort((a,b)=>scheduleTs(a.o)-scheduleTs(b.o)).concat(orphans);
  const ordinary=rest.filter(e=>!e.reasons.length&&!e.claims.length).sort((a,b)=>scheduleTs(a.o)-scheduleTs(b.o));
  return{primary,important,ordinary};
}
function reasonsHtml(entry){
  if(!entry)return'';
  const api=window.BOS_MASTER_UPCOMING_CLAIMS_API;
  return entry.reasons.map(reason=>`<span class="masterV127Reason">${escv(reason)}</span>`).join('')+entry.claims.map(c=>`<span class="masterV127Reason" data-claim-id="${escv(c.id)}"><b>Рекламация</b> · ${escv(api.claimText(c))}<small>${escv(api.claimMeta(c))}</small></span>`).join('');
}
function workHtml(o){const text=window.BOS_MASTER_HOME_ORDERS_V124?.summarize(o);return text?`<span class="masterV127Work">${escv(text)}</span>`:''}
function nextHtml(o,now,entry){
  if(!o)return `<div class="masterV127Empty"><b>Ближайших активных заявок нет</b><span>Новые назначения появятся здесь автоматически.</span></div>`;
  const time=timeOf(o)||'—',address=String(o.address||o.client_address||'Адрес не указан'),current=currentPending(o,now),overdue=reportOverdue(o,now);
  return `<button type="button" class="masterV127Next${overdue?' reportOverdue':''}" data-order-id="${escv(o.id)}" onclick="openOrder('${escv(o.id)}')"><div class="masterV127When"><b>${escv(time)}</b><span>${escv(dateLabel(o))}</span></div><div class="masterV127Main"><small>${current?'ТЕКУЩАЯ ЗАЯВКА':'БЛИЖАЙШАЯ ЗАЯВКА'}</small><h3>№ ${escv(orderNo(o))}</h3><p>${escv(address)}</p>${workHtml(o)}${overdue?'<span class="masterV127ReportReminder">Отправьте отчёт по заявке</span>':''}${reasonsHtml(entry)}<strong>${escv(step(o))}</strong></div><span class="masterV127Arrow">›</span></button>`;
}
function itemHtml(entry){
  const {o,claims}=entry,c=claims[0],important=entry.reasons.length||claims.length;
  const action=o?`openOrder('${escv(o.id)}')`:`openClaimDetails('${escv(c.id)}')`;
  return `<button type="button" class="masterV127DayItem${important?' masterV127AttentionItem':''}" ${o?`data-order-id="${escv(o.id)}"`:`data-claim-id="${escv(c.id)}"`} onclick="${action}"><span class="masterV127DayMain"><b>${o?`№ ${escv(orderNo(o))}`:'Рекламация'}</b>${o?`<small>${escv(dateLabel(o))} · ${escv(timeOf(o)||'Без времени')}</small><small>${escv(o.address||o.client_address||'Адрес не указан')}</small>${workHtml(o)}`:''}${reasonsHtml(entry)}<strong>${escv(claims.length?'Открыть рекламацию':step(o))}</strong></span></button>`;
}
function restHtml({important,ordinary},expanded){
  return `<div class="masterV127Attention"><div class="masterV127AttentionHead"><b>Требуют внимания</b><span>${important.length}</span></div>${important.length?important.map(itemHtml).join(''):'<div class="masterV127AttentionEmpty">Срочных действий сейчас нет</div>'}</div>${ordinary.length?`<div class="masterV127Day"><div class="masterV127DayHead"><b>Остальные заявки</b><span>${ordinary.length}</span></div><div class="masterV127DayList">${ordinary.slice(0,3).map(itemHtml).join('')}</div>${ordinary.length>3?`<details class="masterV127More" ${expanded?'open':''}><summary>Показать ещё (${ordinary.length-3})</summary><div class="masterV127DayList">${ordinary.slice(3).map(itemHtml).join('')}</div></details>`:''}</div>`:''}`;
}
function removeLegacyUpcoming(root){
  for(const h of root.querySelectorAll('h2,h3'))if(h.textContent.trim()==='Ближайшие заявки')(h.closest('section')||h.parentElement)?.remove();
}
function render(){
  queued=false;
  const root=document.getElementById('content');
  if(!root||!masterMode()||String(state?.page||'')!=='home'){document.getElementById('masterDailyV127')?.remove();return}
  removeLegacyUpcoming(root);
  const orders=[...new Map(mine().map(o=>[String(o.id),o])).values()],now=Date.now(),next=nextOrder(orders,now),items=queue(orders,next,now);
  const sig=JSON.stringify([items,next?.id||'',!!next&&currentPending(next,now),!!next&&reportOverdue(next,now)]);
  let box=document.getElementById('masterDailyV127');
  if(box?.dataset.sig===sig)return;
  if(!box){box=document.createElement('section');box.id='masterDailyV127';box.className='masterV127';root.prepend(box)}
  const expanded=!!box.querySelector('.masterV127More')?.open,summary=box.querySelector('#masterDaySummaryV128');
  box.dataset.sig=sig;
  box.innerHTML=`<div class="masterV127Head"><div><small>МАСТЕР</small><h2>Рабочий день</h2></div><button type="button" class="secondary" onclick="show('orders')">Все заявки</button></div>${nextHtml(next,now,items.primary)}${restHtml(items,expanded)}`;
  if(summary)box.querySelector('.masterV127Attention').before(summary);
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(render)}
const baseShow=window.show;
if(typeof baseShow==='function')window.show=function(){const out=baseShow.apply(this,arguments);setTimeout(schedule,0);setTimeout(schedule,100);return out};
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('resize',schedule);
setInterval(schedule,60000);
setTimeout(schedule,0);
window.BOS_MASTER_DAILY_HOME_V127_API={refresh:schedule,step,attentionReason,reportOverdue,scheduleEndTs,nextOrder};

const style=document.createElement('style');style.textContent=`
.masterV127{margin:0 0 16px;padding:14px;border:1px solid rgba(96,165,250,.2);border-radius:18px;background:linear-gradient(180deg,rgba(37,99,235,.08),rgba(15,23,42,.16))}.masterV127Head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.masterV127Head small{display:block;color:var(--muted,#91a3b7);font-size:10px;font-weight:900;letter-spacing:.1em}.masterV127Head h2{margin:2px 0 0;font-size:21px}.masterV127Head button{min-height:38px}.masterV127Next{width:100%;display:grid;grid-template-columns:72px minmax(0,1fr) 18px;gap:12px;align-items:center;text-align:left;padding:14px;border:1px solid rgba(96,165,250,.28);border-radius:15px;background:rgba(37,99,235,.1);color:inherit;cursor:pointer}.masterV127When{display:flex;flex-direction:column;align-items:center;padding:8px 4px;border-radius:12px;background:rgba(255,255,255,.05)}.masterV127When b{font-size:22px;line-height:1;white-space:nowrap}.masterV127When span{margin-top:5px;color:var(--muted,#91a3b7);font-size:11px}.masterV127Main{min-width:0}.masterV127Main small{color:var(--muted,#91a3b7);font-size:10px;font-weight:800}.masterV127Main h3{margin:4px 0 2px;font-size:17px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.masterV127Main p{margin:0;color:var(--muted,#91a3b7);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.masterV127Main strong{display:inline-flex;margin-top:8px;padding:4px 8px;border-radius:999px;background:rgba(96,165,250,.14);font-size:11px}.masterV127Arrow{font-size:28px;color:var(--muted,#91a3b7)}.masterV127Empty{display:flex;flex-direction:column;gap:4px;padding:15px;border:1px dashed rgba(148,163,184,.22);border-radius:14px}.masterV127Empty span,.masterV127AttentionEmpty{color:var(--muted,#91a3b7);font-size:12px}.masterV127Day{margin-top:11px}.masterV127DayHead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px}.masterV127DayHead b{font-size:12px}.masterV127DayHead span{color:var(--muted,#91a3b7);font-size:11px}.masterV127DayList{display:flex;gap:7px;overflow-x:auto;overscroll-behavior-inline:contain;padding:1px 0 3px;scrollbar-width:thin}.masterV127DayItem{flex:1 0 160px;max-width:230px;display:grid;grid-template-columns:45px minmax(0,1fr);gap:8px;align-items:center;padding:8px 9px;border:1px solid rgba(96,165,250,.18);border-radius:11px;background:rgba(37,99,235,.055);color:inherit;text-align:left;cursor:pointer}.masterV127DayTime{font-size:13px;font-weight:900;text-align:center}.masterV127DayMain{min-width:0;display:flex;flex-direction:column;gap:2px}.masterV127DayMain b{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.masterV127DayMain small{color:var(--muted,#91a3b7);font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.masterV127Attention{margin-top:12px}.masterV127AttentionHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px}.masterV127AttentionHead b{font-size:13px}.masterV127AttentionHead span{min-width:24px;padding:2px 7px;border-radius:999px;text-align:center;background:rgba(239,68,68,.13);color:#ff9696;font-size:11px;font-weight:900}.masterV127AttentionItem{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 11px;margin-top:6px;border:1px solid rgba(239,68,68,.18);border-radius:12px;background:rgba(239,68,68,.045);color:inherit;text-align:left;cursor:pointer}.masterV127AttentionItem>span{display:flex;min-width:0;flex-direction:column;gap:2px}.masterV127AttentionItem small{color:var(--muted,#91a3b7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.masterV127AttentionItem strong{flex:0 0 auto;font-size:11px}.masterV127AttentionEmpty{padding:10px 0 2px}
.masterV127Next.reportOverdue{border-color:rgba(239,68,68,.78);background:linear-gradient(135deg,rgba(127,29,29,.34),rgba(239,68,68,.12));box-shadow:0 0 0 1px rgba(239,68,68,.12) inset}.masterV127Next.reportOverdue .masterV127When{background:rgba(239,68,68,.16)}.masterV127Next.reportOverdue .masterV127Main>small,.masterV127Next.reportOverdue .masterV127Arrow{color:#ff9a9a}.masterV127Next.reportOverdue .masterV127Main strong{background:rgba(239,68,68,.17);color:#ffc1c1}.masterV127ReportReminder{display:block;margin-top:8px;color:#ff9a9a;font-size:12px;font-weight:900;line-height:1.25}
.masterV127DayList{display:grid;overflow:visible}.masterV127DayItem{display:block;width:100%;max-width:none}.masterV127AttentionItem small{white-space:normal;overflow:visible}.masterV127DayMain small{white-space:normal;overflow-wrap:anywhere}.masterV127Reason{display:block;color:#ffaaaa;font-size:12px;line-height:1.45;margin-top:6px;white-space:normal;overflow-wrap:anywhere}.masterV127Reason small{display:block;font-size:11px}.masterV127Work{display:block;font-size:12px;margin-top:4px}.masterV127More summary{cursor:pointer;padding:12px 0}.masterV127DayItem strong{font-size:11px;margin-top:5px}
@media(max-width:520px){.masterV127{padding:12px;margin-bottom:12px;border-radius:16px}.masterV127Head h2{font-size:19px}.masterV127Head button{padding:8px 10px}.masterV127Next{grid-template-columns:64px minmax(0,1fr) 12px;padding:12px 10px;gap:9px}.masterV127When b{font-size:20px}.masterV127Main h3{font-size:16px}.masterV127Main p{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.masterV127DayItem{flex-basis:145px;grid-template-columns:40px minmax(0,1fr);padding:8px}.masterV127AttentionItem{align-items:flex-start;flex-direction:column;gap:5px}.masterV127AttentionItem strong{align-self:flex-start}}
`;document.head.appendChild(style);
})();