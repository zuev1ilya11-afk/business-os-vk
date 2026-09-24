(()=>{
'use strict';
if(window.BOS_MASTER_ORDERS_V125)return;
window.BOS_MASTER_ORDERS_V125=true;

const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const liveMaster=()=>String(state?.user?.role||'')==='master';
const own=()=>typeof ownOrders==='function'?(ownOrders()||[]):(state?.orders||[]);
const status=o=>String(o?.status||'');
const stage=o=>String(o?.master_workflow_stage||'assigned');
const dateOnly=v=>String(v||'').slice(0,10);
const scheduledDate=o=>dateOnly(o?.scheduled_date);
const truthy=v=>v===true||v===1||String(v).toLowerCase()==='true'||String(v)==='1';
const isClaim=o=>status(o)==='Рекламация'||truthy(o?.is_claim)||!!o?.claim_id;
const isCompleted=o=>status(o)==='Выполнена'||stage(o)==='completed';
const isCancelled=o=>status(o)==='Отменена'||stage(o)==='cancelled';
const isActive=o=>!isClaim(o)&&!isCompleted(o)&&!isCancelled(o);
const isNew=o=>isActive(o)&&(status(o)==='Новая'||status(o)==='Назначена'||!o?.master_workflow_stage||stage(o)==='assigned');
const isWorking=o=>isActive(o)&&!isNew(o);
const completionDate=o=>dateOnly(o?.completed_at||o?.master_completed_at||o?.report_completed_at||o?.updated_at||o?.scheduled_date||o?.created_at);
const now=()=>window.__BOS_MASTER_NOW?new Date(window.__BOS_MASTER_NOW):new Date();
function dateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function weekStart(){const d=now();d.setHours(12,0,0,0);const day=d.getDay()||7;d.setDate(d.getDate()-day+1);return dateKey(d)}
const doneThisWeek=o=>isCompleted(o)&&!isClaim(o)&&(!completionDate(o)||completionDate(o)>=weekStart());
const archived=o=>!isClaim(o)&&(isCancelled(o)||(isCompleted(o)&&!!completionDate(o)&&completionDate(o)<weekStart()));
const current=o=>isNew(o)||isWorking(o);
const orderNo=o=>{const x=String(o?.external_id||'');return x.startsWith('hands:')?x.slice(6):String(o?.id||'')};
const pay=o=>{const raw=o?.amount;if(raw!==null&&raw!==undefined&&raw!==''){const n=Number(raw);if(Number.isFinite(n))return n*.85*.65}const n=Number(o?.master_payout||0);return Number.isFinite(n)?n:0};
const timeOf=o=>String(o?.scheduled_time||o?.time_slot||'').slice(0,5)||'—';
function escv(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function moneyv(v){return typeof money==='function'?money(v):`${Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})} ₽`}
function phoneHref(v){let p=String(v||'').trim().replace(/[^\d+]/g,'');if(/^8\d{10}$/.test(p))p='+7'+p.slice(1);else if(/^\d{10}$/.test(p))p='+7'+p;return p}
function workSummary(o){const helper=window.BOS_MASTER_HOME_ORDERS_V124?.summarize;if(typeof helper==='function')return helper(o);const text=String(o?.work||'').trim();return text?text.split(/\n+/)[0]:'Работы не указаны'}
function workflowLabel(o){
 if(isClaim(o))return'Рекламация';
 if(isCancelled(o))return'Отменена';
 if(isCompleted(o))return'Выполнена';
 if(String(o?.report_review_status||'')==='rejected')return'Отчёт на доработку';
 if(o?.report_uploaded_at||o?.report_act_url)return'Отчёт на проверке';
 if(stage(o)==='started')return'В работе';
 if(stage(o)==='departed'||stage(o)==='arrived')return'В дороге';
 if(o?.master_agreed_at)return'Договорено';
 if(o?.master_called_at)return'Созвонился';
 return'Нужно позвонить';
}
function stageClass(o){const s=workflowLabel(o);if(['Выполнена'].includes(s))return'done';if(['Рекламация','Отменена','Отчёт на доработку'].includes(s))return'danger';if(['Нужно позвонить'].includes(s))return'attention';if(['В работе','В дороге'].includes(s))return'active';return'info'}
function filterOf(){return String(window.__bosMasterOrderStatus||'current')}
function matches(o,f=filterOf()){if(f==='new')return isNew(o);if(f==='work')return isWorking(o);if(f==='done')return doneThisWeek(o);if(f==='claim')return isClaim(o);if(f==='archive')return archived(o);return current(o)}
function counts(all){return{current:all.filter(current).length,new:all.filter(isNew).length,work:all.filter(isWorking).length,done:all.filter(doneThisWeek).length,claim:all.filter(isClaim).length,archive:all.filter(archived).length}}
function filters(all){const c=counts(all),defs=[['current','Текущие',c.current],['new','Новые',c.new],['work','В работе',c.work],['done','Выполненные',c.done],['claim','Рекламации',c.claim],['archive','Архив',c.archive]],f=filterOf();return `<div class="masterStatusFilters masterV125StatusFilters" aria-label="Фильтр заявок">${defs.map(([v,l,n])=>`<button type="button" class="${f===v?'primary':'secondary'}" onclick="setMasterOrdersFilter('${v}')">${l}<small>${n}</small></button>`).join('')}</div>`}
function sortOrders(list){const f=filterOf();return list.slice().sort((a,b)=>{if(f==='current'){const pn=Number(isNew(b))-Number(isNew(a));if(pn)return pn}if(f==='done'||f==='archive')return String(completionDate(b)||'').localeCompare(String(completionDate(a)||''))||String(scheduledDate(b)||'').localeCompare(String(scheduledDate(a)||''));const sa=String((scheduledDate(a)||'9999')+(a?.scheduled_time||a?.time_slot||'99:99')),sb=String((scheduledDate(b)||'9999')+(b?.scheduled_time||b?.time_slot||'99:99'));return sa.localeCompare(sb)||String(b?.created_at||'').localeCompare(String(a?.created_at||''))})}
function groupDate(o){return(filterOf()==='done'||filterOf()==='archive')?(completionDate(o)||scheduledDate(o)):scheduledDate(o)}
function dateLabel(date){if(!date)return'Без даты';const d=new Date(`${date}T12:00:00`);if(Number.isNaN(d.getTime()))return date;return d.toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'short'}).replace(/^./,c=>c.toUpperCase())}
function dayFilters(list){const dates=[...new Set(list.map(groupDate).filter(Boolean))].slice(0,12);let day=String(window.__bosMasterOrderDay||'all');if(day!=='all'&&!dates.includes(day)){window.__bosMasterOrderDay='all';day='all'}if(!dates.length)return'';return `<div class="masterDayFilters masterV125DayFilters"><button type="button" class="${day==='all'?'primary':'secondary'}" onclick="setMasterOrderDay('all')">Все даты</button>${dates.map(d=>`<button type="button" class="${day===d?'primary':'secondary'}" onclick="setMasterOrderDay('${escv(d)}')">${escv(dateLabel(d))}</button>`).join('')}</div>`}
function card(o){
 const href=phoneHref(o?.phone||o?.client_phone),preview=!liveMaster();
 return `<article class="masterV125Card ${stageClass(o)}" data-master-order-id="${escv(o.id)}">
  <div class="masterV125Top"><div class="masterV125When"><strong>${escv(timeOf(o))}</strong><span>${escv(dateLabel(scheduledDate(o)))}</span></div><span class="masterV125Stage">${escv(workflowLabel(o))}</span></div>
  <div class="masterV125Title"><b>№ ${escv(orderNo(o))}</b><strong>${escv(o?.client||'Клиент не указан')}</strong></div>
  <div class="masterV125Work">${escv(workSummary(o))}</div>
  <div class="masterV125Pay"><span>Выплата мастеру</span><b>${moneyv(pay(o))}</b></div>
  <div class="masterV125Actions">${href&&!preview?`<a class="secondary" href="tel:${escv(href)}">Позвонить</a>`:''}<button type="button" class="primary" onclick="openOrder('${escv(o.id)}')">Открыть заявку</button></div>
 </article>`;
}
function grouped(list){const day=String(window.__bosMasterOrderDay||'all'),source=day==='all'?list:list.filter(o=>groupDate(o)===day),groups=[];source.forEach(o=>{const d=groupDate(o)||'';let g=groups.find(x=>x.date===d);if(!g){g={date:d,orders:[]};groups.push(g)}g.orders.push(o)});return groups.map(g=>`<section class="masterDayGroup masterV125Group"><div class="masterDayHeading"><strong>${escv(dateLabel(g.date))}</strong><span>${g.orders.length} заяв.</span></div>${g.orders.map(card).join('')}</section>`).join('')}
function emptyText(){return({current:'Текущих заявок нет',new:'Новых заявок нет',work:'Заявок в работе нет',done:'Выполненных за эту неделю нет',claim:'Рекламаций нет',archive:'Архив пока пуст'})[filterOf()]||'Заявок нет'}

const previousOrders=pages.orders;
pages.orders=function(){
 if(!masterMode())return previousOrders();
 const all=own().slice(),list=sortOrders(all.filter(o=>matches(o))),c=counts(all);
 return `<div class="masterSimple masterOrdersDense masterOrdersV125"><div class="masterV125Header"><div><h2>Мои заявки</h2><div class="muted">Текущие: ${c.current} · Всего: ${all.length}</div></div></div>${filters(all)}${dayFilters(list)}${list.length?grouped(list):`<div class="masterEmpty">${emptyText()}</div>`}</div>`;
};

function rerender(){const root=document.getElementById('content');if(!root||!masterMode()||String(state?.page||'')!=='orders')return false;root.innerHTML=pages.orders();return true}
const baseSetFilter=window.setMasterOrdersFilter;
window.setMasterOrdersFilter=function(v){window.__bosMasterOrderStatus=String(v||'current');window.__bosMasterOrderDay='all';if(!rerender()&&typeof baseSetFilter==='function')return baseSetFilter(v)};
const baseSetDay=window.setMasterOrderDay;
window.setMasterOrderDay=function(day){window.__bosMasterOrderDay=String(day||'all');if(!rerender()&&typeof baseSetDay==='function')return baseSetDay(day)};

const style=document.createElement('style');
style.textContent=`
.masterOrdersV125{gap:10px}.masterV125Header{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.masterV125Header h2{margin:0}.masterV125StatusFilters,.masterV125DayFilters{display:flex;gap:7px;overflow-x:auto;padding:3px 0 5px;scrollbar-width:none}.masterV125StatusFilters::-webkit-scrollbar,.masterV125DayFilters::-webkit-scrollbar{display:none}.masterV125StatusFilters button,.masterV125DayFilters button{flex:0 0 auto;white-space:nowrap;min-height:40px}.masterV125StatusFilters small{margin-left:5px;opacity:.72}.masterV125Group{display:grid;gap:8px}.masterV125Card{display:grid;gap:10px;padding:14px;border:1px solid rgba(255,255,255,.09);border-radius:16px;background:var(--card,#111d2b);min-width:0}.masterV125Card.active{border-color:rgba(22,131,255,.34)}.masterV125Card.attention{border-color:rgba(245,165,36,.34)}.masterV125Card.danger{border-color:rgba(240,79,95,.34)}.masterV125Card.done{border-color:rgba(24,201,133,.30)}.masterV125Top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;min-width:0}.masterV125When{display:flex;align-items:baseline;gap:8px;min-width:0}.masterV125When strong{font-size:22px;line-height:1;white-space:nowrap;word-break:normal;overflow-wrap:normal}.masterV125When span{font-size:12px;color:var(--muted,#91a3b7);white-space:nowrap}.masterV125Stage{display:inline-flex;align-items:center;max-width:55%;min-height:28px;padding:5px 9px;border-radius:999px;background:rgba(22,131,255,.11);color:#70b7ff;font-size:11px;font-weight:800;line-height:1.15;white-space:nowrap;word-break:normal;overflow-wrap:normal}.masterV125Card.attention .masterV125Stage{background:rgba(245,165,36,.12);color:#f5a524}.masterV125Card.danger .masterV125Stage{background:rgba(240,79,95,.12);color:#ff929e}.masterV125Card.done .masterV125Stage{background:rgba(24,201,133,.12);color:#18c985}.masterV125Title{display:flex;gap:8px 10px;align-items:baseline;flex-wrap:wrap}.masterV125Title>b{color:var(--accent2,#70b7ff);font-size:13px}.masterV125Title>strong{font-size:17px;line-height:1.3;min-width:0;overflow-wrap:break-word}.masterV125Work{font-size:14px;line-height:1.4;color:var(--text,#f5f8fc);overflow-wrap:break-word}.masterV125Pay{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:8px;border-top:1px solid rgba(255,255,255,.07)}.masterV125Pay span{font-size:12px;color:var(--muted,#91a3b7)}.masterV125Pay b{font-size:17px;white-space:nowrap}.masterV125Actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.masterV125Actions>*{min-height:48px!important;display:flex!important;align-items:center;justify-content:center;text-decoration:none}.masterV125Actions>*:only-child{grid-column:1/-1}.masterOrdersV125+.masterEmpty{margin-top:8px}
#modalRoot .bosMasterWorkflow .mwv2Actions,#modalRoot .bosMasterWorkflow .bosMwActionsV26{gap:10px}#modalRoot .bosMasterWorkflow .mwv2Actions>*,#modalRoot .bosMasterWorkflow .bosMwActionsV26>*{min-height:52px!important;font-size:15px!important;border-radius:12px!important}
@media(max-width:520px){.masterOrdersV125{gap:9px}.masterV125Card{padding:13px;gap:9px}.masterV125Top{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start}.masterV125When{display:grid;gap:4px}.masterV125When strong{font-size:21px}.masterV125Stage{max-width:100%;justify-self:end}.masterV125Title{display:grid;gap:3px}.masterV125Title>strong{font-size:16px}.masterV125Work{font-size:13px}.masterV125Actions{grid-template-columns:1fr}.masterV125Actions>*:only-child{grid-column:auto}#modalRoot .bosMasterWorkflow .mwv2Actions,#modalRoot .bosMasterWorkflow .bosMwActionsV26{grid-template-columns:1fr!important}}
@media(max-width:350px){.masterV125Top{grid-template-columns:1fr}.masterV125Stage{justify-self:start}.masterV125When{display:flex;align-items:baseline}.masterV125Pay{align-items:flex-end}.masterV125Pay b{font-size:16px}}
`;
document.head.appendChild(style);
})();
