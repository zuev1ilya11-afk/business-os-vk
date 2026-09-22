(()=>{
'use strict';
if(window.BOS_DISPATCHER_ORDER_ATTENTION_V105)return;
window.BOS_DISPATCHER_ORDER_ATTENTION_V105=true;

let queued=false;
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const dispatcherMode=()=>String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview());
const active=o=>!['Выполнена','Отменена'].includes(String(o?.status||''));
const unassigned=o=>active(o)&&!o?.master_name&&!o?.master_vk_id&&!o?.master_id&&!o?.master_staff_id;
const overdue=o=>{const d=String(o?.scheduled_date||'').slice(0,10);return active(o)&&!!d&&d<today()};
const needsReschedule=o=>active(o)&&!!o?.reschedule_requested;
const idFromCard=card=>(String(card?.getAttribute('onclick')||'').match(/openOrder\('([^']+)'\)/)||[])[1]||'';
const orderFor=card=>(state?.orders||[]).find(o=>String(o?.id)===String(idFromCard(card)));

function label(text,type){
  const span=document.createElement('span');
  span.className=`dmAttentionBadge ${type}`;
  span.textContent=text;
  return span;
}
function decorate(card,order){
  const flags=[];
  if(needsReschedule(order))flags.push(['Нужен перенос','reschedule']);
  if(overdue(order))flags.push(['Просрочено','overdue']);
  if(unassigned(order))flags.push(['Без мастера','unassigned']);
  const signature=flags.map(x=>x[1]).join('|');
  if(card.dataset.dmAttention===signature)return;
  card.querySelector('.dmAttentionRow')?.remove();
  card.classList.remove('dmAttentionReschedule','dmAttentionOverdue','dmAttentionUnassigned');
  card.dataset.dmAttention=signature;
  if(!flags.length)return;
  const row=document.createElement('div');
  row.className='dmAttentionRow';
  flags.forEach(([text,type])=>row.appendChild(label(text,type)));
  const anchor=card.querySelector('.opsCompactTop');
  if(anchor)anchor.insertAdjacentElement('afterend',row); else card.prepend(row);
  card.classList.toggle('dmAttentionReschedule',needsReschedule(order));
  card.classList.toggle('dmAttentionOverdue',overdue(order));
  card.classList.toggle('dmAttentionUnassigned',unassigned(order));
}
function cleanup(root){
  root.querySelectorAll('.dmAttentionRow').forEach(x=>x.remove());
  root.querySelectorAll('[data-dm-attention]').forEach(card=>{
    delete card.dataset.dmAttention;
    card.classList.remove('dmAttentionReschedule','dmAttentionOverdue','dmAttentionUnassigned');
  });
}
function sync(){
  queued=false;
  const root=document.getElementById('content');
  if(!root)return;
  if(!dispatcherMode()||String(state?.page||'')!=='orders')return cleanup(root);
  root.querySelectorAll('#bosOrderList .opsCompactOrder').forEach(card=>{
    const order=orderFor(card);
    if(order)decorate(card,order);
  });
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(sync)}
const root=document.getElementById('content');
if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
queueMicrotask(schedule);

const style=document.createElement('style');
style.textContent=`
.dmAttentionRow{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.dmAttentionBadge{display:inline-flex;align-items:center;min-height:22px;padding:3px 7px;border-radius:999px;font-size:10px;font-weight:800;line-height:1;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#b7c6d5}.dmAttentionBadge.reschedule{border-color:rgba(242,176,65,.42);background:rgba(242,176,65,.1);color:#f2c46d}.dmAttentionBadge.overdue{border-color:rgba(229,92,92,.42);background:rgba(229,92,92,.1);color:#ff9696}.dmAttentionBadge.unassigned{border-color:rgba(88,178,255,.35);background:rgba(88,178,255,.09);color:#90cdff}#content .opsCompactOrder.dmAttentionOverdue{border-color:rgba(229,92,92,.3)}#content .opsCompactOrder.dmAttentionReschedule{box-shadow:inset 3px 0 0 rgba(242,176,65,.65),0 5px 16px rgba(0,0,0,.1)}@media(max-width:760px){.dmAttentionRow{margin-top:6px}.dmAttentionBadge{min-height:24px;padding:4px 7px}}
`;
document.head.appendChild(style);
})();
