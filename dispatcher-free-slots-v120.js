(()=>{
'use strict';
if(window.BOS_DISPATCHER_FREE_SLOTS_V120)return;
window.BOS_DISPATCHER_FREE_SLOTS_V120=true;

const HOURS=Array.from({length:11},(_,i)=>10+i);
let selectedDate='';
let queued=false;

const pad=n=>String(n).padStart(2,'0');
const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const addDays=(date,n)=>{const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+n);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const dateOnly=v=>String(v||'').slice(0,10);
const hm=v=>String(v||'').slice(0,5);
const safe=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const dispatcherMode=()=>String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview());
const active=o=>!!o&&!['Выполнена','Отменена'].includes(String(o.status||''));
const ids=x=>[x?.id,x?.staff_id,x?.master_staff_id,x?.master_id,x?.vk_user_id,x?.user_id,x?.external_id].filter(Boolean).map(String);
const masterKey=m=>String(m?.vk_user_id||m?.external_id||m?.id||m?.staff_id||'');
const sameMaster=(m,o)=>{const set=new Set(ids(m)),orderIds=[o?.master_staff_id,o?.master_id,o?.master_vk_id].filter(Boolean).map(String);return orderIds.some(id=>set.has(id))||String(m?.full_name||m?.name||'')===String(o?.master_name||'')};
const unassigned=o=>active(o)&&!o?.master_staff_id&&!o?.master_id&&!o?.master_vk_id&&!String(o?.master_name||'').trim();
const toMinutes=v=>{const m=String(v||'').match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null};
const slotFor=time=>{const h=Number(String(time).slice(0,2));return `${pad(h)}:00–${pad(h+1)}:00`};

function allMasters(){
  const list=[...(state?.masters||[]),...(state?.users||[]).filter(u=>String(u?.role||'')==='master')],out=[];
  for(const m of list){
    if(!m||m.is_active===false||String(m.is_active)==='false')continue;
    if(out.some(x=>ids(x).some(id=>ids(m).includes(id))||String(x.full_name||x.name||'')===String(m.full_name||m.name||'')))continue;
    out.push(m);
  }
  return out;
}
function rowFor(m,date){const set=new Set(ids(m));return (state?.masterSchedule||[]).find(r=>dateOnly(r?.work_date||r?.date)===date&&ids(r).some(id=>set.has(id)))||null}
function working(row){return !!row&&row.is_working!==false&&String(row.is_working)!=='false'}
function workHours(m,date){
  const row=rowFor(m,date);
  if(row&&!working(row))return [];
  const personalStart=toMinutes(m?.work_start),personalEnd=toMinutes(m?.work_end);
  if(!row&&(personalStart===null||personalEnd===null))return [];
  const start=toMinutes(row?.work_start)??personalStart,end=toMinutes(row?.work_end)??personalEnd;
  if(start===null||end===null||end<=start)return [];
  return HOURS.filter(h=>h*60>=start&&(h+1)*60<=end);
}
function intervalOf(o){
  const slot=String(o?.time_slot||'').replace(/[—-]/g,'–');
  if(slot.includes('–')){
    const [a,b]=slot.split('–').map(x=>toMinutes(x.trim()));
    if(a!==null&&b!==null&&b>a)return [a,b];
  }
  const start=toMinutes(o?.scheduled_time);
  return start===null?null:[start,start+60];
}
function assignedOrders(m,date){return (state?.orders||[]).filter(active).filter(o=>dateOnly(o?.scheduled_date)===date&&sameMaster(m,o))}
function freeTimes(m,date){
  const busy=assignedOrders(m,date).map(intervalOf).filter(Boolean);
  return workHours(m,date).filter(h=>{const a=h*60,b=(h+1)*60;return !busy.some(([x,y])=>a<y&&x<b)}).map(h=>`${pad(h)}:00`);
}
function scheduleText(m,date){
  const row=rowFor(m,date);
  if(row&&!working(row))return 'Выходной';
  const hours=workHours(m,date);if(!hours.length)return 'График не задан';
  const start=hm(row?.work_start)||hm(m?.work_start)||`${pad(hours[0])}:00`;
  const end=hm(row?.work_end)||hm(m?.work_end)||`${pad(hours[hours.length-1]+1)}:00`;
  return `${start}–${end}`;
}
function relevantUnassigned(date){
  return (state?.orders||[]).filter(unassigned).filter(o=>!dateOnly(o?.scheduled_date)||dateOnly(o?.scheduled_date)===date).sort((a,b)=>Number(!!dateOnly(b?.scheduled_date))-Number(!!dateOnly(a?.scheduled_date))||String(a?.id||'').localeCompare(String(b?.id||'')));
}
function availability(date){
  return allMasters().map(master=>({master,key:masterKey(master),free:freeTimes(master,date),load:assignedOrders(master,date).length,schedule:scheduleText(master,date)})).sort((a,b)=>b.free.length-a.free.length||a.load-b.load||String(a.master?.full_name||a.master?.name||'').localeCompare(String(b.master?.full_name||b.master?.name||''),'ru'));
}
function masterCard(item,date){
  const name=item.master?.full_name||item.master?.name||'Мастер';
  const slots=item.free.length?item.free.map(time=>`<button type="button" class="dfs120Slot" data-master="${safe(item.key)}" data-time="${safe(time)}" aria-label="${safe(name)} ${safe(time)}">${safe(time)}</button>`).join(''):'<span class="dfs120NoSlots">Нет свободных окон</span>';
  return `<article class="dfs120Master${item.free.length?' hasFree':' busy'}" data-master="${safe(item.key)}"><div class="dfs120MasterHead"><div><b>${safe(name)}</b><span>${safe(item.schedule)}</span></div><span class="dfs120Load">${item.load} заяв.</span></div><div class="dfs120Slots">${slots}</div></article>`;
}
function panelHtml(date){
  const items=availability(date),workingMasters=items.filter(x=>x.schedule!=='Выходной'&&x.schedule!=='График не задан').length,totalFree=items.reduce((sum,x)=>sum+x.free.length,0),unassignedCount=relevantUnassigned(date).length;
  return `<div class="dfs120Head"><div><h3>Свободные окна мастеров</h3><p>Свободное время по графику и уже назначенным заявкам</p></div><div class="dfs120Date"><button type="button" class="secondary" data-date-shift="0">Сегодня</button><button type="button" class="secondary" data-date-shift="1">Завтра</button><input id="dfs120Date" type="date" value="${safe(date)}" aria-label="Дата свободных окон"></div></div><div class="dfs120Stats"><span><b>${workingMasters}</b> работают</span><span><b>${totalFree}</b> свободных окон</span><span><b>${unassignedCount}</b> без мастера</span></div><div class="dfs120Grid">${items.length?items.map(x=>masterCard(x,date)).join(''):'<p class="muted">Мастеров пока нет.</p>'}</div>`;
}
function bindPanel(panel){
  panel.querySelector('#dfs120Date')?.addEventListener('change',e=>{selectedDate=e.target.value||localToday();renderPanel()});
  panel.querySelectorAll('[data-date-shift]').forEach(button=>button.addEventListener('click',()=>{selectedDate=addDays(localToday(),Number(button.dataset.dateShift||0));renderPanel()}));
  panel.querySelectorAll('.dfs120Slot').forEach(button=>button.addEventListener('click',()=>openAssign(button.dataset.master||'',button.dataset.time||'',selectedDate)));
}
function ensurePanel(){
  if(!dispatcherMode()||String(state?.page||'')!=='dispatch')return null;
  const host=document.getElementById('content');if(!host)return null;
  let panel=host.querySelector('.dfs120Panel');
  if(panel)return panel;
  const anchor=host.querySelector('.usScheduleCard');if(!anchor)return null;
  panel=document.createElement('section');panel.className='card dfs120Panel';
  anchor.parentElement.insertBefore(panel,anchor);
  return panel;
}
function renderPanel(){
  const panel=ensurePanel();if(!panel)return;
  if(!selectedDate)selectedDate=localToday();
  panel.innerHTML=panelHtml(selectedDate);bindPanel(panel);
}
function orderLabel(o){const no=typeof window.BOS_ORDER_NO==='function'?window.BOS_ORDER_NO(o):o?.id;return `№ ${no} · ${o?.client||'Клиент'} · ${o?.work||'Работа'}`}
function openAssign(masterValue,time,date){
  const master=allMasters().find(m=>masterKey(m)===String(masterValue));if(!master)return;
  const orders=relevantUnassigned(date),name=master.full_name||master.name||'Мастер';
  openModal(`<h2>Назначить заявку</h2><p class="muted">${safe(name)} · ${safe(date)} · ${safe(time)}</p><div id="dfs120Orders" class="dfs120Orders">${orders.length?orders.map(o=>`<button type="button" class="secondary dfs120Order" data-order="${safe(o.id)}"><span>${safe(orderLabel(o))}</span><small>${safe(o.address||'Адрес не указан')}</small></button>`).join(''):'<p class="muted">На эту дату нет неназначенных заявок.</p>'}</div><p id="dfs120Msg" class="muted"></p>`);
  document.querySelectorAll('#dfs120Orders .dfs120Order').forEach(button=>button.addEventListener('click',()=>assign(button.dataset.order||'',masterValue,time,date)));
}
async function assign(orderId,masterValue,time,date){
  const order=(state?.orders||[]).find(o=>String(o?.id)===String(orderId)),master=allMasters().find(m=>masterKey(m)===String(masterValue));
  if(!order||!master||state.busy)return;
  if(!confirm(`Назначить заявку № ${typeof window.BOS_ORDER_NO==='function'?window.BOS_ORDER_NO(order):order.id} мастеру ${master.full_name||master.name||'Мастер'} на ${date} ${time}?`))return;
  const msg=document.getElementById('dfs120Msg');state.busy=true;if(msg)msg.textContent='Назначаем…';
  try{
    const payload={id:order.id,master_vk_id:masterValue,scheduled_date:date,scheduled_time:time,time_slot:slotFor(time)};
    const result=await api('updateOrder',payload);if(!result?.ok)throw new Error(result?.error||'Не удалось назначить заявку');
    const i=(state.orders||[]).findIndex(o=>String(o?.id)===String(order.id));
    if(i>=0)state.orders[i]={...state.orders[i],...(result.order||{}),...payload,master_name:master.full_name||master.name||''};
    closeModal();renderPanel();
  }catch(error){if(msg)msg.textContent=error?.message||String(error)}finally{state.busy=false}
}
window.renderDispatcherFreeSlots120=renderPanel;
window.openDispatcherFreeSlot120=openAssign;
window.assignDispatcherFreeSlot120=assign;
window.__dispatcherFreeSlots120=(date=selectedDate||localToday())=>availability(date).map(x=>({master_key:x.key,master_name:x.master?.full_name||x.master?.name||'',free_times:[...x.free],load:x.load,schedule:x.schedule}));

function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;if(dispatcherMode()&&String(state?.page||'')==='dispatch'&&!document.querySelector('.dfs120Panel'))renderPanel()})}
const start=()=>{const root=document.getElementById('content');if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});schedule()};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();

const style=document.createElement('style');
style.textContent=`
.dfs120Panel{display:grid;gap:12px;margin-bottom:12px}.dfs120Head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.dfs120Head h3{margin:0 0 3px}.dfs120Head p{margin:0;color:var(--muted,#8ea0b5);font-size:11px}.dfs120Date{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.dfs120Date input{min-height:40px}.dfs120Stats{display:flex;gap:8px;flex-wrap:wrap}.dfs120Stats span{padding:6px 9px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.03);font-size:11px;color:#9eb0c2}.dfs120Stats b{color:#fff}.dfs120Grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.dfs120Master{display:grid;gap:8px;padding:10px;border:1px solid rgba(255,255,255,.09);border-radius:13px;background:rgba(255,255,255,.025)}.dfs120Master.hasFree{border-color:rgba(55,188,121,.3)}.dfs120MasterHead{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.dfs120MasterHead>div{display:grid;gap:2px}.dfs120MasterHead b{font-size:12px}.dfs120MasterHead span,.dfs120Load{font-size:10px;color:#8fa4b8}.dfs120Load{padding:3px 6px;border-radius:999px;background:rgba(255,255,255,.05);white-space:nowrap}.dfs120Slots{display:flex;gap:5px;flex-wrap:wrap}.dfs120Slot{min-height:34px;padding:5px 8px;border:1px solid rgba(55,188,121,.38);border-radius:9px;background:rgba(55,188,121,.08);color:#9ce2bc;font-size:11px;font-weight:800}.dfs120Slot:hover{background:rgba(55,188,121,.15)}.dfs120NoSlots{font-size:10px;color:#7f93a7}.dfs120Orders{display:grid;gap:7px;margin-top:10px}.dfs120Order{display:grid!important;grid-template-columns:1fr;text-align:left!important;gap:3px;min-height:52px}.dfs120Order span{font-weight:800}.dfs120Order small{color:#8fa4b8}
@media(max-width:760px){.dfs120Head{align-items:stretch;flex-direction:column}.dfs120Date{display:grid;grid-template-columns:1fr 1fr}.dfs120Date input{grid-column:1/-1;min-height:46px}.dfs120Grid{grid-template-columns:1fr}.dfs120Slot{min-height:42px;min-width:64px}.dfs120Panel{padding:11px}}
`;
document.head.appendChild(style);
})();
