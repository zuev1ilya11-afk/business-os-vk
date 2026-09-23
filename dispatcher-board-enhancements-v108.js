(()=>{
'use strict';
if(window.BOS_DISPATCHER_BOARD_V108)return;window.BOS_DISPATCHER_BOARD_V108=true;
const MIN_DESKTOP=1050;
const SORT_KEY='bosDispatcherOrderSort';
let dndInstalled=false;
let busyDrop=false;
let enhanceScheduled=false;
let contentObserver=null;

const dispatcherDesktop=()=>window.innerWidth>=MIN_DESKTOP&&((typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state?.user?.role||'')==='dispatcher');
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10);
const timeOf=o=>String(o?.scheduled_time||o?.time_slot||'').slice(0,5);
const hourOf=o=>{const h=Number(timeOf(o).slice(0,2));return Number.isFinite(h)?h:null};
const masterIds=m=>[m?.id,m?.staff_id,m?.master_staff_id,m?.vk_user_id,m?.external_id].filter(Boolean).map(String);
const orderMasterIds=o=>[o?.master_staff_id,o?.master_id,o?.master_vk_id].filter(Boolean).map(String);
const sameMaster=(m,o)=>masterIds(m).some(x=>orderMasterIds(o).includes(x))||String(m?.full_name||'')===String(o?.master_name||'');
const isDone=o=>String(o?.status||'')==='Выполнена';
const createdTs=o=>{
  for(const v of [o?.created_at,o?.createdAt,o?.created,o?.inserted_at,o?.updated_at]){const n=Date.parse(String(v||''));if(Number.isFinite(n))return n}
  const id=Number(String(o?.id||'').replace(/\D/g,''));return Number.isFinite(id)?id:0;
};
const scheduledTs=o=>{const n=Date.parse(`${dateOf(o)||'9999-12-31'}T${timeOf(o)||'23:59'}:00`);return Number.isFinite(n)?n:Number.MAX_SAFE_INTEGER};
function sortValue(){return localStorage.getItem(SORT_KEY)||'newest'}
function ensureSortControl(){
  if(!dispatcherDesktop())return;
  const filters=document.querySelector('.dbBoard .dbFilters');if(!filters||filters.querySelector('#bosOrderSort'))return;
  const select=document.createElement('select');select.id='bosOrderSort';select.setAttribute('aria-label','Сортировка заявок');
  select.innerHTML='<option value="newest">Новые сначала</option><option value="oldest">Старые сначала</option><option value="schedule">По дате выезда</option>';
  select.value=sortValue();
  select.addEventListener('change',()=>{localStorage.setItem(SORT_KEY,select.value);sortVisibleList()});
  const refresh=filters.querySelector('button');filters.insertBefore(select,refresh||null);
}
function sortVisibleList(){
  const host=document.querySelector('.dbV94ListItems');if(!host)return;
  const mode=document.getElementById('bosOrderSort')?.value||sortValue();
  const map=new Map((state.orders||[]).map(o=>[String(o.id),o]));
  const current=[...host.querySelectorAll(':scope > .dbV94ListCard')];
  if(current.length<2)return;
  const sorted=current.slice().sort((a,b)=>{
    const ao=map.get(String(a.dataset.orderId||''))||{},bo=map.get(String(b.dataset.orderId||''))||{};
    if(mode==='oldest')return createdTs(ao)-createdTs(bo);
    if(mode==='schedule')return scheduledTs(ao)-scheduledTs(bo)||createdTs(bo)-createdTs(ao);
    return createdTs(bo)-createdTs(ao);
  });
  const stable=current.every((card,i)=>card===sorted[i]);
  if(stable)return;
  for(const card of sorted)host.appendChild(card);
}
function completedCard(o){
  const number=String(o?.external_id||'').startsWith('hands:')?String(o.external_id).slice(6):String(o?.id||'');
  return `<button type="button" class="dbOrderCard compact done bosV108Completed" data-bos-completed="1" data-order-id="${escv(o.id)}" onclick="selectDispatchBoardOrder('${escv(o.id)}')"><span class="dbCardTop"><b>№ ${escv(number)}</b><small>${escv(timeOf(o)||'')}</small></span><strong>${escv(o.client||'Клиент')}</strong><span class="dbCardFlags"><span class="dbFlag">Выполнена</span></span></button>`;
}
function injectCompleted(){
  if(!dispatcherDesktop())return;
  const board=document.querySelector('.dbBoard');if(!board)return;
  const date=document.getElementById('dispatchBoardDate')?.value||'';if(!date)return;
  const done=(state.orders||[]).filter(o=>isDone(o)&&dateOf(o)===date&&orderMasterIds(o).length>0);
  const doneIds=new Set(done.map(o=>String(o.id)));
  const existing=[...board.querySelectorAll('[data-bos-completed="1"]')];
  for(const node of existing)if(!doneIds.has(String(node.dataset.orderId||'')))node.remove();
  if(!done.length)return;
  const masters=state.masters||[];
  const place=(slot,o)=>{
    if(!slot)return;
    const id=String(o.id);
    const node=[...board.querySelectorAll('[data-bos-completed="1"]')].find(n=>String(n.dataset.orderId||'')===id);
    if(node?.parentElement===slot)return;
    node?.remove();
    slot.insertAdjacentHTML('beforeend',completedCard(o));
  };
  const rows=[...board.querySelectorAll('.dbTimelineRow')];
  if(rows.length){
    for(const row of rows){
      const name=String(row.querySelector('.dbMasterCell b')?.textContent||'').trim();
      const master=masters.find(m=>String(m.full_name||'').trim()===name);if(!master)continue;
      for(const o of done.filter(x=>sameMaster(master,x))){
        const h=hourOf(o);if(h===null)continue;
        place(row.querySelector(`.dbSlot[data-hour="${h}"]`),o);
      }
    }
    return;
  }
  for(const slot of board.querySelectorAll('.dbV23Slot')){
    const master=String(slot.dataset.master||''),time=String(slot.dataset.time||'').slice(0,2);
    const m=masters.find(x=>masterIds(x).includes(master));if(!m)continue;
    const h=Number(time);for(const o of done.filter(x=>sameMaster(m,x)&&hourOf(x)===h))place(slot,o);
  }
}
function fitBoard(){
  if(!dispatcherDesktop())return;
  const wrap=document.querySelector('.dbTimelineWrap'),timeline=document.querySelector('.dbTimeline');if(!wrap||!timeline)return;
  const rows=[...timeline.querySelectorAll('.dbTimelineRow')];if(!rows.length)return;
  const head=timeline.querySelector('.dbTimelineHead');
  const available=Math.max(260,window.innerHeight-wrap.getBoundingClientRect().top-18-(head?.getBoundingClientRect().height||44));
  const rowH=Math.max(52,Math.min(150,Math.floor(available/rows.length)));
  const value=rowH+'px';
  if(timeline.style.getPropertyValue('--bos-dispatch-row-h')!==value)timeline.style.setProperty('--bos-dispatch-row-h',value);
}
async function clearAssignmentFromDrop(event){
  event?.preventDefault?.();event?.stopPropagation?.();
  if(busyDrop)return;
  const id=String(event?.dataTransfer?.getData('application/x-business-order-id')||event?.dataTransfer?.getData('text/plain')||'');
  const order=(state.orders||[]).find(o=>String(o.id)===id);if(!order)return;
  busyDrop=true;
  const tray=document.querySelector('.dbTray');tray?.classList.add('dropping');
  try{
    const patch={id:order.id,master_vk_id:'',master_id:'',master_staff_id:'',master_name:''};
    if(typeof api!=='function')throw new Error('API недоступен');
    const result=await api('updateOrder',patch);if(!result?.ok)throw new Error(result?.error||'Не удалось снять мастера');
    const i=(state.orders||[]).findIndex(o=>String(o.id)===id);
    if(i>=0)state.orders[i]={...state.orders[i],...(result.order||{}),master_vk_id:'',master_id:'',master_staff_id:'',master_name:''};
    if(typeof show==='function')show('orders');
  }catch(e){if(typeof setMessage==='function')setMessage(e?.message||String(e));else console.error(e)}
  finally{busyDrop=false;tray?.classList.remove('dropping')}
}
function installDnD(){
  if(dndInstalled)return;dndInstalled=true;
  document.addEventListener('dragstart',e=>{
    const card=e.target.closest?.('[data-order-id]');if(!card||!e.dataTransfer)return;
    const id=String(card.dataset.orderId||'');if(!id)return;
    e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',id);e.dataTransfer.setData('application/x-business-order-id',id);
  },true);
  document.addEventListener('dragover',e=>{if(e.target.closest?.('.dbTray,.dbSlot,.dbV23Slot')){e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move'}},true);
  document.addEventListener('drop',e=>{if(e.target.closest?.('.dbTray')){e.stopImmediatePropagation();clearAssignmentFromDrop(e)}},true);
}
const content=document.getElementById('content');
function observeContent(){
  if(contentObserver&&content?.isConnected)contentObserver.observe(content,{subtree:true,childList:true});
}
function enhance(){
  enhanceScheduled=false;
  if(!dispatcherDesktop()||String(state?.page||'')!=='orders'||!document.querySelector('.dbBoard'))return;
  contentObserver?.disconnect();
  try{
    installDnD();ensureSortControl();sortVisibleList();injectCompleted();fitBoard();
  }finally{
    observeContent();
  }
}
function scheduleEnhance(){if(enhanceScheduled)return;enhanceScheduled=true;requestAnimationFrame(enhance)}
if(content){contentObserver=new MutationObserver(()=>{if(document.querySelector('.dbBoard'))scheduleEnhance()});observeContent()}
window.addEventListener('resize',scheduleEnhance);setTimeout(scheduleEnhance,0);
const style=document.createElement('style');style.textContent=`
@media(min-width:${MIN_DESKTOP}px){
.dbLayout{grid-template-columns:220px minmax(0,1fr) 270px!important}.dbTray{min-height:180px;border:1px dashed rgba(112,183,255,.20);border-radius:10px;padding:6px!important}.dbTray.dropping{border-color:#70b7ff;background:rgba(22,131,255,.08)}.dbDropHint{margin-top:8px}
.dbTimelineWrap{height:auto!important;max-height:none!important;overflow:hidden!important}.dbTimeline{min-width:0!important;width:100%!important}.dbTimelineHead,.dbTimelineRow{grid-template-columns:120px repeat(12,minmax(0,1fr))!important}.dbTimelineHead>div{padding:7px 2px!important;font-size:9px!important}.dbTimelineRow{height:var(--bos-dispatch-row-h,96px)!important;min-height:0!important}.dbMasterCell{padding:5px!important;overflow:hidden}.dbMasterCell b{font-size:11px}.dbMasterCell span,.dbMasterCell small{font-size:8px!important}.dbSlot{min-height:0!important;height:100%!important;padding:2px!important;gap:2px!important;overflow:hidden}.dbOrderCard.compact{padding:3px!important;gap:1px!important;min-height:0}.dbOrderCard.compact strong,.dbOrderCard.compact .dbCardTop b{font-size:9px!important;line-height:1.15}.dbOrderCard.compact .dbCardTop small{font-size:7px!important}.dbOrderCard.compact>span:not(.dbCardTop):not(.dbCardFlags),.dbOrderCard.compact>small{display:none!important}.dbOrderCard.compact .dbCardFlags{gap:1px}.dbOrderCard.compact .dbFlag{font-size:6px!important;padding:1px 3px!important}.bosV108Completed{border-color:rgba(34,197,94,.58)!important;background:rgba(34,197,94,.11)!important}
#bosOrderSort{width:100%!important;min-width:0!important;margin:0!important}
}
`;document.head.appendChild(style);
})();