(()=>{
'use strict';
if(window.BOS_MANAGEMENT_ORDER_DELETE_V100)return;window.BOS_MANAGEMENT_ORDER_DELETE_V100=true;
const leadershipRoles=new Set(['owner','manager']);
let deleting=false;
const liveLeadership=()=>leadershipRoles.has(String(state?.user?.role||''));
const orderById=id=>(state?.orders||[]).find(o=>String(o.id)===String(id))||null;
function injectDelete(id){
  if(!liveLeadership()||!orderById(id))return;
  const modal=document.querySelector('#modalRoot .modal');
  if(!modal||modal.querySelector('[data-bos-delete-order]'))return;
  const wrap=document.createElement('div');
  wrap.className='bosDeleteOrderWrap';
  wrap.innerHTML=`<button type="button" class="secondary wide bosDeleteOrderBtn" data-bos-delete-order onclick="deleteLeadershipOrder('${esc(id)}')">Удалить заявку</button><p class="muted bosDeleteOrderMsg" aria-live="polite"></p>`;
  modal.appendChild(wrap);
}
const previousOpenOrder=window.openOrder;
if(typeof previousOpenOrder==='function')window.openOrder=function(id){
  const out=previousOpenOrder.apply(this,arguments);
  if(liveLeadership()){
    setTimeout(()=>injectDelete(id),0);
    setTimeout(()=>injectDelete(id),120);
  }
  return out;
};
window.deleteLeadershipOrder=async function(id){
  if(!liveLeadership()||deleting)return;
  const o=orderById(id);if(!o)return;
  if(!window.confirm(`Удалить заявку №${id} без возможности восстановления?`))return;
  const btn=document.querySelector('[data-bos-delete-order]');
  const msg=document.querySelector('.bosDeleteOrderMsg');
  deleting=true;if(btn)btn.disabled=true;if(msg)msg.textContent='Удаляем…';
  try{
    const d=await api('deleteOrder',{id});
    if(!d?.ok)throw new Error(d?.error||'Не удалось удалить заявку');
    if(Array.isArray(state.orders))state.orders=state.orders.filter(x=>String(x.id)!==String(id));
    if(Array.isArray(state.supabaseOrders))state.supabaseOrders=state.supabaseOrders.filter(x=>String(x.id)!==String(id)&&String(x.supabase_id)!==String(id));
    if(Array.isArray(state.claims))state.claims=state.claims.filter(x=>String(x.order_id)!==String(id));
    if(typeof closeModal==='function')closeModal();
    try{
      if(typeof reloadData==='function')await reloadData(true);
      else if(typeof show==='function')show(state.page||'orders');
    }catch(refreshError){
      console.warn('Order deleted; refresh failed',refreshError);
      if(typeof show==='function')show(state.page||'orders');
    }
  }catch(e){
    if(msg)msg.textContent=e?.message||'Не удалось удалить заявку';
    if(btn)btn.disabled=false;
  }finally{deleting=false}
};
const style=document.createElement('style');
style.textContent=`.bosDeleteOrderWrap{margin-top:12px;padding-top:12px;border-top:1px solid rgba(127,127,127,.18)}.bosDeleteOrderBtn{border-color:rgba(220,38,38,.45)!important;color:#ef4444!important;background:rgba(220,38,38,.08)!important}.bosDeleteOrderBtn:hover{background:rgba(220,38,38,.14)!important}.bosDeleteOrderMsg{margin:7px 2px 0;min-height:16px}`;
document.head.appendChild(style);
})();
