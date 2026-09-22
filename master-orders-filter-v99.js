(()=>{
'use strict';
if(window.BOS_MASTER_ORDERS_FILTER_V99)return;window.BOS_MASTER_ORDERS_FILTER_V99=true;
if(!window.__bosMasterOrderStatus)window.__bosMasterOrderStatus='current';
if(!window.__bosMasterOrderDay)window.__bosMasterOrderDay='all';

const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
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
const dateTime=o=>{const d=scheduledDate(o)||'Дата не назначена',t=String(o?.scheduled_time||o?.time_slot||'').slice(0,5)||'Время не назначено';return `${d} · ${t}`};
const works=o=>String(o?.work||'Работа не указана').split(/\n+/).map(x=>x.trim()).filter(Boolean);
function escv(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function moneyv(v){return typeof money==='function'?money(v):`${Math.round(Number(v)||0).toLocaleString('ru-RU')} ₽`}
function workHtml(o){const rows=works(o),shown=rows.slice(0,3);return shown.map(x=>`<div>${escv(x)}</div>`).join('')+(rows.length>3?`<small>+ ещё ${rows.length-3}</small>`:'')}
function stageLabel(o){if(isClaim(o))return'Рекламация';if(isCancelled(o))return'Отменена';if(isCompleted(o))return'Выполнена';if(isNew(o))return'Новая';return({departed:'Выехал',arrived:'На месте',started:'В работе'})[stage(o)]||'В работе'}
function card(o){const kind=isClaim(o)?' claim':isCompleted(o)?' done':isNew(o)?' new':'';return `<button type="button" class="bosHandsMiniCard masterOrdersV99Card${kind}" data-master-order-id="${escv(o.id)}" onclick="openOrder('${escv(o.id)}')"><div class="masterV99Top"><b>№ ${escv(orderNo(o))}</b><span class="masterV99Status">${escv(stageLabel(o))}</span><time>${escv(dateTime(o))}</time></div><div class="bosHandsMiniClient"><b>${escv(o.client||'Клиент не указан')}</b><strong>Выплата: ${moneyv(pay(o))}</strong></div><div class="bosHandsMiniAddress">${escv(o.address||'Адрес не указан')}</div><div class="masterV99Works">${workHtml(o)}</div></button>`}
function filterOf(){return String(window.__bosMasterOrderStatus||'current')}
function matches(o,f=filterOf()){
  if(f==='new')return isNew(o);
  if(f==='work')return isWorking(o);
  if(f==='done')return doneThisWeek(o);
  if(f==='claim')return isClaim(o);
  if(f==='archive')return archived(o);
  return current(o);
}
function counts(all){return{current:all.filter(current).length,new:all.filter(isNew).length,work:all.filter(isWorking).length,done:all.filter(doneThisWeek).length,claim:all.filter(isClaim).length,archive:all.filter(archived).length}}
function statusFilters(all){const c=counts(all),defs=[['current','Текущие',c.current],['new','Новые',c.new],['work','В работе',c.work],['done','Выполненные',c.done],['claim','Рекламации',c.claim],['archive','Архив',c.archive]],f=filterOf();return `<div class="masterStatusFilters" aria-label="Фильтр заявок">${defs.map(([v,l,n])=>`<button type="button" class="${f===v?'primary':'secondary'}" onclick="setMasterOrdersFilter('${v}')">${l}<small>${n}</small></button>`).join('')}</div>`}
function sortOrders(list){const f=filterOf();return list.slice().sort((a,b)=>{if(f==='current'){const pn=Number(isNew(b))-Number(isNew(a));if(pn)return pn}if(f==='done'||f==='archive')return String(completionDate(b)||'').localeCompare(String(completionDate(a)||''))||String(scheduledDate(b)||'').localeCompare(String(scheduledDate(a)||''));if(f==='claim')return String((scheduledDate(a)||'9999')+(a?.scheduled_time||a?.time_slot||'99:99')).localeCompare(String((scheduledDate(b)||'9999')+(b?.scheduled_time||b?.time_slot||'99:99')));const sa=String((scheduledDate(a)||'9999')+(a?.scheduled_time||a?.time_slot||'99:99')),sb=String((scheduledDate(b)||'9999')+(b?.scheduled_time||b?.time_slot||'99:99'));if(sa!==sb)return sa.localeCompare(sb);return String(b?.created_at||'').localeCompare(String(a?.created_at||''))})}
function groupDate(o){return (filterOf()==='done'||filterOf()==='archive')?(completionDate(o)||scheduledDate(o)):scheduledDate(o)}
function dateLabel(date){if(!date)return'Без даты';const d=new Date(`${date}T12:00:00`);if(Number.isNaN(d.getTime()))return date;return d.toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'short'}).replace(/^./,c=>c.toUpperCase())}
function dayFilters(list){const dates=[...new Set(list.map(groupDate).filter(Boolean))].slice(0,12);let day=String(window.__bosMasterOrderDay||'all');if(day!=='all'&&!dates.includes(day)){window.__bosMasterOrderDay='all';day='all'};if(!dates.length)return'';return `<div class="masterDayFilters masterV99DayFilters"><button type="button" class="${day==='all'?'primary':'secondary'}" onclick="setMasterOrderDay('all')">Все даты</button>${dates.map(d=>`<button type="button" class="${day===d?'primary':'secondary'}" onclick="setMasterOrderDay('${escv(d)}')">${escv(dateLabel(d))}</button>`).join('')}</div>`}
function grouped(list){const day=String(window.__bosMasterOrderDay||'all'),source=day==='all'?list:list.filter(o=>groupDate(o)===day),groups=[];source.forEach(o=>{const d=groupDate(o)||'';let g=groups.find(x=>x.date===d);if(!g){g={date:d,orders:[]};groups.push(g)}g.orders.push(o)});return groups.map(g=>`<section class="masterDayGroup"><div class="masterDayHeading"><strong>${escv(dateLabel(g.date))}</strong><span>${g.orders.length} заяв.</span></div>${g.orders.map(card).join('')}</section>`).join('')}
function emptyText(){return({current:'Текущих заявок нет',new:'Новых заявок нет',work:'Заявок в работе нет',done:'Выполненных за эту неделю нет',claim:'Рекламаций нет',archive:'Архив пока пуст'})[filterOf()]||'Заявок нет'}
function rerender(){const root=document.getElementById('content');if(!root||!masterMode()||String(state?.page||'')!=='orders')return false;root.innerHTML=pages.orders();return true}
window.setMasterOrdersFilter=function(v){window.__bosMasterOrderStatus=String(v||'current');window.__bosMasterOrderDay='all';if(!rerender()&&typeof show==='function')show('orders')};
if(typeof window.setMasterOrderDay!=='function')window.setMasterOrderDay=function(day){window.__bosMasterOrderDay=String(day||'all');if(!rerender()&&typeof show==='function')show('orders')};

const baseOrders=pages.orders;
pages.orders=function(){if(!masterMode())return baseOrders();const all=own().slice(),list=sortOrders(all.filter(matches));return `<div class="masterSimple masterOrdersDense masterOrdersV99"><div class="masterSectionTitle"><div><h2>Мои заявки</h2><div class="muted">Текущие: ${counts(all).current} · Всего: ${all.length}</div></div></div>${statusFilters(all)}${dayFilters(list)}${list.length?grouped(list):`<div class="masterEmpty">${emptyText()}</div>`}</div>`};

let lastWeek=weekStart();setInterval(()=>{const w=weekStart();if(w===lastWeek)return;lastWeek=w;if(masterMode()&&String(state?.page||'')==='orders')rerender()},60000);

const style=document.createElement('style');style.textContent=`
.masterStatusFilters{display:flex;gap:6px;overflow-x:auto;padding:3px 0 7px;scrollbar-width:none}.masterStatusFilters::-webkit-scrollbar,.masterV99DayFilters::-webkit-scrollbar{display:none}.masterStatusFilters button,.masterV99DayFilters button{flex:0 0 auto;min-height:38px;border-radius:999px;padding:7px 11px;white-space:nowrap}.masterStatusFilters small{margin-left:5px;opacity:.72}.masterV99DayFilters{padding-top:0!important}.masterOrdersV99Card{position:relative;transition:border-color .15s ease,background .15s ease}.masterOrdersV99Card.new{border-color:rgba(37,99,235,.4);background:linear-gradient(180deg,rgba(37,99,235,.065),var(--card,#111d2b))}.masterOrdersV99Card.claim{border-color:rgba(242,176,65,.34)}.masterOrdersV99Card.done{opacity:.9}.masterV99Top{display:grid;grid-template-columns:auto auto 1fr;align-items:center;gap:7px}.masterV99Top>b{font-size:15px}.masterV99Top time{font-size:11px;color:var(--muted,#91a3b7);text-align:right}.masterV99Status{display:inline-flex;align-items:center;width:max-content;padding:3px 7px;border-radius:999px;background:rgba(37,99,235,.11);color:#6fa1ff;font-size:10px;font-weight:800}.masterOrdersV99Card.claim .masterV99Status{background:rgba(242,176,65,.13);color:#f2b041}.masterOrdersV99Card.done .masterV99Status{background:rgba(51,160,93,.13);color:#63c884}.masterV99Works{margin-top:7px;padding-top:6px;border-top:1px solid rgba(255,255,255,.06);font-size:12px;line-height:1.3}.masterV99Works div+div{margin-top:2px}.masterV99Works small{display:block;margin-top:3px;color:var(--muted,#91a3b7)}
@media(max-width:520px){.masterStatusFilters button,.masterV99DayFilters button{min-height:36px;padding:6px 10px;font-size:12px}.masterV99Top{grid-template-columns:auto auto;align-items:start}.masterV99Top time{grid-column:1/-1;text-align:left;margin-top:-1px}.masterOrdersV99Card{padding:10px 11px}}
`;
document.head.appendChild(style);
})();
