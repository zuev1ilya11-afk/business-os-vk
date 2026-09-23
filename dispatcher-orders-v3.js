(()=>{
'use strict';
if(window.BOS_DISPATCHER_ORDERS_V3)return;
window.BOS_DISPATCHER_ORDERS_V3=true;

let extraDay='all';
let cityFilter='';
let statusFilter='';
let queued=false;
let internalBaseFilter=false;

const dispatcherMode=()=>String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview());
const ordersPage=()=>String(state?.page||'')==='orders';
const active=o=>!['Выполнена','Отменена'].includes(String(o?.status||''));
const localDate=(offset=0)=>{const d=new Date();d.setDate(d.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const orderDate=o=>String(o?.scheduled_date||'').slice(0,10);
const cityOf=o=>String(o?.city||'').trim();
const statusOf=o=>String(o?.status||'').trim();
const unassigned=o=>active(o)&&!o?.master_name&&!o?.master_vk_id&&!o?.master_id&&!o?.master_staff_id;
const overdue=o=>active(o)&&!!orderDate(o)&&orderDate(o)<localDate();
const reschedule=o=>active(o)&&!!o?.reschedule_requested;
const idFromCard=card=>String(card?.dataset?.orderId||'')||String(card?.getAttribute?.('onclick')||'').match(/openOrder\('([^']+)'\)/)?.[1]||'';
const orderById=id=>(state?.orders||[]).find(o=>String(o?.id)===String(id))||null;

function tomorrowMatch(o){return active(o)&&orderDate(o)===localDate(1)}
function customMatch(o){
  if(!o)return false;
  if(extraDay==='tomorrow'&&!tomorrowMatch(o))return false;
  if(cityFilter&&cityOf(o)!==cityFilter)return false;
  if(statusFilter&&statusOf(o)!==statusFilter)return false;
  return true;
}
function orderedStatuses(){
  const preferred=['Новая','Назначена','В работе','Выполнена','Отменена','Рекламация'];
  const found=new Set((state?.orders||[]).map(statusOf).filter(Boolean));
  return [...preferred.filter(s=>found.has(s)),...[...found].filter(s=>!preferred.includes(s)).sort((a,b)=>a.localeCompare(b,'ru'))];
}
function cities(){return [...new Set((state?.orders||[]).map(cityOf).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'))}
function setOptions(select,values,allLabel,current){
  const signature=values.join('|');
  if(select.dataset.signature===signature&&select.dataset.current===current)return;
  select.replaceChildren();
  const all=document.createElement('option');all.value='';all.textContent=allLabel;select.appendChild(all);
  values.forEach(value=>{const opt=document.createElement('option');opt.value=value;opt.textContent=value;select.appendChild(opt)});
  select.value=values.includes(current)?current:'';
  select.dataset.signature=signature;
  select.dataset.current=select.value;
}
function tomorrowCount(){return (state?.orders||[]).filter(tomorrowMatch).length}

window.dmv3SetTomorrow=function(){
  extraDay='tomorrow';
  const setBase=window.setBosOrderFilter;
  if(typeof setBase==='function'){
    internalBaseFilter=true;
    try{setBase('all')}finally{internalBaseFilter=false}
  }
  schedule();
};
window.dmv3SetCity=function(value){cityFilter=String(value||'');schedule()};
window.dmv3SetStatus=function(value){statusFilter=String(value||'');schedule()};
window.dmv3QuickStatus=function(id){
  if(typeof openOrder!=='function')return;
  openOrder(String(id));
  let attempts=0;
  const focusStatus=()=>{
    const field=document.getElementById('quickStatus')||document.querySelector('#modalRoot select[name="status"]');
    if(field){field.scrollIntoView({block:'center'});field.focus();return}
    if(++attempts<5)setTimeout(focusStatus,40);
  };
  requestAnimationFrame(focusStatus);
};

const baseSetBosOrderFilter=window.setBosOrderFilter;
if(typeof baseSetBosOrderFilter==='function'){
  window.setBosOrderFilter=function(value){
    if(!internalBaseFilter)extraDay='all';
    const out=baseSetBosOrderFilter.apply(this,arguments);
    schedule();
    return out;
  };
}

function tomorrowButton(className){
  const button=document.createElement('button');
  button.type='button';
  button.className=className;
  button.dataset.dmv3Tomorrow='1';
  button.addEventListener('click',window.dmv3SetTomorrow);
  return button;
}
function updateTomorrowButton(button,withCount){
  const count=tomorrowCount();
  button.classList.toggle('primary',extraDay==='tomorrow');
  button.classList.toggle('secondary',extraDay!=='tomorrow');
  button.innerHTML=withCount?`Завтра <small>${count}</small>`:'Завтра';
  button.setAttribute('aria-pressed',extraDay==='tomorrow'?'true':'false');
}
function decorateToolbar(root){
  const filters=root.querySelector('.bosOrderFilters');
  if(filters){
    let button=filters.querySelector('[data-dmv3-tomorrow]');
    if(!button){button=tomorrowButton('secondary dmv3TomorrowFilter');filters.appendChild(button)}
    updateTomorrowButton(button,true);
  }
  const shortcuts=root.querySelector('.dmShortcuts');
  if(shortcuts){
    let button=shortcuts.querySelector('[data-dmv3-tomorrow]');
    if(!button){button=tomorrowButton('secondary dmv3TomorrowShortcut');shortcuts.insertBefore(button,shortcuts.children[2]||null)}
    updateTomorrowButton(button,false);
  }

  const box=root.querySelector('.bosOrderFilterBox');
  if(!box)return;
  box.classList.add('dmv3FilterBox');
  let city=box.querySelector('#dmv3City');
  if(!city){
    city=document.createElement('select');city.id='dmv3City';city.setAttribute('aria-label','Фильтр по городу');
    city.addEventListener('change',()=>window.dmv3SetCity(city.value));box.appendChild(city);
  }
  setOptions(city,cities(),'Все города',cityFilter);
  let status=box.querySelector('#dmv3Status');
  if(!status){
    status=document.createElement('select');status.id='dmv3Status';status.setAttribute('aria-label','Фильтр по статусу');
    status.addEventListener('change',()=>window.dmv3SetStatus(status.value));box.appendChild(status);
  }
  setOptions(status,orderedStatuses(),'Все статусы',statusFilter);
}

function decorateCard(card){
  const order=orderById(idFromCard(card));
  if(!order)return;
  card.classList.toggle('dmv3AttentionDanger',overdue(order));
  card.classList.toggle('dmv3AttentionWarn',!overdue(order)&&reschedule(order));
  card.classList.toggle('dmv3AttentionNeutral',!overdue(order)&&!reschedule(order)&&unassigned(order));
  const actions=card.querySelector(':scope > .dmCardActions');
  if(actions&&active(order)&&!actions.querySelector('.dmv3StatusAction')){
    const button=document.createElement('button');
    button.type='button';button.className='secondary dmv3StatusAction';button.textContent='Статус';
    button.setAttribute('aria-label','Изменить статус заявки');
    button.addEventListener('click',event=>{event.stopPropagation();window.dmv3QuickStatus(order.id)});
    const open=actions.querySelector('.dmOpenAction');
    actions.insertBefore(button,open||null);
  }
}
function applyCustomFilters(root){
  const list=root.querySelector('#bosOrderList');
  if(!list)return;
  const cards=[...list.querySelectorAll(':scope > .opsCompactOrder')];
  let visible=0;
  cards.forEach(card=>{
    const show=customMatch(orderById(idFromCard(card)));
    card.hidden=!show;
    if(show)visible++;
  });
  let empty=list.querySelector(':scope > .dmv3Empty');
  if(cards.length&&visible===0){
    if(!empty){empty=document.createElement('p');empty.className='muted dmv3Empty';empty.textContent='По выбранным фильтрам заявок нет.';list.appendChild(empty)}
  }else empty?.remove();
  const count=root.querySelector(':scope > .row h2 + .muted')||root.querySelector('h2 + .muted');
  if(count&&cards.length)count.textContent=`Найдено: ${visible}`;
}
function cleanup(root){
  root.querySelectorAll('.dmv3TomorrowFilter,.dmv3TomorrowShortcut,.dmv3StatusAction,.dmv3Empty').forEach(node=>node.remove());
  root.querySelectorAll('#dmv3City,#dmv3Status').forEach(node=>node.remove());
  root.querySelectorAll('.dmv3AttentionDanger,.dmv3AttentionWarn,.dmv3AttentionNeutral').forEach(node=>node.classList.remove('dmv3AttentionDanger','dmv3AttentionWarn','dmv3AttentionNeutral'));
  root.querySelectorAll('#bosOrderList .opsCompactOrder[hidden]').forEach(node=>node.hidden=false);
}
function sync(){
  queued=false;
  const root=document.getElementById('content');
  if(!root)return;
  if(!dispatcherMode()||!ordersPage()){cleanup(root);return}
  decorateToolbar(root);
  root.querySelectorAll('#bosOrderList .opsCompactOrder').forEach(decorateCard);
  applyCustomFilters(root);
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(sync)}

const start=()=>{
  const root=document.getElementById('content');
  if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
  schedule();
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.addEventListener('resize',schedule);

const style=document.createElement('style');
style.textContent=`
#content .bosOrderFilterBox.dmv3FilterBox{grid-template-columns:minmax(220px,1.4fr) repeat(4,minmax(125px,.7fr))}
#content .dmv3TomorrowFilter small{opacity:.75;margin-left:3px}
#content .opsCompactOrder.dmv3AttentionDanger{border-color:rgba(229,92,92,.46)!important;box-shadow:inset 3px 0 0 rgba(229,92,92,.7),0 6px 18px rgba(0,0,0,.12)!important}
#content .opsCompactOrder.dmv3AttentionWarn{border-color:rgba(242,176,65,.42)!important;box-shadow:inset 3px 0 0 rgba(242,176,65,.72),0 6px 18px rgba(0,0,0,.12)!important}
#content .opsCompactOrder.dmv3AttentionNeutral{border-color:rgba(92,169,238,.3)!important}
#content .dmv3Empty{padding:18px 4px;text-align:center}
@media(max-width:1050px){#content .bosOrderFilterBox.dmv3FilterBox{grid-template-columns:repeat(2,minmax(0,1fr))}#content .bosOrderFilterBox.dmv3FilterBox input{grid-column:1/-1}}
@media(max-width:620px){#content .bosOrderFilterBox.dmv3FilterBox{grid-template-columns:1fr}#content .bosOrderFilterBox.dmv3FilterBox input{grid-column:auto}.dmCardActions .dmv3StatusAction{min-height:46px}}
`;
document.head.appendChild(style);
})();
