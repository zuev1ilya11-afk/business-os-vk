(()=>{
'use strict';
if(window.BOS_MASTER_ORDERS_V125_COMPAT)return;window.BOS_MASTER_ORDERS_V125_COMPAT=true;
let queued=false;
const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const orderById=id=>(state?.orders||[]).find(o=>String(o?.id)===String(id))||null;
function summary(o){
  const raw=String(o?.work||'').trim();
  const helper=window.BOS_MASTER_HOME_ORDERS_V124?.summarize;
  const compact=typeof helper==='function'?String(helper(o)||'').trim():'';
  if(compact&&compact!=='Уточнить у клиента'&&compact!=='Работы не указаны'&&compact!=='Работы указаны в карточке')return compact;
  const first=raw.split(/\n+/).map(x=>x.trim()).find(Boolean)||'';
  return first.replace(/\s+—\s+.*$/,'').trim()||'Работы не указаны';
}
function legacyClass(o){if(o?.reschedule_requested)return'bosMasterReschedule';if(String(o?.status||'')==='Рекламация')return'bosMasterReclamation';if(String(o?.status||'')==='Выполнена')return'bosMasterDone';return''}
function decorateCard(card){
  const id=String(card?.dataset?.masterOrderId||card?.dataset?.orderId||'');if(!id)return;
  const o=orderById(id);if(!o)return;
  const work=summary(o),legacy=legacyClass(o),pay=card.querySelector('.masterV125Pay b');
  const rawPay=String(pay?.textContent||'').replace(/^Выплата:\s*/,'').trim();
  const sig=JSON.stringify([id,o.status,o.reschedule_requested,work,rawPay]);
  if(card.dataset.v125CompatSig===sig)return;
  card.dataset.v125CompatSig=sig;
  card.dataset.orderId=id;
  card.classList.add('bosHandsMiniCard');
  card.classList.remove('bosMasterDone','bosMasterReclamation','bosMasterReschedule');
  if(legacy)card.classList.add(legacy);
  const workEl=card.querySelector('.masterV125Work');if(workEl&&workEl.textContent!==work)workEl.textContent=work;
  if(pay&&rawPay)pay.textContent=`Выплата: ${rawPay}`;
  if(!card.dataset.v125OpenBound){
    card.dataset.v125OpenBound='1';
    card.addEventListener('click',event=>{if(event.target?.closest?.('a,button'))return;const orderId=String(card.dataset.orderId||'');if(orderId&&typeof window.openOrder==='function')window.openOrder(orderId)});
  }
}
function decorate(){queued=false;if(!masterMode())return;document.querySelectorAll('.masterV125Card').forEach(decorateCard)}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(decorate)}
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
setTimeout(schedule,0);
window.BOS_MASTER_ORDERS_V125_COMPAT={refresh:schedule,summary};
})();
