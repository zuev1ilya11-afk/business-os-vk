(()=>{
'use strict';
if(window.BOS_MASTER_WORKFLOW_V115)return;window.BOS_MASTER_WORKFLOW_V115=true;
const API_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/master-workflow-api';
let busy=false,queued=false;

const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const liveMaster=()=>String(state?.user?.role||'')==='master';
const dispatcherMode=()=>String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview());
const orderById=id=>(state?.orders||[]).find(o=>String(o.id)===String(id))||null;
const stageOf=o=>{if(String(o?.status||'')==='Выполнена')return'completed';if(String(o?.status||'')==='Отменена')return'cancelled';const s=String(o?.master_workflow_stage||'assigned');return s==='arrived'?'departed':['assigned','departed','started'].includes(s)?s:'assigned'};
const laterThanAssigned=o=>['departed','started','completed'].includes(stageOf(o))||!!o?.report_uploaded_at;
const laterThanDeparted=o=>['started','completed'].includes(stageOf(o))||!!o?.report_uploaded_at;
const calledDone=o=>!!o?.master_called_at||laterThanAssigned(o);
const agreementDone=o=>!!o?.master_agreed_at||laterThanAssigned(o);
const reportUploaded=o=>!!o?.report_uploaded_at||!!o?.report_act_url;
const reportRejected=o=>reportUploaded(o)&&String(o?.report_review_status||'pending')==='rejected';
const reportApproved=o=>String(o?.status||'')==='Выполнена'||String(o?.report_review_status||'')==='approved';
const active=o=>o&&!['Выполнена','Отменена'].includes(String(o.status||''));
const hasSchedule=o=>!!String(o?.scheduled_date||'').slice(0,10)&&!!String(o?.scheduled_time||o?.time_slot||'').slice(0,5);
const phoneHref=v=>{let p=String(v||'').trim().replace(/[^\d+]/g,'');if(/^8\d{10}$/.test(p))p='+7'+p.slice(1);else if(/^\d{10}$/.test(p))p='+7'+p;return p};
const fmt=v=>{if(!v)return'';const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})};
const timeText=o=>`${String(o?.scheduled_date||'').slice(0,10)||'Дата не назначена'}${String(o?.scheduled_time||o?.time_slot||'').slice(0,5)?` · ${String(o?.scheduled_time||o?.time_slot||'').slice(0,5)}`:''}`;

async function authHeaders(){const h=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};return {...h,'Content-Type':'application/json'}}
async function workflowCall(action,id){const r=await fetch(API_URL,{method:'POST',headers:await authHeaders(),body:JSON.stringify({action,id})}),d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось сохранить действие');return d}
function mergeOrder(id,data){const i=(state.orders||[]).findIndex(o=>String(o.id)===String(id));if(i>=0)state.orders[i]={...state.orders[i],...(data||{})}}
function panelMsg(id,text){const modal=document.querySelector('#modalRoot .modal'),panel=modal?.querySelector(`.bosMasterWorkflow[data-order-id="${CSS.escape(String(id))}"]`);const msg=panel?.querySelector('.mwv2Msg');if(msg)msg.textContent=text||''}
function rerender(id){decorateMasterModal(id);decorateToday();decorateDispatcher()}

window.masterWorkflowMarkCalled=async function(id){
  if(!liveMaster()||busy)return;const o=orderById(id);if(!o||!active(o)||calledDone(o))return;
  busy=true;panelMsg(id,'Сохраняем звонок…');
  try{const d=await workflowCall('markCalled',id);mergeOrder(id,d.order);rerender(id)}catch(e){panelMsg(id,e?.message||String(e))}finally{busy=false}
};
window.masterWorkflowConfirmAgreement=async function(id){
  if(!liveMaster()||busy)return;const o=orderById(id);if(!o||!active(o)||agreementDone(o))return;
  busy=true;panelMsg(id,'Подтверждаем договорённость…');
  try{const d=await workflowCall('confirmAgreement',id);mergeOrder(id,d.order);rerender(id)}catch(e){panelMsg(id,e?.message||String(e))}finally{busy=false}
};
window.masterWorkflowAgreementStep=function(id){
  const o=orderById(id);if(!o||!liveMaster())return;
  if(!calledDone(o)){panelMsg(id,'Сначала позвоните клиенту и отметьте звонок');return}
  if(hasSchedule(o))return window.masterWorkflowConfirmAgreement(id);
  if(typeof window.openMasterAgreement==='function')return window.openMasterAgreement(id);
  panelMsg(id,'Форма договорённости недоступна');
};

const previousSetStage=window.masterWorkflowSetStage;
if(typeof previousSetStage==='function')window.masterWorkflowSetStage=function(id,stage){
  const o=orderById(id);
  if(stage==='departed'&&o&&!agreementDone(o)){panelMsg(id,'Сначала подтвердите договорённость с клиентом');return}
  return previousSetStage.apply(this,arguments);
};

function stepData(o){
  const stage=stageOf(o),called=calledDone(o),agreed=agreementDone(o),departed=['departed','started','completed'].includes(stage)||reportUploaded(o),started=laterThanDeparted(o),report=reportUploaded(o),done=reportApproved(o);
  const items=[
    ['call','Звонок',called,fmt(o?.master_called_at)],
    ['agreement','Договорённость',agreed,fmt(o?.master_agreed_at)],
    ['departed','Выехал',departed,fmt(o?.master_departed_at)],
    ['started','Работа',started,fmt(o?.master_started_at)],
    ['report','Отчёт',report,fmt(o?.report_uploaded_at)],
    ['completed','Завершена',done,fmt(o?.completed_at)]
  ];
  const firstPending=items.findIndex(x=>!x[2]);
  return items.map((x,i)=>({...Object.fromEntries([['key',x[0]],['label',x[1]],['done',x[2]],['at',x[3]]]),current:firstPending===i||(firstPending<0&&i===items.length-1)}));
}
function workflowStatus(o){
  if(String(o?.status||'')==='Отменена')return'Отменена';
  if(reportApproved(o))return'Завершена';
  if(reportRejected(o))return'Отчёт на доработку';
  if(reportUploaded(o))return'Отчёт на проверке';
  if(stageOf(o)==='started')return'В работе';
  if(stageOf(o)==='departed')return'В дороге';
  if(agreementDone(o))return'Договорено';
  if(calledDone(o))return'Созвонился';
  return'Нужно позвонить';
}
function actionHtml(o,preview){
  if(preview||!liveMaster()||!active(o))return'';
  const called=calledDone(o),agreed=agreementDone(o),stage=stageOf(o),href=phoneHref(o.phone||o.client_phone);
  if(!called){return `${href?`<a class="secondary mwv2CallLink" href="tel:${escv(href)}">Позвонить клиенту</a>`:'<span class="muted mwv2NoPhone">Телефон клиента не указан</span>'}${href?`<button type="button" class="primary" onclick="masterWorkflowMarkCalled('${escv(o.id)}')">Звонок выполнен</button>`:''}`}
  if(!agreed){return `<div class="mwv2AgreementSummary"><span>Текущая дата и время</span><b>${escv(timeText(o))}</b></div><button type="button" class="primary" onclick="masterWorkflowAgreementStep('${escv(o.id)}')">${hasSchedule(o)?'Подтвердить договорённость':'Указать дату и время'}</button>`}
  if(stage==='assigned')return `<button type="button" class="primary" onclick="masterWorkflowSetStage('${escv(o.id)}','departed')">Выехал</button><button type="button" class="secondary" onclick="masterWorkflowOpenReschedule('${escv(o.id)}')">Нужно перенести</button>`;
  if(stage==='departed')return `<button type="button" class="primary" onclick="masterWorkflowSetStage('${escv(o.id)}','started')">Работа начата</button><button type="button" class="secondary" onclick="masterWorkflowOpenReschedule('${escv(o.id)}')">Нужно перенести</button>`;
  if(stage==='started'&&!reportUploaded(o))return `<button type="button" class="primary mwv2ReportBtn" onclick="masterWorkflowComplete('${escv(o.id)}')">Завершить и прикрепить отчёт</button>`;
  if(reportRejected(o))return `<div class="mwv2Review rejected"><b>Отчёт отклонён</b><span>${escv(o.report_review_comment||'Исправьте отчёт и отправьте повторно.')}</span></div><button type="button" class="primary mwv2ReportBtn" onclick="masterWorkflowComplete('${escv(o.id)}')">Исправить отчёт</button>`;
  if(reportUploaded(o)&&!reportApproved(o))return `<div class="mwv2Review"><b>Отчёт отправлен</b><span>Ожидает проверки диспетчером или руководителем.</span></div>`;
  return'';
}
function masterPanelHtml(o){
  const preview=masterMode()&&!liveMaster(),steps=stepData(o),status=workflowStatus(o);
  return `<div class="mwv2Head"><div><small>РАБОЧИЙ ПРОЦЕСС</small><h3>${escv(status)}</h3></div><span>${escv(status)}</span></div><div class="mwv2Steps">${steps.map(s=>`<div class="mwv2Step${s.done?' done':''}${s.current?' current':''}"><i></i><b>${escv(s.label)}</b>${s.at?`<small>${escv(s.at)}</small>`:''}</div>`).join('')}</div>${preview?'<p class="muted">В режиме просмотра действия недоступны.</p>':''}<div class="mwv2Actions">${actionHtml(o,preview)}</div><p class="muted mwv2Msg"></p>`;
}
function decorateMasterModal(forceId=''){
  if(!masterMode())return;const modal=document.querySelector('#modalRoot .modal');if(!modal||modal.querySelector('#masterReportForm,#masterAgreementForm,#masterRescheduleForm'))return;
  const panel=modal.querySelector('.bosMasterWorkflow');const id=String(forceId||panel?.dataset?.orderId||modal.dataset.bosWorkflowOrderId||'');const o=orderById(id);if(!panel||!o)return;
  const sig=JSON.stringify([o.id,o.status,o.master_called_at,o.master_agreed_at,o.master_workflow_stage,o.master_departed_at,o.master_started_at,o.report_uploaded_at,o.report_review_status,o.report_review_comment,o.completed_at,o.scheduled_date,o.scheduled_time,o.time_slot]);
  if(panel.dataset.mwv2Sig===sig)return;panel.dataset.mwv2Sig=sig;panel.dataset.bosV115='1';panel.innerHTML=masterPanelHtml(o);
}
function decorateToday(){
  if(!masterMode())return;document.querySelectorAll('.bosMwTodayCard').forEach(card=>{const m=String(card.getAttribute('onclick')||'').match(/openOrder\(['"]([^'"]+)/);if(!m)return;const o=orderById(m[1]),chip=card.querySelector('.bosMwTodayStage');if(o&&chip)chip.textContent=workflowStatus(o)});
}
function orderIdFromCard(card){const direct=card?.dataset?.orderId;if(direct)return String(direct);const m=String(card?.getAttribute?.('onclick')||'').match(/openOrder\(['"]([^'"]+)/);return m?String(m[1]):''}
function decorateDispatcherCards(){
  if(!dispatcherMode())return;
  document.querySelectorAll('[data-order-id].dbOrderCard,[data-order-id].dbV23Card,[data-order-id].dbV24Card').forEach(card=>{const o=orderById(card.dataset.orderId);if(!o)return;let chip=card.querySelector('.bosFieldStageChip');if(!chip){chip=document.createElement('span');chip.className='bosFieldStageChip';(card.querySelector('.dbV24Badges')||card).appendChild(chip)}const text=workflowStatus(o);chip.textContent=text;chip.classList.toggle('danger',text==='Нужно позвонить'||text==='Отчёт на доработку')});
  document.querySelectorAll('.opsCompactOrder,.dmv2Order').forEach(card=>{const o=orderById(orderIdFromCard(card));if(!o)return;let chip=card.querySelector('.mwv2MobileStage');if(!chip){chip=document.createElement('span');chip.className='mwv2MobileStage';const bottom=card.querySelector('.opsCompactBottom,.dmv2OrderTop');(bottom||card).appendChild(chip)}chip.textContent=workflowStatus(o)});
}
function dispatcherFlowHtml(o){const steps=stepData(o);return `<div class="mwv2DispatcherFlow"><b>Рабочий процесс мастера</b><div>${steps.map(s=>`<span class="${s.done?'done':s.current?'current':''}">${escv(s.label)}</span>`).join('')}</div></div>`}
function decorateDispatcherDetail(){
  if(!dispatcherMode())return;const detail=document.querySelector('#dispatchBoardDetail .dbDetail,.ddDetail');if(!detail)return;const selected=document.querySelector('.dbOrderCard.selected,.ddQueueCard.isSelected');const o=orderById(selected?.dataset?.orderId||'');if(!o)return;let flow=detail.querySelector('.mwv2DispatcherFlow');const html=dispatcherFlowHtml(o);if(flow){const w=document.createElement('div');w.innerHTML=html;flow.replaceWith(w.firstElementChild)}else{const anchor=detail.querySelector('.dbFlags,.ddFlags,.dbDetailGrid,.ddInfoGrid');if(anchor)anchor.insertAdjacentHTML('afterend',html);else detail.insertAdjacentHTML('afterbegin',html)}}
function decorateOpsBar(){
  if(!dispatcherMode()||window.innerWidth<1050||String(state?.page||'')!=='orders'||!document.querySelector('.dbBoard'))return;const date=document.getElementById('dispatchBoardDate')?.value||'';const orders=(state.orders||[]).filter(o=>!date||String(o.scheduled_date||'').slice(0,10)===date);const counts={call:0,agreed:0,road:0,work:0,report:0};for(const o of orders){const s=workflowStatus(o);if(s==='Нужно позвонить'||s==='Созвонился')counts.call++;if(s==='Договорено')counts.agreed++;if(s==='В дороге')counts.road++;if(s==='В работе')counts.work++;if(s==='Отчёт на проверке'||s==='Отчёт на доработку')counts.report++}const anchor=document.querySelector('.dbV21Tools')||document.querySelector('.dbFilters');if(!anchor)return;let bar=document.querySelector('.mwv2OpsBar');if(!bar){bar=document.createElement('div');bar.className='mwv2OpsBar';anchor.insertAdjacentElement('afterend',bar)}bar.innerHTML=`<b>Этапы мастеров</b><span class="${counts.call?'danger':''}">Связаться: ${counts.call}</span><span>Договорено: ${counts.agreed}</span><span>В дороге: ${counts.road}</span><span>В работе: ${counts.work}</span><span>Отчёт: ${counts.report}</span>`}
function decorateDispatcher(){decorateDispatcherCards();decorateDispatcherDetail();decorateOpsBar()}
function decorate(){queued=false;document.querySelectorAll('.bosMasterAgreementBtn,.bosMasterAgreementModalBtn').forEach(x=>x.classList.add('mwv2LegacyHidden'));decorateMasterModal();decorateToday();decorateDispatcher()}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(decorate)}
const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('resize',schedule);setTimeout(schedule,0);

const style=document.createElement('style');style.textContent=`
.mwv2LegacyHidden{display:none!important}.bosMasterWorkflow[data-bos-v115="1"]{padding:14px}.mwv2Head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.mwv2Head small{font-size:10px;font-weight:800;letter-spacing:.08em;color:var(--muted,#91a3b7)}.mwv2Head h3{margin:3px 0 0}.mwv2Head>span{font-size:11px;font-weight:800;padding:5px 8px;border-radius:999px;background:rgba(37,99,235,.10);color:#60a5fa}.mwv2Steps{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:3px;margin:15px 0}.mwv2Step{position:relative;display:grid;justify-items:center;gap:4px;text-align:center;min-width:0}.mwv2Step:before{content:'';position:absolute;top:6px;left:-50%;right:50%;height:2px;background:rgba(127,127,127,.18)}.mwv2Step:first-child:before{display:none}.mwv2Step i{width:12px;height:12px;border-radius:50%;z-index:1;background:rgba(127,127,127,.28)}.mwv2Step.done i,.mwv2Step.done:before{background:#2563eb}.mwv2Step.current i{box-shadow:0 0 0 4px rgba(37,99,235,.15)}.mwv2Step b{font-size:8px;line-height:1.15}.mwv2Step small{font-size:7px;color:var(--muted,#91a3b7)}.mwv2Actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.mwv2Actions>*{min-height:44px;box-sizing:border-box}.mwv2CallLink{display:flex;align-items:center;justify-content:center;text-decoration:none}.mwv2NoPhone{grid-column:1/-1;padding:10px;border:1px solid rgba(220,38,38,.25);border-radius:10px}.mwv2AgreementSummary,.mwv2Review{grid-column:1/-1;display:flex;flex-direction:column;gap:3px;padding:9px 10px;border:1px solid rgba(127,127,127,.16);border-radius:10px}.mwv2AgreementSummary span,.mwv2Review span{font-size:11px;color:var(--muted,#91a3b7)}.mwv2Review.rejected{border-color:rgba(220,38,38,.3)}.mwv2ReportBtn{grid-column:1/-1}.mwv2DispatcherFlow{margin:10px 0;padding:10px;border:1px solid rgba(127,127,127,.15);border-radius:11px}.mwv2DispatcherFlow>b{display:block;margin-bottom:7px;font-size:11px}.mwv2DispatcherFlow>div{display:flex;gap:4px;flex-wrap:wrap}.mwv2DispatcherFlow span{font-size:9px;padding:4px 6px;border-radius:999px;background:rgba(127,127,127,.1);color:var(--muted,#91a3b7)}.mwv2DispatcherFlow span.done{background:rgba(37,99,235,.11);color:#60a5fa}.mwv2DispatcherFlow span.current{outline:1px solid rgba(96,165,250,.55);color:inherit}.mwv2OpsBar{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:0 0 12px;padding:8px 10px;border:1px solid rgba(127,127,127,.16);border-radius:12px;background:var(--card,#fff)}.mwv2OpsBar b{margin-right:auto}.mwv2OpsBar span,.mwv2MobileStage{font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(37,99,235,.08);color:#60a5fa}.mwv2OpsBar span.danger{background:rgba(220,38,38,.09);color:#f87171}.mwv2MobileStage{display:inline-flex;width:max-content;max-width:100%}.dbBoard~* .bosFieldOpsBar,.dbBoard .bosFieldOpsBar{display:none!important}@media(max-width:600px){.mwv2Steps{grid-template-columns:repeat(3,1fr);row-gap:12px}.mwv2Step:nth-child(4):before{display:none}.mwv2Actions{grid-template-columns:1fr}.mwv2AgreementSummary,.mwv2Review,.mwv2ReportBtn,.mwv2NoPhone{grid-column:auto}.mwv2Actions>*{min-height:48px}}
`;document.head.appendChild(style);
})();
