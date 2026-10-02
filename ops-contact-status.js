(()=>{
'use strict';
if(window.BOS_OPS_CONTACT_STATUS)return;
let queued=false;
const ops=()=>['owner','manager','dispatcher'].includes(String(state?.user?.role||''))&&!(typeof isMasterPreview==='function'&&isMasterPreview())&&!(typeof liveMasterMode==='function'&&liveMasterMode());
const order=id=>(state?.orders||[]).find(o=>String(o.id)===String(id));
const cardId=node=>node.dataset.orderId||String(node.getAttribute('onclick')||'').match(/(?:openOrder|selectDispatchBoardOrder)\(['"]([^'"]+)/)?.[1]||'';
function render(node,o,details){const html=window.BOS_CONTACT_STATUS?.html(o,{details})||'';if(node.innerHTML!==html)node.innerHTML=html}
function decorate(){
 queued=false;if(!ops()){document.querySelectorAll('.bosOpsContact').forEach(node=>node.remove());return}
 document.querySelectorAll('#content .opsCompactOrder,#content .dbOrderCard[data-order-id],#content .dbV94ListCard[data-order-id],#content .ddQueueCard[data-order-id],#content .dmv2Card[data-order-id],#content section.card[onclick]').forEach(card=>{
  const o=order(cardId(card));if(!o)return;
  let slot=card.querySelector(':scope>.bosOpsContact');if(!slot){slot=document.createElement('div');slot.className='bosOpsContact';card.appendChild(slot)}render(slot,o,false);
 });
 document.querySelectorAll('[data-bos-contact-order]').forEach(node=>{const o=order(node.dataset.bosContactOrder);if(o)render(node,o,true)});
 const selected=document.querySelector('.dbOrderCard.selected[data-order-id],.dbV94ListCard.du183Selected[data-order-id],.ddQueueCard.isSelected[data-order-id]');
 const detail=document.querySelector('#dispatchBoardDetail .dbDetail,.ddDetail'),o=selected&&order(cardId(selected));
 if(detail&&o){let slot=detail.querySelector(':scope>.bosOpsContact');if(!slot){slot=document.createElement('div');slot.className='bosOpsContact';const anchor=detail.querySelector('.dbDetailGrid,.ddInfoGrid,.dbPanelHead');if(anchor)anchor.insertAdjacentElement('afterend',slot);else detail.appendChild(slot)}render(slot,o,true)}
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(decorate)}
window.BOS_OPS_CONTACT_STATUS={refresh:schedule};
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('bos:data-refreshed',schedule);window.addEventListener('resize',schedule);schedule();
const style=document.createElement('style');style.textContent='.bosOpsContact{min-width:0;margin-top:5px}.dbV94ListCard>.bosOpsContact{grid-column:2/-1}.dbDetail>.bosOpsContact,.ddDetail>.bosOpsContact{margin:8px 0}';document.head.appendChild(style);
})();
