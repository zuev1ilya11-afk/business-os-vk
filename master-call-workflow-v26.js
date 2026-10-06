(()=>{
'use strict';
if(window.BOS_MASTER_CALL_WORKFLOW_V26)return;window.BOS_MASTER_CALL_WORKFLOW_V26=true;
const PROFILE_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/profile-self-api';
const CONTACT_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/master-workflow-api';
const STAGES=['assigned','departed','started','completed'];
const LABELS={assigned:'Назначена',departed:'Выехал',started:'Работа начата',completed:'Завершена',cancelled:'Отменена'};
const TIMES={departed:'master_departed_at',started:'master_started_at',completed:'completed_at'};
let sending=false;
let rendering=false;

function masterMode(){return String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode())}
function liveMaster(){return String(state?.user?.role||'')==='master'}
function masterUser(){return typeof liveMasterUser==='function'?(liveMasterUser()||state?.user||{}):(state?.user||{})}
function findOrder(id){return (state?.orders||[]).find(o=>String(o.id)===String(id))||null}
function escv(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function phoneHref(v){const raw=String(v||'').trim(),hit=raw.match(/(?:\+?7|8)?[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/);return normalizeClientPhone(hit?.[0]||raw)}
function effectiveStage(o){if(String(o?.status||'')==='Выполнена')return'completed';if(String(o?.status||'')==='Отменена')return'cancelled';const raw=String(o?.master_workflow_stage||'assigned');if(raw==='arrived')return'departed';return STAGES.includes(raw)?raw:'assigned'}
function fmt(v){if(!v)return'';const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
function timeline(o){const stage=effectiveStage(o),current=STAGES.indexOf(stage);return `<div class="bosMwSteps bosMwStepsV26">${STAGES.map((s,i)=>{const done=stage==='completed'?true:i<=current,at=fmt(o?.[TIMES[s]]);return `<div class="bosMwStep${done?' done':''}${s===stage?' current':''}"><i></i><span><b>${LABELS[s]}</b>${at?`<small>${escv(at)}</small>`:''}</span></div>`}).join('')}</div>`}
function callAction(o,stage,href,preview){if(!href||preview||!liveMaster()||['completed','cancelled'].includes(stage))return'';return `<a class="secondary bosMwCallAction" href="tel:${escv(href)}">Позвонить клиенту</a>`}
function stageAction(o,stage,preview){if(preview||!liveMaster())return'';if(stage==='assigned')return `<button type="button" class="primary bosMwStageAction" onclick="masterWorkflowSetStage('${escv(o.id)}','departed')">Выехал</button>`;if(stage==='departed')return `<button type="button" class="primary bosMwStageAction" onclick="masterWorkflowSetStage('${escv(o.id)}','started')">Работа начата</button>`;return''}
function rescheduleAction(o,stage,preview){if(preview||!liveMaster()||['completed','cancelled'].includes(stage))return'';return `<button type="button" class="secondary bosMwRescheduleAction" onclick="masterWorkflowOpenReschedule('${escv(o.id)}')">Нужно перенести</button>`}
function completeAction(o,stage,preview){if(preview||!liveMaster()||stage!=='started')return'';return `<button type="button" class="primary bosMwCompleteAction" onclick="masterWorkflowComplete('${escv(o.id)}')">Завершить и прикрепить отчёт</button>`}
function panelBody(o){const stage=effectiveStage(o),href=phoneHref(o.phone||o.client_phone),preview=masterMode()&&!liveMaster();const call=callAction(o,stage,href,preview),next=stageAction(o,stage,preview),reschedule=rescheduleAction(o,stage,preview),complete=completeAction(o,stage,preview);return `<div class="bosMwHead"><div><small>ХОД РАБОТЫ</small><h3>${escv(LABELS[stage]||stage)}</h3></div><span class="bosMwState">${escv(LABELS[stage]||stage)}</span></div>${timeline(o)}${preview?'<p class="muted bosMwPreview">В тестовом просмотре этапы не изменяются.</p>':''}${!href&&!['completed','cancelled'].includes(stage)?'<p class="muted bosMwPhoneMissing">У клиента не указан телефон.</p>':''}<div class="bosMwActions bosMwActionsV26">${call}${next}${reschedule}${complete}</div><p class="muted bosMwMsg"></p>`}
function panelSignature(o){return JSON.stringify([o?.id,effectiveStage(o),o?.status,o?.phone,o?.client_phone,o?.reschedule_requested,o?.reschedule_reason,o?.master_departed_at,o?.master_started_at,o?.completed_at,o?.master_contact_status,o?.master_contact_comment,o?.master_contact_phone,o?.master_contact_updated_at,o?.master_contact_callback_at,Array.isArray(o?.master_contact_history)?o.master_contact_history.length:0])}
function workflowModal(){const modal=document.querySelector('#modalRoot .modal');if(!modal||modal.querySelector('#masterReportForm,#masterRescheduleForm,#masterContactResultForm,#masterAgreementForm,#masterOrderAgree179Form'))return null;return modal}
function modalFor(id){const modal=workflowModal();if(!modal)return null;const marked=String(modal.dataset.bosWorkflowOrderId||'');const panel=modal.querySelector('.bosMasterWorkflow');const panelId=String(panel?.dataset?.orderId||'');if(marked&&marked!==String(id))return null;if(!marked&&panelId&&panelId!==String(id))return null;return modal}
function renderPanel(id){if(rendering||!masterMode())return;const o=findOrder(id),modal=modalFor(id);if(!o||!modal)return;rendering=true;try{modal.dataset.bosWorkflowOrderId=String(id);modal.querySelectorAll('.bosClientCallAction').forEach(x=>{if(!x.closest('.bosCompactMasterCard'))x.remove()});let panel=modal.querySelector('.bosMasterWorkflow');if(!panel){panel=document.createElement('section');panel.className='bosMasterWorkflow';const close=[...modal.querySelectorAll('button')].find(b=>(b.textContent||'').trim()==='Закрыть');if(close)modal.insertBefore(panel,close);else modal.appendChild(panel)}panel.dataset.orderId=String(id);const sig=panelSignature(o);if(panel.dataset.bosV26Sig!==sig||panel.dataset.bosV26!=='1'){panel.dataset.bosV26='1';panel.dataset.bosV26Sig=sig;panel.innerHTML=panelBody(o)}}finally{rendering=false}}
function currentModalId(){const modal=workflowModal();if(!modal)return'';return String(modal.dataset.bosWorkflowOrderId||modal.querySelector('.bosMasterWorkflow')?.dataset?.orderId||'')}
function clearWorkflowMarker(){const modal=document.querySelector('#modalRoot .modal');if(modal)delete modal.dataset.bosWorkflowOrderId}
async function authHeaders(){const h=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};return {...h,'Content-Type':'application/json'}}
async function stageCall(id,stage){const m=masterUser(),phone=String(m?.phone||'').trim();if(!phone)throw new Error('У мастера не указан телефон в профиле');const r=await fetch(PROFILE_URL,{method:'POST',headers:await authHeaders(),body:JSON.stringify({phone,district:`@@BOS_WF1@@|${id}|${stage}`}),keepalive:true}),d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось изменить этап');if(!d.order)throw new Error('Обновите заявку для проверки сохранённого этапа');return{ok:true,order:d.order}}
function mergeOrder(id,data){const i=(state.orders||[]).findIndex(o=>String(o.id)===String(id));if(i>=0)state.orders[i]={...state.orders[i],...(data||{})}}
function setMsg(id,text){const modal=modalFor(id);const el=modal?.querySelector('.bosMasterWorkflow .bosMwMsg');if(el)el.textContent=text||''}
function refreshMasterUi(id){if(id)renderPanel(id);patchLegacyLabels()}

window.masterWorkflowSetStage=async function(id,stage){if(!liveMaster()||sending)return;const o=findOrder(id);if(!o)return;const current=effectiveStage(o),expected=current==='assigned'?'departed':current==='departed'?'started':'';if(stage!==expected){setMsg(id,'Этапы нужно отмечать по порядку');return}sending=true;setMsg(id,'Сохраняем этап…');try{const d=await stageCall(id,stage);mergeOrder(id,d.order);setMsg(id,'');refreshMasterUi(id)}catch(e){setMsg(id,e?.message||String(e))}finally{sending=false}};
// A phone tap records an attempt with the exact dialed number. Successful contact is
// confirmed only after the master chooses the call result.
function normalizeClientPhone(v){
 const digits=String(v||'').replace(/\D/g,'');
 if(digits.length===10)return '+7'+digits;
 if(digits.length===11&&(digits[0]==='7'||digits[0]==='8'))return '+7'+digits.slice(1);
 return digits.length>=10&&digits.length<=15?('+'+digits):'';
}
function newAttemptId(){
 if(globalThis.crypto?.randomUUID)return crypto.randomUUID().replace(/-/g,'_');
 return 'call_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,12);
}
function pendingCall(){
 try{const raw=sessionStorage.getItem('bosPendingClientCall');if(!raw)return null;const x=JSON.parse(raw);return x&&x.id&&x.phone&&x.attempt_id?x:null}catch(_){return null}
}
function savePendingCall(x){try{sessionStorage.setItem('bosPendingClientCall',JSON.stringify(x))}catch(_){}}
function clearPendingCall(attemptId=''){if(attemptId&&pendingCall()?.attempt_id!==attemptId)return;try{sessionStorage.removeItem('bosPendingClientCall')}catch(_){}}
const contactActor=()=>JSON.stringify([state?.user?.role,state?.user?.id,state?.user?.vk_user_id,state?.user?.external_id]);
async function contactApi(action,id,payload={}){
 const who=contactActor(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
 let saved;
 try{
  const r=await fetch(CONTACT_URL,{method:'POST',headers:await authHeaders(),body:JSON.stringify({action,id,...payload}),keepalive:true,signal:controller.signal,bosReconcileBeforeRetry:true});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok||String(d.order?.id)!==String(id)){const error=new Error(d.error||'Не удалось сохранить результат звонка');error.status=r.ok?0:r.status;throw error}
  saved=d;
 }catch(error){
  // Never replay a business write. Read the exact attempt receipt after a lost response.
  if(action==='recordContactResult'&&who===contactActor()&&liveMaster()&&(!error.status||error.status>=500)&&typeof window.api==='function'){
   try{
    const data=await window.api('bootstrap');
    const order=data?.ok&&Array.isArray(data.orders)?data.orders.find(o=>String(o.id)===String(id)):null;
    const event=Array.isArray(order?.master_contact_history)?order.master_contact_history.find(x=>String(x?.id)===String(payload.attempt_id)):null;
    if(who===contactActor()&&liveMaster()&&event&&normalizeClientPhone(event.phone)===normalizeClientPhone(payload.phone)&&String(event.result)===String(payload.result)&&String(event.comment||'')===String(payload.comment||'')&&String(event.callback_at||'')===String(payload.callback_at||''))saved={ok:true,order,reconciled:true};
   }catch(_){}
  }
  if(!saved)throw error.name==='AbortError'?new Error('Ответ на сохранение не получен. Проверьте интернет и повторите проверку заявки.'):error;
 }finally{clearTimeout(timer)}
 if(who!==contactActor()||!liveMaster())throw new Error('Аккаунт изменился. Откройте заявку заново.');
 // A late phone-attempt response must not replace a newer saved call result.
 const current=findOrder(id),oldAt=Date.parse(current?.updated_at),newAt=Date.parse(saved.order.updated_at);
 if(!Number.isFinite(oldAt)||!Number.isFinite(newAt)||newAt>=oldAt)mergeOrder(id,saved.order);
 refreshMasterUi(id);return saved;
}
async function recordContactAttempt(id,phone,attemptId){
 return contactApi('recordContactAttempt',id,{phone,attempt_id:attemptId});
}
async function recordContactResult(id,phone,attemptId,result,comment,callbackAt){
 return contactApi('recordContactResult',id,{phone,attempt_id:attemptId,result,comment,callback_at:callbackAt||null});
}
function resultOptions(){
 return [
  ['no_answer','Не дозвонился','Клиент не ответил или телефон недоступен'],
  ['thinking','Клиент думает','Нужно время, чтобы определиться'],
  ['waiting_delivery','Ждёт доставку','Работы зависят от доставки товара'],
  ['call_later','Перезвонить позже','Связались, но разговор нужно продолжить позже'],
  ['agreed','Договорились','Переходим к дате и времени выезда'],
  ['other','Другое','Зафиксировать другой результат']
 ];
}
function openContactResult(pending){
 if(!liveMaster()||!pending||document.getElementById('masterContactResultForm'))return;
 const id=String(pending.id),phone=normalizeClientPhone(pending.phone),attemptId=String(pending.attempt_id||'');
 if(!id||!phone||!attemptId)return;
 const o=findOrder(id);if(!o)return;
 const options=resultOptions().map(([value,title,hint])=>`<label class="bosContactResultChoice"><input type="radio" name="result" value="${escv(value)}"><span><b>${escv(title)}</b><small>${escv(hint)}</small></span></label>`).join('');
 openModal(`<div class="bosContactResult"><h2>Как прошёл звонок?</h2><p class="muted">Номер: <b>${escv(phone)}</b></p><form id="masterContactResultForm" class="form"><div class="bosContactResultChoices">${options}</div><p class="bosContactSelection" role="status" aria-live="polite">Выберите итог звонка</p><label>Комментарий <span class="muted">(необязательно)</span></label><textarea name="comment" maxlength="500" rows="3" placeholder="Например: клиент уточняет дату доставки"></textarea><div class="bosContactCallback" hidden><label>Когда перезвонить</label><input type="datetime-local" name="callback_at"></div><button type="submit" class="primary wide" disabled>Сохранить итог</button><button type="button" class="secondary wide bosContactLater">Заполнить позже</button><p class="muted bosContactResultMsg" role="status"></p></form></div>`);
 const form=document.getElementById('masterContactResultForm');if(!form)return;
 const submit=form.querySelector('[type=submit]'),callback=form.querySelector('.bosContactCallback'),msg=form.querySelector('.bosContactResultMsg');
 let saving=false;
 const who=contactActor();
 function refreshForm(){
  const result=String(form.elements.result?.value||'');
  form.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=saving);
  submit.disabled=saving||!result;
  form.setAttribute('aria-busy',String(saving));
  callback.hidden=result!=='call_later';
  form.querySelectorAll('.bosContactResultChoice').forEach(row=>row.classList.toggle('is-selected',row.querySelector('input').checked));
  const label=resultOptions().find(x=>x[0]===result)?.[1];
  form.querySelector('.bosContactSelection').textContent=label?'Выбрано: '+label:'Выберите итог звонка';
 }
 form.addEventListener('change',refreshForm);refreshForm();
 form.querySelector('.bosContactLater').onclick=()=>{if(saving)return;clearPendingCall(attemptId);closeModal();window.openOrder?.(id)};
 form.onsubmit=async event=>{
  event.preventDefault();if(sending||saving||who!==contactActor()||!liveMaster())return;
  const result=String(form.elements.result?.value||''),comment=String(form.elements.comment?.value||'').trim();
  if(!result){msg.textContent='Выберите итог звонка';return}
  if(result==='other'&&!comment){msg.textContent='Для варианта «Другое» добавьте комментарий';form.elements.comment.focus();return}
  let callbackAt='';if(result==='call_later'&&form.elements.callback_at?.value){const d=new Date(form.elements.callback_at.value);if(!Number.isNaN(d.getTime()))callbackAt=d.toISOString();}
  sending=true;saving=true;refreshForm();msg.textContent='Сохраняем…';
  try{
   await recordContactResult(id,phone,attemptId,result,comment,callbackAt);clearPendingCall(attemptId);
   if(!form.isConnected||who!==contactActor())return;
   closeModal();
   if(result==='agreed'&&typeof window.masterOrderAgree179==='function')window.masterOrderAgree179(id);
   else window.openOrder?.(id);
  }catch(error){if(form.isConnected)msg.textContent=error?.message||String(error)}
  finally{sending=false;saving=false;if(form.isConnected)refreshForm()}
 };
}
window.openMasterContactResultForOrder=function(id){
 const o=findOrder(id),items=window.BOS_CONTACT_STATUS?.history?.(o)||[];
 const event=[...items].reverse().find(x=>String(x?.result||'')==='pending');
 if(!event)return;
 openContactResult({id:String(id),phone:event.phone,attempt_id:event.id,started_at:Date.now()-1000});
};
function callOrderId(link){
  const host=link?.closest?.('[data-master-order-id],[data-order-id]');
  const direct=host?.dataset?.masterOrderId||host?.dataset?.orderId;
  if(direct)return String(direct);
  const clickable=link?.closest?.('[onclick*="openOrder"]');
  const match=String(clickable?.getAttribute?.('onclick')||'').match(/openOrder\(['"]([^'"]+)/);
  return match?String(match[1]):currentModalId();
}
function recordAndDial(link,id='',shouldDial=true){
  const dial=String(link?.getAttribute?.('href')||''),phone=normalizeClientPhone(dial);
  if(!dial||!phone)return false;
  const orderId=String(id||callOrderId(link)||'');if(!orderId)return false;
  const pending={id:orderId,phone,attempt_id:newAttemptId(),started_at:Date.now()};
  if(liveMaster()){
    savePendingCall(pending);
    Promise.resolve(recordContactAttempt(orderId,phone,pending.attempt_id)).catch(()=>{});
  }
  if(shouldDial)window.location.href=dial;
  else setTimeout(()=>openContactResult(pending),120);
  setTimeout(()=>{const p=pendingCall();if(p&&document.visibilityState==='visible'&&Date.now()-Number(p.started_at||0)>900)openContactResult(p)},1200);
  return false;
}
window.masterWorkflowCallAndAdvance=function(event,id){if(event?.preventDefault)event.preventDefault();return recordAndDial(event?.currentTarget,id,event?.isTrusted!==false)};
document.addEventListener('click',event=>{
  if(!liveMaster())return;
  const link=event.target?.closest?.('a[href^="tel:"]');
  if(!link||link.dataset.bosCallTracked==='1')return;
  const id=callOrderId(link);if(!id)return;
  event.preventDefault();link.dataset.bosCallTracked='1';
  try{recordAndDial(link,id,event.isTrusted!==false)}finally{setTimeout(()=>delete link.dataset.bosCallTracked,500)}
},true);
function maybePromptPending(){
 const p=pendingCall();if(!p||!liveMaster()||document.visibilityState!=='visible'||Date.now()-Number(p.started_at||0)<500)return;
 if(document.getElementById('masterContactResultForm'))return;
 openContactResult(p);
}
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState!=='visible'||!liveMaster())return;
 const after=()=>{maybePromptPending();const id=currentModalId();if(id)refreshMasterUi(id)};
 if(typeof reloadData==='function')Promise.resolve(reloadData(true)).catch(()=>{}).finally(after);else after();
});
window.addEventListener('focus',()=>setTimeout(maybePromptPending,350));
window.masterWorkflowOpenReschedule=function(id){if(typeof window.openMasterRescheduleForm!=='function'){setMsg(id,'Форма переноса временно недоступна');return}clearWorkflowMarker();window.openMasterRescheduleForm(id);setTimeout(()=>{const form=document.getElementById('masterRescheduleForm');if(!form)return;const buttons=[...form.querySelectorAll('button')];const back=buttons.find(b=>(b.textContent||'').includes('Назад'));if(back){back.textContent='Назад к заявке';back.onclick=()=>window.openOrder?.(id)}},0)};
const previousComplete=window.masterWorkflowComplete;
window.masterWorkflowComplete=function(id){if(!liveMaster())return;clearWorkflowMarker();if(typeof window.openMasterReportForm==='function')return window.openMasterReportForm(id);return typeof previousComplete==='function'?previousComplete(id):undefined};

const baseOpen=window.openOrder;
if(typeof baseOpen==='function')window.openOrder=function(id){const out=baseOpen.apply(this,arguments);if(masterMode()){setTimeout(()=>renderPanel(id),20);setTimeout(()=>renderPanel(id),150)}return out};

function patchLegacyLabels(){
  if(masterMode())document.querySelectorAll('.bosMwTodayCard').forEach(card=>{const m=String(card.getAttribute('onclick')||'').match(/openOrder\(['"]([^'"]+)/);if(!m)return;const o=findOrder(m[1]),chip=card.querySelector('.bosMwTodayStage');if(!o||!chip)return;const text=LABELS[effectiveStage(o)]||effectiveStage(o);if(chip.textContent!==text)chip.textContent=text});
  const bar=document.querySelector('.bosFieldOpsBar');if(bar){const date=document.getElementById('dispatchBoardDate')?.value||'';const road=(state.orders||[]).filter(o=>(!date||String(o?.scheduled_date||'').slice(0,10)===date)&&effectiveStage(o)==='departed').length;bar.querySelectorAll('span').forEach(s=>{const t=(s.textContent||'').trim();if(t.startsWith('На месте:'))s.remove();else if(t.startsWith('В дороге:')){const next=`В дороге: ${road}`;if(s.textContent!==next)s.textContent=next}})}
  document.querySelectorAll('[data-order-id].dbOrderCard,[data-order-id].dbV23Card,[data-order-id].dbV24Card').forEach(card=>{const o=findOrder(card.dataset.orderId),chip=card.querySelector('.bosFieldStageChip');if(o&&chip&&String(o.master_workflow_stage||'')==='arrived'&&chip.textContent!=='В дороге')chip.textContent='В дороге'});
}
function enhance(){patchLegacyLabels();const id=currentModalId();if(id)renderPanel(id)}
let queued=false;const obs=new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance()})});obs.observe(document.documentElement,{childList:true,subtree:true});
setTimeout(enhance,0);

const style=document.createElement('style');style.textContent=`
.bosContactResult h2{margin-bottom:4px}.bosContactResultChoices{display:grid;gap:7px;margin:8px 0 12px}.bosContactResultChoice{display:grid;grid-template-columns:20px minmax(0,1fr);gap:9px;align-items:start;padding:10px;border:1px solid rgba(127,127,127,.17);border-radius:12px;background:rgba(127,127,127,.035);cursor:pointer}#masterContactResultForm .bosContactResultChoice{grid-template-columns:22px minmax(0,1fr);gap:11px;min-height:60px;box-sizing:border-box;align-items:center;touch-action:manipulation}
#masterContactResultForm .bosContactResultChoice input[type="radio"]{-webkit-appearance:none!important;appearance:none!important;display:block!important;position:static!important;width:22px!important;height:22px!important;min-width:22px!important;max-width:22px!important;min-height:22px!important;max-height:22px!important;padding:0!important;margin:0!important;border:2px solid #8398b0!important;border-radius:50%!important;background:#0c1827!important;box-shadow:none!important;cursor:pointer}
#masterContactResultForm .bosContactResultChoice input[type="radio"]:checked{border-color:#72b7ff!important;background:radial-gradient(circle,#72b7ff 0 5px,#0c1827 6px)!important}
#masterContactResultForm .bosContactResultChoice.is-selected{border-color:#72b7ff;background:#14375a;box-shadow:inset 0 0 0 1px #72b7ff}
#masterContactResultForm .bosContactResultChoice:focus-within{outline:2px solid #9dccff;outline-offset:2px}
#masterContactResultForm .bosContactResultChoice span{min-width:0;overflow-wrap:anywhere}
#masterContactResultForm .bosContactSelection{font-size:13px;color:#9dccff;margin:0 0 8px}
#masterContactResultForm .bosContactCallback[hidden]{display:none!important}
#masterContactResultForm[aria-busy="true"] .bosContactResultChoice{cursor:wait}
#masterContactResultForm .bosContactResultChoice input:disabled{cursor:wait}.bosContactResultChoice span{display:grid;gap:2px}.bosContactResultChoice b{font-size:13px}.bosContactResultChoice small{font-size:11px;line-height:1.35;color:var(--muted,#91a3b7)}.bosContactCallback{margin-top:2px}.bosContactResult textarea{resize:vertical;min-height:78px}
.bosMasterWorkflow[data-bos-v26="1"] .bosMwStepsV26{grid-template-columns:repeat(4,1fr)}.bosMasterWorkflow[data-bos-v26="1"] .bosMwActionsV26{grid-template-columns:repeat(2,minmax(0,1fr))}.bosMasterWorkflow[data-bos-v26="1"] .bosMwActionsV26>*{display:flex;align-items:center;justify-content:center;min-height:44px;box-sizing:border-box;text-decoration:none}.bosMasterWorkflow[data-bos-v26="1"] .bosMwCompleteAction{grid-column:1/-1}.bosMasterWorkflow[data-bos-v26="1"] .bosMwPhoneMissing{margin:8px 0}.bosMasterWorkflow[data-bos-v26="1"] .bosMwRescheduleAction{border-color:rgba(217,119,6,.45)}@media(max-width:520px){.bosMasterWorkflow[data-bos-v26="1"] .bosMwActionsV26{grid-template-columns:1fr}.bosMasterWorkflow[data-bos-v26="1"] .bosMwCompleteAction{grid-column:auto}}
`;document.head.appendChild(style);
})();
