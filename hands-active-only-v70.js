(()=>{
'use strict';
if(window.BOS_HANDS_ACTIVE_ONLY_V70)return;window.BOS_HANDS_ACTIVE_ONLY_V70=true;
const baseOpenHandsIntegration=window.openHandsIntegration;
if(typeof baseOpenHandsIntegration==='function')window.openHandsIntegration=async function(){
  const out=await baseOpenHandsIntegration.apply(this,arguments);
  setTimeout(()=>{
    const modal=document.querySelector('.modal');
    if(!modal)return;
    const buttons=[...modal.querySelectorAll('button')];
    for(const b of buttons){
      if(/выполненн/i.test(b.textContent||''))b.remove();
    }
    const syncCard=[...modal.querySelectorAll('section.card')].find(s=>/Синхронизация заказов/i.test(s.textContent||''));
    if(syncCard){
      const p=syncCard.querySelector('p#handsSyncMsg')||syncCard.querySelector('p.muted');
      if(p && !p.dataset.activeOnly){
        p.dataset.activeOnly='1';
        p.textContent='Загружаются только активные заказы Hands: без назначенного мастера или уже назначенные, но ещё не выполненные.';
      }
      const two=syncCard.querySelector('.two');
      if(two)two.style.gridTemplateColumns='1fr';
    }
  },0);
  return out;
};
const baseSync=window.syncHandsOrders;
if(typeof baseSync==='function')window.syncHandsOrders=function(){return baseSync('ACTIVE')};
})();