(()=>{
'use strict';
function dcMode(){return (typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state.user?.role||'')==='dispatcher'}
function dcDone(o){return String(o?.status||'')==='Выполнена'}
const prevOpen=window.openOrder;
window.openOrder=function(id){
  prevOpen(id);
  if(!dcMode())return;
  const o=(state.orders||[]).find(x=>String(x.id)===String(id));
  const modal=document.querySelector('.modal');
  if(!o||!modal||dcDone(o)||modal.querySelector('.dispatcherCloseOrder'))return;
  const box=document.createElement('section');
  box.className='card dispatcherCloseOrder';
  box.innerHTML=`<div class="row" style="align-items:center"><div><h3 style="margin:0">Закрытие заявки</h3><div class="muted">Отметить заявку выполненной</div></div><button class="primary" type="button" onclick="dispatcherCloseOrder('${esc(o.id)}')">Закрыть заявку</button></div><p id="dispatcherCloseMsg" class="muted" style="margin:8px 0 0"></p>`;
  modal.appendChild(box);
};
window.dispatcherCloseOrder=async function(id){
  if(!dcMode()||state.busy)return;
  const o=(state.orders||[]).find(x=>String(x.id)===String(id));if(!o)return;
  const msg=document.getElementById('dispatcherCloseMsg');
  if(!confirm(`Закрыть заявку №${o.id} как выполненную?`))return;
  state.busy=true;if(msg)msg.textContent='Закрываем…';
  try{
    const d=await api('updateOrder',{id:o.id,status:'Выполнена'});
    if(!d?.ok)throw new Error(d?.error||'Не удалось закрыть заявку');
    const i=state.orders.findIndex(x=>String(x.id)===String(o.id));if(i>=0)state.orders[i]={...state.orders[i],...d.order};
    closeModal();show('orders');
  }catch(e){if(msg)msg.textContent=e?.message||'Не удалось закрыть заявку'}finally{state.busy=false}
};
})();