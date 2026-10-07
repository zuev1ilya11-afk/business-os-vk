(()=>{
'use strict';
if(window.BOS_MASTER_ORDER_ACTIONS_V179){if(typeof window.BOS_MASTER_ORDER_ACTIONS_V179_REFRESH==='function')setTimeout(window.BOS_MASTER_ORDER_ACTIONS_V179_REFRESH,0);return}
window.BOS_MASTER_ORDER_ACTIONS_V179=true;
const API_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/master-workflow-api';
let busy=false,queued=false;
const uncertain=new Set(),messages=new Map();
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const liveMaster=()=>String(state?.user?.role||'')==='master';
const masterMode=()=>liveMaster()||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const orderById=id=>(state?.orders||[]).find(o=>String(o.id)===String(id))||null;
const active=o=>o&&!['Выполнена','Отменена'].includes(String(o.status||''));
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10);
const timeOf=o=>String(o?.scheduled_time||o?.time_slot||'').slice(0,5);
const hasSchedule=o=>!!dateOf(o)&&!!timeOf(o);
const stageOf=o=>{if(String(o?.status||'')==='Выполнена')return'completed';if(String(o?.status||'')==='Отменена')return'cancelled';const s=String(o?.master_workflow_stage||'assigned');return s==='arrived'?'departed':['assigned','departed','started'].includes(s)?s:'assigned'};
const reportUploaded=o=>!!o?.report_uploaded_at||['pending','approved'].includes(String(o?.report_review_status||''));
const reportRejected=o=>String(o?.report_review_status||'')==='rejected';
const reportApproved=o=>String(o?.status||'')==='Выполнена'||String(o?.report_review_status||'')==='approved';
const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
async function authHeaders(){const h=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};return {...h,'Content-Type':'application/json'}}
async function api(action,id,payload={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),['setAgreementSchedule','confirmAgreement'].includes(action)?25000:20000);
 try{const r=await fetch(API_URL,{method:'POST',headers:await authHeaders(),body:JSON.stringify({action,id,...payload}),signal:controller.signal,bosReconcileBeforeRetry:true});const d=await r.json();if(!r.ok||!d.ok||!d.order){const e=new Error(d.message||d.error||'Не удалось подтвердить сохранение');e.status=r.status;throw e}return d}finally{clearTimeout(timer)}
}
function mergeOrder(id,data){const i=(state?.orders||[]).findIndex(o=>String(o.id)===String(id));if(i>=0)state.orders[i]={...state.orders[i],...(data||{})}}
function currentPanel(){return document.querySelector('#modalRoot .bosMasterWorkflow')}
function message(id,text){messages.set(String(id),text||'');const panel=currentPanel();if(String(panel?.dataset?.orderId||'')!==String(id))return;const el=panel.querySelector('.moa179Msg');if(el)el.textContent=text||''}
const workConfirmed=o=>stageOf(o)==='started'||!!o.master_started_at||reportUploaded(o)||reportRejected(o);
const departConfirmed=o=>['departed','started'].includes(stageOf(o))||!!o.master_departed_at||!!o.master_arrived_at||workConfirmed(o);
const confirmedCount=o=>reportRejected(o)?3:reportUploaded(o)?4:workConfirmed(o)?3:departConfirmed(o)?2:1;
function actualTime(value){if(!value)return'';const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
function actionButton(label,kind,enabled,done,onclick){return `<button type="button" class="moa179Action primary ${kind}" ${enabled&&!busy&&!uncertain.has(String(currentPanel()?.dataset.orderId))?`onclick="${onclick}"`:'disabled'}>${escv(busy?'Сохраняем…':label)}</button>`}
function scheduledActions(o,preview){
 if(stageOf(o)==='cancelled')return '<section class="moa179StageCard"><h3>Прогресс выполнения заявки</h3><p class="moa179Cancelled">⊘ Заявка отменена. Выполнение остановлено.</p></section>';
 const n=confirmedCount(o),canWrite=liveMaster()&&!preview&&active(o),ready=hasSchedule(o)||n>1;
 const rows=[['Заявка назначена',null,''],['Выехал',o.master_departed_at||o.master_arrived_at,'Подтвердите, когда отправитесь к клиенту.'],['Начал работу',o.master_started_at,'Подтвердите начало работ на объекте.'],['Отправить отчёт',reportRejected(o)?null:o.report_uploaded_at,'Приложите акт и фотографии в отчёте.']];
 const labels=['','Подтвердить: выехал','Подтвердить: начал работу',reportRejected(o)?'Исправить отчёт':'Отправить отчёт'];
 const handlers=['',`masterOrderStage179('${escv(o.id)}','departed')`,`masterOrderStage179('${escv(o.id)}','started')`,`masterOrderReport179('${escv(o.id)}')`];
 return `<section class="moa179StageCard"><h3>Прогресс выполнения заявки</h3><div class="moa179ProgressLabel"><b>Завершено ${n} из 4</b><span>${n*25}%</span></div><div class="moa179Progress" role="progressbar" aria-label="Подтверждённый прогресс" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${n*25}"><i style="width:${n*25}%"></i></div><ol class="moa179Steps">${rows.map(([title,at,hint],i)=>{const done=i<n,current=i===n&&active(o)&&ready,t=done?actualTime(at):'';return `<li class="moa179Step ${done?'done':current?'current':'future'}" ${current?'aria-current="step"':''}><span class="moa179StepIcon" aria-hidden="true">${done?'✓':current?'→':'○'}</span><div><b>${escv(title)}</b>${done&&t?`<small>${escv(t)}</small>`:current?'<small>Текущий этап</small>':''}${current?`${actionButton(labels[i],i===1?'depart':i===2?'start':'report',canWrite,false,handlers[i])}`:''}</div></li>`}).join('')}</ol>${n===4?`<div class="moa179Review ${o.report_review_status==='approved'?'approved':''}"><b>${o.report_review_status==='approved'?'Отчёт принят':'Отчёт отправлен — ожидает проверки'}</b><span>${o.report_review_status==='approved'?'Повторная отправка не требуется.':'Действия мастера завершены. Приёмка выполняется отдельно.'}</span></div>`:''}</section>`;
}
function agreementHint(o,preview){
 if(preview||!liveMaster())return 'В режиме просмотра подтверждение недоступно.';
 if(busy)return 'Сохраняем изменения. Дождитесь подтверждения.';
 if(uncertain.has(String(o.id)))return 'Сохранение не подтверждено. Нажмите «Проверить состояние».';
 const reasons={no_answer:'Клиент не ответил. Свяжитесь повторно и согласуйте выезд.',waiting_delivery:'Клиент ждёт доставку. Подтверждение доступно после согласования выезда.',thinking:'Клиент обдумывает предложение. Подтвердите после согласования выезда.',call_later:'Клиент попросил перезвонить. Согласуйте выезд при следующем звонке.',pending:'Итог звонка ещё не зафиксирован. Укажите итог «Договорились» после согласования.',other:'Согласование с клиентом не подтверждено. Уточните условия и зафиксируйте итог «Договорились».'};
 if(reasons[o.master_contact_status])return reasons[o.master_contact_status];
 if(!o.master_called_at)return 'Сначала свяжитесь с клиентом и зафиксируйте звонок.';
 return 'Подтверждение доступно после согласования выезда и итога «Договорились».';
}
function contactBlock(o,preview){
 const disabled=preview||!liveMaster()||busy||uncertain.has(String(o.id));
 // New journal entries require explicit "agreed"; legacy orders without a journal stay compatible.
 const status=preview?(window.BOS_CONTACT_STATUS?.html(o,{details:true})||''):'';
 const contactStatus=String(o?.master_contact_status||''),canAgree=!contactStatus||contactStatus==='agreed';
 if(!active(o))return status;
 return `${status}${confirmedCount(o)>=3?'':o.master_agreed_at?'<small>✓ Время согласовано</small>':hasSchedule(o)?`<button type="button" class="secondary" ${disabled||!o.master_called_at||!canAgree?'disabled':`onclick="masterOrderContact179('${escv(o.id)}','confirmAgreement')"`}>Подтвердить договорённость</button>${disabled||!o.master_called_at||!canAgree?`<small class="moa179AgreementHint">${escv(agreementHint(o,preview))}</small>`:''}`:''}`;
}
function unscheduledActions(o,preview){if(!active(o))return '<section class="moa179StageCard"><h3>Этапы выполнения заявки</h3><p class="moa179Hint">Заявка закрыта. Действия недоступны.</p></section>';const disabled=preview||!liveMaster();return `<section class="moa179StageCard"><h3>Этапы выполнения заявки</h3><button type="button" class="moa179Action agree" ${disabled?'disabled':`onclick="masterOrderAgree179('${escv(o.id)}')"`}><span class="moa179Icon">▣</span><span>Договориться</span><b>›</b></button><p class="moa179Hint">Согласуйте с клиентом дату и время. После сохранения заявка перейдёт в рабочий сценарий мастера.</p></section>`}
function rescheduleBlock(o,preview){if(!active(o))return'';const disabled=preview||!liveMaster()||busy;return `<section class="moa179Reschedule"><div><b>Перенос заявки</b><span>Требует подтверждения диспетчера или руководителя</span></div><button type="button" class="secondary wide" ${disabled?'disabled':`onclick="masterWorkflowOpenReschedule('${escv(o.id)}')"`}>Запросить перенос</button></section>`}
function rejectionNotice(o){return active(o)&&reportRejected(o)?`<div class="moa179Review rejected"><b>Отчёт на доработке</b><span>${escv(o.report_review_comment||'Уточните причину у диспетчера.')}</span><span>Исправьте отчёт. Повторно отмечать выезд и начало работы не нужно.</span></div>`:''}
function approvalNotice(o){return String(o?.report_review_status||'')==='approved'&&String(o?.status||'')!=='Отменена'?'<div class="moa179Review approved"><b>Отчёт принят</b><span>Повторно отправлять отчёт не требуется.</span></div>':''}
function panelHtml(o){const preview=masterMode()&&!liveMaster(),heading=String(o?.status||'')==='Выполнена'?'ЗАЯВКА ВЫПОЛНЕНА':String(o?.status||'')==='Отменена'?'ЗАЯВКА ОТМЕНЕНА':hasSchedule(o)?'ЗАЯВКА НАЗНАЧЕНА':'БЕЗ ДАТЫ И ВРЕМЕНИ';return `<span class="mwv2Head moa179Compat" hidden></span>${!active(o)?`<div class="moa179Head"><b>${escv(heading)}</b></div>`:''}${rejectionNotice(o)}${scheduledActions(o,preview)}${!hasSchedule(o)&&active(o)&&confirmedCount(o)===1?unscheduledActions(o,preview):''}${rescheduleBlock(o,preview)}${preview?'<p class="muted">В режиме просмотра действия недоступны.</p>':''}<p class="muted moa179Msg" role="status" aria-live="polite">${escv(messages.get(String(o.id))||'')}</p>${uncertain.has(String(o.id))?`<button type="button" class="secondary wide" ${busy?'disabled':''} onclick="masterOrderRefresh179('${escv(o.id)}')">Проверить состояние</button>`:''}`}

function decorate(){queued=false;if(!masterMode())return;document.querySelectorAll('#modalRoot .bosMasterAgreementModalBtn').forEach(x=>x.remove());const panel=currentPanel();if(!panel||document.querySelector('#masterReportForm,#masterRescheduleForm,#masterAgreementForm,#masterOrderAgree179Form'))return;const id=String(panel.dataset.orderId||document.querySelector('#modalRoot .modal')?.dataset?.bosWorkflowOrderId||''),o=orderById(id);if(!o)return;const sig=JSON.stringify([busy,uncertain.has(String(o.id)),messages.get(String(o.id)),o.master_staff_id,o.master_contact_status,o.master_called_at,o.master_called_by_staff_id,o.master_called_by_name,o.master_agreed_at,o.master_arrived_at,o.id,o.status,o.scheduled_date,o.scheduled_time,o.time_slot,o.master_workflow_stage,o.master_departed_at,o.master_started_at,o.report_uploaded_at,o.report_act_url,o.report_review_status,o.report_review_comment]);const contact=document.querySelector('#modalRoot .bosMasterClientActions');if(contact&&contact.dataset.sig!==sig){contact.dataset.sig=sig;contact.innerHTML=contactBlock(o,masterMode()&&!liveMaster())}if(panel.dataset.moa179Sig===sig&&panel.dataset.bosV179==='1'&&panel.querySelector('.moa179StageCard'))return;panel.dataset.moa179Sig=sig;panel.dataset.bosV179='1';panel.innerHTML=panelHtml(o)}
function schedule(){if(queued)return;queued=true;setTimeout(decorate,0)}
async function reconcile(id){
 // Reuse the existing authorized bootstrap, including assignment changes/removal.
 if(typeof reloadData!=='function')throw new Error('Обновление недоступно');
 await reloadData(true);uncertain.delete(String(id));
 if(!orderById(id)){closeModal();return false}return true;
}
window.masterOrderRefresh179=async function(id){if(busy)return;busy=true;decorate();try{await reconcile(id);message(id,'Данные обновлены. Проверьте текущий этап.')}catch(_){message(id,'Не удалось обновить заявку. Проверьте интернет и нажмите «Проверить состояние».')}finally{busy=false;decorate()}};
async function saveAction(id,action,payload={}){
 if(busy||!liveMaster()||uncertain.has(String(id)))return;
 busy=true;message(id,'Сохраняем…');decorate();
 try{const d=await api(action,id,payload);mergeOrder(id,d.order);message(id,'')}
 catch(err){
   uncertain.add(String(id));message(id,'Проверяем состояние заявки…');
   try{const exists=await reconcile(id);if(exists)message(id,payload.stage&&((payload.stage==='departed'&&departConfirmed(orderById(id)))||(payload.stage==='started'&&workConfirmed(orderById(id))))?'Этап подтверждён сервером.':(err.status===409||err.status===403?err.message:'Не удалось сохранить действие. Можно повторить.'))}
   catch(_){message(id,'Результат сохранения неизвестен. Проверьте интернет и нажмите «Проверить состояние».')}
 }finally{busy=false;decorate()}
}
window.masterOrderStage179=async function(id,stage){const o=orderById(id);if(!o||!active(o)||!hasSchedule(o))return;const n=confirmedCount(o),expected=n===1?'departed':n===2?'started':'';if(stage!==expected){message(id,'Этапы нужно отмечать по порядку');return}return saveAction(id,'setStage',{stage})};
window.masterOrderContact179=(id,action)=>['markCalled','confirmAgreement'].includes(action)?saveAction(id,action,action==='markCalled'?{contact_confirmed:true}:{}):undefined;
window.masterOrderReport179=function(id){const o=orderById(id);if(!liveMaster()||busy||uncertain.has(String(id))||!active(o)||confirmedCount(o)!==3)return;return window.masterWorkflowComplete?.(id)};
window.masterOrderAgree179=function(id){
 const o=orderById(id);if(!o||!liveMaster()||!active(o))return;
 const contactStatus=String(o?.master_contact_status||'');
 if(contactStatus==='pending'){
  const pending=[...(Array.isArray(o?.master_contact_history)?o.master_contact_history:[])].reverse().find(x=>String(x?.result||'')==='pending');
  if(pending&&typeof window.openMasterContactResultForOrder==='function'){window.openMasterContactResultForOrder(id);return}
  message(id,'Сначала укажите итог звонка.');return;
 }
 if(!o.master_called_at||(contactStatus&&contactStatus!=='agreed')){message(id,'Сначала свяжитесь с клиентом и выберите итог «Договорились».');return}
 openModal(`<h2>Согласовать дату и время</h2><p class="muted">Договоритесь с клиентом и укажите согласованные дату и время.</p><form id="masterOrderAgree179Form" class="form"><label>Дата *</label><input type="date" name="scheduled_date" required min="${localToday()}" value="${escv(dateOf(o))}"><label>Время *</label><input type="time" name="scheduled_time" required step="900" value="${escv(timeOf(o))}"><div class="moa179AgreementContact"></div><p class="muted">После сохранения заявка перейдёт в рабочий сценарий мастера.</p><button type="submit" class="primary wide">Сохранить</button><button type="button" class="secondary wide" onclick="openOrder('${escv(o.id)}')">Отмена</button><p id="masterOrderAgree179Msg" class="muted" role="status"></p></form>`);
 const form=document.getElementById('masterOrderAgree179Form');if(!form)return;
 const msg=form.querySelector('#masterOrderAgree179Msg'),contact=form.querySelector('.moa179AgreementContact'),submit=form.querySelector('[type=submit]');
 const actorKey=()=>JSON.stringify([state?.user?.role,state?.user?.id,state?.user?.vk_user_id,state?.user?.external_id]),who=actorKey();
 function refreshContact(){
  const current=orderById(id)||o,status=String(current?.master_contact_status||''),canAgree=!status||status==='agreed';submit.disabled=busy||!current.master_called_at||!canAgree;
  contact.innerHTML=current.master_called_at&&canAgree?'':'<small class="muted">Сначала свяжитесь с клиентом и выберите итог «Договорились».</small>';
 }
 refreshContact();
 form.onsubmit=async e=>{
  e.preventDefault();if(busy||state.busy||!liveMaster()||who!==actorKey())return;
  const current=orderById(id)||o,status=String(current?.master_contact_status||'');if(!current.master_called_at||(status&&status!=='agreed')){msg.textContent='Сначала свяжитесь с клиентом и выберите итог «Договорились».';return}
  const date=String(form.elements.scheduled_date.value||''),time=String(form.elements.scheduled_time.value||'').slice(0,5);
  if(!date||!time){msg.textContent='Укажите дату и время';return}
  busy=true;state.busy=true;if(typeof setBusy==='function')setBusy(form,true);msg.textContent='Сохраняем…';
  let saved=null;
  try{const d=await api('setAgreementSchedule',id,{scheduled_date:date,scheduled_time:time});if(String(d.order?.id)===String(id))saved=d.order}
  catch(err){
   if(form.isConnected)msg.textContent='Проверяем, сохранились ли дата и время…';
   if(who===actorKey()&&liveMaster()&&(!err.status||err.status>=500)&&typeof window.api==='function'){
    try{
     const data=await window.api('bootstrap');
     const fresh=data?.ok&&Array.isArray(data.orders)?data.orders.find(x=>String(x.id)===String(id)):null;
     if(fresh&&active(fresh)&&fresh.master_agreed_at&&dateOf(fresh)===date&&timeOf(fresh)===time)saved=fresh;
    }catch(_){}
   }
   if(!saved&&form.isConnected)msg.textContent=err?.name==='AbortError'?'Ответ на сохранение не получен. Проверьте интернет и повторите проверку заявки.':err?.message||String(err);
  }
  finally{busy=false;state.busy=false;if(form.isConnected){if(typeof setBusy==='function')setBusy(form,false);refreshContact()}}
  if(saved&&who===actorKey()&&liveMaster()){mergeOrder(id,saved);if(form.isConnected){closeModal();window.openOrder?.(id)}}
 };
};
window.openMasterAgreement=window.masterOrderAgree179;
const baseOpen=window.openOrder;if(typeof baseOpen==='function')window.openOrder=function(){const out=baseOpen.apply(this,arguments);setTimeout(decorate,40);setTimeout(decorate,180);return out};
window.BOS_MASTER_ORDER_ACTIONS_V179_REFRESH=decorate;
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
setTimeout(decorate,0);
const style=document.createElement('style');style.textContent=`.bosMasterWorkflow[data-bos-v179="1"]{padding:12px!important}.bosMasterWorkflow[data-bos-v179="1"] .moa179Compat{display:none!important}.bosMasterWorkflow[data-bos-v179="1"] .moa179Head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.moa179Head small{font-size:10px;font-weight:800;letter-spacing:.06em;color:var(--muted,#91a3b7)}.moa179Head b{font-size:12px}.moa179StageCard,.moa179Reschedule{border:1px solid rgba(127,127,127,.17);border-radius:14px;padding:12px;background:rgba(127,127,127,.035)}.moa179StageCard h3{margin:0 0 10px}.moa179Steps{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:8px}.moa179Step{display:grid;grid-template-columns:25px minmax(0,1fr);gap:10px;padding:10px;border-radius:12px;min-width:0}.moa179Step>div{min-width:0}.moa179Step b,.moa179Step small{display:block;overflow-wrap:anywhere}.moa179Step small{font-size:11px;color:#9cb2c9;margin-top:4px}.moa179Step p{font-size:12px;line-height:1.45;margin:10px 0;color:#bbcee3}.moa179Step.current{background:#102b4e;border:1px solid #3488e7}.moa179Step.future{color:#9aadc2}.moa179Step.done .moa179StepIcon{color:#73b5ff}.moa179StepIcon{font-size:19px}.moa179ProgressLabel{display:flex;justify-content:space-between;gap:8px;margin:15px 0 8px;font-size:12px}.moa179Progress{height:6px;border-radius:9px;background:#23364d;overflow:hidden}.moa179Progress i{display:block;height:100%;background:#3488ff}.moa179Contact{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:14px;font-size:12px}.moa179Contact>b{width:100%}.moa179Contact .secondary{min-height:44px;display:flex;align-items:center;justify-content:center;text-decoration:none;white-space:normal}.moa179Cancelled{color:#ffb5b5;line-height:1.5}.moa179StageCard,.moa179Reschedule,.moa179Contact{min-width:0;overflow-wrap:anywhere}.moa179StageCard h3{font-size:17px;line-height:1.3}.moa179Steps .moa179Action{display:block;padding:12px 10px;white-space:normal;line-height:1.35;overflow-wrap:anywhere;font-size:14px;height:auto}.moa179ProgressLabel span{color:#7eb9ff}.moa179Action{width:100%;min-height:52px;border:0;border-radius:12px;padding:0 14px;display:grid;grid-template-columns:28px 1fr auto;gap:9px;align-items:center;text-align:left;font-weight:800;font-size:15px;background:#1677ff;color:#fff}.moa179Action:not(:disabled){cursor:pointer}.moa179Action:disabled{opacity:.42;cursor:not-allowed}.moa179Action.done{opacity:.72;background:rgba(22,119,255,.45)}.moa179Action.done b{font-size:11px}.moa179Action.agree{margin-top:4px}.moa179Icon{font-size:17px;text-align:center}.moa179AgreementHint{display:block;flex-basis:100%;font-size:12px;line-height:1.4;color:var(--muted,#91a3b7)}.moa179Hint{margin:9px 2px 0;color:var(--muted,#91a3b7);font-size:12px;line-height:1.4}.moa179Reschedule{margin-top:10px}.moa179Reschedule>div{display:grid;gap:3px;margin-bottom:9px}.moa179Reschedule>div span{font-size:12px;color:var(--muted,#91a3b7)}.moa179Reschedule button{min-height:44px}.moa179Review{display:grid;gap:3px;margin-top:10px;padding:9px 10px;border-radius:10px;background:rgba(37,99,235,.08);font-size:12px}.moa179Review.rejected{background:rgba(220,38,38,.09)}@media(max-width:520px){.moa179Head{align-items:flex-start!important;flex-direction:column}.moa179Action{min-height:50px}}`;document.head.appendChild(style);
})();
