(()=>{
'use strict';
if(window.BOS_DISPATCH_BOARD_DESKTOP_V108)return;
window.BOS_DISPATCH_BOARD_DESKTOP_V108=true;

const MIN_DESKTOP=1050;
let queued=false;
let listSort=sessionStorage.getItem('bosDispatchListSort')||'newest';

const dispatcherDesktop=()=>window.innerWidth>=MIN_DESKTOP&&((typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state?.user?.role||'')==='dispatcher');
const ordersPage=()=>String(state?.page||'')==='orders';
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10);
const timeOf=o=>String(o?.scheduled_time||o?.time_slot||'').slice(0,5);
const hourOf=o=>{const h=Number(timeOf(o).slice(0,2));return Number.isFinite(h)?h:null};
const noOf=o=>{const x=String(o?.external_id||'');return x.startsWith('hands:')?x.slice(6):String(o?.id||'')};
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const masterIds=m=>[m?.id,m?.staff_id,m?.master_staff_id,m?.vk_user_id,m?.external_id].filter(Boolean).map(String);
const orderMasterIds=o=>[o?.master_staff_id,o?.master_id,o?.master_vk_id].filter(Boolean).map(String);
const sameMaster=(m,o)=>{const ids=masterIds(m),oid=orderMasterIds(o);return ids.some(x=>oid.includes(x))||String(m?.full_name||'')===String(o?.master_name||'')};

function sequenceValue(o){
  const number=Number(String(noOf(o)).replace(/\D/g,''));
  if(Number.isFinite(number)&&number>0)return number;
  const id=Number(String(o?.id||'').replace(/\D/g,''));
  return Number.isFinite(id)?id:0;
}
function newestValue(o){
  const raw=o?.created_at||o?.createdAt||o?.created_date||o?.created||'';
  const parsed=Date.parse(raw);
  return Number.isFinite(parsed)?parsed:sequenceValue(o);
}
function tripValue(o){return `${dateOf(o)||'9999-99-99'} ${timeOf(o)||'99:99'}`}
function listComparator(a,b){
  if(listSort==='trip')return tripValue(a).localeCompare(tripValue(b))||sequenceValue(b)-sequenceValue(a);
  const age=newestValue(a)-newestValue(b);
  if(listSort==='oldest')return age||sequenceValue(a)-sequenceValue(b);
  return -age||sequenceValue(b)-sequenceValue(a);
}
function orderById(id){return (state?.orders||[]).find(o=>String(o?.id)===String(id))||null}
function listCardId(card){return String(card?.dataset?.orderId||'')}

function ensureSortFilter(){
  const filters=document.querySelector('.dbBoard .dbFilters');
  if(!filters)return;
  let select=filters.querySelector('#bosOrderSort');
  if(!select){
    select=document.createElement('select');
    select.id='bosOrderSort';
    select.className='dbV108Sort';
    select.setAttribute('aria-label','Сортировка заявок');
    select.innerHTML='<option value="newest">Сначала новые</option><option value="trip">По дате выезда</option><option value="oldest">Сначала старые</option>';
    const reload=[...filters.querySelectorAll('button')].find(b=>String(b.textContent||'').trim()==='Обновить');
    if(reload)filters.insertBefore(select,reload);else filters.appendChild(select);
    select.onchange=()=>{listSort=select.value||'newest';sessionStorage.setItem('bosDispatchListSort',listSort);sortInlineList()};
  }
  select.value=listSort;
  select.style.display=document.querySelector('.dbV94InlineList')?'':'none';
}
function sortInlineList(){
  const box=document.querySelector('.dbV94ListItems');
  if(!box)return;
  const cards=[...box.querySelectorAll(':scope > .dbV94ListCard')];
  if(cards.length<2)return;
  const desired=cards.slice().sort((a,b)=>listComparator(orderById(listCardId(a))||{},orderById(listCardId(b))||{}));
  const current=cards.map(listCardId).join('|'),next=desired.map(listCardId).join('|');
  if(current===next)return;
  desired.forEach(card=>box.appendChild(card));
}

function filterMatch(o){
  const q=String(document.getElementById('bosOrderSearch')?.value||'').trim().toLowerCase();
  const master=String(document.getElementById('bosOrderMaster')?.value||'');
  if(master&&String(o?.master_name||'')!==master)return false;
  if(!q)return true;
  return [o?.id,o?.external_id,o?.client,o?.phone,o?.address,o?.work,o?.master_name,o?.status,o?.reschedule_reason].join(' ').toLowerCase().includes(q);
}
function completedCard(o){
  return `<button type="button" draggable="false" class="dbOrderCard bosFilteredOrder done compact dbV108Completed" data-order-id="${escv(o.id)}" onclick="selectDispatchBoardOrder('${escv(o.id)}')"><span class="dbCardTop"><b>№ ${escv(noOf(o))}</b><small>${escv(timeOf(o)||'')}</small></span><strong>${escv(o.client||'Клиент')}</strong><span>${escv(o.work||'Заявка')}</span><small>Выполнена</small><span class="dbCardFlags"><span class="dbFlag done">Выполнена</span></span></button>`;
}
function injectCompletedOrders(){
  const timeline=document.querySelector('.dbBoard .dbTimeline');
  const date=document.getElementById('dispatchBoardDate')?.value||'';
  if(!timeline||!date)return;
  const completed=(state?.orders||[]).filter(o=>String(o?.status||'')==='Выполнена'&&dateOf(o)===date&&filterMatch(o));
  for(const o of completed){
    if(timeline.querySelector(`.dbOrderCard[data-order-id="${CSS.escape(String(o.id))}"]`))continue;
    const h=hourOf(o);if(h===null)continue;
    const m=(state?.masters||[]).find(x=>sameMaster(x,o));if(!m)continue;
    const row=[...timeline.querySelectorAll('.dbTimelineRow')].find(r=>String(r.querySelector('.dbMasterCell b')?.textContent||'').trim()===String(m.full_name||'').trim());
    const slot=row?.querySelector(`.dbSlot[data-hour="${h}"]`);if(!slot)continue;
    slot.insertAdjacentHTML('beforeend',completedCard(o));
  }
  const count=(state?.orders||[]).filter(o=>String(o?.status||'')!=='Отменена'&&dateOf(o)===date&&filterMatch(o)).length;
  const stat=document.querySelector('.dbDayStats b');if(stat)stat.textContent=String(count);
}

function enableAttentionDrop(){
  const attention=document.querySelector('.dbBoard .dbAttention');
  if(!attention||attention.dataset.dbV108Drop==='1')return;
  attention.dataset.dbV108Drop='1';
  attention.addEventListener('dragover',e=>{if(typeof window.dispatchBoardAllowDrop==='function')window.dispatchBoardAllowDrop(e);else e.preventDefault()});
  attention.addEventListener('drop',e=>{
    if(e.target.closest('.dbTray'))return;
    e.preventDefault();e.stopPropagation();
    window.dispatchBoardDropUnassigned?.(e);
  });
}

function fitBoard(){
  const schedule=document.querySelector('.dbBoard .dbSchedule');
  const timeline=schedule?.querySelector('.dbTimeline');
  if(!schedule||!timeline)return;
  const rows=[...timeline.querySelectorAll('.dbTimelineRow')].filter(r=>getComputedStyle(r).display!=='none');
  const available=Math.max(360,window.innerHeight-schedule.getBoundingClientRect().top-14);
  const rowHeight=Math.max(42,Math.floor((available-34)/Math.max(1,rows.length)));
  schedule.style.setProperty('--db-v108-row',`${rowHeight}px`);
  timeline.classList.toggle('dbV108Dense',rowHeight<68);
}

function enhance(){
  queued=false;
  if(!dispatcherDesktop()||!ordersPage()||!document.querySelector('.dbBoard'))return;
  ensureSortFilter();
  injectCompletedOrders();
  enableAttentionDrop();
  fitBoard();
  sortInlineList();
}
function scheduleEnhance(){if(queued)return;queued=true;requestAnimationFrame(enhance)}

const root=document.getElementById('content');
if(root)new MutationObserver(scheduleEnhance).observe(root,{childList:true,subtree:true});
window.addEventListener('resize',scheduleEnhance);
window.__dispatchBoardV108Enhance=enhance;
queueMicrotask(scheduleEnhance);

const style=document.createElement('style');
style.textContent=`
@media(min-width:${MIN_DESKTOP}px){
  .dbAttention{display:flex!important;flex-direction:column;min-height:0}
  .dbAttention .dbTray{flex:1 1 auto;max-height:none!important;min-height:170px}
  .dbAttention[data-db-v108-drop="1"]{outline-offset:-3px}
  .dbTimelineWrap{overflow:visible!important;height:auto!important;max-height:none!important}
  .dbTimeline{min-width:0!important;width:100%!important}
  .dbTimelineHead,.dbTimelineRow{grid-template-columns:minmax(108px,1.45fr) repeat(12,minmax(0,1fr))!important}
  .dbTimelineHead>div{padding:6px 2px!important;font-size:9px!important;overflow:hidden;text-overflow:ellipsis}
  .dbTimelineRow{height:var(--db-v108-row,64px)!important;min-height:var(--db-v108-row,64px)!important}
  .dbMasterCell{padding:5px!important;overflow:hidden}
  .dbMasterCell b{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .dbMasterCell span,.dbMasterCell small{font-size:8px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .dbSlot{min-height:0!important;height:auto!important;padding:2px!important;gap:2px!important;overflow:hidden}
  .dbTimeline .dbOrderCard.compact{min-height:0!important;padding:3px 4px!important;gap:1px!important;border-radius:7px}
  .dbTimeline .dbOrderCard.compact>.dbCardTop b{font-size:9px!important}
  .dbTimeline .dbOrderCard.compact>.dbCardTop small{font-size:7px!important}
  .dbTimeline .dbOrderCard.compact>strong{font-size:9px!important;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .dbTimeline .dbOrderCard.compact>span:not(.dbCardTop):not(.dbCardFlags),.dbTimeline .dbOrderCard.compact>small{display:none!important}
  .dbTimeline .dbOrderCard.compact>.dbCardFlags{gap:2px}
  .dbTimeline .dbOrderCard.compact .dbFlag{font-size:6px!important;padding:1px 3px!important}
  .dbTimeline .dbOrderCard.done{border-color:rgba(34,197,94,.58);background:rgba(34,197,94,.10)}
  .dbFlag.done{background:rgba(34,197,94,.16);color:#86efac}
  .dbV108Dense .dbMasterCell span,.dbV108Dense .dbMasterCell small{display:none!important}
  .dbV108Dense .dbOrderCard.compact{padding:2px 3px!important}
  .dbV108Dense .dbOrderCard.compact>strong,.dbV108Dense .dbOrderCard.compact>.dbCardFlags,.dbV108Dense .dbOrderCard.compact>.dbCardTop small{display:none!important}
  .dbV108Sort{width:100%;min-width:0;margin:0}
}
`;
document.head.appendChild(style);
})();
