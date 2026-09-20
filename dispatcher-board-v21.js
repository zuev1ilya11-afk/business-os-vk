(()=>{
'use strict';
const META_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/order-meta-api';
let freeOnly=false;
let enhancing=false;

function isDispatcherDesktop(){return window.innerWidth>=1050&&((typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state?.user?.role||'')==='dispatcher')}
function active(o){return !['Выполнена','Отменена'].includes(String(o?.status||''))}
function dateOf(o){return String(o?.scheduled_date||'').slice(0,10)}
function timeOf(o){return String(o?.scheduled_time||o?.time_slot||'').slice(0,5)}
function hourOf(o){const h=Number(timeOf(o).slice(0,2));return Number.isFinite(h)?h:null}
function boardDate(){return document.getElementById('dispatchBoardDate')?.value||''}
function masterVk(m){return String(m?.vk_user_id||m?.external_id||'')}
function masterIds(m){return [m?.id,m?.staff_id,m?.master_staff_id,m?.vk_user_id,m?.external_id].filter(Boolean).map(String)}
function orderMasterIds(o){return [o?.master_staff_id,o?.master_id,o?.master_vk_id].filter(Boolean).map(String)}
function sameMaster(m,o){const ids=masterIds(m),oid=orderMasterIds(o);return ids.some(x=>oid.includes(x))||String(m?.full_name||'')===String(o?.master_name||'')}
function selectedOrder(){const id=document.querySelector('.dbOrderCard.selected')?.dataset?.orderId;return (state.orders||[]).find(o=>String(o.id)===String(id||''))||null}
function selectedMaster(o){return (state.masters||[]).find(m=>sameMaster(m,o))||null}
function slotOf(t){const s=String(t||'').slice(0,5);if(!/^\d{2}:\d{2}$/.test(s))return '';const [h,m]=s.split(':').map(Number);return `${s}–${String((h+1)%24).padStart(2,'0')}:${String(m).padStart(2,'0')}`}
function tomorrow(){const d=new Date();d.setDate(d.getDate()+1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function localToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function setMsg(text){const x=document.getElementById('dispatchBoardMsg');if(x)x.textContent=text||''}
function updateState(id,data,extra={}){const i=(state.orders||[]).findIndex(o=>String(o.id)===String(id));if(i>=0)state.orders[i]={...state.orders[i],...(data||{}),...extra}}
async function metaCall(action,payload={}){const headers=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};headers['Content-Type']='application/json';const r=await fetch(META_URL,{method:'POST',headers,body:JSON.stringify({action,...payload})}),d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Ошибка переноса');return d}

function conflictsFor(m,date,time,ignoreId){const h=Number(String(time||'').slice(0,2));return (state.orders||[]).filter(active).filter(o=>String(o.id)!==String(ignoreId)).filter(o=>dateOf(o)===date&&sameMaster(m,o)&&hourOf(o)===h)}
function ordersForMaster(m,date){return (state.orders||[]).filter(active).filter(o=>dateOf(o)===date&&sameMaster(m,o))}

function enhanceTop(){
  const filters=document.querySelector('.dbFilters');if(!filters||document.querySelector('.dbV21Tools'))return;
  const wrap=document.createElement('div');wrap.className='dbV21Tools';
  wrap.innerHTML=`<div class="dbV21QuickDates"><button class="secondary" onclick="setDispatchBoardDate('${localToday()}')">Сегодня</button><button class="secondary" onclick="setDispatchBoardDate('${tomorrow()}')">Завтра</button></div><div class="dbV21Metrics"><span id="dbV21FreeCount">Свободных: —</span><span id="dbV21ConflictCount">Конфликтов: —</span><span id="dbV21UnassignedCount">Без мастера: —</span></div><button id="dbV21FreeToggle" class="secondary" onclick="dispatchBoardV21ToggleFree()">Есть свободное окно</button>`;
  filters.insertAdjacentElement('afterend',wrap);
}

function enhanceRows(){
  const date=boardDate();let freeCount=0,conflicts=0;
  document.querySelectorAll('.dbTimelineRow').forEach(row=>{
    const name=row.querySelector('.dbMasterCell b')?.textContent?.trim()||'';
    const m=(state.masters||[]).find(x=>String(x.full_name||'')===name);
    if(!m)return;
    const slots=[...row.querySelectorAll('.dbSlot:not(.off)')];
    const free=slots.filter(s=>!s.querySelector('.dbOrderCard')).length;
    const own=ordersForMaster(m,date),bad=slots.filter(s=>s.classList.contains('conflict')).length;
    conflicts+=bad;if(free>0)freeCount++;
    row.classList.toggle('dbV21NoFree',free===0);
    row.classList.toggle('dbV21Overloaded',bad>0||own.length>=6);
    row.style.display=freeOnly&&free===0?'none':'';
    let badge=row.querySelector('.dbV21Load');if(!badge){badge=document.createElement('small');badge.className='dbV21Load';row.querySelector('.dbMasterCell')?.appendChild(badge)}
    const text=bad?`Конфликтов: ${bad}`:free?`Свободно окон: ${free}`:'Нет свободных окон';if(badge&&badge.textContent!==text)badge.textContent=text;
  });
  const fc=document.getElementById('dbV21FreeCount');if(fc)fc.textContent=`Свободных: ${freeCount}`;
  const cc=document.getElementById('dbV21ConflictCount');if(cc)cc.textContent=`Конфликтов: ${conflicts}`;
  const uc=document.getElementById('dbV21UnassignedCount');if(uc)uc.textContent=`Без мастера: ${(state.orders||[]).filter(o=>active(o)&&!o.master_staff_id&&!o.master_id&&!o.master_vk_id&&!String(o.master_name||'').trim()).length}`;
  const toggle=document.getElementById('dbV21FreeToggle');if(toggle)toggle.className=freeOnly?'primary':'secondary';
}

function enhanceDetail(){
  const detail=document.querySelector('.dbDetail');if(!detail||detail.querySelector('.dbV21QuickMove'))return;
  const o=selectedOrder();if(!o)return;
  const box=document.createElement('div');box.className='dbV21QuickMove';
  box.innerHTML=`<b>Быстрый перенос</b><div><label><span>Дата</span><input id="dbV21MoveDate" type="date" value="${dateOf(o)||boardDate()||localToday()}"></label><label><span>Время</span><input id="dbV21MoveTime" type="time" value="${timeOf(o)||'09:00'}"></label></div><button class="secondary" onclick="dispatchBoardV21MoveSelected()">Перенести на дату и время</button>${(!o.master_staff_id&&!o.master_id&&!o.master_vk_id&&!String(o.master_name||'').trim())?'<button class="secondary" onclick="dispatchBoardV21AutoAssign()">Назначить свободному мастеру</button>':''}`;
  const msg=detail.querySelector('#dispatchBoardMsg');if(msg)detail.insertBefore(box,msg);else detail.appendChild(box);
}

function enhance(){
  if(enhancing||!isDispatcherDesktop()||!document.querySelector('.dbBoard'))return;enhancing=true;
  try{enhanceTop();enhanceRows();enhanceDetail()}finally{enhancing=false}
}

window.dispatchBoardV21ToggleFree=function(){freeOnly=!freeOnly;enhanceRows()};
window.dispatchBoardV21MoveSelected=async function(){
  const o=selectedOrder(),date=document.getElementById('dbV21MoveDate')?.value||'',time=document.getElementById('dbV21MoveTime')?.value||'';if(!o||!date||!/^\d{2}:\d{2}$/.test(time))return;
  const m=selectedMaster(o),conflicts=m?conflictsFor(m,date,time,o.id):[];if(conflicts.length&&!confirm(`У ${m.full_name||'мастера'} уже есть заявка на это время. Всё равно перенести?`))return;
  setMsg('Переносим…');
  try{
    const d=await api('updateOrder',{id:o.id,scheduled_date:date,scheduled_time:time,time_slot:slotOf(time)});if(!d.ok)throw new Error(d.error||'Не удалось перенести заявку');
    updateState(o.id,d.order,{scheduled_date:date,scheduled_time:time,time_slot:slotOf(time)});
    if(o.reschedule_requested){const r=await metaCall('resolveReschedule',{id:o.id,scheduled_date:date,scheduled_time:time});updateState(o.id,r.order,{reschedule_requested:false,reschedule_reason:null,reschedule_requested_at:null,reschedule_requested_by:null})}
    if(typeof setDispatchBoardDate==='function')setDispatchBoardDate(date);else show('orders');
  }catch(e){setMsg(e.message||String(e))}
};
window.dispatchBoardV21AutoAssign=function(){
  const o=selectedOrder();if(!o)return;
  const candidates=[];document.querySelectorAll('.dbTimelineRow').forEach(row=>{const name=row.querySelector('.dbMasterCell b')?.textContent?.trim()||'',m=(state.masters||[]).find(x=>String(x.full_name||'')===name);if(!m)return;const slot=[...row.querySelectorAll('.dbSlot:not(.off)')].find(s=>!s.querySelector('.dbOrderCard'));if(!slot)return;candidates.push({m,slot,count:ordersForMaster(m,boardDate()).length})});
  candidates.sort((a,b)=>a.count-b.count);const c=candidates[0];if(!c){alert('На выбранный день свободных окон нет');return}const h=String(c.slot.dataset.hour||'9').padStart(2,'0')+':00';window.__dispatchBoardMove?.(o.id,masterVk(c.m),h)
};

const observer=new MutationObserver(()=>requestAnimationFrame(enhance));observer.observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('resize',()=>requestAnimationFrame(enhance));
setTimeout(enhance,0);

const style=document.createElement('style');style.textContent=`
.dbV21Tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 14px}.dbV21QuickDates,.dbV21Metrics{display:flex;gap:8px;align-items:center}.dbV21Metrics{margin-left:auto}.dbV21Metrics span{padding:7px 10px;border-radius:10px;background:var(--card,#fff);border:1px solid rgba(127,127,127,.18);font-size:12px;font-weight:700}.dbV21Load{display:block;margin-top:4px;font-weight:700}.dbV21Overloaded>.dbMasterCell{box-shadow:inset 4px 0 0 #d97706}.dbV21NoFree>.dbMasterCell{opacity:.72}.dbV21QuickMove{margin-top:14px;padding:12px;border:1px solid rgba(127,127,127,.18);border-radius:14px;display:grid;gap:10px}.dbV21QuickMove>div{display:grid;grid-template-columns:1fr 1fr;gap:8px}.dbV21QuickMove label{display:grid;gap:4px}.dbV21QuickMove label span{font-size:12px;color:var(--muted,#6b7280)}.dbV21QuickMove input{width:100%;box-sizing:border-box}@media(max-width:1240px){.dbV21Metrics{margin-left:0;width:100%}}
`;document.head.appendChild(style);
})();
