(()=>{
'use strict';
if(window.BOS_MASTER_MONEY_V130)return;
window.BOS_MASTER_MONEY_V130=true;

let queued=false;
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
const moneyv=v=>typeof money==='function'?money(v):`${num(v).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2})} ₽`;
const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const completed=o=>String(o?.status||'')==='Выполнена'||String(o?.report_review_status||'')==='approved';
const dateOnly=v=>String(v||'').slice(0,10);
const pad=n=>String(n).padStart(2,'0');
const localIso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

function mine(){
  if(typeof ownOrders==='function')return (ownOrders()||[]).filter(Boolean);
  const all=(state?.orders||[]).filter(Boolean),u=state?.user||{};
  const ids=new Set([u.id,u.staff_id,u.master_id,u.vk_user_id,u.external_id].filter(Boolean).map(String));
  if(!ids.size)return String(u.role||'')==='master'?all:[];
  return all.filter(o=>[o.master_staff_id,o.master_id,o.master_vk_id,o.staff_id,o.vk_user_id,o.external_id].filter(Boolean).map(String).some(x=>ids.has(x)));
}
function completedDay(o){
  if(window.BOS_MASTER_PROFILE_SUMMARY_V129_API?.completedDay)return window.BOS_MASTER_PROFILE_SUMMARY_V129_API.completedDay(o);
  if(o?.completed_at){const d=new Date(o.completed_at);if(!Number.isNaN(d.getTime()))return localIso(d)}
  if(o?.report_reviewed_at){const d=new Date(o.report_reviewed_at);if(!Number.isNaN(d.getTime()))return localIso(d)}
  return dateOnly(o?.scheduled_date);
}
function payout(o){
  if(window.BOS_MASTER_PROFILE_SUMMARY_V129_API?.payout)return num(window.BOS_MASTER_PROFILE_SUMMARY_V129_API.payout(o));
  const raw=o?.amount;
  if(raw!==undefined&&raw!==null&&raw!==''){
    const amount=Number(raw);
    if(Number.isFinite(amount))return Math.round(amount*.85*.65*100)/100;
  }
  return num(o?.master_payout);
}
const extra=o=>num(o?.extra_work_amount);
const deduction=o=>num(o?.uncompleted_work_amount);
const salary=o=>payout(o)+extra(o);
function explicitPaid(o){
  for(const value of [o?.master_paid_amount,o?.master_payment_amount,o?.master_payout_paid_amount]){
    if(value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value)))return Math.max(0,Number(value));
  }
  if(o?.master_paid===true||String(o?.master_payment_status||'').toLowerCase()==='paid')return salary(o);
  return null;
}
function mondayOf(value=new Date()){
  const d=value instanceof Date?new Date(value):new Date(`${value}T12:00:00`);
  d.setHours(12,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return localIso(d);
}
function addDays(iso,n){const d=new Date(`${iso}T12:00:00`);d.setDate(d.getDate()+n);return localIso(d)}
function periodOrders(done,start,end){return done.filter(o=>{const d=completedDay(o);return d&&d>=start&&d<=end})}
function orderNo(o){const ext=String(o?.external_id||'');return ext.startsWith('hands:')?ext.slice(6):String(o?.id||'—')}
function snapshot(){
  const done=mine().filter(completed),now=new Date(),weekStart=mondayOf(now),weekEnd=addDays(weekStart,6),monthStart=`${now.getFullYear()}-${pad(now.getMonth()+1)}-01`,monthEnd=localIso(new Date(now.getFullYear(),now.getMonth()+1,0,12));
  const accrued=done.reduce((a,o)=>a+salary(o),0),tracking=done.some(o=>explicitPaid(o)!==null),paid=tracking?done.reduce((a,o)=>a+num(explicitPaid(o)),0):null;
  return{done,accrued,tracking,paid,balance:tracking?Math.max(0,accrued-paid):null,weekStart,weekEnd,monthStart,monthEnd,week:periodOrders(done,weekStart,weekEnd),month:periodOrders(done,monthStart,monthEnd)};
}
function rowsFor(kind,s=snapshot()){
  let rows=s.done;
  if(kind==='extras')rows=rows.filter(o=>extra(o)>0);
  else if(kind==='deductions')rows=rows.filter(o=>deduction(o)>0);
  else if(kind==='week')rows=s.week;
  else if(kind==='month')rows=s.month;
  else if(kind==='paid')rows=s.tracking?rows.filter(o=>num(explicitPaid(o))>0):[];
  else if(kind==='balance')rows=s.tracking?rows.filter(o=>salary(o)-num(explicitPaid(o))>0):[];
  return rows.slice().sort((a,b)=>String(completedDay(b)||'').localeCompare(String(completedDay(a)||'')));
}
function summaryHtml(s){
  const paid=s.tracking?moneyv(s.paid):'Нет данных',balance=s.tracking?moneyv(s.balance):'—';
  return `<section id="masterMoneyV130" class="masterMoneyV130"><div class="masterMoneyV130Head"><div><h3>Деньги</h3><p>Нажмите на показатель выше или на карточку ниже для расшифровки по заявкам</p></div></div><div class="masterMoneyV130Grid"><button type="button" data-master-money-kind="accrued"><span>Начислено</span><strong>${escv(moneyv(s.accrued))}</strong></button><button type="button" data-master-money-kind="paid" class="${s.tracking?'':'untracked'}"><span>Выплачено</span><strong>${escv(paid)}</strong></button><button type="button" data-master-money-kind="balance" class="${s.tracking?'':'untracked'}"><span>Остаток</span><strong>${escv(balance)}</strong></button></div>${s.tracking?'':`<p class="masterMoneyV130Note">Фактические выплаты пока не фиксируются в Business OS. Начисления считаются точно; «Выплачено» и «Остаток» появятся после подключения подтверждения выплат руководителем.</p>`}</section>`;
}
const titles={base:'Выплата по заявкам',accrued:'Все начисления',extras:'Допработы',deductions:'Вычеты',week:'ЗП за неделю',month:'ЗП за месяц',paid:'Выплачено',balance:'Остаток к выплате'};
function detailTotal(kind,rows,s){
  if(kind==='extras')return rows.reduce((a,o)=>a+extra(o),0);
  if(kind==='deductions')return rows.reduce((a,o)=>a+deduction(o),0);
  if(kind==='paid')return s.tracking?rows.reduce((a,o)=>a+num(explicitPaid(o)),0):0;
  if(kind==='balance')return s.tracking?rows.reduce((a,o)=>a+Math.max(0,salary(o)-num(explicitPaid(o))),0):0;
  if(kind==='base')return rows.reduce((a,o)=>a+payout(o),0);
  return rows.reduce((a,o)=>a+salary(o),0);
}
function detailRow(o,kind){
  const date=completedDay(o)||dateOnly(o?.scheduled_date)||'—',base=payout(o),extras=extra(o),deduct=deduction(o),total=salary(o),paid=explicitPaid(o),description=kind==='extras'?(o?.extra_work_description||''):kind==='deductions'?(o?.uncompleted_work_description||''):'';
  const paidLine=paid!==null?`<span>Выплачено <b>${escv(moneyv(paid))}</b></span>`:'';
  return `<article class="masterMoneyV130Row" data-v130-order="${escv(String(o?.id||''))}" role="button" tabindex="0"><div class="masterMoneyV130RowHead"><b>№ ${escv(orderNo(o))}</b><small>${escv(date)}</small></div>${description?`<p>${escv(description)}</p>`:''}<div class="masterMoneyV130Breakdown"><span>Выплата мастеру <b>${escv(moneyv(base))}</b></span>${extras?`<span class="positive">Допработы <b>+ ${escv(moneyv(extras))}</b></span>`:''}${deduct?`<span class="negative">Вычет <b>− ${escv(moneyv(deduct))}</b><em>уже учтён в сумме заявки</em></span>`:''}${paidLine}<span class="total">Итого начислено <b>${escv(moneyv(total))}</b></span></div></article>`;
}
function openDetails(kind){
  if(!masterMode())return;
  const s=snapshot();
  if((kind==='paid'||kind==='balance')&&!s.tracking){
    const html=`<div class="masterMoneyV130Modal"><h2>${escv(titles[kind]||'Деньги')}</h2><p class="muted">Фактические выплаты мастеру пока не хранятся отдельным событием. Поэтому Business OS не подставляет выдуманное значение.</p><section class="card"><b>Начислено: ${escv(moneyv(s.accrued))}</b><p class="muted">Следующий безопасный этап — подтверждение выплаты руководителем с датой и суммой.</p></section></div>`;
    if(typeof openModal==='function')openModal(html);return;
  }
  const rows=rowsFor(kind,s),total=detailTotal(kind,rows,s);
  const note=kind==='deductions'?'Вычет уже уменьшает итоговую сумму заявки и повторно из зарплаты не вычитается.':kind==='extras'?'Допработы начисляются мастеру отдельно от базовой выплаты.':'Нажмите на заявку, чтобы открыть её карточку.';
  const html=`<div class="masterMoneyV130Modal"><div class="masterMoneyV130ModalHead"><div><h2>${escv(titles[kind]||'Деньги')}</h2><p class="muted">${escv(note)}</p></div><strong>${escv(moneyv(total))}</strong></div><div class="masterMoneyV130Rows">${rows.length?rows.map(o=>detailRow(o,kind)).join(''):'<div class="masterMoneyV130Empty">За выбранный период начислений нет</div>'}</div></div>`;
  if(typeof openModal==='function')openModal(html);
}
window.openMasterMoneyV130=openDetails;
function decorate(panel){
  const map={'Моя выплата':'base','Допработы':'extras','Вычеты':'deductions','ЗП за неделю':'week','ЗП за месяц':'month','Общая зарплата':'accrued'};
  panel.querySelectorAll('.masterV129Metric').forEach(card=>{
    const label=(card.querySelector('span')?.textContent||'').trim(),kind=map[label];if(!kind)return;
    card.dataset.masterMoneyKind=kind;card.setAttribute('role','button');card.setAttribute('tabindex','0');card.setAttribute('aria-label',`${label}: открыть расшифровку`);card.title='Открыть расшифровку';card.classList.add('masterMoneyV130Clickable');
  });
}
function render(){
  queued=false;if(!masterMode()||String(state?.page||'')!=='team')return;
  const panel=document.getElementById('masterProfileSummaryV129');if(!panel)return;
  decorate(panel);
  const s=snapshot(),sig=JSON.stringify({orders:s.done.map(o=>[o.id,o.amount,o.original_amount,o.extra_work_amount,o.uncompleted_work_amount,o.completed_at,o.report_reviewed_at,o.master_paid_amount,o.master_payment_amount,o.master_payout_paid_amount,o.master_paid,o.master_payment_status])});
  let box=document.getElementById('masterMoneyV130');if(box?.dataset.sig===sig)return;
  const wrap=document.createElement('div');wrap.innerHTML=summaryHtml(s);const next=wrap.firstElementChild;next.dataset.sig=sig;
  if(box)box.replaceWith(next);else{const metrics=panel.querySelector('.masterV129Metrics');metrics?.insertAdjacentElement('afterend',next)}
}
function schedule(){if(queued||!masterMode())return;queued=true;requestAnimationFrame(render)}
document.addEventListener('click',e=>{const trigger=e.target.closest?.('[data-master-money-kind]');if(trigger){openDetails(trigger.dataset.masterMoneyKind);return}const row=e.target.closest?.('[data-v130-order]');if(row?.dataset.v130Order){try{window.closeModal?.()}catch(_){}window.openOrder?.(row.dataset.v130Order)}});
document.addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key))return;const trigger=e.target.closest?.('[data-master-money-kind]');if(trigger){e.preventDefault();openDetails(trigger.dataset.masterMoneyKind);return}const row=e.target.closest?.('[data-v130-order]');if(row?.dataset.v130Order){e.preventDefault();try{window.closeModal?.()}catch(_){}window.openOrder?.(row.dataset.v130Order)}});
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
const baseShow=window.show;if(typeof baseShow==='function')window.show=function(){const out=baseShow.apply(this,arguments);setTimeout(schedule,0);setTimeout(schedule,100);return out};
setTimeout(schedule,0);
window.BOS_MASTER_MONEY_V130_API={refresh:schedule,snapshot,rowsFor,explicitPaid,openDetails};

const style=document.createElement('style');style.textContent=`
.masterMoneyV130Clickable{cursor:pointer;transition:border-color .16s ease,transform .16s ease,background .16s ease}.masterMoneyV130Clickable:hover{border-color:rgba(96,165,250,.55)!important;background:rgba(37,99,235,.1)!important}.masterMoneyV130Clickable:focus-visible{outline:2px solid #50b5ff;outline-offset:2px}.masterMoneyV130{padding:13px 15px;border:1px solid rgba(96,165,250,.18);border-radius:15px;background:rgba(15,30,45,.68)}.masterMoneyV130Head h3{margin:0;font-size:15px}.masterMoneyV130Head p{margin:3px 0 0;color:var(--muted,#91a3b7);font-size:10.5px}.masterMoneyV130Grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.masterMoneyV130Grid button{min-width:0;padding:10px 12px;border:1px solid rgba(255,255,255,.09);border-radius:12px;background:rgba(255,255,255,.025);color:inherit;text-align:left;cursor:pointer}.masterMoneyV130Grid button:hover{border-color:rgba(96,165,250,.5)}.masterMoneyV130Grid span,.masterMoneyV130Grid strong{display:block}.masterMoneyV130Grid span{font-size:10px;color:#a9c8f4}.masterMoneyV130Grid strong{margin-top:5px;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.masterMoneyV130Grid .untracked strong{color:var(--muted,#91a3b7);font-size:13px}.masterMoneyV130Note{margin:8px 0 0;color:var(--muted,#91a3b7);font-size:9.5px;line-height:1.35}.masterMoneyV130ModalHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.masterMoneyV130ModalHead h2{margin:0}.masterMoneyV130ModalHead p{margin:4px 0 0;max-width:560px}.masterMoneyV130ModalHead>strong{flex:0 0 auto;font-size:18px}.masterMoneyV130Rows{display:grid;gap:8px;margin-top:14px}.masterMoneyV130Row{padding:11px 12px;border:1px solid rgba(255,255,255,.09);border-radius:12px;background:rgba(255,255,255,.025);cursor:pointer}.masterMoneyV130Row:hover{border-color:rgba(96,165,250,.45)}.masterMoneyV130Row:focus-visible{outline:2px solid #50b5ff;outline-offset:2px}.masterMoneyV130RowHead{display:flex;align-items:center;justify-content:space-between;gap:10px}.masterMoneyV130RowHead small{color:var(--muted,#91a3b7)}.masterMoneyV130Row>p{margin:6px 0;color:#d5e5f8;font-size:11px}.masterMoneyV130Breakdown{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 12px;margin-top:8px}.masterMoneyV130Breakdown span{display:flex;align-items:baseline;justify-content:space-between;gap:8px;color:var(--muted,#91a3b7);font-size:10.5px}.masterMoneyV130Breakdown b{color:var(--text,#eef4fb);white-space:nowrap}.masterMoneyV130Breakdown .positive b{color:#8ed8ad}.masterMoneyV130Breakdown .negative b{color:#f6a5a5}.masterMoneyV130Breakdown em{display:block;font-size:8.5px;font-style:normal}.masterMoneyV130Breakdown .total{grid-column:1/-1;margin-top:4px;padding-top:7px;border-top:1px solid rgba(255,255,255,.07);font-size:11.5px}.masterMoneyV130Empty{padding:16px;text-align:center;color:var(--muted,#91a3b7);border:1px dashed rgba(255,255,255,.12);border-radius:12px}
@media(max-width:520px){.masterMoneyV130{padding:11px}.masterMoneyV130Grid{gap:6px}.masterMoneyV130Grid button{padding:9px}.masterMoneyV130Grid strong{font-size:14px}.masterMoneyV130ModalHead{display:block}.masterMoneyV130ModalHead>strong{display:block;margin-top:8px}.masterMoneyV130Breakdown{grid-template-columns:1fr}.masterMoneyV130Breakdown .total{grid-column:auto}}
`;document.head.appendChild(style);
})();