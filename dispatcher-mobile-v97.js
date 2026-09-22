(()=>{
'use strict';
const MOBILE_MAX=760;
const previousOrders=pages.orders;
let wasMobile=window.innerWidth<=MOBILE_MAX;

function dispatcherMode(){
  return (typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state.user?.role||'')==='dispatcher';
}
function mobileMode(){return window.innerWidth<=MOBILE_MAX}
function localToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function statusOf(o){return String(o?.status||'')}
function active(o){return !['Выполнена','Отменена'].includes(statusOf(o))}
function orderDate(o){return String(o?.scheduled_date||'').slice(0,10)}
function unassigned(o){return active(o)&&!o?.master_name&&!o?.master_vk_id&&!o?.master_id&&!o?.master_staff_id}
function overdue(o){const d=orderDate(o);return active(o)&&!!d&&d<localToday()}
function reschedule(o){return active(o)&&!!o?.reschedule_requested}
function normalizePhone(value){
  let p=String(value||'').trim().replace(/[^\d+]/g,'');
  if(/^8\d{10}$/.test(p))p='+7'+p.slice(1);
  else if(/^\d{10}$/.test(p))p='+7'+p;
  return p;
}
function dayLabel(){
  try{return new Date(localToday()+'T12:00:00').toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}
  catch(_){return localToday()}
}
function counts(){
  const orders=state.orders||[],today=localToday();
  return {
    today:orders.filter(o=>active(o)&&orderDate(o)===today).length,
    unassigned:orders.filter(unassigned).length,
    reschedule:orders.filter(reschedule).length,
    overdue:orders.filter(overdue).length
  };
}
function mobileHeader(){
  const c=counts();
  return `<section class="dmMobileHeader"><div class="dmMobileTitle"><span>ДИСПЕТЧЕРСКАЯ</span><h2>Сегодня</h2><p>${esc(dayLabel())}</p></div><button class="primary dmNewOrder" onclick="openOrderForm()">+ Заявка</button></section>
  <div class="dmMetrics" aria-label="Сводка диспетчера">
    <button type="button" onclick="dmFilter('today')"><span>Сегодня</span><b>${c.today}</b></button>
    <button type="button" onclick="dmFilter('unassigned')"><span>Без мастера</span><b>${c.unassigned}</b></button>
    <button type="button" class="${c.reschedule?'warn':''}" onclick="dmFilter('reschedule')"><span>Перенос</span><b>${c.reschedule}</b></button>
    <button type="button" class="${c.overdue?'danger':''}" onclick="dmFilter('overdue')"><span>Просрочено</span><b>${c.overdue}</b></button>
  </div>
  <div class="dmShortcuts" aria-label="Быстрые фильтры">
    <button class="secondary" type="button" onclick="dmFilter('active')">В работе</button>
    <button class="secondary" type="button" onclick="dmFilter('today')">На сегодня</button>
    <button class="secondary" type="button" onclick="dmFilter('unassigned')">Без мастера</button>
    <button class="secondary" type="button" onclick="dmFilter('reschedule')">Нужно перенести</button>
    <button class="secondary" type="button" onclick="dmFilter('all')">Все</button>
  </div>`;
}

window.dmFilter=function(filter){
  if(typeof window.setBosOrderFilter==='function')return window.setBosOrderFilter(filter);
  if(typeof show==='function')show('orders');
};

pages.orders=function(){
  const current=previousOrders();
  if(!dispatcherMode()||!mobileMode())return current;
  return `<div class="bosDispatcherMobile">${mobileHeader()}<div class="dmExistingOrders">${current}</div></div>`;
};

function orderIdFromCard(card){
  const raw=card.getAttribute('onclick')||'';
  const match=raw.match(/openOrder\('([^']+)'\)/);
  return match?match[1]:'';
}
function decorateCards(){
  if(!dispatcherMode()||!mobileMode()||String(state.page||'')!=='orders')return;
  document.querySelectorAll('.bosDispatcherMobile .opsCompactOrder').forEach(card=>{
    if(card.dataset.dmReady==='1')return;
    const id=orderIdFromCard(card),order=(state.orders||[]).find(o=>String(o.id)===String(id));
    if(!order)return;
    const actions=document.createElement('div');
    actions.className='dmCardActions';
    const phone=normalizePhone(order.phone||order.client_phone);
    if(phone){
      const call=document.createElement('a');
      call.className='secondary dmCallAction';
      call.href='tel:'+phone;
      call.textContent='Позвонить';
      call.setAttribute('aria-label','Позвонить клиенту');
      call.addEventListener('click',event=>event.stopPropagation());
      actions.appendChild(call);
    }
    const open=document.createElement('button');
    open.type='button';
    open.className='secondary dmOpenAction';
    open.textContent='Открыть';
    open.addEventListener('click',event=>{event.stopPropagation();openOrder(String(order.id))});
    actions.appendChild(open);
    card.appendChild(actions);
    card.dataset.dmReady='1';
  });
}

const content=document.getElementById('content');
if(content){
  const observer=new MutationObserver(()=>requestAnimationFrame(decorateCards));
  observer.observe(content,{childList:true,subtree:true});
}
window.addEventListener('resize',()=>{
  const nowMobile=mobileMode();
  if(nowMobile===wasMobile)return;
  wasMobile=nowMobile;
  if(dispatcherMode()&&String(state.page||'')==='orders'&&typeof show==='function')show('orders');
});
queueMicrotask(decorateCards);

const style=document.createElement('style');
style.textContent=`
@media(max-width:${MOBILE_MAX}px){
  .bosDispatcherMobile{display:flex;flex-direction:column;gap:10px;padding-bottom:6px}
  .dmMobileHeader{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 1px 2px}
  .dmMobileTitle{min-width:0}.dmMobileTitle>span{display:block;font-size:10px;line-height:1.2;font-weight:800;letter-spacing:.12em;color:#8196aa}.dmMobileTitle h2{margin:2px 0 1px;font-size:24px;line-height:1.08}.dmMobileTitle p{margin:0;color:#91a5b8;font-size:12px;text-transform:capitalize}.dmNewOrder{flex:0 0 auto;min-height:42px;padding-left:13px;padding-right:13px}
  .dmMetrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.dmMetrics button{min-width:0;padding:9px 5px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(15,29,44,.88);color:inherit;text-align:center}.dmMetrics button span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#90a4b7;font-size:9px}.dmMetrics button b{display:block;margin-top:2px;font-size:19px;line-height:1.1}.dmMetrics button.warn{border-color:rgba(242,176,65,.35)}.dmMetrics button.warn b{color:#f2b041}.dmMetrics button.danger{border-color:rgba(229,92,92,.35)}.dmMetrics button.danger b{color:#ff8c8c}
  .dmShortcuts{display:flex;gap:7px;overflow-x:auto;padding:1px 0 3px;scrollbar-width:none}.dmShortcuts::-webkit-scrollbar{display:none}.dmShortcuts button{flex:0 0 auto;min-height:38px;padding:7px 11px;white-space:nowrap;font-size:11px;border-radius:999px}
  .dmExistingOrders>.row:first-child{display:none}.dmExistingOrders .bosOrderFilters{padding-top:2px;margin-left:-1px;margin-right:-1px}.dmExistingOrders .bosOrderFilters button{min-height:36px;border-radius:999px}.dmExistingOrders .bosOrderFilterBox{margin:3px 0 10px;padding:9px;border-radius:14px}.dmExistingOrders .bosOrderFilterBox input,.dmExistingOrders .bosOrderFilterBox select{min-height:42px}
  .dmExistingOrders #bosOrderList{display:flex;flex-direction:column;gap:9px}.dmExistingOrders .opsCompactOrder{margin:0;padding:12px 13px;border-radius:16px;border-color:rgba(255,255,255,.09);box-shadow:0 7px 22px rgba(0,0,0,.12)}.dmExistingOrders .opsCompactTop{align-items:center}.dmExistingOrders .opsCompactTop b{font-size:13px}.dmExistingOrders .opsCompactTop span{font-size:11px}.dmExistingOrders .opsCompactMain{margin-top:7px;align-items:flex-start}.dmExistingOrders .opsCompactMain b{font-size:15px;line-height:1.25}.dmExistingOrders .opsCompactMain strong{font-size:15px;white-space:nowrap}.dmExistingOrders .opsCompactAddress{margin-top:5px;font-size:12px;line-height:1.35}.dmExistingOrders .opsCompactWorks{margin-top:8px;padding-top:8px;line-height:1.35}.dmExistingOrders .opsCompactBottom{margin-top:9px;gap:5px}.dmExistingOrders .opsCompactBottom .status,.dmExistingOrders .bosSourceChip,.dmExistingOrders .bosRescheduleChip{min-height:24px;box-sizing:border-box;padding:4px 7px}
  .dmCardActions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px;padding-top:9px;border-top:1px solid rgba(255,255,255,.07)}.dmCardActions:has(.dmOpenAction:only-child){grid-template-columns:1fr}.dmCardActions .secondary{min-height:40px;margin:0;border-radius:10px;font-size:12px}.dmCallAction{display:flex;align-items:center;justify-content:center;text-decoration:none}.dmOpenAction{width:100%}
}
@media(max-width:390px){.dmMetrics{grid-template-columns:repeat(2,minmax(0,1fr))}.dmMetrics button span{font-size:10px}.dmMobileTitle h2{font-size:22px}}
`;
document.head.appendChild(style);
})();
