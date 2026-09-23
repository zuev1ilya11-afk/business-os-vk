(()=>{
'use strict';
const MOBILE_MAX=760;
let conflictFilter=false;
let scheduled=false;

function dispatcherMode(){return (typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state.user?.role||'')==='dispatcher'}
function mobileMode(){return window.innerWidth<=MOBILE_MAX}
function ordersPage(){return String(state.page||'')==='orders'}
function active(o){return !['Выполнена','Отменена'].includes(String(o?.status||''))}
function dateOf(o){return String(o?.scheduled_date||'').slice(0,10)}
function masterKey(o){return String(o?.master_staff_id||o?.master_vk_id||o?.master_id||o?.master_name||'').trim()}
function mins(v){const m=String(v||'').match(/(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null}
function rangeOf(o){
  const slot=String(o?.time_slot||'').trim();
  const parts=slot.split(/[–—-]/).map(mins).filter(v=>v!==null);
  if(parts.length>=2&&parts[1]>parts[0])return [parts[0],parts[1]];
  const start=mins(o?.scheduled_time);
  return start===null?null:[start,start+60];
}
function overlap(a,b){return a&&b&&a[0]<b[1]&&b[0]<a[1]}
function conflictIds(){
  const list=(state.orders||[]).filter(o=>active(o)&&masterKey(o)&&dateOf(o)&&rangeOf(o));
  const ids=new Set();
  for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
    if(masterKey(list[i])!==masterKey(list[j]))continue;
    if(dateOf(list[i])!==dateOf(list[j]))continue;
    if(!overlap(rangeOf(list[i]),rangeOf(list[j])))continue;
    ids.add(String(list[i].id));ids.add(String(list[j].id));
  }
  return ids;
}
function cardId(card){const raw=card.getAttribute('onclick')||'';const m=raw.match(/openOrder\('([^']+)'\)/);return m?m[1]:''}
function clearDecorations(content){
  content.querySelectorAll('.dmConflictBadge,.dmConflictBar,.dmConflictEmpty').forEach(n=>n.remove());
  content.querySelectorAll('.opsCompactOrder.dmConflictOrder').forEach(n=>n.classList.remove('dmConflictOrder'));
}
function render(){
  scheduled=false;
  const content=document.getElementById('content');
  if(!content)return;
  if(!dispatcherMode()||!mobileMode()||!ordersPage()){clearDecorations(content);return}
  const ids=conflictIds();
  clearDecorations(content);
  const mobile=content.querySelector(':scope > .bosDispatcherMobile');
  if(mobile&&ids.size){
    const bar=document.createElement('button');
    bar.type='button';bar.className='dmConflictBar';bar.setAttribute('aria-label','Показать конфликты времени');
    bar.innerHTML=`<span>⚠ Конфликты времени</span><b>${ids.size}</b>`;
    bar.onclick=()=>window.dmFilter('conflict');
    mobile.appendChild(bar);
  }
  let visible=0;
  content.querySelectorAll('.opsCompactOrder').forEach(card=>{
    const id=cardId(card),hit=ids.has(String(id));
    if(hit){
      card.classList.add('dmConflictOrder');
      const badge=document.createElement('div');badge.className='dmConflictBadge';badge.textContent='⚠ Пересечение по времени у мастера';
      const actions=card.querySelector('.dmCardActions');
      if(actions)card.insertBefore(badge,actions);else card.appendChild(badge);
    }
    if(conflictFilter){card.hidden=!hit;if(hit)visible++}else card.hidden=false;
  });
  if(conflictFilter&&!visible){
    const empty=document.createElement('div');empty.className='card dmConflictEmpty';empty.textContent='Конфликтов времени нет.';
    const list=content.querySelector('#bosOrderList');if(list)list.appendChild(empty);
  }
}
function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(render)}

const baseShow=window.show;
if(typeof baseShow==='function')window.show=function(page,...args){
  const result=baseShow.apply(this,[page,...args]);
  if(String(page)==='orders')setTimeout(schedule,0);
  else{conflictFilter=false;setTimeout(schedule,0)}
  return result;
};

const baseFilter=window.dmFilter;
window.dmFilter=function(filter){
  if(filter==='conflict'){
    conflictFilter=true;
    if(typeof window.setBosOrderFilter==='function')window.setBosOrderFilter('all');
    else if(typeof show==='function'&&!ordersPage())show('orders');
    setTimeout(schedule,0);return;
  }
  conflictFilter=false;
  const result=typeof baseFilter==='function'?baseFilter(filter):undefined;
  setTimeout(schedule,0);return result;
};
window.BOS_DISPATCHER_CONFLICTS={ids:()=>Array.from(conflictIds()),refresh:schedule};

window.addEventListener('resize',schedule);
queueMicrotask(schedule);

const style=document.createElement('style');
style.textContent=`@media(max-width:${MOBILE_MAX}px){
.dmConflictBar{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:44px;padding:10px 12px;border:1px solid rgba(242,176,65,.45);border-radius:13px;background:rgba(242,176,65,.09);color:#f6cf86;text-align:left;font-weight:800;touch-action:manipulation}.dmConflictBar b{display:grid;place-items:center;min-width:28px;height:28px;padding:0 6px;border-radius:999px;background:rgba(242,176,65,.18);font-size:15px}.dmConflictOrder{border-color:rgba(242,176,65,.45)!important}.dmConflictBadge{margin-top:8px;padding:7px 9px;border-radius:10px;background:rgba(242,176,65,.1);color:#f6cf86;font-size:11px;font-weight:700;line-height:1.3}.dmConflictEmpty{padding:16px;text-align:center;color:#91a5b8}}
`;
document.head.appendChild(style);
})();
