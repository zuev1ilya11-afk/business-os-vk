(()=>{
'use strict';
if(window.BOS_MASTER_CALL_WORKFLOW_V26)return;window.BOS_MASTER_CALL_WORKFLOW_V26=true;
const API_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/master-workflow-api';
const STAGES=['assigned','departed','started','completed'];
const LABELS={assigned:'Назначена',departed:'Выехал',started:'Работа начата',completed:'Завершена',cancelled:'Отменена'};
const TIMES={departed:'master_departed_at',started:'master_started_at',completed:'completed_at'};
let sending=false;
let rendering=false;

function masterMode(){return String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode())}
function liveMaster(){return String(state?.user?.role||'')==='master'}
function findOrder(id){return (state?.orders||[]).find(o=>String(o.id)===String(id))||null}
function escv(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function phoneHref(v){let p=String(v||'').trim().replace(/[^\d+]/g,'');if(/^8\d{10}$/.test(p))p='+7'+p.slice(1);else if(/^\d{10}$/.test(p))p='+7'+p;return p}
function effectiveStage(o){if(String(o?.status||'')==='Выполнена')return'completed';if(String(o?.status||'')==='Отменена')return'cancelled';const raw=String(o?.master_workflow_stage||'assigned');if(raw==='arrived')return'departed';return STAGES.includes(raw)?raw:'assigned'}
function fmt(v){if(!v)return'';const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
function timeline(o){const stage=effectiveStage(o),current=STAGES.indexOf(stage);return `<div class="bosMwSteps bosMwStepsV26">${STAGES.map((s,i)=>{const done=stage==='completed'?true:i<=current,at=fmt(o?.[TIMES[s]]);return `<div class="bosMwStep${done?' done':''}${s===stage?' current':''}"><i></i><span><b>${LABELS[s]}</b>${at?`<small>${escv(at)}</small>`:''}</span></div>`}).join('')}</div>`}
function callAction(o,stage,href,preview){if(!href||preview||!liveMaster()||['completed','cancelled'].includes(stage))return'';return `<button type="button" class="secondary bosMwCallAction" onclick="masterWorkflowCallClient('${escv(o.id)}','${escv(href)}')">Позвонить клиенту</button>`}
function stageAction(o,stage,preview){if(preview||!liveMaster())return'';if(stage==='assigned')return `<button type="button" class="primary bosMwStageAction" onclick="masterWorkflowSetStage('${escv(o.id)}','departed')">Перейти: Выехал</button>`;if(stage==='departed')return `<button type="button" class="primary bosMwStageAction" onclick="masterWorkflowSetStage('${escv(o.id)}','started')">Перейти: Работа начата</button>`;return''}
function rescheduleAction(o,stage,preview){if(preview||!liveMaster()||['completed','cancelled'].includes(stage))return'';return `<button type="button" class="secondary bosMwRescheduleAction" onclick="masterWorkflowOpenReschedule('${escv(o.id)}')">Нужно перенести</button>`}
function completeAction(o,stage,preview){if(preview||!liveMaster()||stage!=='started')return'';return `<button type="button" class="primary bosMwCompleteAction" onclick="masterWorkflowComplete('${escv(o.id)}')">Перейти: Завершена</button>`}
function panelBody(o){const stage=effectiveStage(o),href=phoneHref(o.phone||o.client_phone),preview=masterMode()&&!liveMaster();const call=callAction(o,stage,href,preview),next=stageAction(o,stage,preview),reschedule=rescheduleAction(o,stage,preview),complete=completeAction(o,stage,preview);return `<div class="bosMwHead"><div><small>ХОД РАБОТЫ</small><h3>${escv(LABELS[stage]||stage)}</h3></div><span class="bosMwState">${escv(LABELS[stage]||stage)}</span></div>${timeline(o)}${preview?'<p class="muted bosMwPreview">В тестовом просмотре этапы не изменяются.</p>':''}${!href&&!['completed','cancelled'].includes(stage)?'<p class="muted bosMwPhoneMissing">У клиента не указан телефон.</p>':''}<div class="bosMwActions bosMwActionsV26">${call}${next}${reschedule}${complete}</div><p class="muted bosMwMsg"></p>`}
function panelSignature(o){return JSON.stringify([o?.id,effectiveStage(o),o?.status,o?.phone,o?.client_phone,o?.reschedule_requested,o?.reschedule_reason,o?.master_departed_at,o?.master_started_at,o?.completed_at])}
function workflowModal(){const modal=document.querySelector('#modalRoot .modal');if(!modal||modal.querySelector('#masterReportForm,#masterRescheduleForm'))return null;return modal}
function modalFor(id){const modal=workflowModal();if(!modal)return null;const marked=String(modal.dataset.bosWorkflowOrderId||'');const panel=modal.querySelector('.bosMasterWorkflow');const panelId=String(panel?.dataset?.orderId||'');if(marked&&marked!==String(id))return null;if(!marked&&panelId&&panelId!==String(id))return null;return modal}
function renderPanel(id){if(rendering||!masterMode())return;const o=findOrder(id),modal=modalFor(id);if(!o||!modal)return;rendering=true;try{modal.dataset.bosWorkflowOrderId=String(id);modal.querySelectorAll('.bosClientCallAction').forEach(x=>x.remove());let panel=modal.querySelector('.bosMasterWorkflow');if(!panel){panel=document.createElement('section');panel.className='bosMasterWorkflow';const close=[...modal.querySelectorAll('button')].find(b=>(b.textContent||'').trim()==='Закрыть');if(close)modal.insertBefore(panel,close);else modal.appendChild(panel)}panel.dataset.orderId=String(id);const sig=panelSignature(o);if(panel.dataset.bosV26Sig!==sig||panel.dataset.bosV26!=='1'){panel.dataset.bosV26='1';panel.dataset.bosV26Sig=sig;panel.innerHTML=panelBody(o)}}finally{rendering=false}}
function currentModalId(){const modal=workflowModal();if(!modal)return'';return String(modal.dataset.bosWorkflowOrderId||modal.querySelector('.bosMasterWorkflow')?.dataset?.orderId||'')}
function clearWorkflowMarker(){const modal=document.querySelector('#modalRoot .modal');if(modal)delete modal.dataset.bosWorkflowOrderId}
async function authHeaders(){const h=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};return {...h,'Content-Type':'application/json'}}
async function stageCall(id,stage){const r=await fetch(API_URL,{method:'POST',headers:await authHeaders(),body:JSON.stringify({action:'setStage',id,stage}),keepalive:true}),d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось изменить этап');return d}
function mergeOrder(id,data){const i=(state.orders||[]).findIndex(o=>String(o.id)===String(id));if(i>=0)state.orders[i]={...state.orders[i],...(data||{})}}
function setMsg(id,text){const modal=modalFor(id);const el=modal?.querySelector('.bosMasterWorkflow .bosMwMsg');if(el)el.textContent=text||''}
function refreshMasterUi(id){if(id)renderPanel(id);patchLegacyLabels()}

window.masterWorkflowCallClient=function(id,phone){const dial=phoneHref(phone);if(!dial){setMsg(id,'У клиента не указан телефон');return false}setMsg(id,'');try{window.location.assign(`tel:${dial}`)}catch(_){try{window.location.href=`tel:${dial}`}catch(e){setMsg(id,'Не удалось открыть звонок')}}return false};
window.masterWorkflowSetStage=async function(id,stage){if(!liveMaster()||sending)return;const o=findOrder(id);if(!o)return;const current=effectiveStage(o),expected=current==='assigned'?'departed':current==='departed'?'started':'';if(stage!==expected){setMsg(id,'Этапы нужно отмечать по порядку');return}sending=true;setMsg(id,'Сохраняем этап…');try{const d=await stageCall(id,stage);mergeOrder(id,d.order);setMsg(id,'');refreshMasterUi(id)}catch(e){setMsg(id,e?.message||String(e))}finally{sending=false}};
window.masterWorkflowCallAndAdvance=function(event){if(event?.preventDefault)event.preventDefault();const dial=String(event?.currentTarget?.getAttribute?.('href')||'').replace(/^tel:/,'');const id=currentModalId();return window.masterWorkflowCallClient(id,dial)};
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
document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible'||!liveMaster())return;const id=currentModalId();setTimeout(()=>{if(typeof reloadData==='function'){Promise.resolve(reloadData(true)).catch(()=>{}).finally(()=>refreshMasterUi(id))}else refreshMasterUi(id)},500)});
setTimeout(enhance,0);

const style=document.createElement('style');style.textContent=`
.bosMasterWorkflow[data-bos-v26="1"] .bosMwStepsV26{grid-template-columns:repeat(4,1fr)}.bosMasterWorkflow[data-bos-v26="1"] .bosMwActionsV26{grid-template-columns:repeat(2,minmax(0,1fr))}.bosMasterWorkflow[data-bos-v26="1"] .bosMwActionsV26>*{display:flex;align-items:center;justify-content:center;min-height:44px;box-sizing:border-box;text-decoration:none}.bosMasterWorkflow[data-bos-v26="1"] .bosMwCompleteAction{grid-column:1/-1}.bosMasterWorkflow[data-bos-v26="1"] .bosMwPhoneMissing{margin:8px 0}.bosMasterWorkflow[data-bos-v26="1"] .bosMwRescheduleAction{border-color:rgba(217,119,6,.45)}@media(max-width:520px){.bosMasterWorkflow[data-bos-v26="1"] .bosMwActionsV26{grid-template-columns:1fr}.bosMasterWorkflow[data-bos-v26="1"] .bosMwCompleteAction{grid-column:auto}}
`;document.head.appendChild(style);
})();
