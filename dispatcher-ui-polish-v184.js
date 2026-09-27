(()=>{
'use strict';
if(window.BOS_DISPATCHER_UI_POLISH_V184)return;
window.BOS_DISPATCHER_UI_POLISH_V184=true;
const MIN=1050;
let queued=false;
const stateRef=()=>{try{return typeof state!=='undefined'?state:null}catch(_){return null}};
const dispatcherMode=()=>String(stateRef()?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&!!isDispatcherPreview());
const ordersPage=()=>String(stateRef()?.page||'')==='orders';
function markEmptyQueue(root){
  const panel=root.querySelector(':scope>.duq122');
  if(!panel)return;
  const hasItems=!!panel.querySelector('.duq122Item');
  const empty=!!panel.querySelector('.duq122Empty')||String(panel.textContent||'').includes('Неназначенных активных заявок нет');
  panel.classList.toggle('du184QueueEmpty',!hasItems&&empty);
}
function markBoard(root){
  const board=root.querySelector('.dbBoard');
  if(!board)return;
  board.classList.add('du184Board');
  const detail=board.querySelector('#dispatchBoardDetail .dbDetail');
  if(detail)detail.classList.add('du184Detail');
}
function apply(){
  queued=false;
  const root=document.getElementById('content');
  if(!root||window.innerWidth<MIN||!dispatcherMode()||!ordersPage())return;
  markEmptyQueue(root);
  markBoard(root);
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(apply)}
function start(){
  const root=document.getElementById('content');
  if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
  schedule();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.addEventListener('resize',schedule);
window.BOS_DISPATCHER_UI_POLISH_V184={refresh:schedule};
const style=document.createElement('style');
style.textContent=`
@media(min-width:${MIN}px){
  #content>.duq122.du184QueueEmpty{display:none!important}
  #content>.duq122:not(.du184QueueEmpty){margin-bottom:9px!important;padding:10px!important}
  #content>.duq122:not(.du184QueueEmpty) .duq122Head{margin-bottom:7px!important}

  #content .du184Board .dbTop{padding-bottom:10px!important;margin-bottom:9px!important}
  #content .du184Board .dbTop h2{font-size:25px!important;margin:4px 0 3px!important}
  #content .du184Board .dbTop p{font-size:12px!important}
  #content .du184Board .dbDayStats{padding:10px 13px!important;min-width:118px!important}
  #content .du184Board .dbDayStats b{font-size:23px!important}

  #content .du184Board .dbToolbar{margin-bottom:9px!important;padding:8px 9px!important;gap:7px!important}
  #content .du184Board .dbV21Tools{min-height:62px!important;margin-bottom:8px!important}
  #content .du184Board .du183Kpis{gap:8px!important}
  #content .du184Board .du183Kpi{min-height:60px!important;padding:9px 12px!important;gap:10px!important}
  #content .du184Board .du183KpiIcon{width:34px!important;height:34px!important;font-size:16px!important}
  #content .du184Board .du183Kpi strong{font-size:19px!important}
  #content .du184Board .du183Kpi div span{font-size:10px!important}

  #content .du184Board .du183StatusStrip{min-height:34px!important;padding:5px 9px!important;margin-bottom:6px!important;border-radius:11px!important}
  #content .du184Board .du183StatusStrip b{font-size:12px!important}
  #content .du184Board .du183StatusStrip span,
  #content .du184Board .du183StatusStrip small{font-size:9px!important}

  #content .du184Board .dbLayout{grid-template-columns:minmax(225px,255px) minmax(0,1fr) minmax(300px,335px)!important;gap:10px!important;min-height:560px!important}
  #content .du184Board .dbAttention{padding:11px!important;min-width:0!important}
  #content .du184Board .dbSchedule{min-width:0!important}
  #content .du184Board .dbAttention>.dbFilters{margin:7px 0 9px!important;gap:6px!important}
  #content .du184Board .dbAttentionMetrics{gap:5px!important;margin:7px 0 9px!important}
  #content .du184Board .dbAttentionMetrics button{min-height:50px!important}

  #content .du184Board .dbV94ListHead{padding-bottom:7px!important;margin-bottom:7px!important}
  #content .du184Board .da123Controls{gap:5px!important}
  #content .du184Board .dbV94ListItems{gap:7px!important}
  #content .du184Board .dbV94ListCard{min-height:82px!important}
  #content .du184Board .du183Date{width:58px!important;min-width:58px!important}
  #content .du184Board .du183Date b{font-size:19px!important}
  #content .du184Board .du183Date span{font-size:9px!important}
  #content .du184Board .du183Date small{font-size:9px!important}
  #content .du184Board .dbV94ListWork{line-height:1.25!important}
  #content .du184Board .dbV94ListMeta{margin-top:3px!important}
  #content .du184Board .du183CardSide{min-width:126px!important}
  #content .du184Board .du183Amount{white-space:nowrap!important}

  #content .du184Board #dispatchBoardDetail{min-width:0!important}
  #content .du184Board .du184Detail{padding:12px!important}
  #content .du184Board .du184Detail>.dbPanelHead{gap:10px!important;align-items:flex-start!important}
  #content .du184Board .du184Detail>.dbPanelHead>div{min-width:0!important;flex:1 1 auto!important}
  #content .du184Board .du184Detail>.dbPanelHead>div h3{line-height:1.2!important;margin-top:6px!important}
  #content .du184Board .du184Detail>.dbPanelHead>b{white-space:nowrap!important;flex:0 0 auto!important;font-size:16px!important}
  #content .du184Board .dbDetailGrid{gap:7px!important}
  #content .du184Board .dbDetailGrid>div{padding:9px!important;min-width:0!important}
  #content .du184Board .dbDetailGrid span{font-size:9px!important}
  #content .du184Board .dbDetailGrid b{line-height:1.28!important;overflow-wrap:anywhere!important}
}
@media(min-width:1050px) and (max-width:1320px){
  #content .du184Board .dbLayout{grid-template-columns:minmax(215px,235px) minmax(0,1fr) minmax(285px,310px)!important;gap:8px!important}
  #content .du184Board .du183Kpi div span{font-size:9px!important}
}
@media(min-width:1500px){
  #content .du184Board .dbLayout{grid-template-columns:minmax(245px,275px) minmax(0,1fr) minmax(350px,390px)!important;gap:11px!important}
  #content .du184Board .du183CardSide{min-width:132px!important}
}
`;
document.head.appendChild(style);
})();
