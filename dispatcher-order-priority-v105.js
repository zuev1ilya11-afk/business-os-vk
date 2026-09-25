(()=>{
'use strict';
if(window.BOS_DISPATCHER_ORDER_PRIORITY_V105)return;
window.BOS_DISPATCHER_ORDER_PRIORITY_V105=true;

const MOBILE_MAX=760;
let queued=false;
const dispatcherMode=()=>String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview());
const ordersPage=()=>String(state?.page||'')==='orders';
const mobileMode=()=>window.innerWidth<=MOBILE_MAX;
const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const active=o=>!['Выполнена','Отменена'].includes(String(o?.status||''));
const orderDate=o=>String(o?.scheduled_date||'').slice(0,10);
const unassigned=o=>active(o)&&!o?.master_name&&!o?.master_vk_id&&!o?.master_id&&!o?.master_staff_id;
const overdue=o=>{const date=orderDate(o);return active(o)&&!!date&&date<localToday()};
const today=o=>active(o)&&orderDate(o)===localToday();
const reschedule=o=>active(o)&&!!o?.reschedule_requested;
const explicitUrgent=o=>{
  const p=String(o?.priority||o?.urgency||'').trim().toLowerCase();
  return o?.urgent===true||['urgent','high','critical','срочно','высокий','высокая'].includes(p);
};
const urgent=o=>overdue(o)||explicitUrgent(o);
const orderIdFromCard=card=>String(card?.getAttribute('onclick')||'').match(/openOrder\('([^']+)'\)/)?.[1]||'';
const orderForCard=card=>(state?.orders||[]).find(o=>String(o?.id)===orderIdFromCard(card));

function flagsFor(order){
  const flags=[];
  if(urgent(order))flags.push(['Срочно','urgent','dmFlagUrgent']);
  if(today(order))flags.push(['Сегодня','today','dmFlagToday']);
  if(unassigned(order))flags.push(['Без мастера','unassigned','dmFlagUnassigned']);
  if(reschedule(order))flags.push(['Перенос','warn','dmFlagReschedule']);
  return flags;
}

function decorateCard(card){
  const order=orderForCard(card);
  if(!order)return;
  let row=card.querySelector(':scope > .dmOperationalFlags');
  const flags=flagsFor(order);
  if(!flags.length){row?.remove();}
  else{
    if(!row){
      row=document.createElement('div');
      row.className='dmOperationalFlags';
      const actions=card.querySelector(':scope > .dmCardActions');
      if(actions)card.insertBefore(row,actions);else card.appendChild(row);
    }
    const signature=flags.map(x=>x[2]).join('|');
    if(row.dataset.signature!==signature){
      row.innerHTML='';
      flags.forEach(([text,tone,extra])=>{
        const chip=document.createElement('span');
        chip.className=`dmOperationalFlag ${tone} ${extra}`;
        chip.textContent=text;
        row.appendChild(chip);
      });
      row.dataset.signature=signature;
    }
  }

  const actions=card.querySelector(':scope > .dmCardActions');
  if(!actions)return;
  const assign=actions.querySelector('.dmAssignAction');
  if(assign)assign.classList.add('dmPriorityAction');
  const timing=actions.querySelector('.dmDateTimeAction');
  if(timing&&reschedule(order))timing.classList.add('dmPriorityWarning');
}

function cleanup(root){
  root.querySelectorAll('.dmOperationalFlags').forEach(node=>node.remove());
  root.querySelectorAll('.dmPriorityAction').forEach(node=>node.classList.remove('dmPriorityAction'));
  root.querySelectorAll('.dmPriorityWarning').forEach(node=>node.classList.remove('dmPriorityWarning'));
}

function sync(){
  queued=false;
  const root=document.getElementById('content');
  if(!root)return;
  if(!dispatcherMode()||!ordersPage()||!mobileMode()){
    cleanup(root);
    return;
  }
  root.querySelectorAll('#bosOrderList .opsCompactOrder').forEach(decorateCard);
}
function schedule(){
  if(queued)return;
  queued=true;
  requestAnimationFrame(sync);
}

const root=document.getElementById('content');
if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
window.addEventListener('resize',schedule);
const baseShow=window.show;
if(typeof baseShow==='function')window.show=function(){const out=baseShow.apply(this,arguments);schedule();return out};
queueMicrotask(schedule);

const style=document.createElement('style');
style.textContent=`
@media(max-width:${MOBILE_MAX}px){
  .dmOperationalFlags{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)}
  .dmOperationalFlag{display:inline-flex;align-items:center;min-height:24px;padding:3px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.1);font-size:10px;font-weight:800;line-height:1;letter-spacing:.01em;background:rgba(255,255,255,.045);color:#aebdcb}
  .dmOperationalFlag.urgent{border-color:rgba(229,92,92,.5);background:rgba(229,92,92,.14);color:#ffaaaa}
  .dmOperationalFlag.warn{border-color:rgba(242,176,65,.34);background:rgba(242,176,65,.1);color:#f4c86d}
  .dmOperationalFlag.today{border-color:rgba(73,163,255,.34);background:rgba(73,163,255,.1);color:#8dccff}
  .dmOperationalFlag.unassigned{border-color:rgba(170,183,198,.24);background:rgba(170,183,198,.08);color:#c1ccd7}
  #content.dmExistingOrders .dmCardActions .secondary{min-height:46px}
  #content.dmExistingOrders .dmCardActions .dmPriorityAction{border-color:rgba(73,163,255,.5);background:rgba(37,111,180,.24);color:#a9d7ff;font-weight:800}
  #content.dmExistingOrders .dmCardActions .dmPriorityWarning{border-color:rgba(242,176,65,.58);background:rgba(242,176,65,.1);color:#f4c86d;font-weight:800}
}
`;
document.head.appendChild(style);
})();