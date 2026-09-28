(()=>{
'use strict';
if(window.BOS_UNIFIED_DISPATCH_SCHEDULE_V187)return;
const MIN_DESKTOP=1050;
const META_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/order-meta-api';
const STEP=30;
const ROW_PX=46;
let queued=false,rendering=false,lastSignature='',busy=false,legacyDisabled=false;

const st=()=>{try{return typeof state!=='undefined'?state:null}catch(_){return null}};
const dispatcherDesktop=()=>window.innerWidth>=MIN_DESKTOP&&window.BOS_PERMISSIONS.isDispatcherWorkspaceActive(st()?.user);
const active=o=>!!o&&!['Выполнена','Отменена'].includes(String(o?.status||''));
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10);
const timeOf=o=>String(o?.scheduled_time||o?.time_slot||'').slice(0,5);
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const boardDate=()=>String(document.getElementById('dispatchBoardDate')?.value||'').slice(0,10);
const masterVk=m=>String(m?.vk_user_id||m?.external_id||'');
const masterIds=m=>[m?.id,m?.staff_id,m?.master_staff_id,m?.vk_user_id,m?.external_id].filter(Boolean).map(String);
const orderMasterIds=o=>[o?.master_staff_id,o?.master_id,o?.master_vk_id].filter(Boolean).map(String);
const sameMaster=(m,o)=>masterIds(m).some(x=>orderMasterIds(o).includes(x))||String(m?.full_name||'')===String(o?.master_name||'');
const findMaster=v=>(st()?.masters||[]).find(m=>masterVk(m)===String(v||''))||null;
const orderById=id=>(st()?.orders||[]).find(o=>String(o?.id)===String(id))||null;
const mins=t=>{const m=String(t||'').match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):NaN};
const hhmm=n=>{n=Math.max(0,Math.min(24*60,n));const h=Math.floor(n/60),m=n%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`};
const roundStep=n=>Math.round(n/STEP)*STEP;
const unassigned=o=>active(o)&&!o?.master_staff_id&&!o?.master_id&&!o?.master_vk_id&&!String(o?.master_name||'').trim();

function slotRange(o){
  const start=mins(timeOf(o));
  if(!Number.isFinite(start))return null;
  const raw=String(o?.time_slot||'');
  const pair=raw.match(/(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})/);
  let end=pair?mins(pair[2]):NaN;
  if(!Number.isFinite(end)||end<=start)end=start+60;
  end=Math.min(24*60,Math.max(start+STEP,roundStep(end)));
  return {start,end,slots:Math.max(1,Math.round((end-start)/STEP))};
}
function rangeText(start,slots){return `${hhmm(start)}–${hhmm(Math.min(24*60,start+Math.max(1,slots)*STEP))}`}
function overlap(a0,a1,b0,b1){return a0<b1&&b0<a1}
function scheduleFor(m,date){const ids=new Set(masterIds(m));return (st()?.masterSchedule||[]).find(r=>String(r.work_date||r.date||'').slice(0,10)===date&&[r?.staff_id,r?.master_staff_id,r?.master_id,r?.master_vk_id,r?.external_id].filter(Boolean).map(String).some(x=>ids.has(x)))||null}
function available(m,date,t){const r=scheduleFor(m,date);if(!r)return true;if(r.is_working===false)return false;const x=mins(t),from=mins(String(r.work_start||'09:00').slice(0,5)),to=mins(String(r.work_end||'18:00').slice(0,5));return x>=from&&x<to}
function masterLabel(m,date){const r=scheduleFor(m,date);if(!r)return 'График не задан';if(r.is_working===false)return 'Выходной';return `${String(r.work_start||'09:00').slice(0,5)}–${String(r.work_end||'18:00').slice(0,5)}`}
function visibleMasters(){const f=document.getElementById('bosOrderMaster')?.value||'',free=document.getElementById('dbV21FreeToggle')?.classList.contains('primary');return (st()?.masters||[]).filter(m=>(!f||String(m.full_name||'')===f)&&(!free||masterStats(m,boardDate()).free>0))}
function dayAssigned(date){return (st()?.orders||[]).filter(active).filter(o=>dateOf(o)===date&&!unassigned(o))}
function noOf(o){const x=String(o?.external_id||'');return x.startsWith('hands:')?x.slice(6):String(o?.id||'')}
function statusLabel(o){if(o?.reschedule_requested)return 'Перенос';if(o?.master_workflow_stage==='started')return 'В работе';if(o?.master_workflow_stage==='departed')return 'Выехал';return String(o?.status||'В работе')}
function orderInterval(o){const r=slotRange(o);return r||{start:mins(timeOf(o))||0,end:(mins(timeOf(o))||0)+60,slots:2}}
function startsAt(o,t){return orderInterval(o).start===mins(t)}
function covers(o,t){const r=orderInterval(o),x=mins(t);return x>=r.start&&x<r.end}
function conflictFor(id,m,date,start,end){return (st()?.orders||[]).filter(active).some(o=>String(o.id)!==String(id)&&dateOf(o)===date&&sameMaster(m,o)&&(()=>{const r=orderInterval(o);return overlap(start,end,r.start,r.end)})())}
function timelineBounds(date,masters){
  let lo=9*60,hi=21*60;
  for(const m of masters){const r=scheduleFor(m,date);if(r&&r.is_working!==false){const a=mins(String(r.work_start||'').slice(0,5)),b=mins(String(r.work_end||'').slice(0,5));if(Number.isFinite(a))lo=Math.min(lo,a);if(Number.isFinite(b))hi=Math.max(hi,b)}}
  for(const o of dayAssigned(date)){const r=slotRange(o);if(r){lo=Math.min(lo,r.start);hi=Math.max(hi,r.end)}}
  lo=Math.max(6*60,Math.floor(lo/STEP)*STEP);hi=Math.min(24*60,Math.ceil(hi/STEP)*STEP);
  if(hi-lo<8*60)hi=Math.min(24*60,lo+8*60);
  return {lo,hi};
}
function timesBetween(lo,hi){const out=[];for(let x=lo;x<hi;x+=STEP)out.push(hhmm(x));return out}
function masterStats(m,date){const own=dayAssigned(date).filter(o=>sameMaster(m,o)),{lo,hi}=timelineBounds(date,[m]);let free=0,conflicts=0;for(const t of timesBetween(lo,hi)){const n=own.filter(o=>covers(o,t)).length;if(!n&&available(m,date,t))free++;if(n>1)conflicts++}return {free,conflicts}}
// Give intersecting intervals separate lanes for the whole connected group.
function layoutOrders(orders){
  const result=new Map();let group=[],ends=[],groupEnd=-1;
  const flush=()=>{for(const item of group)result.set(String(item.o.id),{lane:item.lane,lanes:ends.length});group=[];ends=[]};
  for(const o of [...orders].sort((a,b)=>orderInterval(a).start-orderInterval(b).start||String(a.id).localeCompare(String(b.id)))){
    const r=orderInterval(o);if(r.start>=groupEnd){flush();groupEnd=-1}let lane=ends.findIndex(end=>end<=r.start);if(lane<0)lane=ends.length;ends[lane]=r.end;group.push({o,lane});groupEnd=Math.max(groupEnd,r.end);
  }
  flush();return result;
}
function signature(date,masters){return JSON.stringify({date,masters:masters.map(m=>[m.id,m.external_id,m.full_name]),orders:dayAssigned(date).map(o=>[o.id,o.master_staff_id,o.master_vk_id,o.master_name,o.scheduled_time,o.time_slot,o.status,o.reschedule_requested,o.master_workflow_stage]),schedule:(st()?.masterSchedule||[]).filter(r=>String(r.work_date||r.date||'').slice(0,10)===date).map(r=>[r.staff_id,r.master_staff_id,r.master_vk_id,r.is_working,r.work_start,r.work_end])})}
function scheduleView(board){if(sessionStorage.getItem('bosDispatchV24Control')==='1')return false;const tabs=[...(board?.querySelectorAll('.dbViewTabs button')||[])],list=tabs.find(b=>String(b.textContent||'').trim()==='Список'),schedule=tabs.find(b=>String(b.textContent||'').trim()==='Расписание');if(list?.classList.contains('primary'))return false;return !schedule||schedule.classList.contains('primary')}
function cardHtml(o,layout={lane:0,lanes:1}){
  const r=orderInterval(o),warn=o.reschedule_requested?' warn':'',slots=Math.max(1,r.slots);
  return `<div class="du187Card${warn}${layout.lanes>1?' conflict':''}" draggable="true" data-order-id="${escv(o.id)}" data-start="${r.start}" data-duration-slots="${slots}" style="--du187-slots:${slots};--du187-lane:${layout.lane};--du187-lanes:${layout.lanes}" ondragstart="bosUnifiedScheduleDrag(event,'${escv(o.id)}')" onclick="selectDispatchBoardOrder('${escv(o.id)}')"><div class="du187CardTop"><b>№ ${escv(noOf(o))}</b><span class="du187When">${escv(rangeText(r.start,slots))}</span></div><strong>${escv(o.client||'Клиент')}</strong><small>${escv(o.work||'Заявка')}</small><em>${escv(statusLabel(o))}</em><button type="button" class="du187Resize" aria-label="Изменить длительность заявки" title="Потяните, чтобы изменить длительность"></button></div>`
}
function slotHtml(m,date,t,orders,layout){
  const start=orders.filter(o=>startsAt(o,t)),covering=orders.filter(o=>covers(o,t)),off=!available(m,date,t),conflict=covering.length>1;
  return `<div class="du187Slot${off?' off':''}${covering.length?' busy':''}${conflict?' conflict':''}" data-master="${escv(masterVk(m))}" data-time="${t}" ondragover="bosUnifiedScheduleAllowDrop(event)" ondrop="bosUnifiedScheduleDrop(event,'${escv(masterVk(m))}','${t}')">${start.map(o=>cardHtml(o,layout.get(String(o.id)))).join('')}${!covering.length&&!off?'<span class="du187Free">Свободно</span>':''}</div>`
}
function gridHtml(date,masters){
  if(!masters.length)return '<section class="du187Root"><p>Нет мастеров по выбранным условиям.</p></section>';
  const assigned=dayAssigned(date),{lo,hi}=timelineBounds(date,masters),times=timesBetween(lo,hi);
  const layouts=new Map(masters.map(m=>[m,layoutOrders(assigned.filter(o=>sameMaster(m,o)))]));
  let conflicts=0;for(const m of masters)for(const t of times){const own=assigned.filter(o=>sameMaster(m,o)&&covers(o,t));if(own.length>1)conflicts++}
  return `<section class="du187Root"><div class="du187Head"><div><b>Расписание дня</b><span>Перетащите заявку на другое время или мастера. Потяните за нижний край, чтобы изменить длительность.</span></div><div class="du187Legend"><span><i class="free"></i>свободно</span><span><i class="busy"></i>занято</span>${conflicts?`<span class="danger">${conflicts} пересеч.</span>`:''}</div></div><div class="du187GridWrap"><div class="du187Grid" style="--du187-masters:${Math.max(1,masters.length)}"><div class="du187Corner">Время</div>${masters.map(m=>`<div class="du187Master"><b>${escv(m.full_name||'Мастер')}</b><span>${escv(masterLabel(m,date))}</span></div>`).join('')}${times.map(t=>`<div class="du187Time">${t}</div>${masters.map(m=>slotHtml(m,date,t,assigned.filter(o=>sameMaster(m,o)),layouts.get(m))).join('')}`).join('')}</div></div></section>`
}
function disableLegacyPlan(){
  if(legacyDisabled)return;legacyDisabled=true;
  const wasPlan=sessionStorage.getItem('bosDispatchV23Plan')==='1';sessionStorage.setItem('bosDispatchV23Plan','0');
  if(wasPlan&&typeof window.dispatchBoardV23Plan==='function'){try{window.dispatchBoardV23Plan(false)}catch(_){}}
}
function removeUnified(schedule){schedule?.classList.remove('du187ScheduleHost');schedule?.querySelector(':scope>.du187Root')?.remove();lastSignature=''}
function render(force=false){
  queued=false;if(rendering)return;if(!dispatcherDesktop()){removeUnified(document.querySelector('.du187ScheduleHost'));return}if(String(st()?.page||'')!=='orders')return;
  const board=document.querySelector('#content .dbBoard'),schedule=board?.querySelector('.dbSchedule');if(!board||!schedule)return;
  disableLegacyPlan();
  if(!scheduleView(board)){removeUnified(schedule);return}
  const date=boardDate();if(!date)return;const masters=visibleMasters(),sig=signature(date,masters);
  if(!force&&sig===lastSignature&&schedule.querySelector(':scope>.du187Root'))return;
  rendering=true;try{
    schedule.classList.add('du187ScheduleHost');
    schedule.querySelector(':scope>.du187Root')?.remove();
    schedule.insertAdjacentHTML('afterbegin',gridHtml(date,masters));
    const root=schedule.querySelector(':scope>.du187Root');lastSignature=sig;if(root)installResize(root)
  }finally{rendering=false}
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>render(false))}
function updateLocal(id,data){const s=st(),i=(s?.orders||[]).findIndex(o=>String(o.id)===String(id));if(i>=0)s.orders[i]={...s.orders[i],...(data||{})}}
async function resolveRescheduleIfNeeded(o,date,time){if(!o?.reschedule_requested)return;const headers=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};headers['Content-Type']='application/json';const r=await fetch(META_URL,{method:'POST',headers,body:JSON.stringify({action:'resolveReschedule',id:o.id,scheduled_date:date,scheduled_time:time})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось подтвердить перенос');if(d.order)updateLocal(o.id,d.order)}
function refreshBoard(){lastSignature='';if(typeof show==='function')show('orders');else render(true)}
async function saveMove(id,masterValue,time){
  if(busy)return false;const o=orderById(id),m=findMaster(masterValue),date=boardDate();if(!o||!m||!date)return false;
  const old=orderInterval(o),start=mins(time),end=Math.min(24*60,start+(old.slots||2)*STEP);if(!Number.isFinite(start))return false;
  if(conflictFor(id,m,date,start,end)&&!confirm(`У ${m.full_name||'мастера'} уже есть заявка, которая пересекается с этим временем. Всё равно назначить?`))return false;
  busy=true;try{
    if(typeof api!=='function')throw new Error('API недоступен');
    const payload={id:o.id,master_vk_id:masterValue,scheduled_date:date,scheduled_time:hhmm(start),time_slot:rangeText(start,old.slots||2)};
    const d=await api('updateOrder',payload);if(!d?.ok)throw new Error(d?.error||'Не удалось изменить расписание');
    updateLocal(id,{...(d.order||{}),master_vk_id:masterValue,master_name:m.full_name||'',scheduled_date:date,scheduled_time:hhmm(start),time_slot:payload.time_slot});
    await resolveRescheduleIfNeeded(o,date,hhmm(start));refreshBoard();if(typeof setMessage==='function')setMessage('Расписание сохранено');return true;
  }catch(e){if(typeof setMessage==='function')setMessage(e?.message||String(e));else console.error(e);return false}finally{busy=false}
}
async function saveDuration(id,slots){
  if(busy)return false;const o=orderById(id),date=dateOf(o)||boardDate();if(!o||!date)return false;const m=(st()?.masters||[]).find(x=>sameMaster(x,o)),r=orderInterval(o),start=r.start,next=Math.max(1,Number(slots)||1),end=Math.min(24*60,start+next*STEP),finalSlots=Math.max(1,Math.round((end-start)/STEP));
  if(m&&conflictFor(id,m,date,start,end)&&!confirm('Новая длительность пересекается с другой заявкой этого мастера. Всё равно сохранить?'))return false;
  busy=true;try{
    if(typeof api!=='function')throw new Error('API недоступен');const timeSlot=rangeText(start,finalSlots);
    const d=await api('updateOrder',{id:o.id,scheduled_time:hhmm(start),time_slot:timeSlot});if(!d?.ok)throw new Error(d?.error||'Не удалось изменить длительность');
    updateLocal(id,{...(d.order||{}),scheduled_time:hhmm(start),time_slot:timeSlot});refreshBoard();if(typeof setMessage==='function')setMessage('Длительность заявки сохранена');return true;
  }catch(e){if(typeof setMessage==='function')setMessage(e?.message||String(e));else console.error(e);return false}finally{busy=false}
}
function installResize(root){
  root.querySelectorAll('.du187Resize').forEach(handle=>{
    if(handle.dataset.bound)return;handle.dataset.bound='1';
    handle.addEventListener('pointerdown',e=>{
      e.preventDefault();e.stopPropagation();const card=handle.closest('.du187Card');if(!card)return;const startY=e.clientY,original=Math.max(1,Number(card.dataset.durationSlots||2)),slot=card.closest('.du187Slot'),rowH=slot?.getBoundingClientRect().height||ROW_PX;let current=original;card.draggable=false;card.classList.add('resizing');handle.setPointerCapture?.(e.pointerId);
      const move=ev=>{const delta=Math.round((ev.clientY-startY)/rowH);current=Math.max(1,Math.min(30,original+delta));card.style.setProperty('--du187-slots',String(current));const start=Number(card.dataset.start||0),label=card.querySelector('.du187When');if(label)label.textContent=rangeText(start,current)};
      const up=async ev=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',up,true);handle.releasePointerCapture?.(ev.pointerId);card.draggable=true;card.classList.remove('resizing');if(ev.type==='pointercancel'||(current!==original&&!await saveDuration(card.dataset.orderId,current))){card.style.setProperty('--du187-slots',String(original));card.querySelector('.du187When').textContent=rangeText(Number(card.dataset.start),original)}};
      window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',up,true);
    });
    handle.addEventListener('click',e=>e.stopPropagation());
    handle.addEventListener('dragstart',e=>{e.preventDefault();e.stopPropagation()});
  })
}
const legacyMove=window.__dispatchBoardMove;
window.__dispatchBoardMove=function(id,master,time){return dispatcherDesktop()&&master?saveMove(id,master,time):legacyMove?.apply(this,arguments)};
window.bosUnifiedScheduleDrag=(event,id)=>{if(!event?.dataTransfer)return;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(id));event.dataTransfer.setData('application/x-business-order-id',String(id))};
window.bosUnifiedScheduleAllowDrop=event=>{event?.preventDefault?.();if(event?.dataTransfer)event.dataTransfer.dropEffect='move'};
window.bosUnifiedScheduleDrop=(event,master,time)=>{event?.preventDefault?.();event?.stopPropagation?.();const id=String(event?.dataTransfer?.getData('application/x-business-order-id')||event?.dataTransfer?.getData('text/plain')||'');if(id)saveMove(id,master,time)};

const start=()=>{const content=document.getElementById('content');if(content)new MutationObserver(schedule).observe(content,{subtree:true,childList:true,attributes:true,attributeFilter:['class','value']});schedule()};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.addEventListener('resize',schedule);
window.BOS_UNIFIED_DISPATCH_SCHEDULE_V187={version:'187',refresh:()=>render(true),setDuration:saveDuration,move:saveMove,masterStats,slotRange,rangeText,conflictFor};
const style=document.createElement('style');style.textContent=`
@media(min-width:${MIN_DESKTOP}px){
#content .dbV23Tab{display:none!important}
#content .du187ScheduleHost{position:relative}
#content .du187ScheduleHost>.dbTimelineWrap,#content .du187ScheduleHost>.dbV23Plan{position:absolute!important;left:-10000px!important;top:0!important;width:1px!important;height:1px!important;min-height:0!important;max-height:1px!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important}
#content .du187Root{display:grid;gap:8px;min-width:0}
#content .du187Head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:0 2px 8px}
#content .du187Head>div:first-child{display:grid;gap:3px}.du187Head b{font-size:15px}.du187Head span{font-size:10px;color:#8fa8bf}
#content .du187Legend{display:flex;align-items:center;gap:10px;white-space:nowrap}.du187Legend span{display:flex;align-items:center;gap:5px}.du187Legend i{width:8px;height:8px;border-radius:50%}.du187Legend i.free{background:#1da872}.du187Legend i.busy{background:#2f78d0}.du187Legend .danger{color:#ff8585}
#content .du187GridWrap{overflow:auto;max-height:calc(100vh - 390px);min-height:360px;border:1px solid rgba(126,166,204,.18);border-radius:12px;background:#0a1927}
#content .du187Grid{display:grid;grid-template-columns:70px repeat(var(--du187-masters),minmax(145px,1fr));min-width:max(760px,calc(70px + var(--du187-masters)*145px));position:relative}
#content .du187Corner,#content .du187Master{position:sticky;top:0;z-index:20;background:#0c1d2d;border-bottom:1px solid rgba(126,166,204,.18);min-height:54px;box-sizing:border-box;padding:9px}
#content .du187Corner{left:0;z-index:22;font-size:11px;font-weight:800;display:flex;align-items:center}
#content .du187Master{display:grid;align-content:center;gap:2px;border-left:1px solid rgba(126,166,204,.12)}.du187Master b{font-size:12px}.du187Master span{font-size:9px;color:#88a3ba}
#content .du187Time{position:sticky;left:0;z-index:10;height:${ROW_PX}px;box-sizing:border-box;padding:7px 8px;background:#0b1b29;border-top:1px solid rgba(126,166,204,.10);font-size:10px;font-weight:800;color:#dbeafe}
#content .du187Slot{height:${ROW_PX}px;box-sizing:border-box;position:relative;border-top:1px solid rgba(126,166,204,.10);border-left:1px solid rgba(126,166,204,.08);overflow:visible}
#content .du187Slot.off{background:repeating-linear-gradient(135deg,transparent,transparent 7px,rgba(127,127,127,.055) 7px,rgba(127,127,127,.055) 14px)}#content .du187Slot.busy{background:rgba(27,86,139,.055)}#content .du187Slot.conflict{box-shadow:inset 3px 0 0 #e45555;background:rgba(228,85,85,.08)}
#content .du187Free{position:absolute;inset:0;display:grid;place-items:center;font-size:8px;color:#7392ad;pointer-events:none}
#content .du187Card{position:absolute;top:3px;left:calc(100% * var(--du187-lane,0) / var(--du187-lanes,1) + 4px);width:calc(100% / var(--du187-lanes,1) - 8px);height:calc(var(--du187-slots)*${ROW_PX}px - 6px);min-height:38px;z-index:7;box-sizing:border-box;border:1px solid rgba(49,134,226,.66);border-radius:9px;background:linear-gradient(180deg,rgba(17,57,96,.98),rgba(12,42,72,.98));padding:5px 7px 9px;display:grid;align-content:start;gap:2px;cursor:grab;box-shadow:0 5px 14px rgba(0,0,0,.16);overflow:hidden}
#content .du187Card:hover{border-color:#55a6ff;z-index:9}#content .du187Card.warn{border-color:#d79a28;background:linear-gradient(180deg,rgba(96,68,17,.97),rgba(66,45,12,.97))}#content .du187Card.conflict{border-color:#ff8585;box-shadow:inset 3px 0 #e45555}#content .du187Card.resizing{cursor:ns-resize;opacity:.95;z-index:30}
#content .du187CardTop{display:flex;justify-content:space-between;gap:6px;align-items:center}.du187CardTop b{font-size:9px}.du187When{font-size:8px;color:#8fd2ff;white-space:nowrap}.du187Card>strong{font-size:10px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.du187Card>small{font-size:8px;line-height:1.2;color:#aac0d3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.du187Card>em{font-size:7px;font-style:normal;color:#7fc6ff;white-space:nowrap}
#content .du187Resize{position:absolute;left:4px;right:4px;bottom:1px;height:8px;border:0!important;padding:0!important;min-height:0!important;background:transparent!important;cursor:ns-resize!important;touch-action:none;border-radius:0!important}#content .du187Resize:after{content:'';position:absolute;left:50%;bottom:2px;width:28px;height:2px;border-radius:3px;background:rgba(170,210,245,.58);transform:translateX(-50%)}
}
`;document.head.appendChild(style);
})();
