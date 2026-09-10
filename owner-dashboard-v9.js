(()=>{
'use strict';
function isDispatcherNow(){return (typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state.user?.role||'')==='dispatcher'}
function isMasterNow(){return typeof isMasterPreview==='function'&&isMasterPreview()}
function isOwnerNow(){return !isDispatcherNow()&&!isMasterNow()&&['owner','manager',''].includes(String(state.user?.role||'owner'))}
function orders(){return state.orders||[]}
function status(o){return String(o?.status||'')}
function done(o){return status(o)==='Выполнена'}
function cancelled(o){return status(o)==='Отменена'}
function today(){return typeof isoDate==='function'?isoDate(new Date()):new Date().toISOString().slice(0,10)}
function correctionOrders(){return orders().filter(o=>done(o)&&(String(o.report_review_status||'')==='rejected'||Number(o.uncompleted_work_amount||0)>0))}
function problemOrders(){
  const d=today(),map=new Map();
  const push=(o,reason)=>{if(!o||cancelled(o))return;const k=String(o.id);const x=map.get(k)||{order:o,reasons:[]};if(!x.reasons.includes(reason))x.reasons.push(reason);map.set(k,x)};
  orders().forEach(o=>{
    if(!done(o)&&o.scheduled_date&&String(o.scheduled_date).slice(0,10)<d)push(o,'Просрочена');
    if(!done(o)&&!o.master_name&&!o.master_vk_id&&!o.master_id)push(o,'Не назначен мастер');
    if(String(o.report_review_status||'')==='rejected')push(o,'Отчёт требует корректировки');
    if(Number(o.uncompleted_work_amount||0)>0)push(o,'Есть невыполненные работы');
    if(o.report_uploaded_at&&String(o.report_review_status||'pending')==='pending')push(o,'Отчёт на проверке');
  });
  return [...map.values()].slice(0,8)
}
function issueChip(t){return `<span class="status info" style="margin:2px 5px 2px 0;display:inline-block">${esc(t)}</span>`}
function problemBlock(){const list=problemOrders();return `<section class="dashSection"><div class="row"><div><div class="eyebrow">КОНТРОЛЬ</div><h2>Проблемные заявки</h2></div><span class="softChip">${list.length}</span></div>${list.length?list.map(x=>{const o=x.order;return `<button class="dashOrder" onclick="openOrder('${esc(o.id)}')"><div class="dashOrderBody" style="width:100%"><div class="row"><strong>${esc(o.id)} · ${esc(o.work||'Заявка')}</strong><span>${esc(String(o.scheduled_date||'').slice(0,10)||'')}</span></div><span>${esc(o.client||'')} · ${esc(o.address||'')}</span><small>${esc(o.master_name||'Мастер не назначен')}</small><div style="margin-top:7px">${x.reasons.map(issueChip).join('')}</div></div><div class="dashArrow">›</div></button>`}).join(''):'<section class="card"><p class="muted">Проблемных заявок нет.</p></section>'}</section>`}
function correctionBlock(){const list=correctionOrders();return `<section class="card"><div class="row"><div><div class="eyebrow">КОРРЕКТИРОВКИ</div><h3 style="margin:2px 0">По выполненным заявкам</h3></div><strong>${list.length}</strong></div>${list.length?list.slice(0,5).map(o=>`<button class="secondary wide" style="margin:7px 0;text-align:left" onclick="${o.report_uploaded_at?`openReportReview('${esc(o.id)}')`:`openOrder('${esc(o.id)}')`}"><b>${esc(o.id)}</b> · ${esc(o.master_name||'Мастер')}<br><span class="muted">${String(o.report_review_status||'')==='rejected'?'Отчёт отклонён — нужна корректировка':'Есть невыполненные работы'}</span></button>`).join(''):'<p class="muted">Корректировок нет.</p>'}</section>`}
function ownerMetrics(){const d=orders().filter(done),revenue=d.reduce((s,o)=>s+Number(o.amount||0),0),corr=correctionOrders().length;return `<div class="dashMetrics"><section class="card dashMetric"><span class="dashIcon">📋</span><span class="muted">Заявок</span><strong>${orders().length}</strong><small>Всего заявок</small></section><section class="card dashMetric"><span class="dashIcon">👥</span><span class="muted">Мастеров</span><strong>${(state.masters||[]).length}</strong><small>В команде</small></section><section class="card dashMetric"><span class="dashIcon">↩️</span><span class="muted">Корректировки</span><strong>${corr}</strong><small>По выполненным</small></section><section class="card dashMetric"><span class="dashIcon">₽</span><span class="muted">Выручка</span><strong>${money(revenue)}</strong><small>По выполненным</small></section></div>`}
const previousHome=pages.home;
pages.home=function(){
  if(isDispatcherNow()){
    const html=previousHome();
    const chart=typeof loadChart==='function'?loadChart():'';
    return String(html).includes('Загруженность мастеров')?html:chart+html;
  }
  if(!isOwnerNow())return previousHome();
  return `${typeof loadChart==='function'?loadChart():''}${ownerMetrics()}${correctionBlock()}${problemBlock()}`;
};
})();