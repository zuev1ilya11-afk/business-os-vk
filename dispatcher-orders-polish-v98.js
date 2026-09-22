(()=>{
'use strict';
if(window.BOS_DISPATCHER_ORDERS_POLISH_V98)return;
window.BOS_DISPATCHER_ORDERS_POLISH_V98=true;

let queued=false;
const content=()=>document.getElementById('content');
const dispatcherMode=()=>String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview());
const ordersPage=()=>String(state?.page||'')==='orders';
const status=o=>String(o?.status||'').trim();
const createdValue=o=>{
  const raw=o?.created_at||o?.createdAt||o?.created_date||o?.date_created||'';
  const time=Date.parse(String(raw||''));
  if(Number.isFinite(time))return time;
  const id=Number(o?.id);
  return Number.isFinite(id)?id:0;
};
const orderIdFromCard=card=>String(card?.getAttribute('onclick')||'').match(/openOrder\('([^']+)'\)/)?.[1]||'';
const orderForCard=card=>(state?.orders||[]).find(o=>String(o?.id)===orderIdFromCard(card));
const priority=o=>status(o)==='Новая'?0:1;

function compareOrders(a,b){
  const pa=priority(a),pb=priority(b);
  if(pa!==pb)return pa-pb;
  const ca=createdValue(a),cb=createdValue(b);
  if(ca!==cb)return cb-ca;
  return String(b?.id||'').localeCompare(String(a?.id||''),'ru',{numeric:true});
}

function sortList(root){
  const list=root.querySelector('#bosOrderList');
  if(!list)return;
  const cards=[...list.querySelectorAll(':scope > .opsCompactOrder')];
  if(cards.length<2)return;
  const sorted=[...cards].sort((a,b)=>compareOrders(orderForCard(a)||{},orderForCard(b)||{}));
  const current=cards.map(orderIdFromCard).join('|');
  const next=sorted.map(orderIdFromCard).join('|');
  if(current===next)return;
  sorted.forEach(card=>list.appendChild(card));
}

function decorate(root){
  root.classList.add('dmDispatcherOrdersPolished');
  const list=root.querySelector('#bosOrderList');
  if(list)list.classList.add('dmDispatcherOrderList');
  root.querySelectorAll('#bosOrderList .opsCompactOrder').forEach(card=>{
    const order=orderForCard(card);
    if(!order)return;
    card.classList.toggle('dmIsNew',status(order)==='Новая');
    if(status(order)==='Новая'&&!card.querySelector('.dmNewBadge')){
      const top=card.querySelector('.opsCompactTop');
      if(top){
        const badge=document.createElement('span');
        badge.className='dmNewBadge';
        badge.textContent='Новая';
        top.insertBefore(badge,top.children[1]||null);
      }
    }
  });
}

function cleanup(root){
  root.classList.remove('dmDispatcherOrdersPolished');
  root.querySelector('#bosOrderList')?.classList.remove('dmDispatcherOrderList');
  root.querySelectorAll('.dmNewBadge').forEach(x=>x.remove());
  root.querySelectorAll('.dmIsNew').forEach(x=>x.classList.remove('dmIsNew'));
}

function sync(){
  queued=false;
  const root=content();
  if(!root)return;
  if(!dispatcherMode()||!ordersPage()){
    if(root.classList.contains('dmDispatcherOrdersPolished'))cleanup(root);
    return;
  }
  sortList(root);
  decorate(root);
}
function schedule(){
  if(queued)return;
  queued=true;
  requestAnimationFrame(sync);
}

const root=content();
if(root){
  new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
}
const baseShow=window.show;
if(typeof baseShow==='function')window.show=function(){
  const out=baseShow.apply(this,arguments);
  schedule();
  return out;
};
queueMicrotask(schedule);

const style=document.createElement('style');
style.textContent=`
#content.dmDispatcherOrdersPolished #bosOrderList{display:grid;gap:8px;margin-top:8px}
#content.dmDispatcherOrdersPolished .opsCompactOrder{position:relative;margin:0;padding:11px 13px;border-radius:14px;border:1px solid rgba(255,255,255,.085);background:linear-gradient(180deg,rgba(20,34,49,.96),rgba(14,27,41,.96));box-shadow:0 5px 16px rgba(0,0,0,.1);transition:border-color .15s ease,transform .15s ease}
#content.dmDispatcherOrdersPolished .opsCompactOrder:hover{border-color:rgba(88,178,255,.28);transform:translateY(-1px)}
#content.dmDispatcherOrdersPolished .opsCompactOrder.dmIsNew{border-color:rgba(88,178,255,.34);box-shadow:inset 3px 0 0 rgba(88,178,255,.78),0 5px 16px rgba(0,0,0,.1)}
#content.dmDispatcherOrdersPolished .opsCompactTop{display:grid;grid-template-columns:auto auto 1fr;align-items:center;justify-content:initial;gap:7px}
#content.dmDispatcherOrdersPolished .opsCompactTop>b{font-size:13px;white-space:nowrap}
#content.dmDispatcherOrdersPolished .opsCompactTop>span:last-child{justify-self:end;text-align:right;font-size:11px;white-space:nowrap}
#content.dmDispatcherOrdersPolished .dmNewBadge{display:inline-flex;align-items:center;justify-content:center;min-height:21px;padding:2px 7px;border-radius:999px;background:rgba(88,178,255,.14);border:1px solid rgba(88,178,255,.3);color:#8dccff;font-size:10px;font-weight:800;line-height:1}
#content.dmDispatcherOrdersPolished .opsCompactMain{margin-top:7px;gap:10px}
#content.dmDispatcherOrdersPolished .opsCompactMain>b{font-size:14px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#content.dmDispatcherOrdersPolished .opsCompactMain>strong{font-size:14px;white-space:nowrap}
#content.dmDispatcherOrdersPolished .opsCompactAddress{margin-top:4px;font-size:11.5px;line-height:1.3}
#content.dmDispatcherOrdersPolished .opsCompactWorks{margin-top:7px;padding-top:7px;font-size:11.5px;line-height:1.3}
#content.dmDispatcherOrdersPolished .opsCompactBottom{margin-top:7px;gap:5px}
#content.dmDispatcherOrdersPolished .opsCompactBottom>*{max-width:100%}
@media(min-width:900px){
  #content.dmDispatcherOrdersPolished #bosOrderList{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}
  #content.dmDispatcherOrdersPolished .opsCompactOrder{min-width:0}
}
@media(max-width:760px){
  #content.dmDispatcherOrdersPolished #bosOrderList{display:flex;flex-direction:column;gap:8px}
  #content.dmDispatcherOrdersPolished .opsCompactOrder{padding:11px 12px;border-radius:14px}
  #content.dmDispatcherOrdersPolished .opsCompactOrder:hover{transform:none}
  #content.dmDispatcherOrdersPolished .opsCompactTop{grid-template-columns:auto auto 1fr;gap:6px}
  #content.dmDispatcherOrdersPolished .opsCompactTop>span:last-child{font-size:10.5px;overflow:hidden;text-overflow:ellipsis}
  #content.dmDispatcherOrdersPolished .opsCompactMain>b{font-size:14px}
  #content.dmDispatcherOrdersPolished .opsCompactWorks{max-height:52px;overflow:hidden}
}
`;
document.head.appendChild(style);
})();
