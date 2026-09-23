(()=>{
'use strict';
if(window.BOS_DISPATCHER_SMART_ASSIGN_V119)return;
window.BOS_DISPATCHER_SMART_ASSIGN_V119=true;

const HOURS=Array.from({length:11},(_,i)=>10+i);
let queued=false;

function dispatcherMode(){return String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview())}
function active(o){return !!o&&!['Выполнена','Отменена'].includes(String(o.status||''))}
function norm(v){return String(v??'').trim().toLowerCase().replace(/ё/g,'е')}
function values(v){if(Array.isArray(v))return v.flatMap(values);return String(v??'').split(/[,;|/]/).map(norm).filter(Boolean)}
function safe(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]))}
function pad(n){return String(n).padStart(2,'0')}
function localToday(){const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function dateOf(o){return String(o?.scheduled_date||'').slice(0,10)}
function masterKey(m){return String(m?.vk_user_id||m?.external_id||m?.id||m?.staff_id||'')}
function masterIds(m){return [m?.id,m?.staff_id,m?.master_staff_id,m?.vk_user_id,m?.external_id,m?.user_id].filter(Boolean).map(String)}
function orderMasterIds(o){return [o?.master_staff_id,o?.master_id,o?.master_vk_id].filter(Boolean).map(String)}
function sameMaster(m,o){const ids=masterIds(m),orderIds=orderMasterIds(o);return ids.some(id=>orderIds.includes(id))||String(m?.full_name||m?.name||'')===String(o?.master_name||'')}
function orderIdFromCard(card){return String(card?.dataset?.orderId||'')||String(card?.getAttribute?.('onclick')||'').match(/openOrder\('([^']+)'\)/)?.[1]||''}
function orderById(id){return (state?.orders||[]).find(o=>String(o?.id)===String(id))||null}
function unassigned(o){return active(o)&&!o?.master_staff_id&&!o?.master_id&&!o?.master_vk_id&&!String(o?.master_name||'').trim()}
function toMinutes(value){const m=String(value||'').match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null}
function timeOf(o){return String(o?.scheduled_time||o?.time_slot||'').slice(0,5)}
function intervalOf(o){
  const slot=String(o?.time_slot||'').replace(/[—-]/g,'–');
  if(slot.includes('–')){
    const [a,b]=slot.split('–').map(x=>toMinutes(x.trim()));
    if(a!==null&&b!==null&&b>a)return [a,b];
  }
  const start=toMinutes(o?.scheduled_time);
  return start===null?null:[start,start+60];
}
function scheduleFor(m,date){
  const ids=new Set(masterIds(m));
  return (state?.masterSchedule||[]).find(r=>String(r?.work_date||r?.date||'').slice(0,10)===date&&[r?.staff_id,r?.master_staff_id,r?.master_id,r?.master_vk_id,r?.external_id,r?.user_id].filter(Boolean).map(String).some(id=>ids.has(id)))||null;
}
function workHours(m,date){
  const row=scheduleFor(m,date);
  if(row&&(row.is_working===false||String(row.is_working)==='false'))return [];
  const personalStart=toMinutes(m?.work_start),personalEnd=toMinutes(m?.work_end);
  if(!row&&(personalStart===null||personalEnd===null))return [];
  const start=toMinutes(row?.work_start)??personalStart;
  const end=toMinutes(row?.work_end)??personalEnd;
  if(start===null||end===null||end<=start)return [];
  return HOURS.filter(h=>h*60>=start&&(h+1)*60<=end);
}
function busyIntervals(m,date,ignoreId){
  return (state?.orders||[]).filter(active).filter(o=>String(o.id)!==String(ignoreId||'')&&dateOf(o)===date&&sameMaster(m,o)).map(intervalOf).filter(Boolean);
}
function freeTimes(m,date,ignoreId){
  const busy=busyIntervals(m,date,ignoreId);
  return workHours(m,date).filter(h=>{
    const a=h*60,b=(h+1)*60;
    return !busy.some(([x,y])=>a<y&&x<b);
  }).map(h=>`${pad(h)}:00`);
}
function dayLoad(m,date,ignoreId){return (state?.orders||[]).filter(active).filter(o=>String(o.id)!==String(ignoreId||'')&&dateOf(o)===date&&sameMaster(m,o)).length}
function workText(o){return norm(o?.service_name||o?.service||o?.work||'')}
function skills(m){return values(m?.specializations||m?.specialization||m?.services||m?.skills)}
function skillMatch(m,o){
  const list=skills(m),work=workText(o);if(!list.length||!work)return null;
  return list.some(s=>work.includes(s)||s.includes(work)||work.split(/\s+/).some(w=>w.length>3&&s.includes(w)));
}
function cityOf(v){return norm(v?.city||v?.work_city||v?.location_city)}
function preferredMinutes(o){return toMinutes(timeOf(o))??600}
function rankCandidate(m,o,date){
  const times=freeTimes(m,date,o?.id);if(!times.length)return null;
  const pref=preferredMinutes(o);
  times.sort((a,b)=>Math.abs(toMinutes(a)-pref)-Math.abs(toMinutes(b)-pref)||toMinutes(a)-toMinutes(b));
  const best=times[0],load=dayLoad(m,date,o?.id),distance=Math.abs((toMinutes(best)-pref)/60);
  let score=100-load*8-distance*2;
  const reasons=[];
  const oc=cityOf(o),mc=cityOf(m);
  if(oc&&mc){if(oc===mc){score+=25;reasons.push('город совпадает')}else{score-=35;reasons.push('другой город')}}
  const sm=skillMatch(m,o);if(sm===true){score+=18;reasons.push('подходит по работе')}else if(sm===false)score-=10;
  if(toMinutes(best)===pref){score+=10;reasons.push('нужное время свободно')}else reasons.push(`ближайшее ${best}`);
  reasons.push(load?`${load} заяв. на день`:'день свободен');
  if(sameMaster(m,o)){score+=4;reasons.push('текущий мастер')}
  return {master:m,master_key:masterKey(m),score,load,best_time:best,free_times:times.slice(0,3),reasons};
}
function candidatesFor(o,date){
  if(!date)return [];
  return (state?.masters||[]).map(m=>rankCandidate(m,o,date)).filter(Boolean).sort((a,b)=>b.score-a.score||a.load-b.load||String(a.master?.full_name||a.master?.name||'').localeCompare(String(b.master?.full_name||b.master?.name||''),'ru')).slice(0,3);
}
window.__dispatchSmartDraftCandidates=(draft,date)=>candidatesFor(draft||{},String(date||draft?.scheduled_date||'').slice(0,10));

function serviceText(form){
  const option=form?.querySelector('#bosService option:checked');
  return String(option?.textContent||'').split(' — ')[0].trim();
}
function formDraft(form){
  const slot=String(form?.elements?.time_slot?.value||'');
  return {
    id:'',
    city:state?.user?.city||'',
    work:serviceText(form),
    scheduled_date:String(form?.elements?.scheduled_date?.value||''),
    scheduled_time:slot.split('–')[0]||''
  };
}
function slotFor(time){const h=Number(String(time).slice(0,2));return `${pad(h)}:00–${pad(h+1)}:00`}
function loadText(c){return c.load?`${c.load} заяв.`:'0 заяв.'}
function candidateHtml(c,index,buttonLabel){
  const name=c.master?.full_name||c.master?.name||'Мастер';
  return `<div class="dsa119Candidate${index===0?' best':''}" data-master="${safe(c.master_key)}"><div class="dsa119CandidateMain"><div class="dsa119CandidateTitle"><b>${index===0?'Рекомендуем · ':''}${safe(name)}</b><span>${safe(loadText(c))}</span></div><p>${safe(c.reasons.join(' · '))}</p><div class="dsa119Times">${c.free_times.map(t=>`<span>${safe(t)}</span>`).join('')}</div></div><button type="button" class="${index===0?'primary':'secondary'} dsa119Pick" data-master="${safe(c.master_key)}" data-time="${safe(c.best_time)}">${safe(buttonLabel)} ${safe(c.best_time)}</button></div>`;
}
function allowedByForm(form,candidate){
  const select=form?.elements?.master_vk_id;if(!select)return true;
  const option=[...select.options].find(o=>String(o.value)===String(candidate.master_key));
  return !option||!option.disabled;
}
function renderFormSmart(box,form){
  const draft=formDraft(form),date=draft.scheduled_date;
  if(!date){box.hidden=true;box.replaceChildren();return}
  box.hidden=false;
  const items=candidatesFor(draft,date).filter(c=>allowedByForm(form,c));
  box.innerHTML=`<div class="dsa119Head"><div><b>Умный подбор мастера</b><span>${safe(date)} · учитываем город, загрузку, график и занятое время</span></div></div><div class="dsa119List">${items.length?items.map((c,i)=>candidateHtml(c,i,'Выбрать')).join(''):'<p class="muted">На выбранный день свободных мастеров не найдено.</p>'}</div>`;
  box.querySelectorAll('.dsa119Pick').forEach(button=>button.addEventListener('click',()=>{
    const master=form.elements.master_vk_id,time=form.elements.time_slot;
    const slot=slotFor(button.dataset.time||'');
    if(time&&[...time.options].some(o=>o.value===slot||o.textContent===slot)){time.value=slot;time.dispatchEvent(new Event('change',{bubbles:true}))}
    if(master){
      const option=[...master.options].find(o=>String(o.value)===String(button.dataset.master));
      if(option&&!option.disabled){master.value=button.dataset.master||'';master.dispatchEvent(new Event('change',{bubbles:true}))}
    }
    box.querySelectorAll('.dsa119Candidate').forEach(x=>x.classList.toggle('selected',x.dataset.master===button.dataset.master));
  }));
}
function enhanceOrderForm(){
  if(!dispatcherMode())return;
  const form=document.getElementById('orderForm');
  if(!form||form.dataset.dsa119==='1')return;
  const title=form.closest('.modal')?.querySelector('h2')?.textContent||'';
  if(!/Новая заявка/i.test(title))return;
  form.dataset.dsa119='1';
  const date=form.elements.scheduled_date,slot=form.elements.time_slot,service=form.querySelector('#bosService');
  if(!date||!slot)return;
  const plan=date.closest('.newOrderSection')||date.closest('.two')?.parentElement||form;
  const target=plan.querySelector('.newOrderGrid')||plan;
  const box=document.createElement('section');box.className='dsa119Form';box.hidden=true;target.appendChild(box);
  const refresh=()=>requestAnimationFrame(()=>renderFormSmart(box,form));
  date.addEventListener('change',refresh);slot.addEventListener('change',refresh);service?.addEventListener('change',refresh);
  refresh();
}

function modalDraft(order,date){return {...order,scheduled_date:date,city:order?.city||state?.user?.city||''}}
function renderMobileModal(orderId){
  const order=orderById(orderId),dateInput=document.getElementById('dsa119Date'),list=document.getElementById('dsa119ModalList');
  if(!order||!dateInput||!list)return;
  const date=dateInput.value||localToday(),items=candidatesFor(modalDraft(order,date),date);
  list.innerHTML=items.length?items.map((c,i)=>candidateHtml(c,i,'Назначить')).join(''):'<p class="muted">На выбранный день свободных мастеров не найдено.</p>';
  list.querySelectorAll('.dsa119Pick').forEach(button=>button.addEventListener('click',()=>assignMobile(order.id,button.dataset.master||'',button.dataset.time||'',date)));
}
function openMobileSmart(orderId){
  const order=orderById(orderId);if(!order||!unassigned(order))return;
  const date=dateOf(order)||localToday();
  openModal(`<h2>Подобрать мастера</h2><p class="muted">Заявка № ${safe(typeof window.BOS_ORDER_NO==='function'?window.BOS_ORDER_NO(order):order.id)} · ${safe(order.work||'Работа')}</p><label class="dsa119DateLabel"><span>Дата выполнения</span><input id="dsa119Date" type="date" value="${safe(date)}"></label><section id="dsa119ModalList" class="dsa119List"></section><p id="dsa119Msg" class="muted"></p>`);
  document.getElementById('dsa119Date')?.addEventListener('change',()=>renderMobileModal(order.id));
  renderMobileModal(order.id);
}
async function assignMobile(orderId,masterValue,time,date){
  const order=orderById(orderId),master=(state?.masters||[]).find(m=>masterKey(m)===String(masterValue));
  if(!order||!master||state.busy)return;
  if(!confirm(`Назначить ${master.full_name||master.name||'мастера'} на ${date} ${time}?`))return;
  const msg=document.getElementById('dsa119Msg');state.busy=true;if(msg)msg.textContent='Назначаем…';
  try{
    const payload={id:order.id,master_vk_id:masterValue,scheduled_date:date,scheduled_time:time,time_slot:slotFor(time)};
    const d=await api('updateOrder',payload);if(!d?.ok)throw new Error(d?.error||'Не удалось назначить мастера');
    const i=(state.orders||[]).findIndex(o=>String(o.id)===String(order.id));
    if(i>=0)state.orders[i]={...state.orders[i],...(d.order||{}),...payload,master_name:master.full_name||master.name||''};
    closeModal();show('orders');
  }catch(error){if(msg)msg.textContent=error?.message||String(error)}finally{state.busy=false}
}
window.openDispatcherSmartAssign119=openMobileSmart;

function decorateMobileCards(){
  const root=document.getElementById('content');if(!root)return;
  if(!dispatcherMode()||String(state?.page||'')!=='orders'||window.innerWidth>760){root.querySelectorAll('.dsa119CardAction').forEach(x=>x.remove());return}
  root.querySelectorAll('#bosOrderList .opsCompactOrder').forEach(card=>{
    const order=orderById(orderIdFromCard(card)),actions=card.querySelector(':scope > .dmCardActions');
    if(!order||!actions||!unassigned(order)||order.reschedule_requested){card.querySelector('.dsa119CardAction')?.remove();return}
    if(actions.querySelector('.dsa119CardAction'))return;
    const button=document.createElement('button');button.type='button';button.className='secondary dsa119CardAction';button.textContent='Подобрать';button.setAttribute('aria-label','Подобрать мастера');
    button.addEventListener('click',event=>{event.stopPropagation();openMobileSmart(order.id)});
    const assign=actions.querySelector('.dmAssignAction');actions.insertBefore(button,assign||actions.firstChild);
  });
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;decorateMobileCards()})}

const previousOpenOrderForm=window.openOrderForm;
if(typeof previousOpenOrderForm==='function')window.openOrderForm=function enhanceNewOrderFormSmartAssign(){
  const result=previousOpenOrderForm.apply(this,arguments);
  const id=arguments[0];
  if(dispatcherMode()&&(id===undefined||id===null||id===''))requestAnimationFrame(()=>requestAnimationFrame(enhanceOrderForm));
  return result;
};

const start=()=>{const root=document.getElementById('content');if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});schedule()};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.addEventListener('resize',schedule);

const style=document.createElement('style');
style.textContent=`
.dsa119Form{grid-column:1/-1;display:grid;gap:9px;margin-top:2px;padding:11px;border:1px solid rgba(77,166,255,.22);border-radius:13px;background:rgba(57,137,214,.06)}.dsa119Form[hidden]{display:none!important}.dsa119Head>div{display:grid;gap:3px}.dsa119Head b{font-size:13px}.dsa119Head span{font-size:11px;line-height:1.35;color:#8fa4b8}.dsa119List{display:grid;gap:8px}.dsa119Candidate{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.025)}.dsa119Candidate.best{border-color:rgba(77,166,255,.34)}.dsa119Candidate.selected{box-shadow:inset 3px 0 0 rgba(77,166,255,.75)}.dsa119CandidateMain{display:grid;gap:4px;min-width:0}.dsa119CandidateTitle{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dsa119CandidateTitle b{font-size:12px}.dsa119CandidateTitle span{font-size:10px;color:#91a6b9}.dsa119Candidate p{margin:0;font-size:10.5px;line-height:1.35;color:#8fa4b8}.dsa119Times{display:flex;gap:5px;flex-wrap:wrap}.dsa119Times span{padding:3px 6px;border-radius:999px;background:rgba(77,166,255,.1);color:#a9d6ff;font-size:10px}.dsa119Pick{flex:0 0 auto;min-height:44px}.dsa119DateLabel{display:flex!important;flex-direction:column;gap:6px;margin:10px 0 12px!important}.dsa119DateLabel span{font-size:11px;font-weight:700;color:#9fb3c8}.dsa119DateLabel input{min-height:46px}
@media(max-width:760px){.dsa119Form{grid-column:auto}.dsa119Candidate{align-items:stretch;flex-direction:column}.dsa119Pick{width:100%;min-height:46px}.dmCardActions .dsa119CardAction{min-height:46px;border-color:rgba(77,166,255,.42);color:#acd9ff;font-weight:800}}
`;
document.head.appendChild(style);
})();
