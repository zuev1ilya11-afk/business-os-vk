(()=>{
'use strict';
if(window.BOS_DISPATCHER_QUICK_ACTIONS_V159)return;
window.BOS_DISPATCHER_QUICK_ACTIONS_V159={version:'159'};

const DESKTOP_MIN=1050;
const MOBILE_MAX=760;
let queued=false;

const dispatcherMode=()=>String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview());
const ordersPage=()=>String(state?.page||'')==='orders';
const active=o=>!!o&&!['Выполнена','Отменена'].includes(String(o?.status||''));
const unassigned=o=>active(o)&&!o?.master_name&&!o?.master_vk_id&&!o?.master_id&&!o?.master_staff_id;
const orderById=id=>(state?.orders||[]).find(o=>String(o?.id)===String(id))||null;
const phoneOf=o=>{let p=String(o?.phone||o?.client_phone||'').trim().replace(/[^\d+]/g,'');if(/^8\d{10}$/.test(p))p='+7'+p.slice(1);else if(/^\d{10}$/.test(p))p='+7'+p;return p};

function openStatus(id){
  if(typeof window.openDispatcherMobileQuick157==='function'){
    window.openDispatcherMobileQuick157(String(id));
    requestAnimationFrame(()=>document.getElementById('drv157Status')?.focus());
    return;
  }
  if(typeof openOrder==='function')openOrder(String(id));
}
function openMaster(id){
  const order=orderById(id);
  if(order&&unassigned(order)&&typeof window.openDispatcherSmartAssign119==='function')return window.openDispatcherSmartAssign119(String(id));
  if(typeof window.openDispatcherMobileQuick157==='function'){
    window.openDispatcherMobileQuick157(String(id));
    requestAnimationFrame(()=>document.getElementById('drv157Master')?.focus());
    return;
  }
  if(typeof openOrder==='function')openOrder(String(id));
}
function openTime(id){
  if(typeof window.openDispatcherResponsiveMove157==='function')return window.openDispatcherResponsiveMove157(String(id));
  if(typeof window.dmEditDateTime==='function')return window.dmEditDateTime(String(id));
  if(typeof openOrder==='function')openOrder(String(id));
}
function openFull(id){
  if(typeof openOrderForm==='function')return openOrderForm(String(id));
  if(typeof openOrder==='function')return openOrder(String(id));
}
window.openDispatcherQuickStatus159=openStatus;
window.openDispatcherQuickMaster159=openMaster;
window.openDispatcherQuickTime159=openTime;
window.openDispatcherQuickFull159=openFull;

function button(label,action,id,extra=''){
  const b=document.createElement('button');b.type='button';b.className=`secondary dq159Action ${extra}`.trim();b.textContent=label;b.dataset.dq159Action=action;b.dataset.orderId=String(id);return b;
}
function desktopActionsFor(card){
  const id=String(card?.dataset?.orderId||'');
  const order=orderById(id);if(!id||!order)return;
  const parent=card.parentElement;
  if(parent?.querySelector(`:scope > .dq159DesktopActions[data-order-id="${CSS.escape(id)}"]`))return;
  const bar=document.createElement('div');bar.className='dq159DesktopActions';bar.dataset.orderId=id;
  const phone=phoneOf(order);
  if(phone){const a=document.createElement('a');a.className='secondary dq159Action dq159Call';a.href='tel:'+phone;a.textContent='Позвонить';a.setAttribute('aria-label','Позвонить клиенту');a.addEventListener('click',e=>e.stopPropagation());bar.appendChild(a)}
  bar.appendChild(button('Статус','status',id));
  bar.appendChild(button(unassigned(order)?'Подобрать':'Мастер','master',id,unassigned(order)?'dq159Primary':''));
  if(active(order))bar.appendChild(button(order.reschedule_requested?'Перенос':'Время','time',id,order.reschedule_requested?'dq159Warn':''));
  bar.appendChild(button('Открыть','open',id));
  card.insertAdjacentElement('afterend',bar);
}
function decorateDesktop(){
  if(window.innerWidth<DESKTOP_MIN||!dispatcherMode()||!ordersPage())return;
  document.querySelectorAll('.dbV94ListItems > .dbV94ListCard[data-order-id], .dbAttention .dbTray > .dbOrderCard[data-order-id]').forEach(desktopActionsFor);
}
function cleanupDesktop(){document.querySelectorAll('.dq159DesktopActions').forEach(n=>n.remove())}

function decorateMobileCard(actions){
  const smart=actions.querySelector('.dsa119CardAction');
  const legacy=actions.querySelector('.dmAssignAction');
  if(smart)smart.classList.add('dq159MasterAction');
  if(legacy)legacy.classList.add('dq159ManualMasterAction');
  actions.classList.add('dq159MobileActions');
}
function decorateMobile(){
  if(window.innerWidth>MOBILE_MAX||!dispatcherMode()||!ordersPage())return;
  document.querySelectorAll('.dmCardActions,.dmv2Actions').forEach(decorateMobileCard);
}
function cleanupMobile(){
  document.querySelectorAll('.dq159MasterAction').forEach(n=>n.classList.remove('dq159MasterAction'));
  document.querySelectorAll('.dq159ManualMasterAction').forEach(n=>n.classList.remove('dq159ManualMasterAction'));
  document.querySelectorAll('.dq159MobileActions').forEach(n=>n.classList.remove('dq159MobileActions'));
}

function sync(){
  queued=false;
  if(!dispatcherMode()||!ordersPage()){cleanupDesktop();cleanupMobile();return}
  if(window.innerWidth>=DESKTOP_MIN){cleanupMobile();decorateDesktop()}else{cleanupDesktop();if(window.innerWidth<=MOBILE_MAX)decorateMobile()}
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(sync)}

document.addEventListener('click',event=>{
  const b=event.target.closest?.('.dq159Action[data-dq159-action]');if(!b)return;
  event.preventDefault();event.stopPropagation();
  const id=b.dataset.orderId,action=b.dataset.dq159Action;
  if(action==='status')openStatus(id);else if(action==='master')openMaster(id);else if(action==='time')openTime(id);else if(action==='open')openFull(id);
});
const root=document.getElementById('content');if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
window.addEventListener('resize',schedule);
queueMicrotask(schedule);

const style=document.createElement('style');style.textContent=`
@media(min-width:${DESKTOP_MIN}px){
  .dq159DesktopActions{display:flex;flex-wrap:wrap;gap:5px;margin:-3px 0 7px;padding:7px;border:1px solid rgba(89,157,222,.18);border-top:0;border-radius:0 0 11px 11px;background:rgba(8,20,32,.72)}
  .dq159DesktopActions+.dbOrderCard,.dq159DesktopActions+.dbV94ListCard{margin-top:2px}
  .dq159DesktopActions .dq159Action{min-height:44px;padding:7px 9px;margin:0;border-radius:8px;font-size:10px;line-height:1;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
  .dq159DesktopActions .dq159Primary{border-color:rgba(73,163,255,.45);background:rgba(37,111,180,.2);color:#a9d7ff;font-weight:800}
  .dq159DesktopActions .dq159Warn{border-color:rgba(242,176,65,.5);color:#f4c86d}
  .dbAttention .dq159DesktopActions{gap:4px;padding:6px}.dbAttention .dq159DesktopActions .dq159Action{flex:1 1 calc(50% - 4px);padding:7px 6px}
}
@media(max-width:${MOBILE_MAX}px){
  .dmCardActions.dq159MobileActions,.dmv2Actions.dq159MobileActions{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
  .dq159MobileActions .dq159MasterAction{border-color:rgba(73,163,255,.48);background:rgba(37,111,180,.22);color:#a9d7ff;font-weight:800}
  .dq159MobileActions .dmCallAction{order:1}
  .dq159MobileActions .dmAssignAction{order:2}
  .dq159MobileActions .dsa119CardAction{order:3}
  .dq159MobileActions .dmDateTimeAction{order:4}
  .dq159MobileActions .dmStatusAction{order:5}
  .dq159MobileActions .drv157QuickAction{order:6}
  .dq159MobileActions .dmOpenAction{order:7;grid-column:1/-1}
}
`;
document.head.appendChild(style);
})();