(()=>{
'use strict';
if(window.BOS_MASTER_ORDER_FLOW_V179)return;
window.BOS_MASTER_ORDER_FLOW_V179=true;

const API_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/master-workflow-api';
let busy=false,queued=false;
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const liveMaster=()=>String(state?.user?.role||'')==='master';
const masterMode=()=>liveMaster()||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const orderById=id=>(state?.orders||[]).find(o=>String(o.id)===String(id))||null;
const active=o=>o&&!['Выполнена','Отменена'].includes(String(o.status||''));
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10);
const timeOf=o=>String(o?.scheduled_time||o?.time_slot||'').slice(0,5);
const hasSchedule=o=>!!dateOf(o)&&!!timeOf(o);
const stageOf=o=>{if(String(o?.status||'')==='Выполнена')return'completed';if(String(o?.status||'')==='Отменена')return'cancelled';const s=String(o?.master_workflow_stage||'assigned');return s==='arrived'?'departed':['assigned','departed','started'].includes(s)?s:'assigned'};
const reportUploaded=o=>!!o?.report_uploaded_at||!!o?.report_act_url;
const reportRejected=o=>reportUploaded(o)&&String(o?.report_review_status||'pending')==='rejected';
const reportApproved=o=>String(o?.status||'')==='Выполнена'||String(o?.report_review_status||'')==='approved';
const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const whenText=o=>`${dateOf(o)||'Дата не назначена'}${timeOf(o)?` · ${timeOf(o)}`:''}`;
const button=(label,handler,enabled,done=false,extra='')=>`<button type="button" class="v179StageButton${done?' isDone':''}${extra?' '+extra:''}" ${enabled?`onclick="${handler}"`:'disabled'}><span>${escv(label)}</span><b aria-hidden="true">${done?'✓':'›'}</b></button>`;

async function authHeaders(){const h=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};return {...h,'Content-Type':'application/json'}}
async function api(action,id,payload={}){const r=await fetch(API_URL,{method:'POST',headers:await authHeaders(),body:JSON.stringify({action,id,...payload})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось сохранить действие');return d}
function mergeOrder(id,data){const i=(state.orders||[]).findIndex(o=>String(o.id)===String(id));if(i>=0)state.orders[i]={...state.orders[i],...(data||{})}}
function msg(id,text){const panel=document.querySelector('#modalRoot .bosMasterWorkflow');if(String(panel?.dataset?.orderId||'')!==String(id))return;const el=panel.querySelector('.v179Msg');if(el)el.textContent=text||''}
function legacyV115Sig(o){return JSON.stringify([o.id,o.status,o.master_called_at,o.master_agreed_at,o.master_workflow_stage,o.master_departed_at,o.master_started_at,o.report_uploaded_at,o.report_review_status,o.report_review_comment,o.completed_at,o.scheduled_date,o.scheduled_time,o.time_slot])}
function legacyV116Sig(o){return JSON.stringify([o.id,o.status,o.master_called_at,o.master_agreed_at,o.master_workflow_stage,o.master_started_at,o.report_uploaded_at,o.report_review_status,o.report_review_comment,o.completed_at,o.scheduled_date,o.scheduled_time,o.time_slot])}
function legacyV26Sig(o){return JSON.stringify([o?.id,stageOf(o),o?.status,o?.phone,o?.client_phone,o?.reschedule_requested,o?.reschedule_reason,o?.master_departed_at,o?.master_started_at,o?.completed_at])}
function ownSig(o){return JSON.stringify([legacyV115Sig(o),o.reschedule_requested,o.reschedule_reason,o.report_act_url,o.report_review_status])}

window.openMasterAgreement=function(id){
  const o=orderById(id);if(!liveMaster()||!active(o)||hasSchedule(o))return;
  openModal(`<h2>Согласовать дату и время</h2><p class="muted">Укажите согласованные с клиентом дату и время.</p><form id="masterAgreementForm" class="form"><label>Дата *</label><input type="date" name="scheduled_date" required min="${localToday()}" value="${escv(dateOf(o))}"><label>Время *</label><input type="time" name="scheduled_time" required step="900" value="${escv(timeOf(o))}"><p class="muted">После сохранения заявка перейдёт в рабочий сценарий мастера.</p><p class="muted">Изменение после согласования требует подтверждения диспетчера или руководителя.</p><button class="primary wide" type="submit">Сохранить</button><button class="secondary wide" type="button" onclick="openOrder('${escv(o.id)}')">Отмена</button><p id="masterAgreementMsg" class="muted"></p></form>`);
  const form=document.getElementById('masterAgreementForm');
  form.onsubmit=async e=>{
    e.preventDefault();if(busy||state.busy)return;
    const date=String(form.elements.scheduled_date.value||''),time=String(form.elements.scheduled_time.value||'').slice(0,5),message=document.getElementById('masterAgreementMsg');
    if(!date||!time){message.textContent='Укажите дату и время';return}
    busy=true;state.busy=true;if(typeof setBusy==='function')setBusy(form,true);message.textContent='Сохраняем…';
    try{
      const current=orderById(o.id);
      if(!current?.master_called_at){const called=await api('markCalled',o.id);mergeOrder(o.id,called.order)}
      const agreed=await api('setAgreementSchedule',o.id,{scheduled_date:date,scheduled_time:time});mergeOrder(o.id,agreed.order);
      closeModal();window.openOrder?.(o.id);
    }catch(err){message.textContent=err?.message||String(err);if(typeof setBusy==='function')setBusy(form,false)}finally{busy=false;state.busy=false}
  };
};
window.masterWorkflowAgreementStep=id=>window.openMasterAgreement?.(id);

window.masterOrderFlowDepart=async function(id){
  if(!liveMaster()||busy)return;const o=orderById(id);if(!active(o)||!hasSchedule(o)||stageOf(o)!=='assigned')return;
  busy=true;msg(id,'Отмечаем выезд…');
  try{const d=await api('setStage',id,{stage:'departed'});mergeOrder(id,d.order);window.openOrder?.(id)}catch(err){msg(id,err?.message||String(err))}finally{busy=false}
};
window.masterOrderFlowStart=async function(id){
  if(!liveMaster()||busy)return;const o=orderById(id);if(!active(o)||!hasSchedule(o)||stageOf(o)!=='departed')return;
  busy=true;msg(id,'Начинаем работу…');
  try{const d=await api('setStage',id,{stage:'started'});mergeOrder(id,d.order);window.openOrder?.(id)}catch(err){msg(id,err?.message||String(err))}finally{busy=false}
};

function statusText(o){
  if(String(o?.status||'')==='Отменена')return'Отменена';
  if(reportApproved(o))return'Завершена';
  if(reportRejected(o))return'Отчёт на доработку';
  if(reportUploaded(o))return'Отчёт отправлен';
  if(!hasSchedule(o))return'Нужно договориться';
  const s=stageOf(o);if(s==='started')return'В работе';if(s==='departed')return'Выехал';return'Назначена';
}
function scheduledHtml(o,preview){
  const s=stageOf(o),available=liveMaster()&&!preview&&active(o),departed=['departed','started','completed'].includes(s),started=['started','completed'].includes(s),reported=reportUploaded(o),canReport=available&&s==='started'&&(!reported||reportRejected(o)),reschedulePending=!!o.reschedule_requested;
  const depart=button('Выехал',`masterOrderFlowDepart('${escv(o.id)}')`,available&&s==='assigned',departed);
  const start=button('Начал работу',`masterOrderFlowStart('${escv(o.id)}')`,available&&s==='departed',started);
  const report=button('Отправить отчет',`masterWorkflowComplete('${escv(o.id)}')`,canReport,reported&&!reportRejected(o),'v179Report');
  const reportNote=reported&&!reportRejected(o)?'<p class="muted v179StateNote">Отчёт отправлен, ожидает проверки.</p>':reportRejected(o)?`<p class="muted v179StateNote">Отчёт требует исправления${o.report_review_comment?`: ${escv(o.report_review_comment)}`:'.'}</p>`:'';
  return `<div class="v179Schedule"><span>Дата и время</span><b>${escv(whenText(o))}</b></div><div class="v179Stages">${depart}${start}${report}</div>${reportNote}<section class="v179Reschedule"><div><b>Перенос заявки</b><small>Требует подтверждения диспетчера или руководителя</small></div><button type="button" class="secondary wide" ${available&&!reschedulePending?`onclick="masterWorkflowOpenReschedule('${escv(o.id)}')"`:'disabled'}>${reschedulePending?'Перенос запрошен':'Запросить перенос'}</button></section>`;
}
function unscheduledHtml(o,preview){const enabled=liveMaster()&&!preview&&active(o);return `<div class="v179NeedAgreement"><p class="muted">У заявки ещё не назначены дата и время.</p><button type="button" class="primary wide v179Agree" ${enabled?`onclick="openMasterAgreement('${escv(o.id)}')"`:'disabled'}>Договориться</button><small>После согласования появятся этапы «Выехал», «Начал работу» и «Отправить отчет».</small></div>`}
function panelHtml(o){const preview=masterMode()&&!liveMaster(),status=statusText(o);return `<div class="mwv2Head"><div><small>ЭТАПЫ ВЫПОЛНЕНИЯ ЗАЯВКИ</small><h3>${escv(status)}</h3></div><span>${escv(status)}</span></div>${preview?'<p class="muted">В режиме просмотра действия недоступны.</p>':''}<div class="v179Flow">${hasSchedule(o)?scheduledHtml(o,preview):unscheduledHtml(o,preview)}</div><p class="muted v179Msg"></p>`}

function decorateMaster(){
  if(!masterMode())return;
  const modal=document.querySelector('#modalRoot .modal');
  if(!modal||modal.querySelector('#masterReportForm,#masterAgreementForm,#masterRescheduleForm'))return;
  const panel=modal.querySelector('.bosMasterWorkflow');if(!panel)return;
  const id=String(panel.dataset.orderId||modal.dataset.bosWorkflowOrderId||''),o=orderById(id);if(!o)return;
  const sig=ownSig(o);if(panel.dataset.v179Sig===sig&&panel.querySelector('.v179Flow'))return;
  panel.dataset.orderId=String(o.id);panel.dataset.bosV26='1';panel.dataset.bosV115='1';panel.dataset.bosV116='1';panel.dataset.bosV179='1';
  panel.dataset.bosV26Sig=legacyV26Sig(o);panel.dataset.mwv2Sig=legacyV115Sig(o);panel.dataset.mwv3Sig=legacyV116Sig(o);panel.dataset.v179Sig=sig;
  panel.innerHTML=panelHtml(o);
}
function decorate(){queued=false;decorateMaster()}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(decorate)}
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
setTimeout(schedule,0);

const style=document.createElement('style');
style.textContent=`
.bosMasterWorkflow[data-bos-v179="1"]{padding:14px}
.bosMasterWorkflow[data-bos-v179="1"] .mwv2Head{margin-bottom:12px}
.v179Flow{display:grid;gap:12px}.v179Schedule{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid rgba(127,127,127,.18);border-radius:12px;background:rgba(127,127,127,.035)}.v179Schedule span{font-size:12px;color:var(--muted,#91a3b7)}.v179Schedule b{font-size:13px;text-align:right}.v179Stages{display:grid;gap:8px}.v179StageButton{width:100%;min-height:54px;border:0;border-radius:13px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#2563eb;color:#fff;font:inherit;font-weight:800;text-align:left;cursor:pointer}.v179StageButton b{font-size:22px}.v179StageButton:disabled{cursor:default;opacity:.42}.v179StageButton.isDone{background:rgba(37,99,235,.13);color:#60a5fa;border:1px solid rgba(96,165,250,.24);opacity:1}.v179StageButton.isDone:disabled{opacity:1}.v179Reschedule{display:grid;gap:10px;padding:12px;border:1px solid rgba(127,127,127,.18);border-radius:13px;background:rgba(127,127,127,.035)}.v179Reschedule>div{display:grid;gap:3px}.v179Reschedule small,.v179NeedAgreement small{color:var(--muted,#91a3b7);line-height:1.35}.v179NeedAgreement{display:grid;gap:10px}.v179Agree{min-height:54px;font-size:16px}.v179StateNote{margin:0}.bosMasterWorkflow[data-bos-v179="1"] .mwv2Steps,.bosMasterWorkflow[data-bos-v179="1"] .mwv2Actions{display:none!important}@media(max-width:520px){.bosMasterWorkflow[data-bos-v179="1"]{padding:12px}.v179StageButton{min-height:52px}.v179Reschedule{padding:11px}}
`;
document.head.appendChild(style);
})();
