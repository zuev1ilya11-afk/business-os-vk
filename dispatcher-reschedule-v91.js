(()=>{
'use strict';
const URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/order-meta-api';
const MIN_DESKTOP=1050;

function dispatcherMode(){return (typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state.user?.role||'')==='dispatcher'}
function orderById(id){return (state.orders||[]).find(x=>String(x.id)===String(id))||null}
function localToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function currentOrderId(){return String(document.querySelector('.ddQueueCard.isSelected')?.dataset?.orderId||'')}
function slotFromTime(v){const s=String(v||'').slice(0,5);if(!/^\d{2}:\d{2}$/.test(s))return '';const [h,m]=s.split(':').map(Number);return `${s}–${String((h+1)%24).padStart(2,'0')}:${String(m).padStart(2,'0')}`}

async function call(action,payload={}){
  const headers=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};
  headers['Content-Type']='application/json';
  const response=await fetch(URL,{method:'POST',headers,body:JSON.stringify({action,...payload})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.ok)throw new Error(data.error||'Не удалось перенести заявку');
  return data;
}

function inject(){
  if(!dispatcherMode()||window.innerWidth<MIN_DESKTOP||state.page!=='orders')return;
  const actions=document.querySelector('.ddDetailActions');
  if(!actions||actions.querySelector('.dispatcherRescheduleBtn'))return;
  const id=currentOrderId(),o=orderById(id);
  if(!o||['Выполнена','Отменена'].includes(String(o.status||'')))return;
  const button=document.createElement('button');
  button.type='button';
  button.className=`${o.reschedule_requested?'primary':'secondary'} dispatcherRescheduleBtn`;
  button.textContent=o.reschedule_requested?'Перенести заявку':'Изменить дату / время';
  button.onclick=()=>window.openDispatcherReschedule(id);
  actions.prepend(button);
}

window.openDispatcherReschedule=function(id){
  const o=orderById(id);if(!o)return;
  if(['Выполнена','Отменена'].includes(String(o.status||''))){alert('Нельзя переносить завершённую или отменённую заявку');return}
  const reason=String(o.reschedule_reason||'').trim();
  const date=String(o.scheduled_date||'').slice(0,10);
  const time=String(o.scheduled_time||'').slice(0,5)||String(o.time_slot||'').slice(0,5);
  openModal(`<h2>Перенести заявку № ${esc(o.external_id?.startsWith('hands:')?o.external_id.slice(6):o.id)}</h2>${o.reschedule_requested?`<section class="card dispatcherRescheduleReason"><span class="muted">Причина мастера</span><b>${esc(reason||'Причина не указана')}</b></section>`:''}<form id="dispatcherRescheduleForm" class="form"><label>Новая дата *</label><input type="date" name="scheduled_date" required min="${localToday()}" value="${esc(date)}"><label>Новое время *</label><input type="time" name="scheduled_time" required step="900" value="${esc(time)}"><section class="card dispatcherRescheduleSummary"><div><span class="muted">Мастер</span><b>${esc(o.master_name||'Не назначен')}</b></div><div><span class="muted">Сейчас</span><b>${esc(date||'Без даты')}${time?` · ${esc(time)}`:''}</b></div></section><p class="muted">Перенос изменит только дату и время. Мастер, сумма и остальные данные заявки останутся без изменений.</p><button class="primary wide" type="submit">Подтвердить перенос</button><button class="secondary wide" type="button" onclick="closeModal()">Отмена</button><p id="dispatcherRescheduleMsg" class="muted"></p></form>`);
  const form=document.getElementById('dispatcherRescheduleForm');
  form.onsubmit=async e=>{
    e.preventDefault();if(state.busy)return;
    const newDate=String(form.elements.scheduled_date.value||''),newTime=String(form.elements.scheduled_time.value||'').slice(0,5),msg=document.getElementById('dispatcherRescheduleMsg');
    if(!newDate||!newTime){msg.textContent='Укажите новую дату и время';return}
    state.busy=true;setBusy(form,true);msg.textContent='Переносим…';
    try{
      const data=await call('resolveReschedule',{id:o.id,scheduled_date:newDate,scheduled_time:newTime,time_slot:slotFromTime(newTime)});
      const i=(state.orders||[]).findIndex(x=>String(x.id)===String(o.id));
      if(i>=0)state.orders[i]={...state.orders[i],...data.order,scheduled_date:newDate,scheduled_time:newTime,time_slot:slotFromTime(newTime),reschedule_requested:false,reschedule_reason:null,reschedule_requested_at:null,reschedule_requested_by:null};
      state.busy=false;closeModal();show('orders');
    }catch(err){msg.textContent=err.message||String(err);setBusy(form,false)}finally{state.busy=false}
  };
};

const observer=new MutationObserver(()=>requestAnimationFrame(inject));
const start=()=>{const root=document.getElementById('content');if(root)observer.observe(root,{childList:true,subtree:true});inject()};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.addEventListener('resize',()=>requestAnimationFrame(inject));

const style=document.createElement('style');
style.textContent=`.dispatcherRescheduleReason{display:flex;flex-direction:column;gap:5px;margin:12px 0}.dispatcherRescheduleSummary{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dispatcherRescheduleSummary div{display:flex;flex-direction:column;gap:4px}@media(max-width:600px){.dispatcherRescheduleSummary{grid-template-columns:1fr}}`;
document.head.appendChild(style);
})();
