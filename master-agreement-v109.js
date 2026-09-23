(()=>{
'use strict';
if(window.BOS_MASTER_AGREEMENT_V109)return;window.BOS_MASTER_AGREEMENT_V109=true;
const API_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/master-workflow-api';
let saving=false,queued=false;

function masterMode(){return String(state?.user?.role||'')==='master'}
function orderById(id){return (state?.orders||[]).find(o=>String(o.id)===String(id))||null}
function stageOf(o){const s=String(o?.master_workflow_stage||'assigned');return s==='arrived'?'departed':['assigned','departed','started'].includes(s)?s:'assigned'}
function calledDone(o){return !!o?.master_called_at||['departed','started'].includes(stageOf(o))||!!o?.report_uploaded_at}
function eligible(o){return masterMode()&&o&&calledDone(o)&&stageOf(o)!=='started'&&!o?.report_uploaded_at&&!['Выполнена','Отменена'].includes(String(o.status||''))}
function escv(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function localToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
async function authHeaders(){const h=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};return {...h,'Content-Type':'application/json'}}
async function saveSchedule(id,date,time){
  const r=await fetch(API_URL,{method:'POST',headers:await authHeaders(),body:JSON.stringify({action:'setAgreementSchedule',id,scheduled_date:date,scheduled_time:time})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось сохранить дату и время');
  return d;
}
function mergeOrder(id,data){const i=(state.orders||[]).findIndex(o=>String(o.id)===String(id));if(i>=0)state.orders[i]={...state.orders[i],...(data||{})}}

window.openMasterAgreement=function(id){
  const o=orderById(id);if(!eligible(o))return;
  const number=String(o.external_id||'').startsWith('hands:')?String(o.external_id).slice(6):String(o.id||'');
  const currentDate=String(o.scheduled_date||'').slice(0,10),currentTime=String(o.scheduled_time||o.time_slot||'').slice(0,5);
  openModal(`<h2>Договорённость по заявке № ${escv(number)}</h2><p class="muted bosMasterAgreementHint">Укажите согласованные с клиентом дату и время. До начала работы их можно изменить здесь.</p><form id="masterAgreementForm" class="form"><label>Дата *</label><input type="date" name="scheduled_date" required min="${localToday()}" value="${escv(currentDate)}"><label>Время *</label><input type="time" name="scheduled_time" required step="900" value="${escv(currentTime)}"><p class="muted">После сохранения заявка перейдёт к этапу «Работа».</p><button class="primary wide" type="submit">Сохранить договорённость</button><button class="secondary wide" type="button" onclick="openOrder('${escv(o.id)}')">Отмена</button><p id="masterAgreementMsg" class="muted"></p></form>`);
  const form=document.getElementById('masterAgreementForm');
  form.onsubmit=async e=>{
    e.preventDefault();if(saving||state.busy)return;
    const date=String(form.elements.scheduled_date.value||''),time=String(form.elements.scheduled_time.value||'').slice(0,5),msg=document.getElementById('masterAgreementMsg');
    if(!date||!time){msg.textContent='Укажите дату и время';return}
    saving=true;state.busy=true;setBusy(form,true);msg.textContent='Сохраняем…';
    try{
      const d=await saveSchedule(o.id,date,time);mergeOrder(o.id,d.order);closeModal();show('orders');
    }catch(err){msg.textContent=err?.message||String(err);setBusy(form,false)}finally{saving=false;state.busy=false}
  };
};

function injectListButtons(){
  if(!masterMode()||String(state?.page||'')!=='orders')return;
  document.querySelectorAll('.masterOrdersV99Card[data-master-order-id]').forEach(card=>{
    const id=String(card.dataset.masterOrderId||''),o=orderById(id),next=card.nextElementSibling;
    if(!eligible(o)){if(next?.classList?.contains('bosMasterAgreementBtn'))next.remove();return}
    if(next?.classList?.contains('bosMasterAgreementBtn'))return;
    const btn=document.createElement('button');btn.type='button';btn.className='primary wide bosMasterAgreementBtn';btn.dataset.orderId=id;btn.textContent=o?.master_agreed_at?'Изменить договорённость':'Договориться';btn.onclick=e=>{e.preventDefault();e.stopPropagation();window.openMasterAgreement(id)};card.insertAdjacentElement('afterend',btn);
  });
}
function injectModalButton(id){
  const o=orderById(id),modal=document.querySelector('#modalRoot .modal');
  if(!eligible(o)||!modal||modal.querySelector('.bosMasterAgreementModalBtn'))return;
  const btn=document.createElement('button');btn.type='button';btn.className='primary wide bosMasterAgreementModalBtn';btn.textContent=o?.master_agreed_at?'Изменить договорённость':'Договориться';btn.onclick=()=>window.openMasterAgreement(id);
  const workflow=modal.querySelector('.bosMasterWorkflow');
  if(workflow)workflow.insertAdjacentElement('beforebegin',btn);else{const close=[...modal.querySelectorAll('button')].find(b=>(b.textContent||'').trim()==='Закрыть');if(close)modal.insertBefore(btn,close);else modal.appendChild(btn)}
}
const baseOpenOrder=window.openOrder;
if(typeof baseOpenOrder==='function')window.openOrder=function(id){const out=baseOpenOrder.apply(this,arguments);if(masterMode()){setTimeout(()=>injectModalButton(id),0);setTimeout(()=>injectModalButton(id),100)}return out};
function enhance(){queued=false;injectListButtons()}
const start=()=>{const root=document.getElementById('content');if(root)new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(enhance)}).observe(root,{childList:true,subtree:true});enhance()};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();

const style=document.createElement('style');style.textContent=`
.bosMasterAgreementBtn{margin:6px 0 12px!important;min-height:44px}.bosMasterAgreementModalBtn{margin:10px 0!important}.bosMasterAgreementHint{margin-top:-3px}
@media(max-width:520px){.bosMasterAgreementBtn,.bosMasterAgreementModalBtn{min-height:46px;font-size:14px}}
`;document.head.appendChild(style);
})();