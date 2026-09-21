(()=>{
'use strict';
if(window.BOS_MASTER_STATUS_COLORS_V95)return;window.BOS_MASTER_STATUS_COLORS_V95=true;
const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
function idOf(card){const raw=card?.getAttribute?.('onclick')||'',m=raw.match(/openOrder\((?:'|")([^'"]+)/);return m?m[1]:String(card?.dataset?.orderId||'')}
function cls(o){if(o?.reschedule_requested)return 'bosMasterReschedule';if(String(o?.status||'')==='Рекламация')return 'bosMasterReclamation';if(String(o?.status||'')==='Выполнена')return 'bosMasterDone';return ''}
function apply(){if(!masterMode())return;document.querySelectorAll('.bosHandsMiniCard,.masterCompactOrder').forEach(card=>{card.classList.remove('bosMasterDone','bosMasterReclamation','bosMasterReschedule');const order=(state.orders||[]).find(o=>String(o.id)===String(idOf(card))),c=cls(order);if(c)card.classList.add(c)})}
const observer=new MutationObserver(()=>requestAnimationFrame(apply));observer.observe(document.documentElement,{subtree:true,childList:true});setTimeout(apply,0);
const style=document.createElement('style');style.textContent=`.bosHandsMiniCard.bosMasterDone,.masterCompactOrder.bosMasterDone{border-color:rgba(34,197,94,.72)!important;background:rgba(34,197,94,.14)!important;box-shadow:inset 4px 0 0 #22c55e}.bosHandsMiniCard.bosMasterReclamation,.masterCompactOrder.bosMasterReclamation{border-color:rgba(239,68,68,.76)!important;background:rgba(239,68,68,.13)!important;box-shadow:inset 4px 0 0 #ef4444}.bosHandsMiniCard.bosMasterReschedule,.masterCompactOrder.bosMasterReschedule{border-color:rgba(245,158,11,.8)!important;background:rgba(245,158,11,.14)!important;box-shadow:inset 4px 0 0 #f59e0b}`;document.head.appendChild(style);
})();
