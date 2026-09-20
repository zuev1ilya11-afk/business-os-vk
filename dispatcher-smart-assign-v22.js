(()=>{
'use strict';
const HOURS=Array.from({length:12},(_,i)=>9+i);
let enhancing=false;

function isDispatcherDesktop(){return window.innerWidth>=1050&&((typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state?.user?.role||'')==='dispatcher')}
function active(o){return !['Выполнена','Отменена'].includes(String(o?.status||''))}
function dateOf(o){return String(o?.scheduled_date||'').slice(0,10)}
function timeOf(o){return String(o?.scheduled_time||o?.time_slot||'').slice(0,5)}
function hourOf(o){const h=Number(timeOf(o).slice(0,2));return Number.isFinite(h)?h:null}
function boardDate(){return document.getElementById('dispatchBoardDate')?.value||dateOf(selectedOrder())||localToday()}
function localToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function masterVk(m){return String(m?.vk_user_id||m?.external_id||'')}
function masterIds(m){return [m?.id,m?.staff_id,m?.master_staff_id,m?.vk_user_id,m?.external_id].filter(Boolean).map(String)}
function orderMasterIds(o){return [o?.master_staff_id,o?.master_id,o?.master_vk_id].filter(Boolean).map(String)}
function sameMaster(m,o){const ids=masterIds(m),oid=orderMasterIds(o);return ids.some(x=>oid.includes(x))||String(m?.full_name||'')===String(o?.master_name||'')}
function selectedOrder(){const id=document.querySelector('.dbOrderCard.selected')?.dataset?.orderId;return (state.orders||[]).find(o=>String(o.id)===String(id||''))||null}
function norm(v){return String(v??'').trim().toLowerCase().replace(/ё/g,'е')}
function values(v){if(Array.isArray(v))return v.flatMap(values);return String(v??'').split(/[,;|/]/).map(norm).filter(Boolean)}
function orderCity(o){return norm(o?.city||o?.location_city||o?.client_city)}
function masterCity(m){return norm(m?.city||m?.work_city||m?.location_city)}
function orderDistrict(o){return norm(o?.district||o?.area||o?.region_name)}
function masterDistricts(m){return values(m?.districts||m?.district||m?.areas||m?.area)}
function masterSkills(m){return values(m?.specializations||m?.specialization||m?.services||m?.skills)}
function orderWork(o){return norm(o?.service_name||o?.service||o?.work||'')}
function scheduleFor(m,date){const ids=new Set(masterIds(m));return (state.masterSchedule||[]).find(r=>String(r?.work_date||r?.date||'').slice(0,10)===date&&[r?.staff_id,r?.master_staff_id,r?.master_id,r?.master_vk_id,r?.external_id].filter(Boolean).map(String).some(x=>ids.has(x)))||null}
function workingHours(m,date){const s=scheduleFor(m,date);if(s?.is_working===false)return [];let from=9,to=21;if(s){from=Math.max(0,Number(String(s.work_start||'09:00').slice(0,2))||9);to=Math.min(24,Number(String(s.work_end||'21:00').slice(0,2))||21)}return HOURS.filter(h=>h>=from&&h<to)}
function busyHours(m,date,ignoreId){return new Set((state.orders||[]).filter(active).filter(o=>String(o.id)!==String(ignoreId)&&dateOf(o)===date&&sameMaster(m,o)).map(hourOf).filter(Number.isFinite))}
function loadFor(m,date,ignoreId){return (state.orders||[]).filter(active).filter(o=>String(o.id)!==String(ignoreId)&&dateOf(o)===date&&sameMaster(m,o)).length}
function preferredHour(o){const h=hourOf(o);return Number.isFinite(h)?h:9}
function chooseSlot(m,o,date){const free=workingHours(m,date).filter(h=>!busyHours(m,date,o.id).has(h));if(!free.length)return null;const pref=preferredHour(o);free.sort((a,b)=>Math.abs(a-pref)-Math.abs(b-pref)||a-b);return free[0]}
function skillMatch(m,o){const skills=masterSkills(m),work=orderWork(o);if(!skills.length||!work)return null;return skills.some(s=>work.includes(s)||s.includes(work)||work.split(/\s+/).some(w=>w.length>3&&s.includes(w)))}
function scoreCandidate(m,o,date){const slot=chooseSlot(m,o,date);if(slot===null)return null;const load=loadFor(m,date,o.id),pref=preferredHour(o);let score=100-load*8-Math.abs(slot-pref)*2;const reasons=[];
  const oc=orderCity(o),mc=masterCity(m);if(oc&&mc){if(oc===mc){score+=25;reasons.push('город совпадает')}else{score-=35;reasons.push('другой город')}}
  const od=orderDistrict(o),md=masterDistricts(m);if(od&&md.length){if(md.includes(od)){score+=12;reasons.push('район подходит')}else score-=5}
  const sm=skillMatch(m,o);if(sm===true){score+=18;reasons.push('подходит по работе')}else if(sm===false)score-=10;
  if(slot===pref){score+=10;reasons.push('нужное время свободно')}else reasons.push(`свободно в ${String(slot).padStart(2,'0')}:00`);
  if(load===0)reasons.push('нет заявок на день');else reasons.push(`${load} заяв. на день`);
  if(sameMaster(m,o)){score+=4;reasons.push('текущий мастер')}
  return {master:m,score,slot,time:`${String(slot).padStart(2,'0')}:00`,load,reasons};
}
function candidatesFor(o,date=boardDate()){return (state.masters||[]).map(m=>scoreCandidate(m,o,date)).filter(Boolean).sort((a,b)=>b.score-a.score||a.load-b.load||String(a.master?.full_name||'').localeCompare(String(b.master?.full_name||''))).slice(0,3)}
function esc(v){const d=document.createElement('div');d.textContent=String(v??'');return d.innerHTML}
function render(){
  if(enhancing||!isDispatcherDesktop()||!document.querySelector('.dbBoard'))return;enhancing=true;
  try{
    const detail=document.querySelector('.dbDetail'),o=selectedOrder();if(!detail||!o||!active(o))return;
    let box=detail.querySelector('.dbSmartAssign');if(box)box.remove();box=document.createElement('section');box.className='dbSmartAssign';
    const date=boardDate(),items=candidatesFor(o,date);box.innerHTML=`<div class="dbSmartHead"><div><b>Умный подбор мастера</b><span>${esc(date)} · рекомендация, назначение только после подтверждения</span></div></div><div class="dbSmartList">${items.length?items.map((c,i)=>`<div class="dbSmartCandidate${i===0?' best':''}"><div><strong>${i===0?'Лучший вариант · ':''}${esc(c.master.full_name||'Мастер')}</strong><span>${esc(c.reasons.join(' · '))}</span></div><div><b>${esc(c.time)}</b><button class="${i===0?'primary':'secondary'}" onclick="dispatchSmartAssign('${esc(o.id)}','${esc(masterVk(c.master))}','${esc(c.time)}')">Назначить</button></div></div>`).join(''):'<p class="muted">На выбранный день свободных мастеров не найдено.</p>'}</div>`;
    const quick=detail.querySelector('.dbV21QuickMove');if(quick)quick.insertAdjacentElement('afterend',box);else detail.appendChild(box);
  }finally{enhancing=false}
}
window.dispatchSmartAssign=function(id,m,time){const o=(state.orders||[]).find(x=>String(x.id)===String(id));if(!o)return;const master=(state.masters||[]).find(x=>masterVk(x)===String(m));if(!master)return;const date=boardDate();if(!confirm(`Назначить ${master.full_name||'мастера'} на ${date} ${time}?`))return;window.__dispatchBoardMove?.(o.id,m,time)};
window.__dispatchSmartCandidates=(id,date)=>{const o=(state.orders||[]).find(x=>String(x.id)===String(id));return o?candidatesFor(o,date||boardDate()):[]};
const observer=new MutationObserver(()=>requestAnimationFrame(render));observer.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(render,0);
const style=document.createElement('style');style.textContent=`.dbSmartAssign{margin-top:14px;padding:12px;border:1px solid rgba(127,127,127,.18);border-radius:14px;display:grid;gap:10px}.dbSmartHead{display:flex;justify-content:space-between;gap:10px}.dbSmartHead div{display:grid;gap:3px}.dbSmartHead span{font-size:11px;color:var(--muted,#6b7280)}.dbSmartList{display:grid;gap:8px}.dbSmartCandidate{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 10px;border:1px solid rgba(127,127,127,.16);border-radius:12px}.dbSmartCandidate.best{border-width:2px}.dbSmartCandidate>div:first-child{display:grid;gap:3px;min-width:0}.dbSmartCandidate span{font-size:11px;color:var(--muted,#6b7280);line-height:1.35}.dbSmartCandidate>div:last-child{display:flex;align-items:center;gap:8px;flex-shrink:0}.dbSmartCandidate button{padding:7px 10px}@media(max-width:1240px){.dbSmartCandidate{align-items:flex-start;flex-direction:column}.dbSmartCandidate>div:last-child{width:100%;justify-content:space-between}}`;document.head.appendChild(style);
})();
