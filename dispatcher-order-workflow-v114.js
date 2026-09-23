(()=>{
'use strict';
if(window.BOS_DISPATCHER_ORDER_WORKFLOW_V114)return;
window.BOS_DISPATCHER_ORDER_WORKFLOW_V114=true;

let queued=false;

function dispatcherMode(){
  return String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview());
}
function activeOrder(o){return !!o&&!['Выполнена','Отменена'].includes(String(o.status||''))}
function orderById(id){return (state?.orders||[]).find(o=>String(o.id)===String(id))||null}
function safe(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function displayNo(o){return typeof window.BOS_ORDER_NO==='function'?window.BOS_ORDER_NO(o):String(o?.id||'')}
function idFromCard(card){
  const direct=card?.dataset?.orderId;
  if(direct)return String(direct);
  const raw=card?.getAttribute?.('onclick')||'';
  const match=raw.match(/openOrder\('([^']+)'\)/);
  return match?String(match[1]):'';
}
function masterUser(o){
  if(!o)return null;
  const ids=[o.master_staff_id,o.master_vk_id,o.master_id].filter(Boolean).map(String);
  const name=String(o.master_name||'').trim();
  return (state?.users||[]).find(u=>{
    if(String(u?.role||'')!=='master')return false;
    const userIds=[u.id,u.staff_id,u.master_staff_id,u.vk_user_id,u.user_id,u.external_id].filter(Boolean).map(String);
    return ids.some(id=>userIds.includes(id))||(name&&name===String(u.full_name||u.name||'').trim());
  })||null;
}
function masterProfileId(o){
  const u=masterUser(o);
  return u?String(u.vk_user_id||u.id||u.staff_id||''):'';
}
function renderReason(o){
  const reason=String(o?.reschedule_reason||'').trim();
  if(!o?.reschedule_requested||!reason)return '';
  return `<div class="dwv114Reason"><span>Причина переноса</span><b>${safe(reason)}</b></div>`;
}

window.openDispatcherAssignedMaster=function(orderId){
  const o=orderById(orderId),profileId=masterProfileId(o);
  if(!o)return;
  if(profileId&&typeof openEmployeeProfile==='function')return openEmployeeProfile(profileId);
  const name=String(o.master_name||'').trim();
  if(name)alert(`Профиль мастера «${name}» не найден в текущем списке сотрудников.`);
};

window.openDispatcherCancelOrder=function(orderId){
  const o=orderById(orderId);
  if(!o||!activeOrder(o))return;
  const pageBefore=String(state?.page||'orders');
  const when=String(o.scheduled_date||'').slice(0,10);
  const time=String(o.scheduled_time||o.time_slot||'').slice(0,5);
  openModal(`<h2>Отменить заявку № ${safe(displayNo(o))}</h2><section class="card dwv114CancelSummary"><div><span>Клиент</span><b>${safe(o.client||'Не указан')}</b></div><div><span>Работа</span><b>${safe(o.work||'Не указана')}</b></div><div><span>Мастер</span><b>${safe(o.master_name||'Не назначен')}</b></div><div><span>Дата</span><b>${safe(when||'Не назначена')}${time?` · ${safe(time)}`:''}</b></div></section><div class="dwv114CancelWarning"><b>Подтвердите отмену</b><span>Заявка получит статус «Отменена» и исчезнет из активной очереди. Остальные данные заявки сохранятся.</span></div><div class="dwv114CancelButtons"><button type="button" class="secondary" onclick="closeModal()">Не отменять</button><button id="dwv114CancelConfirm" type="button" class="primary dwv114CancelConfirm">Отменить заявку</button></div><p id="dwv114CancelMsg" class="muted"></p>`);
  const confirm=document.getElementById('dwv114CancelConfirm');
  const msg=document.getElementById('dwv114CancelMsg');
  if(!confirm)return;
  confirm.onclick=async()=>{
    if(state.busy)return;
    state.busy=true;confirm.disabled=true;
    if(msg)msg.textContent='Отменяем заявку…';
    try{
      const d=await api('updateOrder',{id:o.id,status:'Отменена'});
      if(!d?.ok)throw new Error(d?.error||'Не удалось отменить заявку');
      const i=(state.orders||[]).findIndex(x=>String(x.id)===String(o.id));
      if(i>=0)state.orders[i]=d.order||{...state.orders[i],status:'Отменена'};
      closeModal();
      if(typeof show==='function')show(pageBefore==='dispatch'?'dispatch':'orders');
    }catch(err){
      if(msg)msg.textContent=err?.message||String(err);
      confirm.disabled=false;
    }finally{state.busy=false}
  };
};

function addButton(actions,o,kind){
  if(!actions||!o)return;
  if(kind==='master'){
    const profileId=masterProfileId(o);
    if(!profileId||actions.querySelector('.dwv114MasterAction'))return;
    const b=document.createElement('button');
    b.type='button';b.className='secondary dwv114Action dwv114MasterAction';b.textContent='Мастер';
    b.setAttribute('aria-label','Профиль назначенного мастера');
    b.addEventListener('click',e=>{e.stopPropagation();window.openDispatcherAssignedMaster(String(o.id))});
    actions.appendChild(b);
    return;
  }
  if(kind==='cancel'&&activeOrder(o)&&!actions.querySelector('.dwv114CancelAction')){
    const b=document.createElement('button');
    b.type='button';b.className='secondary dwv114Action dwv114CancelAction';b.textContent='Отменить';
    b.setAttribute('aria-label','Отменить заявку');
    b.addEventListener('click',e=>{e.stopPropagation();window.openDispatcherCancelOrder(String(o.id))});
    actions.appendChild(b);
  }
}
function addReason(card,o,actions){
  if(!card||!o||!o.reschedule_requested||!String(o.reschedule_reason||'').trim())return;
  if(card.querySelector('.dwv114Reason'))return;
  const wrap=document.createElement('div');
  wrap.innerHTML=renderReason(o);
  const reason=wrap.firstElementChild;
  if(reason)card.insertBefore(reason,actions||null);
}
function decorateMobileOrders(){
  document.querySelectorAll('.opsCompactOrder').forEach(card=>{
    const o=orderById(idFromCard(card));if(!o)return;
    const actions=card.querySelector('.dmCardActions');if(!actions)return;
    addReason(card,o,actions);
    addButton(actions,o,'master');
    addButton(actions,o,'cancel');
  });
}
function decorateMobileDispatch(){
  document.querySelectorAll('.dmv2Order').forEach(card=>{
    const o=orderById(idFromCard(card));if(!o)return;
    const actions=card.querySelector('.dmv2Actions');if(!actions)return;
    addReason(card,o,actions);
    addButton(actions,o,'master');
    addButton(actions,o,'cancel');
  });
}
function selectedDesktopOrder(){
  const boardId=document.querySelector('.dbOrderCard.selected[data-order-id]')?.dataset?.orderId||'';
  const classicId=document.querySelector('.ddQueueCard.isSelected')?.dataset?.orderId||'';
  return orderById(boardId||classicId);
}
function decorateDesktop(){
  const actions=document.querySelector('.dbDetailActions')||document.querySelector('.ddDetailActions');
  const o=selectedDesktopOrder();
  if(!actions||!o)return;
  addButton(actions,o,'master');
  addButton(actions,o,'cancel');
}
function cleanup(){
  document.querySelectorAll('.dwv114Action,.dwv114Reason').forEach(node=>node.remove());
}
function decorate(){
  queued=false;
  if(!dispatcherMode()){cleanup();return}
  const page=String(state?.page||'');
  if(page==='orders'){
    if(window.innerWidth>=1050)decorateDesktop();
    else decorateMobileOrders();
  }else if(page==='dispatch'&&window.innerWidth<=760)decorateMobileDispatch();
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(decorate)}

const start=()=>{
  const root=document.getElementById('content');
  if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
  schedule();
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.addEventListener('resize',schedule);

const style=document.createElement('style');
style.textContent=`
.dwv114Reason{display:flex;flex-direction:column;gap:3px;margin:9px 0 0;padding:8px 10px;border:1px solid rgba(242,176,65,.3);border-radius:10px;background:rgba(242,176,65,.08)}.dwv114Reason span{font-size:10px;font-weight:700;color:#d2a84f}.dwv114Reason b{font-size:12px;line-height:1.35;color:#f1d49a}.dwv114CancelSummary{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.dwv114CancelSummary>div{display:flex;flex-direction:column;gap:4px;min-width:0}.dwv114CancelSummary span{font-size:11px;color:#8fa4b8}.dwv114CancelSummary b{overflow-wrap:anywhere}.dwv114CancelWarning{display:flex;flex-direction:column;gap:5px;padding:12px;border:1px solid rgba(229,92,92,.32);border-radius:12px;background:rgba(229,92,92,.08)}.dwv114CancelWarning span{font-size:12px;line-height:1.4;color:#aebdca}.dwv114CancelButtons{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.dwv114CancelButtons button{min-height:46px}.dwv114CancelConfirm{background:linear-gradient(135deg,#b94a4a,#d65d5d)!important;border-color:rgba(255,150,150,.45)!important}.ddDetailActions .dwv114CancelAction,.dbDetailActions .dwv114CancelAction{border-color:rgba(229,92,92,.32);color:#ff9a9a}.dmCardActions .dwv114CancelAction,.dmv2Actions .dwv114CancelAction{border-color:rgba(229,92,92,.32);color:#ff9a9a}
@media(max-width:760px){.dwv114CancelSummary{grid-template-columns:1fr}.dwv114CancelButtons{grid-template-columns:1fr}.dwv114CancelButtons button{min-height:50px}.dmCardActions .dwv114Action{min-height:40px}.dmv2Actions .dwv114Action{min-height:40px}}
`;
document.head.appendChild(style);
})();
