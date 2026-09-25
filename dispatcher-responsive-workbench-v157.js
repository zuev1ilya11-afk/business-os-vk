(()=>{
'use strict';
if(window.BOS_DISPATCHER_RESPONSIVE_V157)return;

let queued=false;
function dispatcherMode(){return String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview())}
function active(o){return !!o&&!['Выполнена','Отменена'].includes(String(o?.status||''))}
function safe(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function orderById(id){return (state?.orders||[]).find(o=>String(o?.id)===String(id))||null}
function unassigned(o){return active(o)&&!o?.master_name&&!o?.master_vk_id&&!o?.master_id&&!o?.master_staff_id}
function masterValue(m){return String(m?.vk_user_id||m?.external_id||'')}
function currentMasterValue(order){
  const direct=String(order?.master_vk_id||'');
  if(direct)return direct;
  const name=String(order?.master_name||'');
  const matched=(state?.masters||[]).find(m=>String(m?.full_name||'')===name&&masterValue(m));
  return matched?masterValue(matched):'';
}
function orderIdFromNode(node){
  if(!node)return'';
  const data=String(node.dataset?.orderId||'');if(data)return data;
  const raw=String(node.getAttribute?.('onclick')||'');
  return raw.match(/openOrder\('([^']+)'\)/)?.[1]||raw.match(/openOrder\("([^"]+)"\)/)?.[1]||'';
}
function returnPage(){return ['orders','dispatch'].includes(String(state?.page||''))?String(state.page):'orders'}

function desktopAssistHtml(order){
  if(!order)return'';
  const date=String(order.scheduled_date||'').slice(0,10);
  const candidates=unassigned(order)&&typeof window.__dispatchSmartDraftCandidates==='function'&&date
    ?window.__dispatchSmartDraftCandidates(order,date):[];
  const best=candidates?.[0]||null;
  const recommendation=best?`<div class="drv157Recommendation"><span>Рекомендуем</span><b>${safe(best.master?.full_name||best.master?.name||'Мастер')} · ${safe(best.best_time||'')}</b><small>${safe((best.reasons||[]).slice(0,2).join(' · '))}</small></div>`:'';
  const smart=unassigned(order)?`<button type="button" class="primary" onclick="openDispatcherResponsiveSmart157('${safe(order.id)}')">Подобрать мастера</button>`:'';
  const move=active(order)&&order.reschedule_requested?`<button type="button" class="secondary" onclick="openDispatcherResponsiveMove157('${safe(order.id)}')">Перенести</button>`:'';
  return `<section class="drv157DesktopAssist" data-order-id="${safe(order.id)}"><div class="drv157AssistHead"><div><span>СЛЕДУЮЩЕЕ ДЕЙСТВИЕ</span><b>${unassigned(order)?'Назначьте мастера':order.reschedule_requested?'Нужно согласовать перенос':'Заявка под контролем'}</b></div></div>${recommendation}<div class="drv157AssistActions">${smart}${move}<button type="button" class="secondary" onclick="show('dispatch')">График мастеров</button></div></section>`;
}
function decorateDesktop(){
  if(!dispatcherMode()||window.innerWidth<1050||String(state?.page||'')!=='orders')return;
  const detail=document.querySelector('#dispatchBoardDetail .dbDetail')||document.querySelector('.ddDetail');if(!detail)return;
  const selected=document.querySelector('.dbOrderCard.selected[data-order-id]')||document.querySelector('.ddQueueCard.isSelected[data-order-id]');
  const order=orderById(selected?.dataset?.orderId||'');if(!order)return;
  const existing=detail.querySelector(':scope > .drv157DesktopAssist');
  if(existing&&String(existing.dataset.orderId)===String(order.id))return;
  existing?.remove();
  const anchor=detail.querySelector(':scope > .dbDetailActions')||detail.querySelector(':scope > .ddQuickEdit');
  const wrap=document.createElement('div');wrap.innerHTML=desktopAssistHtml(order);
  const node=wrap.firstElementChild;if(!node)return;
  if(anchor)detail.insertBefore(node,anchor);else detail.appendChild(node);
}

window.openDispatcherResponsiveSmart157=function(id){
  if(typeof window.openDispatcherSmartAssign119==='function')return window.openDispatcherSmartAssign119(String(id));
  if(typeof openOrder==='function')openOrder(String(id));
};
window.openDispatcherResponsiveMove157=function(id){
  if(typeof window.openDispatcherReschedule==='function')return window.openDispatcherReschedule(String(id));
  if(typeof window.dmEditDateTime==='function')return window.dmEditDateTime(String(id));
  if(typeof openOrder==='function')openOrder(String(id));
};

function statusOptions(order){
  const current=String(order?.status||'В работе');
  const items=['В работе','Выполнена','Отменена'];
  if(current&&!items.includes(current))items.unshift(current);
  return items.map(s=>`<option value="${safe(s)}" ${s===current?'selected':''}>${safe(s)}</option>`).join('');
}
function masterOptions(order){
  const current=currentMasterValue(order),assigned=!!String(order?.master_name||order?.master_vk_id||order?.master_id||order?.master_staff_id||'');
  let html='';
  if(assigned&&!current)html+=`<option value="__keep__" selected>${safe(order.master_name||'Текущий мастер')} · оставить</option>`;
  html+='<option value="">Без мастера</option>';
  for(const m of state?.masters||[]){
    const value=masterValue(m);if(!value)continue;
    html+=`<option value="${safe(value)}" ${value===current?'selected':''}>${safe(m.full_name||'Мастер')}</option>`;
  }
  return html;
}
window.openDispatcherMobileQuick157=function(id){
  const order=orderById(id);if(!order)return;
  const page=returnPage();
  window.__bosDispatcherQuickReturn157=page;
  openModal(`<h2>Быстро изменить</h2><p class="muted drv157ModalContext">Заявка № ${safe(order.id)} · ${safe(order.client||order.work||'')}</p><div class="drv157QuickForm"><label><span>Статус</span><select id="drv157Status">${statusOptions(order)}</select></label><label><span>Мастер</span><select id="drv157Master">${masterOptions(order)}</select></label><button type="button" class="primary wide" onclick="saveDispatcherMobileQuick157('${safe(order.id)}')">Сохранить</button><button type="button" class="secondary wide" onclick="closeModal();openOrder('${safe(order.id)}')">Открыть заявку</button><p id="drv157Msg" class="muted"></p></div>`);
};
window.saveDispatcherMobileQuick157=async function(id){
  if(state.busy)return;
  const order=orderById(id);if(!order)return;
  const status=document.getElementById('drv157Status')?.value||String(order.status||'');
  const master=document.getElementById('drv157Master')?.value??'__keep__';
  const msg=document.getElementById('drv157Msg');
  const payload={id:order.id,status};
  if(master!=='__keep__')payload.master_vk_id=master;
  state.busy=true;if(msg)msg.textContent='Сохраняем…';
  try{
    const d=await api('updateOrder',payload);if(!d?.ok)throw new Error(d?.error||'Не удалось сохранить');
    const i=(state.orders||[]).findIndex(o=>String(o.id)===String(order.id));
    if(i>=0){
      const fallback={...state.orders[i],...payload};
      if(master===''&&!d.order)fallback.master_name='';
      state.orders[i]=d.order||fallback;
    }
    closeModal();
    if(typeof show==='function')show(window.__bosDispatcherQuickReturn157||'orders');
  }catch(error){if(msg)msg.textContent=error?.message||String(error)}finally{state.busy=false}
};

function addQuickButton(actions,id){
  if(!actions||!id||actions.querySelector(':scope > .drv157QuickAction'))return;
  const button=document.createElement('button');
  button.type='button';button.className='secondary drv157QuickAction';button.textContent='Статус';button.setAttribute('aria-label','Быстро изменить статус и мастера');
  button.addEventListener('click',event=>{event.stopPropagation();window.openDispatcherMobileQuick157(id)});
  const open=actions.querySelector('.dmOpenAction');
  actions.insertBefore(button,open||actions.lastElementChild||null);
}
function decorateMobile(){
  if(!dispatcherMode()||window.innerWidth>760)return;
  document.querySelectorAll('.dmCardActions').forEach(actions=>{
    const card=actions.closest('.opsCompactOrder');addQuickButton(actions,orderIdFromNode(card));
  });
  document.querySelectorAll('.dmv2Actions').forEach(actions=>{
    const card=actions.closest('.dmv2Order');addQuickButton(actions,orderIdFromNode(card));
  });
}
function decorate(){
  if(!dispatcherMode())return;
  decorateDesktop();decorateMobile();
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;decorate()})}

const content=document.getElementById('content');
if(content)new MutationObserver(schedule).observe(content,{childList:true,subtree:true});
window.addEventListener('resize',schedule);
queueMicrotask(schedule);

window.BOS_DISPATCHER_RESPONSIVE_V157={decorate,openQuick:window.openDispatcherMobileQuick157};

const style=document.createElement('style');style.textContent=`
@media(min-width:1050px){
 .drv157DesktopAssist{margin:14px 0;padding:14px;border:1px solid rgba(76,169,255,.2);border-radius:16px;background:linear-gradient(135deg,rgba(32,83,124,.15),rgba(12,25,38,.35));display:grid;gap:11px}.drv157AssistHead span,.drv157Recommendation span{display:block;font-size:10px;font-weight:800;letter-spacing:.1em;color:#7f9bb4}.drv157AssistHead b{display:block;margin-top:3px;font-size:15px}.drv157Recommendation{padding:10px 11px;border-radius:12px;background:rgba(13,28,43,.7);border:1px solid rgba(255,255,255,.07)}.drv157Recommendation b{display:block;margin-top:2px;font-size:14px}.drv157Recommendation small{display:block;margin-top:4px;color:#91a7bb;line-height:1.35}.drv157AssistActions{display:flex;gap:8px;flex-wrap:wrap}.drv157AssistActions button{min-height:40px}
}
.drv157QuickForm{display:grid;gap:12px}.drv157QuickForm label{display:grid;gap:6px}.drv157QuickForm label>span{font-size:12px;color:#91a5b8}.drv157QuickForm select{width:100%;min-height:46px}.drv157ModalContext{margin-top:-4px}
@media(max-width:760px){
 .drv157QuickAction{min-height:40px!important}.dmCardActions .drv157QuickAction,.dmv2Actions .drv157QuickAction{margin:0}
}
`;
document.head.appendChild(style);
})();