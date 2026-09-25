(()=>{
'use strict';
if(window.BOS_DISPATCHER_ATTENTION_V123)return;
const MIN_DESKTOP=1050;
let activeFilter='all',queued=false;
const pad=n=>String(n).padStart(2,'0');
const today=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const desktop=()=>window.innerWidth>=MIN_DESKTOP&&(String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview()));
const ordersPage=()=>String(state?.page||'')==='orders';
const active=o=>!!o&&!['Выполнена','Отменена'].includes(String(o?.status||''));
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10);
const masterKey=o=>String(o?.master_staff_id||o?.master_vk_id||o?.master_id||o?.master_name||'').trim();
const unassigned=o=>active(o)&&!masterKey(o);
const overdue=o=>active(o)&&!!dateOf(o)&&dateOf(o)<today();
const dueToday=o=>active(o)&&dateOf(o)===today();
const reschedule=o=>active(o)&&!!o?.reschedule_requested;
const explicitUrgent=o=>{
  const p=String(o?.priority||o?.urgency||'').trim().toLowerCase();
  return o?.urgent===true||['urgent','high','critical','срочно','высокий','высокая'].includes(p);
};
const orderById=id=>(state?.orders||[]).find(o=>String(o?.id)===String(id))||null;
const mins=v=>{const m=String(v||'').match(/(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null};
function rangeOf(o){const p=String(o?.time_slot||'').trim().split(/[–—-]/).map(mins).filter(v=>v!==null);if(p.length>=2&&p[1]>p[0])return[p[0],p[1]];const s=mins(o?.scheduled_time);return s===null?null:[s,s+60]}
const overlap=(a,b)=>a&&b&&a[0]<b[1]&&b[0]<a[1];
function conflictIds(){const src=(state?.orders||[]).filter(o=>active(o)&&masterKey(o)&&dateOf(o)&&rangeOf(o)),ids=new Set();for(let i=0;i<src.length;i++)for(let j=i+1;j<src.length;j++){if(masterKey(src[i])!==masterKey(src[j])||dateOf(src[i])!==dateOf(src[j]))continue;if(overlap(rangeOf(src[i]),rangeOf(src[j]))){ids.add(String(src[i].id));ids.add(String(src[j].id))}}return ids}
const urgent=(o,conflicts)=>active(o)&&(overdue(o)||explicitUrgent(o)||conflicts.has(String(o?.id)));
function filterFlags(order,conflicts){const out=[];if(urgent(order,conflicts))out.push('urgent');if(dueToday(order))out.push('today');if(unassigned(order))out.push('unassigned');if(reschedule(order))out.push('reschedule');return out}
function detailFlags(order,conflicts){const out=[];if(overdue(order))out.push('overdue');if(conflicts.has(String(order?.id)))out.push('conflict');if(dueToday(order))out.push('today');if(unassigned(order))out.push('unassigned');if(reschedule(order))out.push('reschedule');return out}
const label=f=>({urgent:'Срочно',today:'Сегодня',overdue:'Просрочено',unassigned:'Без мастера',conflict:'Конфликт',reschedule:'Перенос'})[f]||f;
const matches=f=>activeFilter==='all'||f.includes(activeFilter);
function badge(card,details,filters){
  card.classList.toggle('da123Urgent',filters.includes('urgent'));
  card.classList.toggle('da123Today',filters.includes('today'));
  card.classList.toggle('da123Overdue',details.includes('overdue'));
  card.classList.toggle('da123Unassigned',details.includes('unassigned'));
  card.classList.toggle('da123Conflict',details.includes('conflict'));
  card.classList.toggle('da123Reschedule',details.includes('reschedule'));
  const sig=details.join('|');let box=card.querySelector(':scope>.da123Badges');
  if(!sig){box?.remove();return}
  if(!box){box=document.createElement('div');box.className='da123Badges';card.querySelector(':scope>.dbV94ListTop')?.insertAdjacentElement('afterend',box)}
  if(box.dataset.signature===sig)return;
  box.dataset.signature=sig;box.innerHTML=details.map(x=>`<span class="da123Badge ${x}">${label(x)}</span>`).join('')
}
function controlsHtml(c,total){return [['all','Все',total],['urgent','Срочно',c.urgent],['today','Сегодня',c.today],['unassigned','Без мастера',c.unassigned],['reschedule','Перенос',c.reschedule]].map(([v,l,n])=>`<button type="button" class="${activeFilter===v?'primary':'secondary'}" data-da123-filter="${v}" aria-pressed="${activeFilter===v?'true':'false'}"><span>${l}</span><b>${n}</b></button>`).join('')}
function ensureControls(list,c,total){const head=list.querySelector(':scope>.dbV94ListHead');if(!head)return;head.classList.add('da123Head');let box=head.querySelector(':scope>.da123Controls');if(!box){box=document.createElement('div');box.className='da123Controls';head.appendChild(box)}const sig=`${activeFilter}|${total}|${c.urgent}|${c.today}|${c.unassigned}|${c.reschedule}`;if(box.dataset.signature===sig)return;box.dataset.signature=sig;box.innerHTML=controlsHtml(c,total)}
function cleanup(root){root.querySelectorAll('.da123Controls,.da123Empty,.da123Badges').forEach(n=>n.remove());root.querySelectorAll('.dbV94ListHead.da123Head').forEach(n=>n.classList.remove('da123Head'));root.querySelectorAll('.dbV94ListCard[data-order-id]').forEach(n=>{n.hidden=false;n.classList.remove('da123Urgent','da123Today','da123Overdue','da123Unassigned','da123Conflict','da123Reschedule')});root.querySelectorAll('.dsd121[data-order-id]').forEach(n=>n.hidden=false)}
function sync(){
  queued=false;const root=document.getElementById('content');if(!root)return;
  if(!desktop()||!ordersPage()){cleanup(root);return}
  const list=root.querySelector('.dbV94InlineList'),items=list?.querySelector('.dbV94ListItems');if(!list||!items)return;
  const cards=[...list.querySelectorAll('.dbV94ListCard[data-order-id]')],conflicts=conflictIds(),c={urgent:0,today:0,unassigned:0,reschedule:0};let visible=0;
  cards.forEach(card=>{
    const id=String(card.dataset.orderId||''),o=orderById(id),filters=o?filterFlags(o,conflicts):[],details=o?detailFlags(o,conflicts):[];
    filters.forEach(x=>c[x]++);badge(card,details,filters);
    const show=matches(filters);card.hidden=!show;if(show)visible++;
    const smart=[...items.querySelectorAll('.dsd121[data-order-id]')].find(n=>String(n.dataset.orderId||'')===id);if(smart)smart.hidden=!show
  });
  ensureControls(list,c,cards.length);
  let empty=items.querySelector(':scope>.da123Empty');if(visible){empty?.remove()}else{if(!empty){empty=document.createElement('div');empty.className='da123Empty';items.appendChild(empty)}empty.textContent=activeFilter==='all'?'По выбранным условиям заявок нет.':`Нет заявок: ${label(activeFilter).toLowerCase()}.`}
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(sync)}
function setFilter(v){activeFilter=['all','urgent','today','unassigned','reschedule'].includes(String(v))?String(v):'all';schedule()}
document.addEventListener('click',e=>{const b=e.target.closest?.('[data-da123-filter]');if(!b)return;e.preventDefault();e.stopPropagation();setFilter(b.dataset.da123Filter)});
function start(){const root=document.getElementById('content');if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});schedule()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();window.addEventListener('resize',schedule);
window.BOS_DISPATCHER_ATTENTION_V123={setFilter,refresh:schedule,get filter(){return activeFilter},conflictIds:()=>[...conflictIds()]};
const style=document.createElement('style');style.textContent=`@media(min-width:${MIN_DESKTOP}px){#content .dbV94ListHead.da123Head{flex-wrap:wrap}#content .dbV94ListHead.da123Head>.da123Controls{flex:1 0 100%;width:100%;margin-top:2px}#content .da123Controls{display:flex;gap:6px;overflow-x:auto;padding:0 0 2px;scrollbar-width:none}#content .da123Controls::-webkit-scrollbar{display:none}#content .da123Controls button{min-height:34px;padding:6px 9px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-size:11px}#content .da123Controls button b{display:grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:rgba(255,255,255,.09);font-size:10px}#content .dbV94ListCard[hidden],#content .dsd121[hidden]{display:none!important}#content .dbV94ListCard.da123Urgent{border-color:rgba(239,68,68,.66);box-shadow:inset 3px 0 0 rgba(239,68,68,.82)}#content .dbV94ListCard.da123Today:not(.da123Urgent){box-shadow:inset 3px 0 0 rgba(59,130,246,.72)}#content .dbV94ListCard.da123Conflict.da123Unassigned{box-shadow:inset 3px 0 0 rgba(239,68,68,.82)}#content .da123Badges{display:flex;gap:5px;flex-wrap:wrap;margin-top:1px}#content .da123Badge{display:inline-flex;align-items:center;min-height:18px;padding:2px 6px;border-radius:999px;font-size:9px;font-weight:800;line-height:1;background:rgba(255,255,255,.07);color:#cbd5e1}#content .da123Badge.overdue{background:rgba(239,68,68,.14);color:#fca5a5}#content .da123Badge.today{background:rgba(59,130,246,.14);color:#93c5fd}#content .da123Badge.unassigned{background:rgba(59,130,246,.1);color:#bfdbfe}#content .da123Badge.conflict{background:rgba(245,158,11,.15);color:#fcd34d}#content .da123Badge.reschedule{background:rgba(168,85,247,.14);color:#d8b4fe}#content .da123Empty{padding:28px 12px;text-align:center;color:var(--muted,#91a3b7);font-size:12px}}`;document.head.appendChild(style);
})();