(()=>{
'use strict';
if(window.BOS_DISPATCHER_UNASSIGNED_QUEUE_V122)return;
window.BOS_DISPATCHER_UNASSIGNED_QUEUE_V122=true;

let queued=false;
let expanded=false;
const pad=n=>String(n).padStart(2,'0');
const isoDate=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today=()=>isoDate(new Date());
const tomorrow=()=>{const d=new Date();d.setDate(d.getDate()+1);return isoDate(d)};
const dispatcherMode=()=>String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview());
const ordersPage=()=>String(state?.page||'')==='orders';
const active=o=>!!o&&!['Выполнена','Отменена'].includes(String(o?.status||''));
const unassigned=o=>active(o)&&!o?.master_staff_id&&!o?.master_id&&!o?.master_vk_id&&!String(o?.master_name||'').trim();
const orderDate=o=>String(o?.scheduled_date||'').slice(0,10);
const orderTime=o=>String(o?.scheduled_time||o?.time_slot||'').slice(0,5);
const safe=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=v=>Number(v||0).toLocaleString('ru-RU');

function urgency(order){
  if(order?.reschedule_requested)return 0;
  const date=orderDate(order),t=today();
  if(date&&date<t)return 1;
  if(date===t)return 2;
  if(date===tomorrow())return 3;
  if(date)return 4;
  return 5;
}
function compareOrders(a,b){
  const ua=urgency(a),ub=urgency(b);
  if(ua!==ub)return ua-ub;
  const da=orderDate(a)||'9999-12-31',db=orderDate(b)||'9999-12-31';
  if(da!==db)return da.localeCompare(db);
  const ta=orderTime(a)||'99:99',tb=orderTime(b)||'99:99';
  if(ta!==tb)return ta.localeCompare(tb);
  return String(a?.created_at||a?.id||'').localeCompare(String(b?.created_at||b?.id||''));
}
function queueOrders(){return (state?.orders||[]).filter(unassigned).sort(compareOrders)}
function urgencyMeta(order){
  if(order?.reschedule_requested)return ['Нужно перенести','warn'];
  const date=orderDate(order),t=today();
  if(date&&date<t)return ['Просрочена','danger'];
  if(date===t)return ['Сегодня','today'];
  if(date===tomorrow())return ['Завтра','next'];
  if(date)return ['Запланирована','future'];
  return ['Без даты','muted'];
}
function formatDate(order){
  const date=orderDate(order),time=orderTime(order);
  if(!date)return time||'Дата не указана';
  const [y,m,d]=date.split('-');
  return `${d}.${m}${time?` · ${time}`:''}`;
}
function bestFor(order){
  if(order?.reschedule_requested||typeof window.__dispatcherSmartDispatch121!=='function')return null;
  try{return window.__dispatcherSmartDispatch121(order.id)?.[0]||null}catch(error){console.warn('Unassigned queue v122 recommendation failed',error);return null}
}
function signatureFor(orders){
  return `${expanded?'all':'top'}|${orders.map(order=>{const best=bestFor(order);return `${order.id}:${order.updated_at||''}:${order.master_staff_id||''}:${orderDate(order)}:${orderTime(order)}:${order.reschedule_requested?'r':''}:${best?.master_key||''}:${best?.best_time||''}`}).join('|')}`;
}
function openOrderSafe(id){
  if(typeof openOrder==='function')openOrder(id);
}
async function assignBest(order,best,button){
  if(!order||!best||typeof window.assignDispatcherRecommendation121!=='function')return false;
  const label=`${best.master_name||'мастера'} на ${best.best_time||'свободное время'}`;
  if(typeof confirm==='function'&&!confirm(`Назначить ${label}?`))return false;
  if(button){button.disabled=true;button.textContent='Назначаем…'}
  try{
    const ok=await window.assignDispatcherRecommendation121(order.id,best.master_key,best.best_time,orderDate(order)||today());
    schedule();
    return !!ok;
  }finally{
    if(button?.isConnected){button.disabled=false;button.textContent='Назначить'}
  }
}
function rowNode(order){
  const best=bestFor(order);
  const [badge,tone]=urgencyMeta(order);
  const row=document.createElement('article');
  row.className='duq122Item';
  row.dataset.orderId=String(order.id);
  const title=order.client||order.client_name||`Заявка #${order.id}`;
  const work=order.work||order.service||order.description||'Работа не указана';
  const address=order.address||'Адрес не указан';
  row.innerHTML=`
    <div class="duq122Main">
      <div class="duq122Title"><span class="duq122Badge ${tone}">${safe(badge)}</span><b>${safe(title)}</b><small>#${safe(order.id)}</small></div>
      <div class="duq122Meta"><span>${safe(formatDate(order))}</span><span>${safe(work)}</span><span>${safe(address)}</span>${Number(order.amount||0)>0?`<span>${safe(money(order.amount))} ₽</span>`:''}</div>
    </div>
    <div class="duq122Pick"></div>
    <div class="duq122Actions"></div>`;
  const pick=row.querySelector('.duq122Pick');
  if(order.reschedule_requested){
    pick.innerHTML=`<b>Сначала обработать перенос</b><small>${safe(order.reschedule_reason||'Причина переноса указана мастером')}</small>`;
  }else if(best){
    pick.innerHTML=`<b>${safe(best.master_name||'Мастер')} · ${safe(best.best_time||'')}</b><small>${safe((best.reasons||[]).slice(0,2).join(' · ')||'Лучший свободный вариант')}</small>`;
  }else{
    pick.innerHTML='<b>Нет свободного варианта</b><small>Откройте заявку для ручного назначения</small>';
  }
  const actions=row.querySelector('.duq122Actions');
  if(best&&!order.reschedule_requested){
    const assign=document.createElement('button');
    assign.type='button';assign.className='primary duq122Assign';assign.textContent='Назначить';
    assign.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();assignBest(order,best,assign)});
    actions.appendChild(assign);
  }
  const open=document.createElement('button');
  open.type='button';open.className='secondary';open.textContent='Открыть';
  open.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openOrderSafe(order.id)});
  actions.appendChild(open);
  return row;
}
function ensurePanel(root){
  let panel=root.querySelector(':scope > .duq122');
  if(panel)return panel;
  panel=document.createElement('section');
  panel.className='duq122';
  const anchor=root.querySelector('.dbViewTabs')||root.querySelector('.dbSchedule')||root.querySelector('#bosOrderList')||root.firstElementChild;
  if(anchor)root.insertBefore(panel,anchor);else root.appendChild(panel);
  return panel;
}
function render(root,orders){
  const panel=ensurePanel(root);
  const signature=signatureFor(orders);
  if(panel.dataset.signature===signature)return;
  panel.dataset.signature=signature;
  panel.replaceChildren();
  const head=document.createElement('div');
  head.className='duq122Head';
  head.innerHTML=`<div><b>Очередь без мастера</b><small>${orders.length?`Сначала самые срочные · ${orders.length} шт.`:'Все активные заявки распределены'}</small></div>`;
  panel.appendChild(head);
  if(!orders.length){
    const empty=document.createElement('div');empty.className='duq122Empty';empty.textContent='Неназначенных активных заявок нет.';panel.appendChild(empty);return;
  }
  const list=document.createElement('div');list.className='duq122List';
  const visible=expanded?orders:orders.slice(0,5);
  visible.forEach(order=>list.appendChild(rowNode(order)));
  panel.appendChild(list);
  if(orders.length>5){
    const more=document.createElement('button');
    more.type='button';more.className='secondary duq122More';
    more.textContent=expanded?'Свернуть':`Показать ещё ${orders.length-5}`;
    more.addEventListener('click',()=>{expanded=!expanded;panel.dataset.signature='';schedule()});
    panel.appendChild(more);
  }
}
function cleanup(root){root?.querySelectorAll?.(':scope > .duq122')?.forEach(node=>node.remove())}
function sync(){
  queued=false;
  const root=document.getElementById('content');if(!root)return;
  if(!dispatcherMode()||!ordersPage()){cleanup(root);return}
  if(typeof window.__dispatcherSmartDispatch121!=='function'){setTimeout(schedule,80);return}
  render(root,queueOrders());
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(sync)}
function start(){
  const root=document.getElementById('content');
  if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
  schedule();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.addEventListener('resize',schedule);
window.__dispatcherUnassignedQueue122=()=>queueOrders().map(order=>({id:String(order.id),urgency:urgencyMeta(order)[0],best:bestFor(order)}));

const style=document.createElement('style');
style.textContent=`
#content>.duq122{margin:0 0 14px;padding:12px;border:1px solid rgba(86,156,214,.22);border-radius:14px;background:rgba(37,56,75,.38)}
#content .duq122Head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
#content .duq122Head>div{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
#content .duq122Head b{font-size:14px}
#content .duq122Head small{color:var(--muted,#8e9baa);font-size:11px}
#content .duq122List{display:grid;gap:7px}
#content .duq122Item{display:grid;grid-template-columns:minmax(260px,1.45fr) minmax(220px,1fr) auto;align-items:center;gap:12px;padding:10px;border:1px solid rgba(255,255,255,.075);border-radius:11px;background:rgba(255,255,255,.025)}
#content .duq122Title{display:flex;align-items:center;gap:7px;min-width:0}
#content .duq122Title b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
#content .duq122Title small{color:var(--muted,#8e9baa);font-size:10px}
#content .duq122Badge{display:inline-flex;align-items:center;min-height:22px;padding:3px 7px;border-radius:999px;font-size:9px;font-weight:900;line-height:1;white-space:nowrap;border:1px solid rgba(255,255,255,.12)}
#content .duq122Badge.warn{color:#f4c86d;border-color:rgba(242,176,65,.38);background:rgba(242,176,65,.1)}
#content .duq122Badge.danger{color:#ff9696;border-color:rgba(229,92,92,.4);background:rgba(229,92,92,.11)}
#content .duq122Badge.today{color:#8dccff;border-color:rgba(73,163,255,.36);background:rgba(73,163,255,.1)}
#content .duq122Badge.next{color:#9dd8ba;border-color:rgba(80,190,135,.32);background:rgba(80,190,135,.09)}
#content .duq122Badge.future,#content .duq122Badge.muted{color:#bdc7d1;background:rgba(255,255,255,.04)}
#content .duq122Meta{display:flex;gap:8px;margin-top:5px;min-width:0;flex-wrap:wrap;color:var(--muted,#8e9baa);font-size:10px}
#content .duq122Meta span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
#content .duq122Pick{min-width:0}
#content .duq122Pick b,#content .duq122Pick small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#content .duq122Pick b{font-size:11px}
#content .duq122Pick small{margin-top:3px;color:var(--muted,#8e9baa);font-size:10px}
#content .duq122Actions{display:flex;gap:6px;justify-content:flex-end}
#content .duq122Actions button{min-height:36px;padding:7px 10px;font-size:11px}
#content .duq122More{display:block;margin:9px auto 0;min-height:34px;font-size:11px}
#content .duq122Empty{padding:12px;text-align:center;color:var(--muted,#8e9baa);font-size:12px}
@media(max-width:900px){#content .duq122Item{grid-template-columns:1fr auto}#content .duq122Pick{grid-column:1/2}#content .duq122Actions{grid-column:2/3;grid-row:1/3}}
@media(max-width:620px){#content>.duq122{padding:10px;margin-bottom:10px}#content .duq122Item{grid-template-columns:1fr;gap:8px}#content .duq122Pick,#content .duq122Actions{grid-column:auto;grid-row:auto}#content .duq122Actions{justify-content:stretch}#content .duq122Actions button{flex:1;min-height:44px}#content .duq122Meta span{max-width:100%}}
`;
document.head.appendChild(style);
})();
