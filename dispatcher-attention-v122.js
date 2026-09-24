(()=>{
'use strict';
if(window.BOS_DISPATCHER_ATTENTION_V122)return;
window.BOS_DISPATCHER_ATTENTION_V122=true;

const MIN_DESKTOP=1050;
let activeFilter='all';
let queued=false;

const pad=n=>String(n).padStart(2,'0');
const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const dispatcherDesktop=()=>window.innerWidth>=MIN_DESKTOP&&(String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview()));
const ordersPage=()=>String(state?.page||'')==='orders';
const active=o=>!!o&&!['Выполнена','Отменена'].includes(String(o?.status||''));
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10);
const masterKey=o=>String(o?.master_staff_id||o?.master_vk_id||o?.master_id||o?.master_name||'').trim();
const unassigned=o=>active(o)&&!masterKey(o);
const overdue=o=>active(o)&&!!dateOf(o)&&dateOf(o)<localToday();
const reschedule=o=>active(o)&&!!o?.reschedule_requested;
const orderById=id=>(state?.orders||[]).find(o=>String(o?.id)===String(id))||null;
const cardId=card=>String(card?.dataset?.orderId||'');

function mins(v){const m=String(v||'').match(/(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null}
function rangeOf(o){
  const parts=String(o?.time_slot||'').trim().split(/[–—-]/).map(mins).filter(v=>v!==null);
  if(parts.length>=2&&parts[1]>parts[0])return [parts[0],parts[1]];
  const start=mins(o?.scheduled_time);
  return start===null?null:[start,start+60];
}
function overlap(a,b){return a&&b&&a[0]<b[1]&&b[0]<a[1]}
function conflictIds(){
  const source=(state?.orders||[]).filter(o=>active(o)&&masterKey(o)&&dateOf(o)&&rangeOf(o));
  const ids=new Set();
  for(let i=0;i<source.length;i++)for(let j=i+1;j<source.length;j++){
    if(masterKey(source[i])!==masterKey(source[j])||dateOf(source[i])!==dateOf(source[j]))continue;
    if(!overlap(rangeOf(source[i]),rangeOf(source[j])))continue;
    ids.add(String(source[i].id));ids.add(String(source[j].id));
  }
  return ids;
}
function flagsFor(order,conflicts){
  const flags=[];
  if(overdue(order))flags.push('overdue');
  if(unassigned(order))flags.push('unassigned');
  if(conflicts.has(String(order?.id)))flags.push('conflict');
  if(reschedule(order))flags.push('reschedule');
  return flags;
}
function matches(flags){return activeFilter==='all'||flags.includes(activeFilter)}
function labelOf(flag){return ({overdue:'Просрочено',unassigned:'Без мастера',conflict:'Конфликт',reschedule:'Перенос'})[flag]||flag}

function listCards(root){return [...root.querySelectorAll('.dbV94InlineList .dbV94ListCard[data-order-id]')]}
function smartBox(root,id){return [...root.querySelectorAll('.dbV94ListItems .dsd121[data-order-id]')].find(n=>String(n.dataset.orderId||'')===String(id))||null}
function decorateCard(card,flags){
  card.classList.toggle('da122Overdue',flags.includes('overdue'));
  card.classList.toggle('da122Unassigned',flags.includes('unassigned'));
  card.classList.toggle('da122Conflict',flags.includes('conflict'));
  card.classList.toggle('da122Reschedule',flags.includes('reschedule'));
  const signature=flags.join('|');
  let badges=card.querySelector(':scope > .da122Badges');
  if(!signature){badges?.remove();return}
  if(!badges){badges=document.createElement('div');badges.className='da122Badges';const top=card.querySelector(':scope > .dbV94ListTop');top?.insertAdjacentElement('afterend',badges)}
  if(badges.dataset.signature===signature)return;
  badges.dataset.signature=signature;
  badges.innerHTML=flags.map(flag=>`<span class="da122Badge ${flag}">${labelOf(flag)}</span>`).join('');
}
function controlsHtml(counts,total){
  const defs=[['all','Все',total],['overdue','Просрочено',counts.overdue],['unassigned','Без мастера',counts.unassigned],['conflict','Конфликт',counts.conflict],['reschedule','Перенос',counts.reschedule]];
  return defs.map(([value,label,count])=>`<button type="button" class="${activeFilter===value?'primary':'secondary'}" data-da122-filter="${value}" aria-pressed="${activeFilter===value?'true':'false'}"><span>${label}</span><b>${count}</b></button>`).join('');
}
function ensureControls(list,counts,total){
  let controls=list.querySelector(':scope > .da122Controls');
  if(!controls){
    controls=document.createElement('div');controls.className='da122Controls';
    const head=list.querySelector(':scope > .dbV94ListHead');
    head?.insertAdjacentElement('afterend',controls);
  }
  const signature=`${activeFilter}|${total}|${counts.overdue}|${counts.unassigned}|${counts.conflict}|${counts.reschedule}`;
  if(controls.dataset.signature===signature)return;
  controls.dataset.signature=signature;
  controls.innerHTML=controlsHtml(counts,total);
}
function renderEmpty(items,visible){
  let empty=items.querySelector(':scope > .da122Empty');
  if(visible){empty?.remove();return}
  if(!empty){empty=document.createElement('div');empty.className='da122Empty';items.appendChild(empty)}
  empty.textContent=activeFilter==='all'?'По выбранным условиям заявок нет.':`Нет заявок: ${labelOf(activeFilter).toLowerCase()}.`;
}
function sync(){
  queued=false;
  const root=document.getElementById('content');if(!root)return;
  if(!dispatcherDesktop()||!ordersPage())return;
  const list=root.querySelector('.dbV94InlineList'),items=list?.querySelector('.dbV94ListItems');
  if(!list||!items)return;
  const cards=listCards(root),conflicts=conflictIds();
  const counts={overdue:0,unassigned:0,conflict:0,reschedule:0};
  let visible=0;
  cards.forEach(card=>{
    const id=cardId(card),order=orderById(id),flags=order?flagsFor(order,conflicts):[];
    flags.forEach(flag=>counts[flag]++);
    decorateCard(card,flags);
    const show=matches(flags);card.hidden=!show;if(show)visible++;
    const box=smartBox(root,id);if(box)box.hidden=!show;
  });
  ensureControls(list,counts,cards.length);
  renderEmpty(items,visible);
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(sync)}
function setFilter(value){
  const allowed=['all','overdue','unassigned','conflict','reschedule'];
  activeFilter=allowed.includes(String(value))?String(value):'all';
  schedule();
}

document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-da122-filter]');if(!button)return;
  event.preventDefault();event.stopPropagation();setFilter(button.dataset.da122Filter);
});
function start(){const root=document.getElementById('content');if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});schedule()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.addEventListener('resize',schedule);
window.BOS_DISPATCHER_ATTENTION_V122={setFilter,refresh:schedule,get filter(){return activeFilter},conflictIds:()=>[...conflictIds()]};

const style=document.createElement('style');style.textContent=`
@media(min-width:${MIN_DESKTOP}px){
#content .da122Controls{display:flex;gap:6px;overflow-x:auto;padding:0 0 2px;scrollbar-width:none}#content .da122Controls::-webkit-scrollbar{display:none}#content .da122Controls button{min-height:34px;padding:6px 9px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-size:11px}#content .da122Controls button b{display:grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:rgba(255,255,255,.09);font-size:10px}
#content .dbV94ListCard[hidden],#content .dsd121[hidden]{display:none!important}#content .dbV94ListCard.da122Overdue{border-color:rgba(239,68,68,.62)}#content .dbV94ListCard.da122Conflict{box-shadow:inset 3px 0 0 rgba(245,158,11,.8)}#content .dbV94ListCard.da122Unassigned{box-shadow:inset 3px 0 0 rgba(96,165,250,.72)}#content .dbV94ListCard.da122Conflict.da122Unassigned{box-shadow:inset 3px 0 0 rgba(245,158,11,.8)}
#content .da122Badges{display:flex;gap:5px;flex-wrap:wrap;margin-top:1px}#content .da122Badge{display:inline-flex;align-items:center;min-height:18px;padding:2px 6px;border-radius:999px;font-size:9px;font-weight:800;line-height:1;background:rgba(255,255,255,.07);color:#cbd5e1}#content .da122Badge.overdue{background:rgba(239,68,68,.14);color:#fca5a5}#content .da122Badge.unassigned{background:rgba(59,130,246,.14);color:#93c5fd}#content .da122Badge.conflict{background:rgba(245,158,11,.15);color:#fcd34d}#content .da122Badge.reschedule{background:rgba(168,85,247,.14);color:#d8b4fe}#content .da122Empty{padding:28px 12px;text-align:center;color:var(--muted,#91a3b7);font-size:12px}
}
`;document.head.appendChild(style);
})();
