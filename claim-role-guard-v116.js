(()=>{
'use strict';
if(window.BOS_CLAIM_ROLE_GUARD_V116)return;
window.BOS_CLAIM_ROLE_GUARD_V116=true;
const allowed=()=>['owner','manager','dispatcher'].includes(String(state?.user?.role||''));
let rawClaim=null,wrappedClaim=null,rawOrder=null,wrappedOrder=null,queued=false;
const orderById=id=>(state?.orders||[]).find(o=>String(o.id)===String(id))||null;
const claimOrderId=o=>o?.supabase_id||(/^\d+$/.test(String(o?.id||''))?o.id:null);
function addButton(host,o){
  if(!allowed()||!host||!o||String(o.status||'')!=='Выполнена')return;
  const id=claimOrderId(o);if(!id||host.querySelector('.bosClaimCreateV116'))return;
  const btn=document.createElement('button');btn.type='button';btn.className='secondary wide bosClaimCreateV116';btn.textContent='Открыть претензию';
  btn.onclick=()=>window.openReopenClaimForm?.(String(id));
  const target=host.querySelector('.ddActions,.dbDetailActions,.dbActions,.modalActions')||host;
  target.appendChild(btn);
}
function injectForOrder(id){
  if(!allowed())return;
  const o=orderById(id);if(!o)return;
  addButton(document.querySelector('#modalRoot .modal'),o);
  addButton(document.querySelector('#dispatchBoardDetail .dbDetail,#dispatchBoardDetail .ddDetail,#dispatchBoardDetail'),o);
}
function installClaimGuard(){
  const current=window.openReopenClaimForm;
  if(typeof current!=='function'||current===wrappedClaim)return;
  rawClaim=current;
  wrappedClaim=function(){if(!allowed())return;return rawClaim.apply(this,arguments)};
  window.openReopenClaimForm=wrappedClaim;
}
function installOrderHook(){
  const current=window.openOrder;
  if(typeof current!=='function'||current===wrappedOrder)return;
  rawOrder=current;
  wrappedOrder=function(id){const out=rawOrder.apply(this,arguments);setTimeout(()=>injectForOrder(id),0);setTimeout(()=>injectForOrder(id),80);return out};
  window.openOrder=wrappedOrder;
}
function removeUnauthorized(){
  if(allowed())return;
  document.querySelectorAll('.bosClaimCreateV116').forEach(x=>x.remove());
  document.querySelectorAll('button').forEach(b=>{const t=(b.textContent||'').trim();if(t==='Открыть рекламацию'||t==='Открыть претензию')b.remove()});
  const form=document.querySelector('#claimForm');if(form){const modal=form.closest('.modal');if(modal)modal.remove();else form.remove()}
}
function injectSelected(){
  if(!allowed())return;
  const detail=document.querySelector('#dispatchBoardDetail .dbDetail,#dispatchBoardDetail .ddDetail,#dispatchBoardDetail');
  if(!detail)return;
  const selected=document.querySelector('.dbOrderCard.selected,.ddQueueCard.isSelected,[data-order-id].selected,[data-order-id].isSelected');
  const id=selected?.dataset?.orderId||detail.dataset?.orderId||'';
  if(id)injectForOrder(id);
}
function decorate(){queued=false;installClaimGuard();installOrderHook();removeUnauthorized();injectSelected()}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(decorate)}
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
setTimeout(schedule,0);setTimeout(schedule,100);setTimeout(schedule,500);
})();