(()=>{
'use strict';
if(window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190_FIX)return;
const MIN=1050;

function fitBoard(){
  if(window.innerWidth<MIN)return;
  const board=document.querySelector('#content .dbBoard');
  if(!board)return;
  // Keep keyboard traversal aligned with the supplementary queue's visual position.
  const queue=board.parentElement.querySelector(':scope>.duq122');
  if(queue&&board.nextElementSibling!==queue)board.after(queue);
  if(!board.classList.contains('dh190Board'))return;
  sessionStorage.setItem('bosDispatchV23Plan','0');
  board.querySelectorAll('.dbV23Plan').forEach(node=>node.remove());
  // Keep the public compatibility hook without forcing a viewport-sized board.
  board.style.removeProperty('--dh190-vh');
}

const scheduleFit=()=>requestAnimationFrame(fitBoard);
window.addEventListener('resize',scheduleFit);
document.addEventListener('click',e=>{if(e.target.closest?.('nav [data-page]'))setTimeout(scheduleFit,0)},true);
const content=document.getElementById('content');
if(content)new MutationObserver(scheduleFit).observe(content,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
scheduleFit();

const style=document.createElement('style');
style.textContent=`
@media(min-width:${MIN}px){
/* All board tabs use document scrolling, including a direct entry into List/Control. */
body #app:has(#content .dbBoard){height:auto!important;min-height:100dvh!important;max-height:none!important;padding-bottom:32px!important;overflow:visible!important}
#app>#content:has(.dbBoard){min-height:0!important;overflow:visible!important;display:flex!important;flex-direction:column!important;gap:12px}
#content .dbBoard .dbLayout{min-width:0!important;min-height:0!important;grid-template-rows:auto!important;align-items:start!important;overflow:visible!important}
#content .dbBoard .dbAttention,#content .dbBoard .dbSchedule,#content .dbBoard #dispatchBoardDetail,#content .dbBoard #dispatchBoardDetail>.dbDetail{height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;position:static!important}
#content .dbBoard .dbV94InlineList,#content .dbBoard .dbV94ListItems,#content .dbBoard .dbV24Control,#content .dbBoard .dbV24List{height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;grid-template-rows:auto!important}
#content .dbBoard .dbToolbar,#content .dbBoard .dbViewTabs,#content .dbBoard .dbV21QuickDates,#content .dbBoard .dbDateNav,#content .dbBoard .da123Controls{flex-wrap:wrap!important;min-width:0!important}
#content .dbBoard .dbDetail button,#content .dbBoard .dbDetail a{white-space:normal;word-break:normal;overflow-wrap:normal;min-height:44px!important}
#content .dbBoard .dbDetail .dbDetailActions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
#content .dbBoard .dbV21QuickMove>div{grid-template-columns:minmax(0,1fr)!important}
#content .dbBoard .dbSmartCandidate{display:grid!important;grid-template-columns:minmax(0,1fr);align-items:start}
#content .dbBoard .dbSmartCandidate>div:last-child{width:100%;justify-content:space-between}
#content .dbBoard .dbQuickAssign{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
#content .dbBoard .dbQuickAssign label,#content .dbBoard .dbQuickAssign select{min-width:0;width:100%}
#content .dbBoard .dbV21Tools{margin:0 0 16px!important}
#content .dbBoard .du183Kpi{min-height:64px!important}
#content .dbBoard .du183Kpi div span{font-size:11px!important;line-height:1.4}
#content .dbBoard .dbAttention .dbOrderCard{padding:12px 10px 30px!important;gap:7px!important}
#content .dbBoard .dbAttention .dbOrderCard :is(b,strong,small),#content .dbBoard .dbAttentionMetrics span{font-size:11px!important}
#content .dbBoard .dbAttention .dbOrderCard>span:not(.dbCardFlags){font-size:12px!important;line-height:1.4}
#content .dbBoard .dbV94ListTop{flex-wrap:wrap!important;gap:6px!important}
#content .dbBoard .dbV94ListTop b{white-space:normal!important;font-size:14px!important;line-height:1.4!important}
#content .dbBoard .dbV94ListWork{font-size:13px!important;line-height:1.5!important;-webkit-line-clamp:3}
#content .dbBoard .dbV94ListMeta{white-space:normal!important;font-size:12px!important;line-height:1.5}
#content .dbBoard .du183Master{font-size:12px!important;white-space:normal!important}
#content .dbBoard .dbDetailGrid{grid-template-columns:minmax(0,1fr)!important}
#content .dbBoard .dbAttentionMetrics{grid-template-columns:minmax(0,1fr)!important}
#content .dbBoard .dbAttentionMetrics button{display:flex;align-items:center;justify-content:space-between;min-height:44px!important;gap:8px}
#content .dbBoard .dbDetailGrid b{font-size:13px!important;line-height:1.5!important}
#content .dbBoard .dbDetailGrid span{font-size:11px!important}
#content .dbBoard .dbV24Card{padding:16px;gap:12px;scroll-margin-block:16px}
#content .dbBoard .dbV24Card[aria-current=true]{border-color:var(--bos-ui-link,#9ec9ff);box-shadow:inset 3px 0 var(--bos-ui-link,#9ec9ff)}
#content .dbBoard .dbV24CardTop{flex-wrap:wrap}
#content .dbBoard .dbV24CardTop>div:first-child{flex:1 1 220px;gap:8px}
#content .dbBoard .dbV24CardTop span,#content .dbBoard .dbV24Meta span{font-size:13px;line-height:1.5}
#content .dbBoard .dbV24CardSide{display:grid;gap:6px;align-content:start}
#content .dbBoard .dbV24CardSide strong{font-size:15px;white-space:nowrap}
#content .dbBoard .dbV24Status{font-size:12px;padding:4px 7px;color:var(--bos-ui-text,#e8eef6)}
#content .dbBoard .dbV24Actions :is(button,a){font-size:13px;min-height:44px}
#content .dh190Board #dispatchBoardDetail{grid-column:3!important;grid-row:1!important}
#content .dh190Head{flex-wrap:wrap!important;align-content:start!important}
#content .dh190Head>div:first-child{min-width:0!important;flex:1 1 300px!important}
#content .dh190Title{flex-wrap:wrap!important}
#content .dh190HeadRight{flex-wrap:wrap!important}
#content .dh190Board .dbAttention,#content .dh190Board .dbSchedule,#content .dh190Board #dispatchBoardDetail{min-width:0!important;margin:0!important}
#content .dh190Board .dbAttention{z-index:2!important}
#content .dh190Board .dbSchedule{position:relative!important;z-index:1!important;isolation:isolate!important;min-width:0!important;max-width:100%!important}
#content .dh190Board #dispatchBoardDetail{position:static!important;z-index:2!important;width:100%!important;max-width:300px!important;justify-self:end!important}
#content .dh190GridWrap{max-width:100%!important;contain:layout!important}
#content .dh190Grid .du187Master b{line-height:1.35;white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
#content .dh190Grid .du187Master,#content .dh190Grid .du187Slot{height:80px!important;min-height:80px!important}
#content .dh190Board .dbAttention .dbFilters button.primary,#content .dh190Board .dbAttention .dbFilters button.secondary{min-height:44px!important;height:44px!important}
}
@media(min-width:1500px){#content .dh190Board #dispatchBoardDetail{min-width:0!important;max-width:300px!important}}
@media(min-width:${MIN}px) and (max-width:1599px){
  #content .dbBoard .dbV94ListCard{grid-template-columns:52px minmax(0,1fr)!important;column-gap:10px!important}
  #content .dbBoard .du183CardSide{grid-column:2!important;grid-row:5!important;display:flex!important;flex-wrap:wrap;justify-content:space-between;min-width:0!important;gap:8px!important;margin-top:5px}
  #content .dbBoard .du183Master{flex:1 1 100px;text-align:left!important}
  #content .dbBoard .du183Date{width:auto!important;min-width:0!important}
}
`;
document.head.appendChild(style);
window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190_FIX={version:'190d',fit:fitBoard};
})();
