(()=>{
'use strict';
if(window.BOS_MASTER_MONEY_V130)return;
window.BOS_MASTER_MONEY_V130=true;

let queued=false;
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
function completedDay(o){return window.BOS_SALARY_PERIODS.completedDay(o)}
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
const calendar=window.BOS_SALARY_PERIODS;
let selection={kind:'week',anchor:null,start:'',end:''},selectionOwner='',periodError='',rollTimer;
let draftRange={start:'',end:''};
const periodNames={day:'День',week:'Неделя',month:'Месяц',custom:'Свои даты'};
function resetForMaster(){
  const user=typeof isMasterPreview==='function'&&isMasterPreview()&&typeof previewUser!=='undefined'?previewUser:state?.user;
  const key=String(user?.id||user?.external_id||'');
  if(selectionOwner!==key){selectionOwner=key;selection={kind:'week',anchor:null,start:'',end:''};draftRange={start:'',end:''};periodError=''}
}
const dateLabel=(iso,options={day:'numeric',month:'long'})=>new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',...options}).format(new Date(`${iso}T12:00:00Z`));
const numericDate=iso=>iso.split('-').reverse().join('.');
function periodLabel(kind,range){
  if(kind==='month'){const text=dateLabel(range.start,{month:'long',year:'numeric'});return text[0].toUpperCase()+text.slice(1)}
  if(range.start===range.end)return dateLabel(range.start);
  return range.start.slice(0,7)===range.end.slice(0,7)?`${Number(range.start.slice(8))}–${dateLabel(range.end)}`:`${dateLabel(range.start,{day:'numeric',month:'short'})} – ${dateLabel(range.end,{day:'numeric',month:'short'})}`;
}
function paymentTotals(rows){
  const values=rows.map(explicitPaid),tracking=!!rows.length&&values.every(v=>v!==null),hasPayments=values.some(v=>v!==null);
  const accrued=rows.reduce((a,o)=>a+salary(o),0),paid=tracking?values.reduce((a,v)=>a+v,0):null;
  return {accrued,tracking,hasPayments,paid,balance:tracking?Math.max(0,accrued-paid):null};
}
function periodSnapshot(){
  resetForMaster();
  const today=calendar.day(),current=calendar.bounds(selection.kind==='custom'?'week':selection.kind,today);
  const range=selection.kind==='custom'?{start:selection.start,end:selection.end}:calendar.bounds(selection.kind,selection.anchor||today);
  const allDone=mine().filter(completed),done=allDone.filter(o=>calendar.contains(range,completedDay(o))).sort((a,b)=>completedDay(b).localeCompare(completedDay(a))||String(b.id).localeCompare(String(a.id),'ru',{numeric:true}));
  const base=done.reduce((a,o)=>a+payout(o),0),extras=done.reduce((a,o)=>a+extra(o),0),deductions=done.reduce((a,o)=>a+deduction(o),0);
  return {...paymentTotals(done),done,allDone,base,extras,deductions,range,current,today,kind:selection.kind,isCurrent:selection.kind!=='custom'&&!selection.anchor};
}
function snapshot(){return periodSnapshot()}
function rowsFor(kind,s=snapshot()){
  let rows=s.done;
  if(kind==='extras')rows=rows.filter(o=>extra(o)>0);
  else if(kind==='deductions')rows=rows.filter(o=>deduction(o)>0);
  else if(kind==='paid')rows=s.tracking?rows.filter(o=>num(explicitPaid(o))>0):[];
  else if(kind==='balance')rows=s.tracking?rows.filter(o=>salary(o)-num(explicitPaid(o))>0):[];
  return rows.slice();
}
function historyFor(s){
  const kind=s.kind==='custom'?'week':s.kind,current=calendar.bounds(kind,s.today),periods=new Map();
  for(const order of s.allDone){const date=completedDay(order);if(!date)continue;const range=calendar.bounds(kind,date);if(range.start>=current.start)continue;const item=periods.get(range.start)||{...range,total:0};item.total+=salary(order);periods.set(range.start,item)}
  return {kind,periods:[...periods.values()].sort((a,b)=>b.start.localeCompare(a.start)).slice(0,6)};
}
function previewOrder(o){
  const work=String(o.work||o.description||o.service_name||'Выполненная заявка'),place=[o.client||o.client_name,o.address].filter(Boolean).join(' · ');
  return `<button type="button" class="salaryOrder" data-v130-order="${escv(o.id)}"><span><small>${escv(dateLabel(completedDay(o)))} · № ${escv(orderNo(o))}</small><b>${escv(work)}</b>${place?`<small class="salaryOrderPlace" title="${escv(place)}">${escv(place)}</small>`:''}</span><strong>${escv(moneyv(salary(o)))}</strong><i aria-hidden="true">›</i></button>`;
}
function summaryHtml(s){
  const history=historyFor(s),rangeText=s.range.start===s.range.end?numericDate(s.range.start):`${numericDate(s.range.start)} — ${numericDate(s.range.end)}`;
  const currentName={day:'Сегодня',week:'Текущая неделя',month:'Текущий месяц'},periodType=s.kind==='month'?'month':'date';
  const controls=s.kind==='custom'?`<form class="salaryCustom" id="salaryPeriodForm"><label>С<input type="date" name="start" data-money-field="start" value="${escv(draftRange.start)}" max="${s.today}" required></label><label>По<input type="date" name="end" data-money-field="end" value="${escv(draftRange.end)}" max="${s.today}" required></label><button type="submit" class="primary">Показать</button></form>`:`<div class="salaryPeriodNav"><button type="button" data-money-action="previous" aria-label="Предыдущий период">‹</button><label class="salaryPeriodPicker"><span>${escv(periodLabel(s.kind,s.range))}</span><i aria-hidden="true">⌄</i><input type="${periodType}" data-money-field="anchor" aria-label="Выбрать период" value="${s.kind==='month'?s.range.start.slice(0,7):s.range.start}" max="${s.kind==='month'?s.today.slice(0,7):s.today}"></label><button type="button" data-money-action="next" aria-label="Следующий период" ${s.isCurrent?'disabled':''}>›</button></div>`;
  const next=calendar.addDays(s.range.end,1),note=s.isCurrent?`Следующий период — с ${dateLabel(next)}. Прошлые останутся в истории.`:'Просмотр выбранного периода.';
  const paymentNote=s.tracking?'':s.hasPayments?'Выплаты отмечены только по части заявок. Полного итога пока нет.':'Выплаты пока не отмечаются в приложении.';
  return `<section id="masterMoneyV130" class="masterMoneyV130 salaryPeriods"><h3>Моя зарплата</h3><div class="salaryTabs" role="group" aria-label="Период зарплаты">${Object.entries(periodNames).map(([key,label])=>`<button type="button" data-money-action="kind" data-kind="${key}" aria-pressed="${key===s.kind}">${label}</button>`).join('')}</div>${controls}<p class="salaryError" role="alert" ${periodError?'':'hidden'}>${escv(periodError)}</p><div class="salaryRange"><span data-salary-range>${escv(rangeText)}</span><span class="salaryBadge ${s.isCurrent?'current':''}">${s.isCurrent?currentName[s.kind]:s.kind==='custom'?'Свои даты':'Прошлый период'}</span>${!s.isCurrent?'<button type="button" data-money-action="current" class="secondary">К текущему</button>':''}</div><p class="salaryHint">${escv(note)} <span>Время Москвы.</span></p>
  <button type="button" class="salaryHero" data-master-money-kind="accrued"><span>Начислено за период</span><strong>${escv(moneyv(s.accrued))}</strong><small>Выполненных заявок: ${s.done.length}</small></button>
  <div class="salaryBreakdown">${[['base','По заявкам',moneyv(s.base),''],['extras','Допработы',`+ ${moneyv(s.extras)}`,'positive'],['deductions','Вычеты',moneyv(s.deductions),'negative']].map(([kind,label,value,cls])=>`<button type="button" data-master-money-kind="${kind}" class="${cls}"><span>${label}</span><strong>${escv(value)}</strong></button>`).join('')}</div>
  <div class="salaryPayments"><button type="button" data-master-money-kind="paid"><span>Выплачено</span><strong>${s.tracking?escv(moneyv(s.paid)):'Нет данных'}</strong></button><button type="button" data-master-money-kind="balance"><span>Остаток</span><strong>${s.tracking?escv(moneyv(s.balance)):'—'}</strong></button>${paymentNote?`<p>${paymentNote}</p>`:''}</div>
  <div class="salaryLower"><section class="salaryOrders"><h4>Заявки за период</h4><p class="salaryHint">Нажмите на заявку для расшифровки</p><div class="salaryOrderList">${s.done.length?s.done.slice(0,5).map(previewOrder).join(''):'<p class="salaryEmpty">За выбранный период начислений нет</p>'}</div>${s.done.length?`<button type="button" class="secondary salaryAll" data-master-money-kind="accrued">Все заявки за период (${s.done.length})</button>`:''}</section><section class="salaryHistory"><h4>Прошлые периоды</h4>${history.periods.length?history.periods.map(p=>`<button type="button" data-money-action="history" data-kind="${history.kind}" data-start="${p.start}" aria-pressed="${s.kind===history.kind&&s.range.start===p.start}"><span>${escv(periodLabel(history.kind,p))}<small>${p.start.slice(0,4)}</small></span><strong>${escv(moneyv(p.total))}</strong><i aria-hidden="true">›</i></button>`).join(''):'<p class="salaryEmpty">За прошлые периоды начислений нет</p>'}<button type="button" class="secondary salaryAll" data-money-action="choose">Выбрать другой период</button></section></div></section>`;
}
function setAnchor(value){
  const today=calendar.day();if(!calendar.valid(value)||value>today)return;
  const current=calendar.bounds(selection.kind,today),picked=calendar.bounds(selection.kind,value);
  selection.anchor=picked.start===current.start?null:picked.start;periodError='';render();
}
function changePeriod(action,node){
  resetForMaster();const s=periodSnapshot();periodError='';
  if(action==='kind'){
    const kind=node.dataset.kind;if(!Object.hasOwn(periodNames,kind))return;
    selection={kind,anchor:null,start:s.range.start,end:s.range.end>s.today?s.today:s.range.end};draftRange={start:selection.start,end:selection.end};
  }else if(action==='current'){selection.anchor=null;if(selection.kind==='custom')selection.kind='week'}
  else if(action==='previous'||action==='next'){if(action==='next'&&s.isCurrent)return;setAnchor(calendar.shift(selection.kind,s.range.start,action==='previous'?-1:1));return}
  else if(action==='history'){selection.kind=node.dataset.kind;setAnchor(node.dataset.start);return}
  else if(action==='choose'){
    const input=document.querySelector('#masterMoneyV130 [data-money-field="anchor"]')||document.querySelector('#masterMoneyV130 [data-money-field="start"]');
    input?.focus();try{input?.showPicker?.()}catch(_){}return;
  }
  render();
}
function armRollover(){clearTimeout(rollTimer);rollTimer=setTimeout(()=>{schedule();armRollover()},Math.max(50,calendar.nextMidnight()-Date.now()+50))}

const titles={base:'Выплата по заявкам',accrued:'Начисления за период',extras:'Допработы',deductions:'Вычеты',week:'ЗП за неделю',month:'ЗП за месяц',paid:'Выплачено',balance:'Остаток к выплате'};
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
    const html=`<div class="masterMoneyV130Modal"><h2>${escv(titles[kind]||'Деньги')}</h2><p class="muted">${s.hasPayments?'Выплаты отмечены только по части заявок.':'Фактические выплаты мастеру пока не отмечены.'} Business OS не подставляет выдуманное значение.</p><section class="card"><b>Начислено: ${escv(moneyv(s.accrued))}</b><p class="muted">Следующий безопасный этап — подтверждение выплаты руководителем с датой и суммой.</p></section></div>`;
    if(typeof openModal==='function')openModal(html);return;
  }
  const rows=rowsFor(kind,s),total=detailTotal(kind,rows,s);
  const note=kind==='deductions'?'Вычет уже уменьшает итоговую сумму заявки и повторно из зарплаты не вычитается.':kind==='extras'?'Допработы начисляются мастеру отдельно от базовой выплаты.':'Нажмите на заявку, чтобы открыть её карточку.';
  const html=`<div class="masterMoneyV130Modal"><div class="masterMoneyV130ModalHead"><div><h2>${escv(titles[kind]||'Деньги')}</h2><p class="muted">${escv(numericDate(s.range.start))} — ${escv(numericDate(s.range.end))}<br>${escv(note)}</p></div><strong>${escv(moneyv(total))}</strong></div><div class="masterMoneyV130Rows">${rows.length?rows.map(o=>detailRow(o,kind)).join(''):'<div class="masterMoneyV130Empty">За выбранный период начислений нет</div>'}</div></div>`;
  if(typeof openModal==='function')openModal(html);
}
window.openMasterMoneyV130=openDetails;
function render(){
  queued=false;if(!masterMode()||String(state?.page||'')!=='team')return;
  const panel=document.getElementById('masterProfileSummaryV129');if(!panel)return;
  const s=snapshot(),sig=JSON.stringify({selection,owner:selectionOwner,today:s.today,error:periodError,orders:s.allDone.map(o=>[o.id,completedDay(o),o.amount,o.master_payout,o.extra_work_amount,o.uncompleted_work_amount,o.work,o.description,o.service_name,o.client,o.client_name,o.address,o.external_id,o.master_paid_amount,o.master_payment_amount,o.master_payout_paid_amount,o.master_paid,o.master_payment_status])});
  const box=document.getElementById('masterMoneyV130');if(box?.dataset.sig===sig)return;
  const active=document.activeElement,focused=box?.contains(active)?{...active.dataset}:null;
  const wrap=document.createElement('div');wrap.innerHTML=summaryHtml(s);const next=wrap.firstElementChild;next.dataset.sig=sig;
  if(box)box.replaceWith(next);else panel.appendChild(next);
  if(focused){const control=[...next.querySelectorAll('button,input')].find(el=>focused.moneyField?el.dataset.moneyField===focused.moneyField:focused.moneyAction&&el.dataset.moneyAction===focused.moneyAction&&el.dataset.kind===focused.kind);control?.focus({preventScroll:true})}
}
function schedule(){if(queued||!masterMode())return;queued=true;requestAnimationFrame(render)}
document.addEventListener('click',e=>{const action=e.target.closest?.('#masterMoneyV130 [data-money-action]');if(action){changePeriod(action.dataset.moneyAction,action);return}const trigger=e.target.closest?.('[data-master-money-kind]');if(trigger){openDetails(trigger.dataset.masterMoneyKind);return}const row=e.target.closest?.('[data-v130-order]');if(row?.dataset.v130Order){try{window.closeModal?.()}catch(_){}window.openOrder?.(row.dataset.v130Order)}});
document.addEventListener('keydown',e=>{if(e.target.closest?.('button'))return;if(!['Enter',' '].includes(e.key))return;const trigger=e.target.closest?.('[data-master-money-kind]');if(trigger){e.preventDefault();openDetails(trigger.dataset.masterMoneyKind);return}const row=e.target.closest?.('[data-v130-order]');if(row?.dataset.v130Order){e.preventDefault();try{window.closeModal?.()}catch(_){}window.openOrder?.(row.dataset.v130Order)}});
document.addEventListener('input',e=>{const input=e.target.closest?.('#salaryPeriodForm [data-money-field]');if(input)draftRange[input.dataset.moneyField]=input.value});
document.addEventListener('change',e=>{const input=e.target.closest?.('#masterMoneyV130 [data-money-field="anchor"]');if(input)setAnchor(input.type==='month'?input.value+'-01':input.value)});
document.addEventListener('submit',e=>{
  if(e.target.id!=='salaryPeriodForm')return;e.preventDefault();
  const data=new FormData(e.target),start=String(data.get('start')||''),end=String(data.get('end')||'');
  if(!calendar.valid(start)||!calendar.valid(end)||start>end||end>calendar.day()){periodError='Выберите корректные даты: начало не позже окончания, окончание не позже сегодня.';const error=e.target.parentElement.querySelector('.salaryError');error.textContent=periodError;error.hidden=false;return}
  selection.start=start;selection.end=end;draftRange={start,end};periodError='';render();
});
window.addEventListener('focus',()=>{schedule();armRollover()});
window.addEventListener('pageshow',()=>{schedule();armRollover()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){schedule();armRollover()}});
armRollover();
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
const baseShow=window.show;if(typeof baseShow==='function')window.show=function(){const out=baseShow.apply(this,arguments);setTimeout(schedule,0);setTimeout(schedule,100);return out};
setTimeout(schedule,0);
window.BOS_MASTER_MONEY_V130_API={refresh:schedule,snapshot,periodSnapshot,rowsFor,explicitPaid,openDetails};

const style=document.createElement('style');style.textContent=`
#masterMoneyV130.salaryPeriods{padding:18px;display:grid;gap:14px;min-width:0;background:#0b1b2a;border-color:#254762;color:#e8f2fc}
.salaryPeriods h3,.salaryPeriods h4{margin:0;font-size:20px;line-height:1.3}.salaryPeriods h4{font-size:17px}
.salaryPeriods button{font:inherit;color:inherit;cursor:pointer;min-width:0;min-height:44px;border:1px solid #29445c;border-radius:10px;background:#102438}
.salaryPeriods button:disabled{cursor:default;opacity:.4}.salaryPeriods button:hover:not(:disabled){border-color:#4298ee}.salaryPeriods button:focus-visible,.salaryPeriodPicker:focus-within{outline:2px solid #58acff;outline-offset:2px}
.salaryTabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #29445c;border-radius:10px;overflow:hidden}.salaryPeriods .salaryTabs button{border:0;border-right:1px solid #29445c;border-radius:0;padding:10px 6px;font-size:14px;white-space:nowrap}.salaryPeriods .salaryTabs button:last-child{border:0}.salaryPeriods .salaryTabs [aria-pressed=true]{background:#1479eb;color:white;font-weight:700}
.salaryPeriodNav{display:grid;grid-template-columns:44px minmax(0,320px) 44px;justify-content:center;gap:8px}.salaryPeriodNav>button{font-size:26px;line-height:1;padding:0}.salaryPeriodPicker{position:relative;display:flex;align-items:center;justify-content:center;gap:10px;min-height:44px;min-width:0;border:1px solid #29445c;border-radius:10px;background:#102438;font-size:16px;font-weight:700;padding:8px}.salaryPeriodPicker input{position:absolute;inset:0;opacity:0;width:100%;height:100%;min-width:0;cursor:pointer}.salaryPeriodPicker i{font-style:normal;color:#a6c8e8}
.salaryRange{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;font-size:13px}.salaryBadge{border-radius:6px;padding:5px 8px;background:#20394f;color:#bdd3e9;font-size:12px;white-space:nowrap}.salaryBadge.current{background:#12437a;color:#d4eaff}.salaryPeriods .salaryRange button{padding:7px 12px;min-height:36px;font-size:12px}
.salaryHint{margin:0;font-size:12px;line-height:1.5;color:#a4bed8}.salaryPeriods>.salaryHint{text-align:center}.salaryHint>span{white-space:nowrap;color:#789bbd}.salaryError{margin:0;color:#ffb0ad;font-size:13px}.salaryError[hidden]{display:none}
.salaryPeriods .salaryHero{display:block;width:100%;text-align:left;padding:20px;border-color:#2b81d8;background:linear-gradient(110deg,#142e51,#0d2340)}.salaryHero span,.salaryHero strong,.salaryHero small{display:block}.salaryHero span{font-size:14px}.salaryHero strong{font-size:36px;line-height:1.2;margin:8px 0;color:white;overflow-wrap:anywhere}.salaryHero small{font-size:14px;color:#aecbe9}
.salaryBreakdown{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.salaryBreakdown button{text-align:left;padding:14px}.salaryBreakdown span,.salaryBreakdown strong{display:block}.salaryBreakdown span{font-size:12px;color:#abc5df}.salaryBreakdown strong{font-size:19px;line-height:1.4;margin-top:6px;overflow-wrap:anywhere}.salaryBreakdown .positive strong{color:#74e4af}.salaryBreakdown .negative strong{color:#f5aeaa}
.salaryPayments{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.4fr);gap:10px;align-items:center;background:#102438;border:1px solid #29445c;border-radius:12px;padding:12px}.salaryPeriods .salaryPayments button{border:0;text-align:left;padding:4px 10px;background:transparent}.salaryPayments span,.salaryPayments strong{display:block}.salaryPayments span{font-size:12px;color:#abc5df}.salaryPayments strong{font-size:15px;margin-top:6px;overflow-wrap:anywhere}.salaryPayments p{margin:0;font-size:12px;line-height:1.5;color:#a4bed8}
.salaryLower{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:14px}.salaryOrders,.salaryHistory{min-width:0;border:1px solid #29445c;border-radius:12px;padding:14px;align-self:start}.salaryOrderList{display:grid;gap:8px;margin:12px 0}.salaryPeriods .salaryOrder{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto 10px;gap:10px;align-items:center;padding:12px;text-align:left}.salaryOrder>span{min-width:0}.salaryOrder small,.salaryOrder b{display:block;line-height:1.4}.salaryOrder small{font-size:12px;color:#abc5df}.salaryOrder b{font-size:14px;margin:4px 0}.salaryOrder strong{font-size:15px;white-space:nowrap}.salaryOrder i,.salaryHistory i{font-style:normal;color:#7fbeff}.salaryOrderPlace{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.salaryPeriods .salaryAll{width:100%;margin-top:10px;border-color:#2b81d8;background:#102b48;padding:10px;font-size:13px}.salaryEmpty{font-size:13px;line-height:1.5;color:#a4bed8;margin:14px 0}
.salaryPeriods .salaryHistory>button:not(.salaryAll){display:grid;grid-template-columns:minmax(0,1fr) auto 10px;align-items:center;gap:8px;padding:12px;width:100%;margin-top:10px;text-align:left;font-size:13px}.salaryHistory button small{display:block;margin-top:4px;font-size:11px;color:#8cadcd}.salaryHistory button strong{font-size:14px;white-space:nowrap}.salaryHistory [aria-pressed=true]{border-color:#4394eb!important;background:#15385a!important}
.salaryCustom{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:10px;align-items:end}.salaryCustom label{display:grid;gap:5px;font-size:12px;color:#abc5df;min-width:0}.salaryCustom input{width:100%;min-width:0;min-height:44px;box-sizing:border-box;border:1px solid #29445c;border-radius:10px;background:#102438;color:#e8f2fc;padding:10px;font:inherit;color-scheme:dark}.salaryCustom button{padding:10px 15px;background:#1479eb}
@media(max-width:760px){#masterMoneyV130.salaryPeriods{padding:14px;gap:12px}.salaryLower{grid-template-columns:1fr}.salaryPayments{grid-template-columns:repeat(2,minmax(0,1fr))}.salaryPayments p{grid-column:1/-1}.salaryBreakdown{grid-template-columns:1fr}.salaryBreakdown button{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 13px}.salaryBreakdown strong{margin:0;font-size:18px}.salaryPeriodNav{grid-template-columns:40px minmax(0,1fr) 40px;gap:6px}.salaryPeriodPicker{font-size:14px}.salaryHero strong{font-size:32px}.salaryCustom{grid-template-columns:repeat(2,minmax(0,1fr))}.salaryCustom button{grid-column:1/-1}.salaryPeriods .salaryTabs button{font-size:12px;padding:9px 3px}.salaryOrders,.salaryHistory{padding:12px}.salaryPeriods .salaryOrder{padding:10px;gap:6px}.salaryOrder strong{font-size:14px}}
@media(max-width:360px){#masterMoneyV130.salaryPeriods{padding:10px}.salaryPeriods .salaryHero{padding:14px}.salaryHero strong{font-size:28px}.salaryRange{font-size:12px}.salaryOrder strong{font-size:12px}.salaryPeriods h3{font-size:18px}}
.masterMoneyV130Clickable{cursor:pointer;transition:border-color .16s ease,transform .16s ease,background .16s ease}.masterMoneyV130Clickable:hover{border-color:rgba(96,165,250,.55)!important;background:rgba(37,99,235,.1)!important}.masterMoneyV130Clickable:focus-visible{outline:2px solid #50b5ff;outline-offset:2px}.masterMoneyV130{padding:13px 15px;border:1px solid rgba(96,165,250,.18);border-radius:15px;background:rgba(15,30,45,.68)}.masterMoneyV130Head h3{margin:0;font-size:15px}.masterMoneyV130Head p{margin:3px 0 0;color:var(--muted,#91a3b7);font-size:10.5px}.masterMoneyV130Grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.masterMoneyV130Grid button{min-width:0;padding:10px 12px;border:1px solid rgba(255,255,255,.09);border-radius:12px;background:rgba(255,255,255,.025);color:inherit;text-align:left;cursor:pointer}.masterMoneyV130Grid button:hover{border-color:rgba(96,165,250,.5)}.masterMoneyV130Grid span,.masterMoneyV130Grid strong{display:block}.masterMoneyV130Grid span{font-size:10px;color:#a9c8f4}.masterMoneyV130Grid strong{margin-top:5px;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.masterMoneyV130Grid .untracked strong{color:var(--muted,#91a3b7);font-size:13px}.masterMoneyV130Note{margin:8px 0 0;color:var(--muted,#91a3b7);font-size:9.5px;line-height:1.35}.masterMoneyV130ModalHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.masterMoneyV130ModalHead h2{margin:0}.masterMoneyV130ModalHead p{margin:4px 0 0;max-width:560px}.masterMoneyV130ModalHead>strong{flex:0 0 auto;font-size:18px}.masterMoneyV130Rows{display:grid;gap:8px;margin-top:14px}.masterMoneyV130Row{padding:11px 12px;border:1px solid rgba(255,255,255,.09);border-radius:12px;background:rgba(255,255,255,.025);cursor:pointer}.masterMoneyV130Row:hover{border-color:rgba(96,165,250,.45)}.masterMoneyV130Row:focus-visible{outline:2px solid #50b5ff;outline-offset:2px}.masterMoneyV130RowHead{display:flex;align-items:center;justify-content:space-between;gap:10px}.masterMoneyV130RowHead small{color:var(--muted,#91a3b7)}.masterMoneyV130Row>p{margin:6px 0;color:#d5e5f8;font-size:11px}.masterMoneyV130Breakdown{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 12px;margin-top:8px}.masterMoneyV130Breakdown span{display:flex;align-items:baseline;justify-content:space-between;gap:8px;color:var(--muted,#91a3b7);font-size:10.5px}.masterMoneyV130Breakdown b{color:var(--text,#eef4fb);white-space:nowrap}.masterMoneyV130Breakdown .positive b{color:#8ed8ad}.masterMoneyV130Breakdown .negative b{color:#f6a5a5}.masterMoneyV130Breakdown em{display:block;font-size:8.5px;font-style:normal}.masterMoneyV130Breakdown .total{grid-column:1/-1;margin-top:4px;padding-top:7px;border-top:1px solid rgba(255,255,255,.07);font-size:11.5px}.masterMoneyV130Empty{padding:16px;text-align:center;color:var(--muted,#91a3b7);border:1px dashed rgba(255,255,255,.12);border-radius:12px}
@media(max-width:520px){.masterMoneyV130{padding:11px}.masterMoneyV130Grid{gap:6px}.masterMoneyV130Grid button{padding:9px}.masterMoneyV130Grid strong{font-size:14px}.masterMoneyV130ModalHead{display:block}.masterMoneyV130ModalHead>strong{display:block;margin-top:8px}.masterMoneyV130Breakdown{grid-template-columns:1fr}.masterMoneyV130Breakdown .total{grid-column:auto}}
`;document.head.appendChild(style);
})();