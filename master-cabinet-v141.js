(()=>{
'use strict';
if(window.BOS_MASTER_CABINET_V141)return;
window.BOS_MASTER_CABINET_V141=true;

let queued=false;
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
const moneyv=v=>typeof money==='function'?money(v):`${num(v).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})} ₽`;
const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const completed=o=>String(o?.status||'')==='Выполнена'||String(o?.report_review_status||'')==='approved';
const pad=n=>String(n).padStart(2,'0');
const todayIso=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const completedDay=o=>window.BOS_MASTER_PROFILE_SUMMARY_V129_API?.completedDay?.(o)||String(o?.completed_at||o?.report_reviewed_at||o?.scheduled_date||'').slice(0,10);
const payout=o=>num(window.BOS_MASTER_PROFILE_SUMMARY_V129_API?.payout?.(o)??o?.master_payout);
const extra=o=>num(o?.extra_work_amount);
const deduction=o=>num(o?.uncompleted_work_amount);
const salary=o=>payout(o)+extra(o);
const orderNo=o=>{const ext=String(o?.external_id||'');return ext.startsWith('hands:')?ext.slice(6):String(o?.id||'—')};
function mine(){
  if(typeof ownOrders==='function')return (ownOrders()||[]).filter(Boolean);
  const all=(state?.orders||[]).filter(Boolean),u=state?.user||{};
  const ids=new Set([u.id,u.staff_id,u.master_id,u.vk_user_id,u.external_id].filter(Boolean).map(String));
  if(!ids.size)return String(u.role||'')==='master'?all:[];
  return all.filter(o=>[o.master_staff_id,o.master_id,o.master_vk_id,o.staff_id,o.vk_user_id,o.external_id].filter(Boolean).map(String).some(x=>ids.has(x)));
}
function doneRows(){return mine().filter(completed).sort((a,b)=>String(completedDay(b)||'').localeCompare(String(completedDay(a)||''))||String(b?.id||'').localeCompare(String(a?.id||''),'ru',{numeric:true}))}
function todayRows(){const today=todayIso();return doneRows().filter(o=>completedDay(o)===today)}
function metricCard(){
  const rows=todayRows(),total=rows.reduce((a,o)=>a+salary(o),0);
  return `<div class="masterV129Metric period masterCabinetV141Today masterMoneyV130Clickable" data-master-cabinet-v141="today" role="button" tabindex="0" aria-label="ЗП сегодня: открыть расшифровку" title="Открыть расшифровку"><span>ЗП сегодня</span><strong>${escv(moneyv(total))}</strong></div>`;
}
function previewRow(o){
  const day=completedDay(o)||'—',work=String(o?.work||o?.description||o?.service_name||'').trim(),client=String(o?.client||o?.client_name||'').trim(),extras=extra(o),deduct=deduction(o);
  return `<button type="button" class="masterCabinetV141Order" data-master-cabinet-v141-order="${escv(String(o?.id||''))}"><span class="masterCabinetV141OrderMain"><b>№ ${escv(orderNo(o))}</b><small>${escv(day)}</small></span><span class="masterCabinetV141OrderText">${escv(work||client||'Выполненная заявка')}</span><span class="masterCabinetV141OrderMoney"><strong>${escv(moneyv(salary(o)))}</strong>${extras?`<em class="positive">+ ${escv(moneyv(extras))} доп.</em>`:''}${deduct?`<em class="negative">− ${escv(moneyv(deduct))} вычет</em>`:''}</span></button>`;
}
function completedHtml(rows){
  const latest=rows.slice(0,5);
  return `<section id="masterCabinetV141Completed" class="masterCabinetV141Completed"><div class="masterCabinetV141Head"><div><h3>Выполненные заявки</h3><p>Последние завершённые работы и начисления</p></div><button type="button" class="secondary" data-master-cabinet-v141="all">Все</button></div><div class="masterCabinetV141List">${latest.length?latest.map(previewRow).join(''):'<div class="masterCabinetV141Empty">Выполненных заявок пока нет</div>'}</div></section>`;
}
function todayDetailRow(o){
  const extras=extra(o),deduct=deduction(o);
  return `<article class="masterMoneyV130Row" data-master-cabinet-v141-order="${escv(String(o?.id||''))}" role="button" tabindex="0"><div class="masterMoneyV130RowHead"><b>№ ${escv(orderNo(o))}</b><small>${escv(completedDay(o)||'—')}</small></div><div class="masterMoneyV130Breakdown"><span>Выплата мастеру <b>${escv(moneyv(payout(o)))}</b></span>${extras?`<span class="positive">Допработы <b>+ ${escv(moneyv(extras))}</b></span>`:''}${deduct?`<span class="negative">Вычет <b>− ${escv(moneyv(deduct))}</b><em>уже учтён в сумме заявки</em></span>`:''}<span class="total">Итого начислено <b>${escv(moneyv(salary(o)))}</b></span></div></article>`;
}
function openToday(){
  const rows=todayRows(),total=rows.reduce((a,o)=>a+salary(o),0);
  const html=`<div class="masterMoneyV130Modal"><div class="masterMoneyV130ModalHead"><div><h2>ЗП сегодня</h2><p class="muted">Начисления по завершённым сегодня заявкам.</p></div><strong>${escv(moneyv(total))}</strong></div><div class="masterMoneyV130Rows">${rows.length?rows.map(todayDetailRow).join(''):'<div class="masterMoneyV130Empty">Сегодня начислений пока нет</div>'}</div></div>`;
  if(typeof openModal==='function')openModal(html);
}
function render(){
  queued=false;
  if(!masterMode()||String(state?.page||'')!=='team')return;
  const panel=document.getElementById('masterProfileSummaryV129');if(!panel)return;
  const metrics=panel.querySelector('.masterV129Metrics');if(!metrics)return;
  const rows=doneRows(),today=todayRows(),sig=JSON.stringify(rows.map(o=>[o.id,o.status,o.report_review_status,completedDay(o),o.amount,o.master_payout,o.extra_work_amount,o.uncompleted_work_amount]));
  let todayCard=panel.querySelector('.masterCabinetV141Today');
  const wrap=document.createElement('div');wrap.innerHTML=metricCard();const freshCard=wrap.firstElementChild;
  if(todayCard)todayCard.replaceWith(freshCard);else{const week=[...metrics.querySelectorAll('.masterV129Metric')].find(x=>(x.querySelector('span')?.textContent||'').trim()==='ЗП за неделю');if(week)week.insertAdjacentElement('beforebegin',freshCard);else metrics.appendChild(freshCard)}
  let completedBox=document.getElementById('masterCabinetV141Completed');
  if(completedBox?.dataset.sig!==sig){const boxWrap=document.createElement('div');boxWrap.innerHTML=completedHtml(rows);const next=boxWrap.firstElementChild;next.dataset.sig=sig;if(completedBox)completedBox.replaceWith(next);else{const moneyBox=document.getElementById('masterMoneyV130');if(moneyBox)moneyBox.insertAdjacentElement('afterend',next);else panel.appendChild(next)}}
  panel.dataset.v141TodayCount=String(today.length);
}
function schedule(){if(queued||!masterMode())return;queued=true;requestAnimationFrame(render)}
document.addEventListener('click',e=>{
  const action=e.target.closest?.('[data-master-cabinet-v141]');
  if(action){const kind=action.dataset.masterCabinetV141;if(kind==='today'){e.preventDefault();e.stopPropagation();openToday();return}if(kind==='all'){e.preventDefault();e.stopPropagation();window.openMasterMoneyV130?.('accrued');return}}
  const row=e.target.closest?.('[data-master-cabinet-v141-order]');if(row?.dataset.masterCabinetV141Order){e.preventDefault();e.stopPropagation();try{window.closeModal?.()}catch(_){}window.openOrder?.(row.dataset.masterCabinetV141Order)}
});
document.addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key))return;const action=e.target.closest?.('[data-master-cabinet-v141]');if(action){e.preventDefault();if(action.dataset.masterCabinetV141==='today')openToday();else if(action.dataset.masterCabinetV141==='all')window.openMasterMoneyV130?.('accrued');return}const row=e.target.closest?.('[data-master-cabinet-v141-order]');if(row?.dataset.masterCabinetV141Order){e.preventDefault();try{window.closeModal?.()}catch(_){}window.openOrder?.(row.dataset.masterCabinetV141Order)}});
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
setTimeout(schedule,0);
window.BOS_MASTER_CABINET_V141_API={refresh:schedule,todayRows,doneRows,openToday};

const style=document.createElement('style');style.textContent=`
.masterCabinetV141Completed{padding:13px 15px;border:1px solid rgba(96,165,250,.18);border-radius:15px;background:rgba(15,30,45,.68)}.masterCabinetV141Head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.masterCabinetV141Head h3{margin:0;font-size:15px}.masterCabinetV141Head p{margin:3px 0 0;color:var(--muted,#91a3b7);font-size:10.5px}.masterCabinetV141Head button{min-height:36px;padding:7px 12px}.masterCabinetV141List{display:grid;gap:7px;margin-top:10px}.masterCabinetV141Order{display:grid;grid-template-columns:minmax(90px,.65fr) minmax(0,1.5fr) minmax(110px,.8fr);gap:10px;align-items:center;width:100%;padding:10px 11px;border:1px solid rgba(255,255,255,.08);border-radius:11px;background:rgba(255,255,255,.025);color:inherit;text-align:left;cursor:pointer}.masterCabinetV141Order:hover{border-color:rgba(96,165,250,.45)}.masterCabinetV141OrderMain b,.masterCabinetV141OrderMain small,.masterCabinetV141OrderText,.masterCabinetV141OrderMoney strong,.masterCabinetV141OrderMoney em{display:block}.masterCabinetV141OrderMain small{margin-top:3px;color:var(--muted,#91a3b7);font-size:10px}.masterCabinetV141OrderText{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11.5px}.masterCabinetV141OrderMoney{text-align:right}.masterCabinetV141OrderMoney strong{font-size:13px}.masterCabinetV141OrderMoney em{margin-top:2px;font-size:9px;font-style:normal}.masterCabinetV141OrderMoney .positive{color:#8ed8ad}.masterCabinetV141OrderMoney .negative{color:#f6a5a5}.masterCabinetV141Empty{padding:14px;text-align:center;color:var(--muted,#91a3b7);border:1px dashed rgba(255,255,255,.12);border-radius:11px}
@media(max-width:520px){.masterCabinetV141Completed{padding:11px}.masterCabinetV141Order{grid-template-columns:minmax(78px,.65fr) minmax(0,1.25fr) minmax(92px,.8fr);gap:7px;padding:9px}.masterCabinetV141OrderText{font-size:10.5px}.masterCabinetV141OrderMoney strong{font-size:12px}.masterCabinetV141Head p{font-size:10px}}
`;document.head.appendChild(style);
})();
