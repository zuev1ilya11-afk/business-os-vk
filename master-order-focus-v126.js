(()=>{
'use strict';
if(window.BOS_MASTER_ORDER_FOCUS_V126)return;
window.BOS_MASTER_ORDER_FOCUS_V126=true;
let queued=false;
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const liveMaster=()=>String(state?.user?.role||'')==='master';
const orderById=id=>(state?.orders||[]).find(o=>String(o.id)===String(id))||null;
const stageOf=o=>{if(String(o?.status||'')==='Выполнена')return'completed';if(String(o?.status||'')==='Отменена')return'cancelled';const s=String(o?.master_workflow_stage||'assigned');return s==='arrived'?'departed':['assigned','departed','started'].includes(s)?s:'assigned'};
const reportUploaded=o=>!!o?.report_uploaded_at||!!o?.report_act_url;
const reportRejected=o=>reportUploaded(o)&&String(o?.report_review_status||'pending')==='rejected';
const reportApproved=o=>String(o?.status||'')==='Выполнена'||String(o?.report_review_status||'')==='approved';
const progressed=o=>['departed','started','completed'].includes(stageOf(o))||reportUploaded(o);
const calledDone=o=>!!o?.master_called_at||progressed(o);
const agreementDone=o=>!!o?.master_agreed_at||progressed(o);
const workDone=o=>['started','completed'].includes(stageOf(o))||reportUploaded(o);
const phoneHref=v=>{let p=String(v||'').trim().replace(/[^\d+]/g,'');if(/^8\d{10}$/.test(p))p='+7'+p.slice(1);else if(/^\d{10}$/.test(p))p='+7'+p;return p};
const routeAddress=o=>{const address=String(o?.address||'').trim();if(!address)return'';const city=String(o?.city||'').trim();return city&&!address.toLowerCase().includes(city.toLowerCase())?`${city}, ${address}`:address};
const yandexRouteHref=o=>{const destination=routeAddress(o);return destination?`https://yandex.ru/maps/?mode=routes&rtext=~${encodeURIComponent(destination)}&rtt=auto`:''};
const receivedDate=v=>{const raw=String(v||'').slice(0,10),m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}.${m[2]}.${m[1]}`:(raw||'—')};
function nextStep(o){
  if(String(o?.status||'')==='Отменена')return{tone:'muted',title:'Заявка отменена',hint:'Дополнительных действий не требуется.'};
  if(reportApproved(o))return{tone:'done',title:'Заявка завершена',hint:'Отчёт принят, работа по заявке закончена.'};
  if(reportRejected(o))return{tone:'danger',title:'Исправьте отчёт',hint:o?.report_review_comment||'Отчёт вернули на доработку. Исправьте его и отправьте повторно.'};
  if(reportUploaded(o))return{tone:'waiting',title:'Отчёт на проверке',hint:'Дождитесь проверки диспетчером или руководителем.'};
  if(workDone(o))return{tone:'active',title:'Заполните отчёт',hint:'Работа отмечена начатой. После завершения прикрепите отчёт.'};
  if(agreementDone(o))return{tone:'active',title:'Начните работу',hint:'Дата и время согласованы. Когда приступите к заказу, отметьте начало работы.'};
  if(calledDone(o))return{tone:'waiting',title:'Зафиксируйте договорённость',hint:'Уточните с клиентом дату и время и сохраните договорённость.'};
  return{tone:'attention',title:'Позвоните клиенту',hint:'Свяжитесь с клиентом и после разговора отметьте выполненный звонок.'};
}
function focusHtml(o){const step=nextStep(o),phone=phoneHref(o?.phone||o?.client_phone),call=liveMaster()&&phone&&!calledDone(o)?`<a class="secondary masterV126QuickCall" href="tel:${escv(phone)}">Позвонить сейчас</a>`:'';return `<section class="masterV126Focus ${escv(step.tone)}" aria-label="Следующий шаг"><div class="masterV126FocusText"><small>СЛЕДУЮЩИЙ ШАГ</small><h3>${escv(step.title)}</h3><p>${escv(step.hint)}</p></div>${call}</section>`}
function decoratePhone(modal,o){const phone=phoneHref(o?.phone||o?.client_phone);if(!phone)return;const blocks=[...modal.querySelectorAll('.bosHandsBlock')];const clientBlock=blocks.find(x=>x.querySelector('small')&&(x.textContent||'').includes(String(o?.client||'')))||blocks.find(x=>x.querySelector('small'));if(!clientBlock)return;const old=clientBlock.querySelector('small');if(!old||old.querySelector('a'))return;const label=(old.textContent||o?.phone||o?.client_phone||'').trim();if(!label)return;old.innerHTML=`<a class="masterV126Phone" href="tel:${escv(phone)}">${escv(label)}</a>`}
function decorateRoute(modal,o,panel){const href=yandexRouteHref(o);if(!href)return;let route=modal.querySelector('.masterV149Route');if(!route){route=document.createElement('a');route.className='primary wide masterV149Route';route.target='_blank';route.rel='noopener noreferrer';route.innerHTML='<span>📍</span><span>Построить маршрут в Яндекс Картах</span>';const addressBlock=[...modal.querySelectorAll('.bosHandsBlock')].find(x=>(x.textContent||'').includes(String(o?.address||'')));if(addressBlock)addressBlock.insertAdjacentElement('afterend',route);else if(panel)panel.insertAdjacentElement('beforebegin',route);else modal.prepend(route)}route.href=href;route.setAttribute('aria-label',`Построить маршрут до адреса ${routeAddress(o)}`)}
function decorateCards(){
  document.querySelectorAll('.masterV125Card[data-master-order-id]').forEach(card=>{
    const o=orderById(card.dataset.masterOrderId);if(!o)return;
    let received=card.querySelector('.masterV126Received');
    if(!received){received=document.createElement('div');received.className='masterV126Received';const anchor=card.querySelector('.masterV125Title');if(anchor)anchor.insertAdjacentElement('afterend',received);else card.prepend(received)}
    received.innerHTML=`<span>Дата поступления</span><b>${escv(receivedDate(o?.created_at))}</b>`;
  });
}
function decorateReceivedModal(modal,o,panel){
  let received=modal.querySelector('.masterV126ReceivedModal');
  if(!received){
    received=document.createElement('div');
    received.className='masterV126Received masterV126ReceivedModal';
    const anchor=panel||modal.querySelector('.bosHandsOrder');
    if(panel)panel.insertAdjacentElement('beforebegin',received);
    else if(anchor)anchor.insertAdjacentElement('afterend',received);
    else modal.prepend(received);
  }
  received.innerHTML=`<span>Дата поступления заявки</span><b>${escv(receivedDate(o?.created_at))}</b>`;
}
function decorate(){
  queued=false;
  if(!masterMode())return;
  decorateCards();
  const modal=document.querySelector('#modalRoot .modal');
  if(!modal||modal.querySelector('#masterReportForm,#masterAgreementForm,#masterRescheduleForm'))return;
  const panel=modal.querySelector('.bosMasterWorkflow');
  const id=String(panel?.dataset?.orderId||modal.dataset?.bosWorkflowOrderId||'');
  const o=orderById(id);
  if(!o)return;
  decorateReceivedModal(modal,o,panel);
  const sig=JSON.stringify([o.id,o.status,o.master_called_at,o.master_agreed_at,o.master_workflow_stage,o.report_uploaded_at,o.report_act_url,o.report_review_status,o.report_review_comment,o.completed_at,o.phone,o.client_phone,o.created_at,o.address,o.city]);
  let focus=modal.querySelector('.masterV126Focus');
  if(!focus){focus=document.createElement('div');const anchor=panel||modal.querySelector('.bosHandsOrder');if(panel)panel.insertAdjacentElement('beforebegin',focus);else if(anchor)anchor.insertAdjacentElement('afterend',focus);else modal.prepend(focus)}
  if(focus.dataset.sig!==sig){focus.outerHTML=focusHtml(o);focus=modal.querySelector('.masterV126Focus');if(focus)focus.dataset.sig=sig}
  decoratePhone(modal,o);
  decorateRoute(modal,o,panel);
  const primary=panel?.querySelector('.mwv2Actions .primary,.bosMwActions .primary');
  panel?.querySelectorAll('.masterV126PrimaryAction').forEach(x=>x.classList.remove('masterV126PrimaryAction'));
  if(primary)primary.classList.add('masterV126PrimaryAction');
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(decorate)}
const baseOpen=window.openOrder;
if(typeof baseOpen==='function')window.openOrder=function(){const out=baseOpen.apply(this,arguments);setTimeout(schedule,30);setTimeout(schedule,180);return out};
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('resize',schedule);
setTimeout(schedule,0);
const style=document.createElement('style');style.textContent=`
.masterV126Received{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--muted,#91a3b7);font-size:12px;line-height:1.3}.masterV126Received b{color:var(--text,#f5f8fc);font-size:12px;font-weight:700;white-space:nowrap}.masterV126ReceivedModal{margin:10px 0;padding:10px 12px;border:1px solid rgba(96,165,250,.18);border-radius:12px;background:rgba(37,99,235,.06)}
.masterV126Focus{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0 2px;padding:13px 14px;border:1px solid rgba(96,165,250,.24);border-radius:14px;background:rgba(37,99,235,.09)}
.masterV126FocusText{min-width:0}.masterV126Focus small{display:block;font-size:10px;letter-spacing:.08em;color:var(--muted,#91a3b7);font-weight:800}.masterV126Focus h3{margin:3px 0 3px;font-size:17px;line-height:1.2}.masterV126Focus p{margin:0;color:var(--muted,#91a3b7);font-size:12px;line-height:1.35}.masterV126Focus.attention{border-color:rgba(245,158,11,.34);background:rgba(245,158,11,.08)}.masterV126Focus.danger{border-color:rgba(239,68,68,.34);background:rgba(239,68,68,.08)}.masterV126Focus.done{border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.08)}.masterV126Focus.muted{opacity:.82}.masterV126QuickCall{flex:0 0 auto;min-height:42px;display:flex;align-items:center;justify-content:center;text-decoration:none}.masterV126Phone{color:inherit;text-decoration:underline;text-decoration-color:rgba(96,165,250,.55);text-underline-offset:3px;font-weight:700}.masterV126PrimaryAction{box-shadow:0 0 0 2px rgba(96,165,250,.16)}
.masterV149Route{display:flex;align-items:center;justify-content:center;gap:8px;min-height:46px;margin:10px 0 12px;text-decoration:none;box-sizing:border-box}.masterV149Route span:first-child{font-size:18px}
@media(max-width:520px){.masterV126Received{font-size:11px}.masterV126Received b{font-size:11px}.masterV126ReceivedModal{padding:9px 10px}.masterV126Focus{align-items:stretch;flex-direction:column;margin-top:10px}.masterV126QuickCall{width:100%;box-sizing:border-box}.bosMasterWorkflow[data-bos-v116="1"] .mwv2Actions,.bosMasterWorkflow[data-bos-v115="1"] .mwv2Actions{position:static;bottom:auto;z-index:auto;padding:9px;margin:8px -5px 0;border:1px solid rgba(255,255,255,.09);border-radius:14px;background:rgba(12,22,34,.96);box-shadow:0 8px 26px rgba(0,0,0,.32);backdrop-filter:blur(10px)}.bosMasterWorkflow .mwv2Actions>*{min-width:0}.masterV126Focus h3{font-size:18px}.masterV149Route{width:100%}}
`;document.head.appendChild(style);
})();
