(()=>{
'use strict';
if(window.BOS_DISPATCHER_UI_STABILITY_V185)return;
const MIN=1050;
let queued=false;
const stateRef=()=>{try{return typeof state!=='undefined'?state:null}catch(_){return null}};
const dispatcherMode=()=>window.BOS_PERMISSIONS.isDispatcherWorkspaceActive(stateRef()?.user);
const ordersPage=()=>String(stateRef()?.page||'')==='orders';

function syncHost(host,cardSelector){
  if(!host)return;
  const cards=[...host.children].filter(node=>node.matches?.(cardSelector));
  const byId=new Map(cards.map(card=>[String(card.dataset.orderId||''),card]));
  const bars=[...host.children].filter(node=>node.matches?.('.dq159DesktopActions[data-order-id]'));
  const barById=new Map();
  for(const bar of bars){
    const id=String(bar.dataset.orderId||'');
    const card=byId.get(id);
    if(!card||barById.has(id)){bar.remove();continue}
    barById.set(id,bar);
  }
  for(const card of cards){
    const id=String(card.dataset.orderId||'');
    const bar=barById.get(id);if(!bar)continue;
    if(bar.hidden!==card.hidden)bar.hidden=card.hidden;
    if(card.nextElementSibling!==bar)card.insertAdjacentElement('afterend',bar);
  }
}
function syncPairs(){
  syncHost(document.querySelector('.dbV94ListItems'),'.dbV94ListCard[data-order-id]');
  document.querySelectorAll('.dbAttention .dbTray').forEach(host=>syncHost(host,'.dbOrderCard[data-order-id]'));
}
function apply(){
  queued=false;
  if(window.innerWidth<MIN||!dispatcherMode()||!ordersPage())return;
  syncPairs();
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(apply)}
function start(){
  const root=document.getElementById('content');
  if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  document.addEventListener('click',event=>{if(event.target.closest?.('[data-da123-filter]'))queueMicrotask(schedule)},true);
  document.addEventListener('change',event=>{if(event.target.closest?.('#bosOrderSort,#bosOrderMaster'))queueMicrotask(schedule)},true);
  document.addEventListener('input',event=>{if(event.target.closest?.('#bosOrderSearch'))queueMicrotask(schedule)},true);
  schedule();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.addEventListener('resize',schedule);
window.BOS_DISPATCHER_UI_STABILITY_V185={version:'185',refresh:schedule,syncPairs};

const style=document.createElement('style');
style.textContent=`
@media(min-width:${MIN}px){
  #content .dq159DesktopActions[hidden]{display:none!important}
  #content .du184Board,
  #content .du184Board .dbLayout,
  #content .du184Board .dbLayout>*{min-width:0!important}
  #content .du184Board .dbSchedule,
  #content .du184Board #dispatchBoardDetail,
  #content .du184Board .dbAttention,
  #content .du184Board .dbV94InlineList,
  #content .du184Board .dbV94ListItems{min-width:0!important;max-width:100%!important}
}
@media(min-width:${MIN}px) and (max-width:1320px){
  #content .du184Board .dbLayout{grid-template-columns:minmax(205px,235px) minmax(0,1fr) minmax(275px,310px)!important;gap:8px!important}
  #content .du184Board .dbToolbar{flex-wrap:wrap!important;align-items:center!important}
  #content .du184Board .dbViewTabs{flex:0 0 auto!important}
  #content .du184Board .dbV21QuickDates{flex:1 1 500px!important;min-width:0!important;justify-content:flex-end!important;flex-wrap:wrap!important;margin-left:auto!important}
  #content .du184Board .dbV21QuickDates .dbDateNav{min-width:0!important;flex-wrap:wrap!important}
  #content .du184Board .dbV21QuickDates .dbDateNav input{min-width:125px!important;width:145px!important}
  #content .du184Board .dbV94ListCard{min-width:0!important}
  #content .du184Board .dbV94ListTop,
  #content .du184Board .dbV94ListWork,
  #content .du184Board .dbV94ListMeta{min-width:0!important}
}
@media(min-width:${MIN}px) and (max-width:1140px){
  #content .du184Board .dbLayout{grid-template-columns:minmax(190px,215px) minmax(0,1fr) minmax(250px,285px)!important;gap:7px!important}
  #content .du184Board .dbAttention{padding:8px!important}
  #content .du184Board .dbV94InlineList{padding:9px!important}
  #content .du184Board .du183Date{width:50px!important;min-width:50px!important}
  #content .du184Board .du183CardSide{min-width:105px!important}
  #content .du184Board .dbToolbar{padding:7px!important;gap:6px!important}
}
`;
document.head.appendChild(style);
})();
