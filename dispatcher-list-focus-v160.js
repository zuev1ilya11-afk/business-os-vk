(()=>{
'use strict';
if(window.BOS_DISPATCHER_LIST_FOCUS_V160)return;
window.BOS_DISPATCHER_LIST_FOCUS_V160={version:'160'};

const DESKTOP_MIN=1050;
const STORAGE_KEY='bos_dispatcher_compact_v160';
let attentionOnly=false;
let queued=false;
let compact=localStorage.getItem(STORAGE_KEY)!=='comfortable';

const dispatcherMode=()=>String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview());
const ordersPage=()=>String(state?.page||'')==='orders';
const active=o=>!!o&&!['Выполнена','Отменена'].includes(String(o?.status||''));
const pad=n=>String(n).padStart(2,'0');
const today=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10);
const timeOf=o=>String(o?.scheduled_time||o?.time_slot||'').trim();
const unassigned=o=>active(o)&&!o?.master_name&&!o?.master_vk_id&&!o?.master_id&&!o?.master_staff_id;
const overdue=o=>active(o)&&!!dateOf(o)&&dateOf(o)<today();
const reschedule=o=>active(o)&&!!o?.reschedule_requested;
const missingDate=o=>active(o)&&!dateOf(o);
const missingTime=o=>active(o)&&dateOf(o)===today()&&!timeOf(o);
const orderById=id=>(state?.orders||[]).find(o=>String(o?.id)===String(id))||null;
const conflictIds=()=>new Set((window.BOS_DISPATCHER_ATTENTION_V123?.conflictIds?.()||[]).map(String));

function reasons(o,conflicts){
  const out=[];
  if(reschedule(o))out.push('Перенос');
  if(overdue(o))out.push('Просрочено');
  if(unassigned(o))out.push('Без мастера');
  if(missingDate(o))out.push('Без даты');
  if(missingTime(o))out.push('Без времени');
  if(conflicts.has(String(o?.id)))out.push('Конфликт');
  return out;
}
function needsAttention(o,conflicts){return active(o)&&reasons(o,conflicts).length>0}

function ensureBadge(card,items){
  let box=card.querySelector(':scope>.dlf160Badges');
  const extra=items.filter(x=>x==='Без даты'||x==='Без времени');
  if(!extra.length){box?.remove();return}
  if(!box){box=document.createElement('div');box.className='dlf160Badges';card.querySelector(':scope>.dbV94ListTop')?.insertAdjacentElement('afterend',box)}
  const sig=extra.join('|');if(box.dataset.signature===sig)return;
  box.dataset.signature=sig;box.innerHTML=extra.map(x=>`<span>${x}</span>`).join('');
}
function setHiddenWithActions(items,card,hidden){
  if(card.hidden!==hidden)card.hidden=hidden;
  const id=String(card.dataset.orderId||'');
  [...items.querySelectorAll('.dq159DesktopActions[data-order-id],.dsd121[data-order-id]')].forEach(n=>{
    if(String(n.dataset.orderId||'')===id&&n.hidden!==hidden)n.hidden=hidden;
  });
}
function ensureControls(list,attentionCount,total){
  const head=list.querySelector(':scope>.dbV94ListHead');if(!head)return;
  let tools=head.querySelector(':scope>.dlf160Tools');
  if(!tools){tools=document.createElement('div');tools.className='dlf160Tools';head.appendChild(tools)}
  tools.innerHTML=`<button type="button" class="${attentionOnly?'primary':'secondary'}" data-dlf160-filter="attention" aria-pressed="${attentionOnly?'true':'false'}">Внимание <b>${attentionCount}</b></button><button type="button" class="secondary" data-dlf160-compact aria-pressed="${compact?'true':'false'}">${compact?'Обычный вид':'Компактно'}</button>`;
  tools.dataset.total=String(total);
}
function cleanup(root){
  root.querySelectorAll('.dlf160Tools,.dlf160Badges,.dlf160Empty').forEach(n=>n.remove());
  root.querySelectorAll('.dbV94ListItems').forEach(n=>n.classList.remove('dlf160Compact'));
  root.querySelectorAll('.dbV94ListCard[data-order-id]').forEach(n=>{n.classList.remove('dlf160NeedsAttention','dlf160MissingDate','dlf160MissingTime');if(attentionOnly)n.hidden=false});
  root.querySelectorAll('.dq159DesktopActions[data-order-id],.dsd121[data-order-id]').forEach(n=>{if(attentionOnly)n.hidden=false});
}
function sync(){
  queued=false;const root=document.getElementById('content');if(!root)return;
  if(window.innerWidth<DESKTOP_MIN||!dispatcherMode()||!ordersPage()){cleanup(root);return}
  const list=root.querySelector('.dbV94InlineList'),items=list?.querySelector('.dbV94ListItems');if(!list||!items)return;
  items.classList.toggle('dlf160Compact',compact);
  const conflicts=conflictIds();const cards=[...items.querySelectorAll('.dbV94ListCard[data-order-id]')];let attentionCount=0,visible=0;
  cards.forEach(card=>{
    const o=orderById(card.dataset.orderId);const why=o?reasons(o,conflicts):[];const flagged=o?needsAttention(o,conflicts):false;
    if(flagged)attentionCount++;
    card.classList.toggle('dlf160NeedsAttention',flagged);
    card.classList.toggle('dlf160MissingDate',!!o&&missingDate(o));
    card.classList.toggle('dlf160MissingTime',!!o&&missingTime(o));
    ensureBadge(card,why);
    const hide=attentionOnly&&!flagged;setHiddenWithActions(items,card,hide);if(!hide)visible++;
  });
  ensureControls(list,attentionCount,cards.length);
  let empty=items.querySelector(':scope>.dlf160Empty');
  if(attentionOnly&&!visible){if(!empty){empty=document.createElement('div');empty.className='dlf160Empty';items.appendChild(empty)}empty.textContent='Заявок, требующих внимания, нет.'}else empty?.remove();
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(sync)}
function setAttention(on){attentionOnly=!!on;if(attentionOnly)window.BOS_DISPATCHER_ATTENTION_V123?.setFilter?.('all');requestAnimationFrame(schedule)}
function setCompact(on){compact=!!on;localStorage.setItem(STORAGE_KEY,compact?'compact':'comfortable');schedule()}

document.addEventListener('click',event=>{
  const att=event.target.closest?.('[data-dlf160-filter="attention"]');
  if(att){event.preventDefault();event.stopPropagation();setAttention(!attentionOnly);return}
  const density=event.target.closest?.('[data-dlf160-compact]');
  if(density){event.preventDefault();event.stopPropagation();setCompact(!compact);return}
  if(event.target.closest?.('[data-da123-filter]')&&attentionOnly){attentionOnly=false;requestAnimationFrame(schedule)}
});
const root=document.getElementById('content');if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
window.addEventListener('resize',schedule);queueMicrotask(schedule);
window.BOS_DISPATCHER_LIST_FOCUS_V160={version:'160',refresh:schedule,setAttention,setCompact,get attentionOnly(){return attentionOnly},get compact(){return compact}};

const style=document.createElement('style');style.textContent=`
@media(min-width:${DESKTOP_MIN}px){
  #content .dlf160Tools{display:flex;align-items:center;gap:6px;margin-left:auto;flex-wrap:wrap}
  #content .dlf160Tools button{min-height:34px;padding:6px 9px;font-size:11px;display:inline-flex;align-items:center;gap:6px}
  #content .dlf160Tools button b{display:grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:rgba(255,255,255,.09);font-size:10px}
  #content .dbV94ListCard.dlf160NeedsAttention{border-color:rgba(245,158,11,.5);box-shadow:inset 3px 0 0 rgba(245,158,11,.7)}
  #content .dbV94ListCard.dlf160MissingDate{border-color:rgba(239,68,68,.48);box-shadow:inset 3px 0 0 rgba(239,68,68,.8)}
  #content .dlf160Badges{display:flex;gap:5px;flex-wrap:wrap;margin-top:2px}
  #content .dlf160Badges span{display:inline-flex;align-items:center;min-height:18px;padding:2px 6px;border-radius:999px;font-size:9px;font-weight:800;background:rgba(239,68,68,.12);color:#fca5a5}
  #content .dlf160Compact .dbV94ListCard{padding:8px 10px!important;margin-bottom:4px!important;min-height:0!important}
  #content .dlf160Compact .dbV94ListCard *{line-height:1.2}
  #content .dlf160Compact .da123Badges,#content .dlf160Compact .dlf160Badges{margin-top:1px}
  #content .dlf160Compact .dq159DesktopActions{padding:5px;margin:-2px 0 4px;gap:4px}
  #content .dlf160Compact .dq159DesktopActions .dq159Action{min-height:36px;padding:6px 8px}
  #content .dlf160Empty{padding:28px 12px;text-align:center;color:var(--muted,#91a3b7);font-size:12px}
  #content .dq159DesktopActions[hidden],#content .dsd121[hidden]{display:none!important}
}
`;
document.head.appendChild(style);
})();