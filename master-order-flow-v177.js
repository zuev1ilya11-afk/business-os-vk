(()=>{
'use strict';
if(window.BOS_MASTER_ORDER_FLOW_V177)return;
window.BOS_MASTER_ORDER_FLOW_V177=true;

const API_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/master-workflow-api';
let busy=false,queued=false,expandedHomeId='';
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const liveMaster=()=>String(state?.user?.role||'')==='master';
const masterMode=()=>liveMaster()||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const orderById=id=>(state?.orders||[]).find(o=>String(o.id)===String(id))||null;
const active=o=>o&&!['Выполнена','Отменена'].includes(String(o.status||''));
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10);
const timeOf=o=>String(o?.scheduled_time||o?.time_slot||'').slice(0,5);
const hasSchedule=o=>!!dateOf(o)&&!!timeOf(o);
const stageOf=o=>{if(String(o?.status||'')==='Выполнена')return'completed';const s=String(o?.master_workflow_stage||'assigned');return s==='arrived'?'departed':['assigned','departed','started','completed'].includes(s)?s:'assigned'};
const reportUploaded=o=>!!o?.report_uploaded_at||!!o?.report_act_url;
const reportRejected=o=>reportUploaded(o)&&String(o?.report_review_status||'pending')==='rejected';
const reportApproved=o=>String(o?.status||'')==='Выполнена'||String(o?.report_review_status||'')==='approved';
const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const fmtDate=d=>{if(!d)return'Дата не назначена';const x=new Date(`${d}T00:00:00`);return Number.isNaN(x.getTime())?d:x.toLocaleDateString('ru-RU',{day:'2-digit',month:'long'})};
const orderNo=o=>{const ext=String(o?.external_id||'');return ext.startsWith('hands:')?ext.slice(6):String(o?.id||'')};

async function authHeaders(){const h=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};return {...h,'Content-Type':'application/json'}}
async function api(action,id,payload={}){const r=await fetch(API_URL,{method:'POST',headers:await authHeaders(),body:JSON.stringify({action,id,...payload})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось сохранить действие');return d}
function mergeOrder(id,data){const i=(state?.orders||[]).findIndex(o=>String(o.id)===String(id));if(i>=0)state.orders[i]={...state.orders[i],...(data||{})}}
function refresh(){window.BOS_MASTER_DAILY_HOME_V127_API?.refresh?.();schedule(true)}
function flowStatus(o){if(reportApproved(o))return'Завершена';if(reportRejected(o))return'Отчёт на доработку';if(reportUploaded(o))return'Отчёт отправлен';if(!hasSchedule(o))return'Дата и время не согласованы';const s=stageOf(o);if(s==='started')return'В работе';if(s==='departed')return'В дороге';return'Запланирована'}
function progress(o){const s=stageOf(o);return {departed:['departed','started','completed'].includes(s)||reportUploaded(o),started:['started','completed'].includes(s)||reportUploaded(o),report:reportUploaded(o)}}
function actionButtons(o,compact=false){
  const p=progress(o),scheduled=hasSchedule(o),requested=!!o?.reschedule_requested;
  if(!scheduled)return `<button type="button" class="primary mof177Deal${compact?' compact':''}" onclick="masterOrderFlowOpenAgreement177('${escv(o.id)}',${compact?'true':'false'})">Договориться</button>`;
  const departDisabled=p.departed?' disabled':'',startDisabled=p.started||!p.departed?' disabled':'',reportEnabled=(p.started&&!p.report)||reportRejected(o),reportDisabled=reportEnabled?'':' disabled';
  const departText=p.departed?'Выехал ✓':'Выехал',startText=p.started?'Начал работу ✓':'Начал работу',reportText=reportRejected(o)?'Исправить отчёт':p.report?'Отчёт отправлен':'Отправить отчёт';
  return `<div class="mof177ActionGrid"><button type="button" class="primary mof177Depart"${departDisabled} onclick="masterOrderFlowDepart177('${escv(o.id)}')">${departText}</button><button type="button" class="primary mof177Start"${startDisabled} onclick="masterOrderFlowStart177('${escv(o.id)}')">${startText}</button><button type="button" class="secondary mof177Report"${reportDisabled} onclick="masterOrderFlowReport177('${escv(o.id)}')">${reportText}</button></div><button type="button" class="secondary mof177Move"${requested?' disabled':''} onclick="masterOrderFlowReschedule177('${escv(o.id)}')">${requested?'Перенос запрошен':'Перенести заявку'}</button><small class="mof177MoveHint">${requested?'Ожидает подтверждения диспетчера / руководителя':'Требует подтверждения диспетчера / руководителя'}</small>`;
}
function homeAgreementForm(o){return `<form class="mof177Agreement" onsubmit="return masterOrderFlowSubmitAgreement177(event,'${escv(o.id)}')"><label>Дата<input type="date" name="scheduled_date" required min="${localToday()}"></label><label>Время<input type="time" name="scheduled_time" required step="900"></label><button class="primary" type="submit">Подтвердить</button><small>После подтверждения будут доступны: Выехал, Начал работу, Отправить отчёт.</small><p class="mof177Msg"></p></form>`}
function homeHtml(o){if(!liveMaster()||!active(o))return'';if(!hasSchedule(o)){return `<div class="mof177HomeState"><div class="mof177NoSchedule"><b>Дата и время не согласованы</b><span>Согласуйте с клиентом дату и время выполнения.</span></div>${actionButtons(o,true)}${expandedHomeId===String(o.id)?homeAgreementForm(o):''}</div>`}return `<div class="mof177HomeState"><div class="mof177Schedule"><span>${escv(timeOf(o))}</span><b>${escv(fmtDate(dateOf(o)))}</b><em>${escv(flowStatus(o))}</em></div>${actionButtons(o,true)}<p class="mof177Msg"></p></div>`}
function decorateHome(force=false){
  const daily=document.getElementById('masterDailyV127'),card=daily?.querySelector('.masterV127Next');
  if(!daily||!card||!liveMaster()){document.getElementById('masterOrderFlowHome177')?.remove();return}
  const id=String(card.dataset.orderId||''),o=orderById(id);if(!o)return;
  const chip=card.querySelector('.masterV127Main strong'),chipText=flowStatus(o);if(chip&&chip.textContent!==chipText)chip.textContent=chipText;
  let box=document.getElementById('masterOrderFlowHome177');if(!box){box=document.createElement('div');box.id='masterOrderFlowHome177';box.className='mof177Home';card.insertAdjacentElement('afterend',box)}else if(box.previousElementSibling!==card)card.insertAdjacentElement('afterend',box);
  const sig=JSON.stringify([o.id,dateOf(o),timeOf(o),o.master_workflow_stage,o.report_uploaded_at,o.report_act_url,o.report_review_status,o.status,o.reschedule_requested,expandedHomeId]);
  if(!force&&box.dataset.sig===sig)return;box.dataset.sig=sig;box.dataset.orderId=id;box.innerHTML=homeHtml(o);
}
function stepsHtml(o){const p=progress(o);return `<div class="mof177Steps"><span class="${p.departed?'done':''}">Выехал</span><span class="${p.started?'done':''}">Работа</span><span class="${p.report?'done':''}">Отчёт</span></div>`}
function panelHtml(o){const scheduled=hasSchedule(o),preview=!liveMaster();return `<div class="mwv2Head mof177Head"><div><small>РАБОЧИЙ ПРОЦЕСС</small><h3>${escv(flowStatus(o))}</h3></div><span>${scheduled?`${escv(dateOf(o))} · ${escv(timeOf(o))}`:'Без даты и времени'}</span></div>${scheduled?stepsHtml(o):'<div class="mof177NoSchedule"><b>Нужно договориться</b><span>Выберите согласованные с клиентом дату и время.</span></div>'}${preview?'<p class="muted">В режиме просмотра действия недоступны.</p>':`<div class="mwv2Actions mof177Actions">${actionButtons(o)}</div>`}<p class="muted mof177Msg"></p>`}
function decorateModal(force=false){
  if(!masterMode())return;const panel=document.querySelector('#modalRoot .bosMasterWorkflow');
  if(!panel||document.querySelector('#masterReportForm,#masterAgreementForm,#masterRescheduleForm'))return;
  const id=String(panel.dataset.orderId||document.querySelector('#modalRoot .modal')?.dataset?.bosWorkflowOrderId||''),o=orderById(id);if(!o)return;
  const sig=JSON.stringify([o.id,dateOf(o),timeOf(o),o.master_workflow_stage,o.report_uploaded_at,o.report_act_url,o.report_review_status,o.report_review_comment,o.status,o.reschedule_requested]);
  if(!force&&panel.dataset.mof177Sig===sig&&panel.querySelector('.mof177Head'))return;
  panel.dataset.mof177Sig=sig;panel.classList.add('mof177Panel');panel.innerHTML=panelHtml(o);
}
function schedule(force=false){if(queued&&!force)return;queued=true;requestAnimationFrame(()=>{queued=false;decorateHome(force);decorateModal(force)})}
function setMsg(id,text){const home=document.querySelector(`#masterOrderFlowHome177[data-order-id="${CSS.escape(String(id))}"] .mof177Msg`);if(home)home.textContent=text||'';const modal=document.querySelector('#modalRoot .mof177Panel .mof177Msg');if(modal)modal.textContent=text||''}

window.masterOrderFlowOpenAgreement177=function(id,inline=false){const o=orderById(id);if(!liveMaster()||!active(o)||hasSchedule(o))return;if(inline){expandedHomeId=String(id);decorateHome(true);document.querySelector('#masterOrderFlowHome177 .mof177Agreement input')?.focus();return}openAgreementModal(o)};
function openAgreementModal(o){
  openModal(`<h2>Договориться по заявке № ${escv(orderNo(o))}</h2><p class="muted">Выберите согласованные с клиентом дату и время.</p><form id="masterAgreementForm" class="form"><label>Дата *</label><input type="date" name="scheduled_date" required min="${localToday()}"><label>Время *</label><input type="time" name="scheduled_time" required step="900"><p class="muted">После подтверждения будут доступны «Выехал», «Начал работу» и «Отправить отчёт».</p><button class="primary wide" type="submit">Подтвердить</button><button class="secondary wide" type="button" onclick="openOrder('${escv(o.id)}')">Отмена</button><p id="masterAgreementMsg" class="muted"></p></form>`);
  const form=document.getElementById('masterAgreementForm');form.onsubmit=e=>submitAgreement(e,o.id,form,document.getElementById('masterAgreementMsg'),true);
}
async function submitAgreement(e,id,form,msg,reopen){
  e?.preventDefault?.();if(busy||state?.busy)return false;const o=orderById(id);if(!o)return false;
  const date=String(form.elements.scheduled_date.value||''),time=String(form.elements.scheduled_time.value||'').slice(0,5);if(!date||!time){if(msg)msg.textContent='Укажите дату и время';return false}
  busy=true;if(state)state.busy=true;if(typeof setBusy==='function')setBusy(form,true);if(msg)msg.textContent='Сохраняем…';
  try{let current=o;if(!current.master_called_at){const called=await api('markCalled',id);mergeOrder(id,called.order);current=called.order}const saved=await api('setAgreementSchedule',id,{scheduled_date:date,scheduled_time:time});mergeOrder(id,saved.order);expandedHomeId='';if(reopen){closeModal();window.openOrder?.(id)}refresh()}catch(err){if(msg)msg.textContent=err?.message||String(err);if(typeof setBusy==='function')setBusy(form,false)}finally{busy=false;if(state)state.busy=false}return false;
}
window.masterOrderFlowSubmitAgreement177=function(e,id){const form=e?.currentTarget,msg=form?.querySelector('.mof177Msg');submitAgreement(e,id,form,msg,false);return false};
window.masterOrderFlowDepart177=async function(id){const o=orderById(id);if(!liveMaster()||busy||!active(o)||!hasSchedule(o)||stageOf(o)!=='assigned')return;busy=true;setMsg(id,'Отмечаем выезд…');try{const d=await api('setStage',id,{stage:'departed'});mergeOrder(id,d.order);refresh()}catch(e){setMsg(id,e?.message||String(e))}finally{busy=false}};
window.masterOrderFlowStart177=async function(id){const o=orderById(id);if(!liveMaster()||busy||!active(o)||stageOf(o)!=='departed')return;busy=true;setMsg(id,'Начинаем работу…');try{const d=await api('setStage',id,{stage:'started'});mergeOrder(id,d.order);refresh()}catch(e){setMsg(id,e?.message||String(e))}finally{busy=false}};
window.masterOrderFlowReport177=function(id){const o=orderById(id);if(!liveMaster()||!active(o))return;const can=(stageOf(o)==='started'&&!reportUploaded(o))||reportRejected(o);if(!can)return;if(typeof window.masterWorkflowComplete==='function')window.masterWorkflowComplete(id)};
window.masterOrderFlowReschedule177=function(id){const o=orderById(id);if(!liveMaster()||!active(o)||!hasSchedule(o)||o.reschedule_requested)return;if(typeof window.masterWorkflowOpenReschedule==='function')return window.masterWorkflowOpenReschedule(id);if(typeof window.openMasterRescheduleForm==='function')return window.openMasterRescheduleForm(id)};

const baseOpen=window.openOrder;if(typeof baseOpen==='function')window.openOrder=function(){const out=baseOpen.apply(this,arguments);setTimeout(()=>decorateModal(true),0);setTimeout(()=>decorateModal(true),140);return out};
new MutationObserver(()=>schedule()).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('resize',()=>schedule());setTimeout(()=>schedule(true),0);

const style=document.createElement('style');style.textContent=`
.mof177Home{margin-top:10px;padding:11px;border:1px solid rgba(96,165,250,.2);border-radius:14px;background:rgba(15,31,58,.44)}.mof177HomeState{display:grid;gap:9px}.mof177Schedule{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mof177Schedule>span{font-size:17px;font-weight:900}.mof177Schedule>b{font-size:12px;color:var(--muted,#91a3b7)}.mof177Schedule>em{margin-left:auto;padding:4px 8px;border-radius:999px;background:rgba(37,99,235,.18);font-size:10px;font-style:normal;font-weight:800}.mof177NoSchedule{display:flex;flex-direction:column;gap:2px;padding:9px 10px;border-radius:11px;background:rgba(96,165,250,.08)}.mof177NoSchedule b{font-size:12px}.mof177NoSchedule span{color:var(--muted,#91a3b7);font-size:11px}.mof177ActionGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.mof177ActionGrid .mof177Report{grid-column:1/-1}.mof177ActionGrid button,.mof177Move,.mof177Deal{min-height:42px;margin:0}.mof177Move{width:100%}.mof177MoveHint{display:block;margin-top:-4px;color:var(--muted,#91a3b7);font-size:10px}.mof177Actions{display:block!important}.mof177Actions>.mof177ActionGrid{margin-top:10px}.mof177Actions>.mof177Move{margin-top:8px}.mof177Agreement{display:grid;gap:8px;padding:10px;border:1px solid rgba(96,165,250,.2);border-radius:12px}.mof177Agreement label{display:grid;gap:4px;color:var(--muted,#91a3b7);font-size:11px}.mof177Agreement input{min-height:42px}.mof177Agreement small{color:var(--muted,#91a3b7);font-size:10px;line-height:1.35}.mof177Msg{min-height:0;margin:0;color:var(--muted,#91a3b7);font-size:11px}.mof177Panel{padding:14px}.mof177Head{margin-bottom:10px}.mof177Steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:9px 0}.mof177Steps span{padding:7px 5px;border-radius:9px;background:rgba(148,163,184,.08);color:var(--muted,#91a3b7);font-size:10px;font-weight:800;text-align:center}.mof177Steps span.done{background:rgba(16,185,129,.13);color:#7ee7bd}.mof177Panel button:disabled,.mof177Home button:disabled{opacity:.48;cursor:default;filter:saturate(.6)}
@media(max-width:520px){.mof177ActionGrid{grid-template-columns:1fr 1fr}.mof177ActionGrid button{padding:9px 7px;font-size:12px}.mof177Agreement input{font-size:16px}.mof177Head{align-items:flex-start}.mof177Head>span{font-size:10px}}
`;document.head.appendChild(style);
})();
