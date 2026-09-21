(()=>{
'use strict';
if(window.BOS_UI_DISPATCH_MASTER_V94)return;window.BOS_UI_DISPATCH_MASTER_V94=true;
const MIN_DESKTOP=1050;
let inlineListMode=false;
let enhancing=false;

const dispatcherDesktop=()=>window.innerWidth>=MIN_DESKTOP&&((typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state?.user?.role||'')==='dispatcher');
const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const noOf=o=>{const x=String(o?.external_id||'');return x.startsWith('hands:')?x.slice(6):String(o?.id||'')};
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10);
const timeOf=o=>String(o?.scheduled_time||o?.time_slot||'').slice(0,5);

function orderIdFromCard(el){
  const raw=el?.getAttribute?.('onclick')||'';
  const m=raw.match(/openOrder\((?:'|")([^'"]+)/);
  return m?m[1]:String(el?.dataset?.orderId||'');
}
function masterVisualClass(o){
  if(o?.reschedule_requested)return 'bosMasterReschedule';
  if(String(o?.status||'')==='Рекламация')return 'bosMasterReclamation';
  if(String(o?.status||'')==='Выполнена')return 'bosMasterDone';
  return '';
}
function enhanceMasterCards(){
  if(!masterMode())return;
  document.querySelectorAll('.masterCompactOrder').forEach(card=>{
    card.classList.remove('bosMasterDone','bosMasterReclamation','bosMasterReschedule');
    const id=orderIdFromCard(card),order=(state.orders||[]).find(o=>String(o.id)===String(id));
    const cls=masterVisualClass(order);if(cls)card.classList.add(cls);
  });
  const badge=document.querySelector('#modalRoot .masterCompactDetailsTop .status');
  if(badge){
    badge.classList.remove('bosMasterDoneBadge','bosMasterReclamationBadge','bosMasterRescheduleBadge');
    const text=String(badge.textContent||'').trim();
    if(text==='Выполнена')badge.classList.add('bosMasterDoneBadge');
    if(text==='Рекламация')badge.classList.add('bosMasterReclamationBadge');
    const modal=document.querySelector('#modalRoot .masterCompactDetails');
    const id=orderIdFromCard(document.querySelector('.masterCompactOrder[aria-current="true"]'));
    const order=(state.orders||[]).find(o=>String(o.id)===String(id));
    if(order?.reschedule_requested)badge.classList.add('bosMasterRescheduleBadge');
  }
}

function relocateDispatcherControls(){
  if(!dispatcherDesktop())return;
  const board=document.querySelector('.dbBoard');if(!board)return;
  const attention=board.querySelector('.dbAttention'),filters=board.querySelector('.dbFilters');
  if(attention&&filters&&filters.parentElement!==attention){
    const head=attention.querySelector('.dbPanelHead');
    if(head)head.insertAdjacentElement('afterend',filters);else attention.prepend(filters);
  }
  const layout=board.querySelector('.dbLayout'),tools=board.querySelector('.dbV21Tools');
  if(layout&&tools&&tools.parentElement!==board)layout.insertAdjacentElement('beforebegin',tools);
  const dateNav=board.querySelector('.dbDateNav');
  const quickDates=board.querySelector('.dbV21QuickDates');
  if(dateNav&&quickDates&&dateNav.parentElement!==quickDates)quickDates.appendChild(dateNav);
  else if(dateNav&&layout&&!quickDates){
    let dayControls=board.querySelector('.dbV94DayControls');
    if(!dayControls){dayControls=document.createElement('div');dayControls.className='dbV94DayControls';layout.insertAdjacentElement('beforebegin',dayControls)}
    if(dateNav.parentElement!==dayControls)dayControls.appendChild(dateNav);
  }
}

function listMatches(o,q,master){
  if(master&&String(o?.master_name||'')!==master)return false;
  if(!q)return true;
  return [o?.id,o?.external_id,o?.client,o?.phone,o?.address,o?.work,o?.master_name,o?.status,o?.reschedule_reason].join(' ').toLowerCase().includes(q);
}
function listStatus(o){
  if(o?.reschedule_requested)return ['warn','Нужно перенести'];
  if(String(o?.status||'')==='Рекламация')return ['danger','Рекламация'];
  if(String(o?.status||'')==='Выполнена')return ['done','Выполнена'];
  if(String(o?.status||'')==='Отменена')return ['cancelled','Отменена'];
  return ['','В работе'];
}
function inlineListHtml(){
  const q=String(document.getElementById('bosOrderSearch')?.value||'').trim().toLowerCase();
  const master=String(document.getElementById('bosOrderMaster')?.value||'');
  const orders=(state.orders||[]).filter(o=>listMatches(o,q,master)).slice().sort((a,b)=>{
    const ad=`${dateOf(a)||'9999-99-99'} ${timeOf(a)||'99:99'}`,bd=`${dateOf(b)||'9999-99-99'} ${timeOf(b)||'99:99'}`;
    return ad.localeCompare(bd);
  });
  return `<div class="dbV94InlineList"><div class="dbV94ListHead"><div><b>Список заявок</b><span>Внутри диспетчерской доски</span></div><strong>${orders.length}</strong></div><div class="dbV94ListItems">${orders.map(o=>{const [cls,label]=listStatus(o);return `<button type="button" class="dbV94ListCard ${cls}" data-order-id="${escv(o.id)}" onclick="selectDispatchBoardOrder('${escv(o.id)}')"><div class="dbV94ListTop"><b>№ ${escv(noOf(o))} · ${escv(o.client||'Клиент')}</b><span class="dbV94Status ${cls}">${label}</span></div><div class="dbV94ListWork">${escv(o.work||'Заявка')}</div><div class="dbV94ListMeta"><span>${escv(dateOf(o)||'Без даты')} ${escv(timeOf(o)||'')}</span><span>${escv(o.master_name||'Без мастера')}</span><span>${escv(o.address||'Адрес не указан')}</span></div></button>`}).join('')||'<div class="dbV94Empty">По выбранным условиям заявок нет.</div>'}</div></div>`;
}
function syncListTab(){
  document.querySelectorAll('.dbViewTabs button').forEach(b=>{
    const name=String(b.textContent||'').trim();
    if(name==='Список'){b.classList.toggle('primary',inlineListMode);b.classList.toggle('secondary',!inlineListMode)}
    else if(name==='Расписание'&&inlineListMode){b.classList.remove('primary');b.classList.add('secondary')}
  });
}
function renderInlineList(){
  if(!inlineListMode||!dispatcherDesktop())return;
  const schedule=document.querySelector('.dbBoard .dbSchedule');if(!schedule)return;
  schedule.innerHTML=inlineListHtml();syncListTab();relocateDispatcherControls();
}
function enhanceDispatcher(){
  if(!dispatcherDesktop())return;
  relocateDispatcherControls();
  if(inlineListMode)renderInlineList();
}
function enhance(){
  if(enhancing)return;enhancing=true;
  try{enhanceDispatcher();enhanceMasterCards()}finally{enhancing=false}
}

document.addEventListener('click',e=>{
  const tab=e.target.closest?.('.dbViewTabs button');if(!tab)return;
  const name=String(tab.textContent||'').trim();
  if(name==='Список'){
    e.preventDefault();e.stopImmediatePropagation();
    inlineListMode=true;
    sessionStorage.setItem('bosDispatchV23Plan','0');sessionStorage.setItem('bosDispatchV24Control','0');
    renderInlineList();
    return;
  }
  inlineListMode=false;
},true);

const observer=new MutationObserver(()=>requestAnimationFrame(enhance));
observer.observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('resize',()=>requestAnimationFrame(enhance));
setTimeout(enhance,0);

const style=document.createElement('style');style.textContent=`
.masterCompactOrder.bosMasterDone{border-color:rgba(34,197,94,.72)!important;background:rgba(34,197,94,.14)!important;box-shadow:inset 4px 0 0 #22c55e}
.masterCompactOrder.bosMasterReclamation{border-color:rgba(239,68,68,.76)!important;background:rgba(239,68,68,.13)!important;box-shadow:inset 4px 0 0 #ef4444}
.masterCompactOrder.bosMasterReschedule{border-color:rgba(245,158,11,.8)!important;background:rgba(245,158,11,.14)!important;box-shadow:inset 4px 0 0 #f59e0b}
.bosMasterDoneBadge{background:rgba(34,197,94,.15)!important;color:#86efac!important}.bosMasterReclamationBadge{background:rgba(239,68,68,.15)!important;color:#fca5a5!important}.bosMasterRescheduleBadge{background:rgba(245,158,11,.15)!important;color:#fcd34d!important}
@media(min-width:${MIN_DESKTOP}px){
.dbAttention>.dbFilters{display:grid!important;grid-template-columns:1fr!important;gap:7px!important;padding:8px!important;margin:9px 0 10px!important;background:rgba(7,16,26,.38)!important;border-radius:11px!important}.dbAttention>.dbFilters .dbSearch{min-width:0!important;width:100%!important}.dbAttention>.dbFilters select,.dbAttention>.dbFilters button{width:100%!important;min-width:0!important;margin:0!important}.dbAttention>.dbFilters input{min-width:0!important}.dbV21Tools{margin-top:0!important}.dbV21QuickDates{flex-wrap:wrap}.dbV21QuickDates .dbDateNav{display:flex;align-items:center;gap:7px;margin-left:2px}.dbV21QuickDates .dbDateNav input{min-width:145px}.dbV94DayControls{display:flex;align-items:center;margin:0 0 12px}.dbV94DayControls .dbDateNav{display:flex;gap:7px;align-items:center}
.dbV94InlineList{display:grid;gap:10px;padding:12px;height:100%;box-sizing:border-box}.dbV94ListHead,.dbV94ListTop{display:flex;align-items:center;justify-content:space-between;gap:10px}.dbV94ListHead{padding:2px 2px 8px;border-bottom:1px solid rgba(255,255,255,.08)}.dbV94ListHead span{display:block;color:var(--muted,#91a3b7);font-size:11px}.dbV94ListHead strong{font-size:22px}.dbV94ListItems{display:grid;gap:7px;align-content:start;overflow:auto;max-height:650px;padding-right:2px}.dbV94ListCard{width:100%;display:grid;gap:5px;text-align:left;padding:10px;border-radius:11px;border:1px solid rgba(89,157,222,.25);background:#102235;color:inherit}.dbV94ListCard:hover{border-color:#4d96d7}.dbV94ListCard.warn{border-color:rgba(245,158,11,.7);background:rgba(245,158,11,.10)}.dbV94ListCard.danger{border-color:rgba(239,68,68,.68);background:rgba(239,68,68,.10)}.dbV94ListCard.done{border-color:rgba(34,197,94,.62);background:rgba(34,197,94,.09)}.dbV94ListCard.cancelled{opacity:.66}.dbV94ListTop b{font-size:12px}.dbV94Status{font-size:9px;font-weight:800;padding:3px 6px;border-radius:999px;background:rgba(255,255,255,.08)}.dbV94Status.warn{color:#fcd34d;background:rgba(245,158,11,.15)}.dbV94Status.danger{color:#fca5a5;background:rgba(239,68,68,.15)}.dbV94Status.done{color:#86efac;background:rgba(34,197,94,.15)}.dbV94ListWork{font-size:12px}.dbV94ListMeta{display:flex;gap:8px;flex-wrap:wrap;color:var(--muted,#91a3b7);font-size:10px}.dbV94Empty{padding:30px;text-align:center;color:var(--muted,#91a3b7)}
}
`;document.head.appendChild(style);
})();
