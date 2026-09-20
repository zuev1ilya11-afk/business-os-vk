(()=>{
'use strict';
const MIN_DESKTOP=1050;
const META_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/order-meta-api';
const HOURS=Array.from({length:12},(_,i)=>9+i);
let boardDate=localToday();
let boardSelected='';
let boardSearch='';
let boardMaster='';
let boardView='board';
let boardBusy=false;
const previousOrders=pages.orders;

function dispatcherMode(){return (typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state.user?.role||'')==='dispatcher'}
function desktopMode(){return window.innerWidth>=MIN_DESKTOP}
function localToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function active(o){return !['Выполнена','Отменена'].includes(String(o?.status||''))}
function dateOf(o){return String(o?.scheduled_date||'').slice(0,10)}
function timeOf(o){return String(o?.scheduled_time||o?.time_slot||'').slice(0,5)}
function hourOf(o){const h=Number(timeOf(o).slice(0,2));return Number.isFinite(h)?h:null}
function unassigned(o){return active(o)&&!o?.master_staff_id&&!o?.master_id&&!o?.master_vk_id&&!String(o?.master_name||'').trim()}
function reschedule(o){return active(o)&&!!o?.reschedule_requested}
function overdue(o){return active(o)&&!!dateOf(o)&&dateOf(o)<localToday()}
function escv(v){return typeof esc==='function'?esc(v):String(v??'')}
function cash(v){return typeof money==='function'?money(v):`${Number(v||0).toLocaleString('ru-RU')} ₽`}
function noOf(o){const x=String(o?.external_id||'');return x.startsWith('hands:')?x.slice(6):String(o?.id||'')}
function phoneHref(v){let p=String(v||'').trim().replace(/[^\d+]/g,'');if(/^8\d{10}$/.test(p))p='+7'+p.slice(1);else if(/^\d{10}$/.test(p))p='+7'+p;return p}
function slotOf(t){const s=String(t||'').slice(0,5);if(!/^\d{2}:\d{2}$/.test(s))return '';const [h,m]=s.split(':').map(Number);return `${s}–${String((h+1)%24).padStart(2,'0')}:${String(m).padStart(2,'0')}`}
function masterVk(m){return String(m?.vk_user_id||m?.external_id||'')}
function masterIds(m){return [m?.id,m?.staff_id,m?.master_staff_id,m?.vk_user_id,m?.external_id].filter(Boolean).map(String)}
function orderMasterIds(o){return [o?.master_staff_id,o?.master_id,o?.master_vk_id].filter(Boolean).map(String)}
function sameMaster(m,o){const ids=masterIds(m),oid=orderMasterIds(o);return ids.some(x=>oid.includes(x))||String(m?.full_name||'')===String(o?.master_name||'')}
function findMasterByVk(v){return (state.masters||[]).find(m=>masterVk(m)===String(v||''))||null}
function selectedOrder(){return (state.orders||[]).find(o=>String(o.id)===String(boardSelected))||null}
function allActive(){return (state.orders||[]).filter(active)}
function searchMatch(o){const q=boardSearch.trim().toLowerCase();if(!q)return true;return [o.id,o.external_id,o.client,o.phone,o.address,o.work,o.master_name,o.status,o.reschedule_reason].join(' ').toLowerCase().includes(q)}
function masterFilterMatch(o){return !boardMaster||String(o.master_name||'')===boardMaster}
function dayOrders(){return allActive().filter(o=>dateOf(o)===boardDate).filter(searchMatch).filter(masterFilterMatch)}
function searchResults(){return boardSearch.trim()?allActive().filter(searchMatch).filter(masterFilterMatch):[]}
function requested(){return allActive().filter(reschedule).filter(searchMatch).filter(masterFilterMatch)}
function unassignedOrders(){return allActive().filter(unassigned).filter(searchMatch).filter(masterFilterMatch)}
function ensureSelected(){
  if(selectedOrder())return;
  const first=requested()[0]||dayOrders()[0]||unassignedOrders()[0]||searchResults()[0];
  boardSelected=first?String(first.id):'';
}
function formatDate(date){if(!date)return 'Без даты';try{return new Date(date+'T12:00:00').toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'long'})}catch(_){return date}}
function statusClass(o){if(reschedule(o))return ' warn';if(overdue(o))return ' danger';if(String(o.status||'')==='Выполнена')return ' done';return ''}
function flags(o){const x=[];if(reschedule(o))x.push('<span class="dbFlag warn">Нужно перенести</span>');if(overdue(o))x.push('<span class="dbFlag danger">Просрочено</span>');if(unassigned(o))x.push('<span class="dbFlag">Без мастера</span>');return x.join('')}
function orderCard(o,compact=false){
  const sel=String(o.id)===String(boardSelected)?' selected':'';
  const when=[dateOf(o),timeOf(o)].filter(Boolean).join(' · ')||'Без даты';
  return `<button type="button" draggable="true" class="dbOrderCard bosFilteredOrder${statusClass(o)}${sel}${compact?' compact':''}" data-order-id="${escv(o.id)}" ondragstart="dispatchBoardDragStart(event,'${escv(o.id)}')" onclick="selectDispatchBoardOrder('${escv(o.id)}')"><span class="dbCardTop"><b>№ ${escv(noOf(o))}</b><small>${escv(timeOf(o)||when)}</small></span><strong>${escv(o.client||'Клиент')}</strong><span>${escv(o.work||'Заявка')}</span>${compact?`<small>${escv(o.master_name||dateOf(o)||'Без мастера')}</small>`:`<small>${escv(o.address||'Адрес не указан')}</small>`}<span class="dbCardFlags">${flags(o)}</span></button>`;
}
function scheduleFor(m){
  const rows=(state.masterSchedule||[]).filter(r=>String(r.work_date||r.date||'').slice(0,10)===boardDate);
  const ids=new Set(masterIds(m));
  return rows.find(r=>[r?.staff_id,r?.master_staff_id,r?.master_id,r?.master_vk_id,r?.external_id].filter(Boolean).map(String).some(x=>ids.has(x)))||null;
}
function workLabel(m){const r=scheduleFor(m);if(!r)return 'График не задан';if(r.is_working===false)return 'Выходной';return `${String(r.work_start||'09:00').slice(0,5)}–${String(r.work_end||'18:00').slice(0,5)}`}
function hourAvailable(m,h){const r=scheduleFor(m);if(!r)return true;if(r.is_working===false)return false;const from=Number(String(r.work_start||'09:00').slice(0,2)),to=Number(String(r.work_end||'18:00').slice(0,2));return h>=from&&h<to}
function rowForMaster(m,orders){
  const own=orders.filter(o=>sameMaster(m,o));
  const vk=masterVk(m);
  return `<div class="dbTimelineRow"><div class="dbMasterCell"><b>${escv(m.full_name||'Мастер')}</b><span>${escv(workLabel(m))}</span><small>${own.length} заяв.</small></div>${HOURS.map(h=>{const inSlot=own.filter(o=>hourOf(o)===h),conflict=inSlot.length>1?' conflict':'',off=hourAvailable(m,h)?'':' off';return `<div class="dbSlot${conflict}${off}" data-master="${escv(vk)}" data-hour="${h}" ondragover="dispatchBoardAllowDrop(event)" ondrop="dispatchBoardDrop(event,'${escv(vk)}','${String(h).padStart(2,'0')}:00')">${inSlot.map(o=>orderCard(o,true)).join('')}</div>`}).join('')}</div>`;
}
function timeline(){
  const orders=dayOrders().filter(o=>!unassigned(o));
  const masters=(state.masters||[]).filter(m=>!boardMaster||String(m.full_name||'')===boardMaster);
  return `<div class="dbTimelineWrap"><div class="dbTimeline"><div class="dbTimelineHead"><div class="dbMasterCell"><b>Мастер</b><span>${escv(formatDate(boardDate))}</span></div>${HOURS.map(h=>`<div>${String(h).padStart(2,'0')}:00</div>`).join('')}</div>${masters.map(m=>rowForMaster(m,orders)).join('')||'<div class="dbEmptyTimeline">Мастеров пока нет.</div>'}</div></div>`;
}
function attention(){
  const req=requested(),un=unassignedOrders(),late=allActive().filter(overdue),results=searchResults();
  const list=boardSearch.trim()?results:(req.length?req:un);
  const title=boardSearch.trim()?'Результаты поиска':req.length?'Нужно перенести':'Без мастера';
  return `<aside class="dbAttention"><div class="dbPanelHead"><div><b>Требует внимания</b><span>Оперативная очередь</span></div></div><div class="dbAttentionMetrics"><button onclick="setDispatchBoardSearch('')"><span>Перенос</span><b>${req.length}</b></button><button onclick="setDispatchBoardSearch('')"><span>Без мастера</span><b>${un.length}</b></button><button onclick="setDispatchBoardSearch('')"><span>Просрочено</span><b>${late.length}</b></button></div><div class="dbTrayHead"><b>${title}</b><span>${list.length}</span></div><div class="dbTray" ondragover="dispatchBoardAllowDrop(event)" ondrop="dispatchBoardDropUnassigned(event)">${list.map(o=>orderCard(o,true)).join('')||'<p class="muted">Здесь всё разобрано.</p>'}</div><p class="dbDropHint">Перетащите заявку на мастера и время. Чтобы снять мастера, перетащите её обратно сюда.</p></aside>`;
}
function detail(){
  const o=selectedOrder();if(!o)return '<aside class="dbDetail"><div class="dbDetailEmpty"><b>Выберите заявку</b><span>Карточка появится здесь.</span></div></aside>';
  const href=phoneHref(o.phone),reason=String(o.reschedule_reason||'').trim();
  return `<aside class="dbDetail"><div class="dbPanelHead"><div><span>ЗАЯВКА № ${escv(noOf(o))}</span><h3>${escv(o.client||'Клиент')}</h3></div><b>${cash(o.amount||0)}</b></div><div class="dbFlags">${flags(o)}</div>${reschedule(o)?`<div class="dbReason"><b>Причина переноса</b><span>${escv(reason||'Причина не указана')}</span></div>`:''}<div class="dbDetailGrid"><div><span>Телефон</span><b>${escv(o.phone||'Не указан')}</b></div><div><span>Дата / время</span><b>${escv(dateOf(o)||'Без даты')} ${escv(timeOf(o)||'')}</b></div><div><span>Мастер</span><b>${escv(o.master_name||'Не назначен')}</b></div><div><span>Статус</span><b>${escv(o.status||'В работе')}</b></div><div class="wide"><span>Адрес</span><b>${escv(o.address||'Не указан')}</b></div><div class="wide"><span>Работа</span><b>${escv(o.work||'Не указана')}</b></div></div><div class="dbDetailActions">${reschedule(o)&&typeof window.openDispatcherReschedule==='function'?`<button class="primary" onclick="openDispatcherReschedule('${escv(o.id)}')">Перенести заявку</button>`:''}${href?`<a class="secondary dbActionLink" href="tel:${escv(href)}">Позвонить</a>`:''}<button class="secondary" onclick="openOrderForm('${escv(o.id)}')">Редактировать</button></div><div class="dbQuickAssign"><label><span>Быстро назначить мастера</span><select id="dbQuickMaster"><option value="">Не назначен</option>${(state.masters||[]).map(m=>`<option value="${escv(masterVk(m))}" ${sameMaster(m,o)?'selected':''}>${escv(m.full_name||'Мастер')}</option>`).join('')}</select></label><button class="secondary" onclick="dispatchBoardQuickAssign('${escv(o.id)}')">Назначить</button></div><p id="dispatchBoardMsg" class="muted"></p></aside>`;
}
function toolbar(){
  const today=boardDate===localToday();
  return `<div class="dbToolbar"><div class="dbDateNav"><button class="secondary" onclick="shiftDispatchBoardDate(-1)">←</button><input id="dispatchBoardDate" type="date" value="${escv(boardDate)}" onchange="setDispatchBoardDate(this.value)"><button class="secondary" onclick="shiftDispatchBoardDate(1)">→</button>${today?'':`<button class="secondary" onclick="setDispatchBoardDate('${localToday()}')">Сегодня</button>`}</div><div class="dbViewTabs"><button class="${boardView==='board'?'primary':'secondary'}" onclick="setDispatchBoardView('board')">Расписание</button><button class="${boardView==='list'?'primary':'secondary'}" onclick="setDispatchBoardView('list')">Список</button></div><button class="primary" onclick="openOrderForm()">+ Новая</button></div><div class="dbFilters"><div class="dbSearch"><span>⌕</span><input id="bosOrderSearch" value="${escv(boardSearch)}" placeholder="Поиск по заявкам" oninput="setDispatchBoardSearch(this.value)"></div><select id="bosOrderMaster" onchange="setDispatchBoardMaster(this.value)"><option value="">Все мастера</option>${(state.masters||[]).map(m=>`<option value="${escv(m.full_name||'')}" ${boardMaster===String(m.full_name||'')?'selected':''}>${escv(m.full_name||'Мастер')}</option>`).join('')}</select><button class="secondary" onclick="reloadDispatchBoard()">Обновить</button></div>`;
}
function boardHtml(){ensureSelected();return `<div class="dbBoard"><header class="dbTop"><div><span>ДИСПЕТЧЕРСКАЯ · DISPATCH BOARD</span><h2>Расписание мастеров</h2><p>Перетаскивайте заявки между мастерами и временем.</p></div><div class="dbDayStats"><b>${dayOrders().length}</b><span>заявок на день</span></div></header>${toolbar()}<div class="dbLayout">${attention()}<main class="dbSchedule">${timeline()}</main><div id="dispatchBoardDetail">${detail()}</div></div></div>`}
function listHtml(){return `<div class="dbListMode"><div class="dbListSwitch"><button class="primary" onclick="setDispatchBoardView('board')">← Расписание</button></div>${previousOrders()}</div>`}

async function metaCall(action,payload={}){const headers=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};headers['Content-Type']='application/json';const r=await fetch(META_URL,{method:'POST',headers,body:JSON.stringify({action,...payload})}),d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Ошибка переноса');return d}
function updateState(id,data,extra={}){const i=(state.orders||[]).findIndex(o=>String(o.id)===String(id));if(i>=0)state.orders[i]={...state.orders[i],...(data||{}),...extra}}
function hasConflict(id,master,time){return allActive().some(o=>String(o.id)!==String(id)&&dateOf(o)===boardDate&&sameMaster(master,o)&&hourOf(o)===Number(String(time).slice(0,2)))}
async function moveOrder(id,masterVkValue,time){
  if(boardBusy)return;const o=(state.orders||[]).find(x=>String(x.id)===String(id));if(!o)return;
  if(['Выполнена','Отменена'].includes(String(o.status||'')))return;
  const m=findMasterByVk(masterVkValue);if(masterVkValue&&!m){alert('Мастер не найден');return}
  if(m&&hasConflict(id,m,time)&&!confirm(`У ${m.full_name||'мастера'} на это время уже есть заявка. Всё равно назначить?`))return;
  boardBusy=true;setMessage('Сохраняем изменение…');
  try{
    const payload={id:o.id,master_vk_id:masterVkValue,scheduled_date:boardDate,scheduled_time:time,time_slot:slotOf(time)};
    const d=await api('updateOrder',payload);if(!d.ok)throw new Error(d.error||'Не удалось изменить заявку');
    updateState(o.id,d.order,{master_vk_id:masterVkValue,master_name:m?.full_name||'',scheduled_date:boardDate,scheduled_time:time,time_slot:slotOf(time)});
    if(o.reschedule_requested){
      const resolved=await metaCall('resolveReschedule',{id:o.id,scheduled_date:boardDate,scheduled_time:time});
      updateState(o.id,resolved.order,{master_vk_id:masterVkValue,master_name:m?.full_name||'',reschedule_requested:false,reschedule_reason:null,reschedule_requested_at:null,reschedule_requested_by:null});
    }
    boardSelected=String(o.id);show('orders');
  }catch(e){setMessage(e.message||String(e))}finally{boardBusy=false}
}
function setMessage(text){const el=document.getElementById('dispatchBoardMsg');if(el)el.textContent=text||''}

pages.orders=function(){if(!dispatcherMode()||!desktopMode())return previousOrders();return boardView==='list'?listHtml():boardHtml()};
window.setDispatchBoardView=function(v){boardView=v==='list'?'list':'board';show('orders')};
window.setDispatchBoardDate=function(v){if(/^\d{4}-\d{2}-\d{2}$/.test(String(v||'')))boardDate=String(v);boardSelected='';show('orders')};
window.shiftDispatchBoardDate=function(n){const d=new Date(boardDate+'T12:00:00');d.setDate(d.getDate()+Number(n||0));window.setDispatchBoardDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)};
window.setDispatchBoardSearch=function(v){boardSearch=String(v||'');boardSelected='';show('orders');requestAnimationFrame(()=>document.getElementById('bosOrderSearch')?.focus())};
window.setDispatchBoardMaster=function(v){boardMaster=String(v||'');boardSelected='';show('orders')};
window.selectDispatchBoardOrder=function(id){boardSelected=String(id||'');const root=document.getElementById('dispatchBoardDetail');if(root)root.innerHTML=detail();document.querySelectorAll('.dbOrderCard').forEach(x=>x.classList.toggle('selected',String(x.dataset.orderId||'')===boardSelected))};
window.dispatchBoardDragStart=function(e,id){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(id||''))};
window.dispatchBoardAllowDrop=function(e){e.preventDefault();e.dataTransfer.dropEffect='move'};
window.dispatchBoardDrop=function(e,m,time){e.preventDefault();const id=e.dataTransfer.getData('text/plain');moveOrder(id,String(m||''),String(time||''))};
window.dispatchBoardDropUnassigned=async function(e){e.preventDefault();const id=e.dataTransfer.getData('text/plain'),o=(state.orders||[]).find(x=>String(x.id)===String(id));if(!o||boardBusy)return;boardBusy=true;try{const d=await api('updateOrder',{id:o.id,master_vk_id:''});if(!d.ok)throw new Error(d.error||'Не удалось снять мастера');updateState(o.id,d.order,{master_vk_id:'',master_name:''});boardSelected=String(o.id);show('orders')}catch(err){setMessage(err.message||String(err))}finally{boardBusy=false}};
window.dispatchBoardQuickAssign=async function(id){const m=document.getElementById('dbQuickMaster')?.value||'',o=(state.orders||[]).find(x=>String(x.id)===String(id));if(!o||boardBusy)return;boardBusy=true;setMessage('Назначаем…');try{const d=await api('updateOrder',{id:o.id,master_vk_id:m});if(!d.ok)throw new Error(d.error||'Не удалось назначить мастера');const master=findMasterByVk(m);updateState(o.id,d.order,{master_vk_id:m,master_name:master?.full_name||''});show('orders')}catch(e){setMessage(e.message||String(e))}finally{boardBusy=false}};
window.reloadDispatchBoard=async function(){try{await reloadData(true)}catch(e){setMessage(e.message||String(e))}};
window.__dispatchBoardMove=moveOrder;

window.addEventListener('resize',()=>{if(dispatcherMode()&&state.page==='orders')show('orders')});
const style=document.createElement('style');style.textContent=`
@media(min-width:${MIN_DESKTOP}px){
#content:has(.dbBoard){max-width:none;width:min(1900px,calc(100vw - 34px));padding-left:12px;padding-right:12px}
.dbBoard{display:flex;flex-direction:column;gap:12px}.dbTop,.dbToolbar,.dbFilters,.dbPanelHead{display:flex;align-items:center;justify-content:space-between;gap:12px}.dbTop{padding:4px 2px}.dbTop>div:first-child>span{font-size:11px;letter-spacing:.12em;color:#7f96ad;font-weight:800}.dbTop h2{margin:3px 0;font-size:25px}.dbTop p{margin:0;color:#8ea3b8}.dbDayStats{display:flex;align-items:baseline;gap:7px;padding:10px 14px;border:1px solid rgba(255,255,255,.08);border-radius:12px}.dbDayStats b{font-size:24px}.dbDayStats span{color:#8ea3b8;font-size:12px}
.dbToolbar,.dbFilters{background:rgba(12,24,37,.88);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:9px}.dbDateNav,.dbViewTabs{display:flex;align-items:center;gap:7px}.dbDateNav input{min-width:150px}.dbFilters{justify-content:flex-start}.dbSearch{display:flex;align-items:center;gap:7px;flex:1;min-width:260px}.dbSearch input{width:100%;margin:0}.dbFilters select{min-width:200px;margin:0}
.dbLayout{display:grid;grid-template-columns:270px minmax(680px,1fr) 330px;gap:10px;min-height:620px}.dbAttention,.dbSchedule,.dbDetail{background:rgba(12,24,37,.9);border:1px solid rgba(255,255,255,.08);border-radius:15px;min-width:0}.dbAttention,.dbDetail{padding:12px}.dbPanelHead span,.dbPanelHead small{display:block;color:#8fa3b8;font-size:11px}.dbPanelHead h3{margin:2px 0}.dbAttentionMetrics{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:12px 0}.dbAttentionMetrics button{background:#101f2e;border:1px solid rgba(255,255,255,.08);border-radius:10px;color:inherit;padding:8px 5px}.dbAttentionMetrics span{display:block;color:#91a6b9;font-size:9px}.dbAttentionMetrics b{font-size:18px}.dbTrayHead{display:flex;justify-content:space-between;margin:10px 1px 7px}.dbTray{display:flex;flex-direction:column;gap:7px;min-height:150px;max-height:465px;overflow:auto;padding:2px}.dbDropHint{font-size:10px;color:#8299ad;line-height:1.4}
.dbSchedule{overflow:hidden}.dbTimelineWrap{overflow:auto;height:100%;max-height:720px}.dbTimeline{min-width:1500px}.dbTimelineHead,.dbTimelineRow{display:grid;grid-template-columns:170px repeat(12,minmax(105px,1fr))}.dbTimelineHead{position:sticky;top:0;z-index:8;background:#0c1825;border-bottom:1px solid rgba(255,255,255,.09)}.dbTimelineHead>div{padding:10px 7px;text-align:center;color:#91a6b9;font-size:11px;border-right:1px solid rgba(255,255,255,.06)}.dbMasterCell{position:sticky;left:0;z-index:6;background:#0d1b29!important;text-align:left!important;display:flex;flex-direction:column;justify-content:center;gap:2px}.dbMasterCell span,.dbMasterCell small{color:#8ea3b7;font-size:10px}.dbTimelineRow{min-height:106px;border-bottom:1px solid rgba(255,255,255,.07)}.dbSlot{padding:4px;border-right:1px solid rgba(255,255,255,.055);min-height:106px;display:flex;flex-direction:column;gap:4px;transition:.12s;background:rgba(255,255,255,.012)}.dbSlot:hover{background:rgba(67,139,205,.08)}.dbSlot.off{background:repeating-linear-gradient(135deg,rgba(255,255,255,.015),rgba(255,255,255,.015) 6px,rgba(255,255,255,.035) 6px,rgba(255,255,255,.035) 12px)}.dbSlot.conflict{box-shadow:inset 0 0 0 2px rgba(246,179,75,.5)}.dbEmptyTimeline{padding:30px;color:#8ea3b8}
.dbOrderCard{width:100%;border:1px solid rgba(89,157,222,.28);background:#102a40;color:inherit;border-radius:10px;padding:7px;text-align:left;display:flex;flex-direction:column;gap:3px;cursor:pointer}.dbOrderCard:hover,.dbOrderCard.selected{border-color:#4d96d7;box-shadow:0 0 0 1px rgba(77,150,215,.28)}.dbOrderCard.warn{border-color:rgba(240,174,68,.55);background:#352912}.dbOrderCard.danger{border-color:rgba(230,95,95,.45)}.dbOrderCard strong{font-size:12px}.dbOrderCard>span:not(.dbCardTop):not(.dbCardFlags){font-size:10px;color:#b8c8d6}.dbOrderCard small{font-size:9px;color:#8fa5b8}.dbOrderCard.compact{padding:6px}.dbCardTop{display:flex;align-items:center;justify-content:space-between;gap:5px}.dbCardTop b{font-size:10px}.dbCardFlags{display:flex;gap:3px;flex-wrap:wrap}.dbFlag{display:inline-flex;padding:2px 5px;border-radius:999px;background:rgba(255,255,255,.08);font-size:8px;font-weight:700}.dbFlag.warn{background:rgba(240,174,68,.17);color:#ffc767}.dbFlag.danger{background:rgba(230,95,95,.16);color:#ff9292}
.dbFlags{display:flex;gap:5px;flex-wrap:wrap;margin:9px 0}.dbReason{display:flex;flex-direction:column;gap:4px;padding:10px;border:1px solid rgba(240,174,68,.25);background:rgba(240,174,68,.08);border-radius:10px;margin:9px 0}.dbReason span{font-size:12px}.dbDetailGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.dbDetailGrid>div{padding:8px;background:rgba(255,255,255,.025);border-radius:9px}.dbDetailGrid .wide{grid-column:1/-1}.dbDetailGrid span{display:block;color:#8fa3b8;font-size:9px;margin-bottom:3px}.dbDetailGrid b{font-size:11px}.dbDetailActions{display:flex;gap:6px;flex-wrap:wrap}.dbActionLink{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}.dbQuickAssign{display:grid;grid-template-columns:1fr auto;gap:7px;align-items:end;margin-top:12px}.dbQuickAssign label span{display:block;color:#8fa3b8;font-size:10px;margin-bottom:4px}.dbQuickAssign select{margin:0}.dbDetailEmpty{display:flex;flex-direction:column;gap:5px;align-items:center;justify-content:center;min-height:260px;color:#8fa3b8}.dbListSwitch{margin-bottom:8px}
}
@media(min-width:1050px) and (max-width:1399px){.dbLayout{grid-template-columns:240px minmax(620px,1fr)}#dispatchBoardDetail{grid-column:1/-1}.dbDetail{min-height:auto}.dbTimeline{min-width:1420px}}
`;
document.head.appendChild(style);
})();
