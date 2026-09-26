(()=>{
'use strict';
if(window.BOS_MASTER_ORDER_FLOW_V179)return;window.BOS_MASTER_ORDER_FLOW_V179=true;
const API_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/master-workflow-api';
let saving=false,queued=false;
const liveMaster=()=>String(state?.user?.role||'')==='master';
const orderById=id=>(state?.orders||[]).find(o=>String(o.id)===String(id))||null;
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10);
const timeOf=o=>String(o?.scheduled_time||o?.time_slot||'').slice(0,5);
const hasSchedule=o=>!!dateOf(o)&&!!timeOf(o);
const active=o=>o&&!['Выполнена','Отменена'].includes(String(o.status||''));
const stageOf=o=>{if(String(o?.status||'')==='Выполнена')return'completed';const s=String(o?.master_workflow_stage||'assigned');return s==='arrived'?'departed':['assigned','departed','started','completed'].includes(s)?s:'assigned'};
const reportUploaded=o=>!!o?.report_uploaded_at||!!o?.report_act_url;
const reportRejected=o=>reportUploaded(o)&&String(o?.report_review_status||'pending')==='rejected';
const reportApproved=o=>String(o?.status||'')==='Выполнена'||String(o?.report_review_status||'')==='approved';
const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
async function authHeaders(){const h=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};return {...h,'Content-Type':'application/json'}}
async function api(action,id,payload={}){const r=await fetch(API_URL,{method:'POST',headers:await authHeaders(),body:JSON.stringify({action,id,...payload})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось сохранить действие');return d}
function mergeOrder(id,data){const i=(state.orders||[]).findIndex(o=>String(o.id)===String(id));if(i>=0)state.orders[i]={...state.orders[i],...(data||{})}}
function button(label,enabled,onclick,done=false){return `<button type="button" class="primary bosOrderStepBtn${done?' is-done':''}"${enabled?` onclick="${onclick}"`:' disabled'}>${done?'✓ ':''}${label}</button>`}
function scheduledActions(o){
  const id=escv(o.id),stage=stageOf(o),uploaded=reportUploaded(o),approved=reportApproved(o),rejected=reportRejected(o),requested=!!o.reschedule_requested;
  const departed=['departed','started','completed'].includes(stage)||uploaded;
  const started=['started','completed'].includes(stage)||uploaded;
  const reportDone=uploaded||approved;
  let reportLabel='Отправить отчет';
  if(rejected)reportLabel='Исправить отчет';else if(reportDone&&!approved)reportLabel='Отчет отправлен';else if(approved)reportLabel='Отчет принят';
  return `<div class="bosOrderFlowV179" data-mode="scheduled">
    <div class="bosOrderFlowTitle">Этапы выполнения заявки</div>
    <div class="bosOrderStepList">
      ${button('Выехал',stage==='assigned'&&active(o),`masterWorkflowSetStage('${id}','departed')`,departed)}
      ${button('Начал работу',stage==='departed'&&active(o),`masterWorkflowSetStage('${id}','started')`,started)}
      ${button(reportLabel,stage==='started'&&active(o)&&(!uploaded||rejected),`masterWorkflowComplete('${id}')`,reportDone&&!rejected)}
    </div>
    <div class="bosOrderRescheduleBox">
      <div><b>Перенос заявки</b><span>Требует подтверждения диспетчера или руководителя</span></div>
      <button type="button" class="secondary bosOrderRescheduleBtn"${requested?' disabled':` onclick="masterWorkflowOpenReschedule('${id}')"`}>${requested?'Перенос запрошен':'Запросить перенос'}</button>
    </div>
  </div>`;
}
function unscheduledActions(o){const id=escv(o.id);return `<div class="bosOrderFlowV179" data-mode="agreement"><div class="bosOrderFlowTitle">Этапы выполнения заявки</div><button type="button" class="primary bosOrderAgreeBtn" onclick="openMasterOrderAgreementV179('${id}')">Договориться</button><p class="muted bosOrderAgreementNote">После согласования изменения даты и времени требуют подтверждения диспетчера или руководителя.</p></div>`}
window.openMasterOrderAgreementV179=function(id){
  const o=orderById(id);if(!liveMaster()||!active(o)||hasSchedule(o))return;
  openModal(`<h2>Согласовать дату и время</h2><p class="muted">Выберите согласованные с клиентом дату и время.</p><form id="masterOrderAgreementV179" class="form"><label>Дата *</label><input type="date" name="scheduled_date" required min="${localToday()}"><label>Время *</label><input type="time" name="scheduled_time" required step="900"><p class="muted">После сохранения заявка перейдет в рабочий сценарий мастера.</p><button class="primary wide" type="submit">Сохранить</button><button class="secondary wide" type="button" onclick="openOrder('${escv(o.id)}')">Отмена</button><p class="muted bosOrderAgreementMsg"></p></form>`);
  const form=document.getElementById('masterOrderAgreementV179');
  form.onsubmit=async e=>{e.preventDefault();if(saving||state.busy)return;const date=String(form.elements.scheduled_date.value||''),time=String(form.elements.scheduled_time.value||'').slice(0,5),msg=form.querySelector('.bosOrderAgreementMsg');if(!date||!time){msg.textContent='Укажите дату и время';return}saving=true;state.busy=true;if(typeof setBusy==='function')setBusy(form,true);msg.textContent='Сохраняем…';try{const current=orderById(o.id);if(!current?.master_called_at){const called=await api('markCalled',o.id);mergeOrder(o.id,called.order)}const saved=await api('setAgreementSchedule',o.id,{scheduled_date:date,scheduled_time:time});mergeOrder(o.id,saved.order);closeModal();setTimeout(()=>window.openOrder?.(o.id),0)}catch(err){msg.textContent=err?.message||String(err);if(typeof setBusy==='function')setBusy(form,false)}finally{saving=false;state.busy=false}};
};
function decorate(){
  queued=false;if(!liveMaster())return;
  document.querySelectorAll('#modalRoot .bosMasterAgreementModalBtn').forEach(x=>x.remove());
  const panel=document.querySelector('#modalRoot .bosMasterWorkflow[data-bos-v26="1"]');if(!panel)return;
  const id=String(panel.dataset.orderId||''),o=orderById(id),actions=panel.querySelector('.bosMwActionsV26');if(!o||!actions)return;
  const sig=JSON.stringify([o.id,dateOf(o),timeOf(o),stageOf(o),o.status,o.report_uploaded_at,o.report_act_url,o.report_review_status,o.reschedule_requested,o.reschedule_reason]);
  if(actions.dataset.bosV179Sig===sig&&actions.querySelector('.bosOrderFlowV179'))return;
  actions.dataset.bosV179Sig=sig;actions.innerHTML=hasSchedule(o)?scheduledActions(o):unscheduledActions(o);
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(decorate)}
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
const baseOpen=window.openOrder;if(typeof baseOpen==='function')window.openOrder=function(){const out=baseOpen.apply(this,arguments);setTimeout(decorate,40);setTimeout(decorate,180);return out};
setTimeout(decorate,0);
const style=document.createElement('style');style.textContent=`
.bosMasterWorkflow[data-bos-v26="1"] .bosMwActionsV26:has(.bosOrderFlowV179){display:block!important}.bosOrderFlowV179{display:grid;gap:12px}.bosOrderFlowTitle{font-size:16px;font-weight:800}.bosOrderStepList{display:grid;gap:9px}.bosOrderStepBtn,.bosOrderAgreeBtn{width:100%;min-height:48px;font-weight:800}.bosOrderStepBtn:disabled{opacity:.42;cursor:default}.bosOrderStepBtn.is-done{opacity:.72;background:rgba(45,111,224,.28);border:1px solid rgba(96,165,250,.34)}.bosOrderRescheduleBox{display:grid;gap:10px;padding:12px;border:1px solid rgba(96,165,250,.22);border-radius:14px;background:rgba(15,23,42,.42)}.bosOrderRescheduleBox>div{display:grid;gap:3px}.bosOrderRescheduleBox b{font-size:14px}.bosOrderRescheduleBox span,.bosOrderAgreementNote{font-size:12px;line-height:1.4}.bosOrderRescheduleBtn{width:100%;min-height:44px}.bosOrderAgreementNote{margin:0}.bosMasterAgreementModalBtn{display:none!important}@media(max-width:520px){.bosOrderStepBtn,.bosOrderAgreeBtn{min-height:50px;font-size:15px}}
`;document.head.appendChild(style);
})();