(()=>{
'use strict';
if(window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190_FIX)return;
const MIN=1050;

function fitBoard(){
  if(window.innerWidth<MIN)return;
  const board=document.querySelector('#content .dbBoard.dh190Board');
  if(!board)return;
  sessionStorage.setItem('bosDispatchV23Plan','0');
  board.querySelectorAll('.dbV23Plan').forEach(node=>node.remove());
  const top=Math.max(0,board.getBoundingClientRect().top);
  let bottom=8;
  document.querySelectorAll('nav').forEach(nav=>{
    const r=nav.getBoundingClientRect(),pos=getComputedStyle(nav).position;
    if((pos==='fixed'||pos==='sticky')&&r.height>0&&r.bottom>=window.innerHeight-2&&r.top>top+40&&r.width>window.innerWidth*.45){
      bottom=Math.max(bottom,window.innerHeight-r.top+8);
    }
  });
  board.style.setProperty('--dh190-vh',`${Math.max(440,window.innerHeight-top-bottom)}px`);
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
html:has(#content .dh190Board),body:has(#content .dh190Board){height:100dvh!important;min-height:0!important;max-height:100dvh!important;overflow:hidden!important}
body #app:has(#content .dh190Board){height:auto!important;min-height:0!important;max-height:100dvh!important;padding-bottom:0!important;overflow:hidden!important}
#app>#content:has(.dh190Board){min-height:0!important;padding-bottom:0!important;overflow:hidden!important}
#content .dh190Board .dbLayout{min-width:0!important;grid-template-rows:minmax(0,1fr)!important}
#content .dh190Board #dispatchBoardDetail{grid-column:3!important;grid-row:1!important}
#content .dh190Head{flex-wrap:wrap!important;align-content:start!important}
#content .dh190Head>div:first-child{min-width:0!important;flex:1 1 220px!important}
#content .dh190Title{flex-wrap:wrap!important}
#content .dh190HeadRight{flex-wrap:wrap!important}
#content .dh190Board .dbAttention,#content .dh190Board .dbSchedule,#content .dh190Board #dispatchBoardDetail{min-width:0!important;margin:0!important}
#content .dh190Board .dbAttention{z-index:2!important}
#content .dh190Board .dbSchedule{position:relative!important;z-index:1!important;isolation:isolate!important;min-width:0!important;max-width:100%!important}
#content .dh190Board #dispatchBoardDetail{position:sticky!important;top:0!important;z-index:2!important;width:100%!important;max-width:300px!important;justify-self:end!important}
#content .dh190GridWrap{max-width:100%!important;contain:layout paint!important}
#content .dh190Grid .du187Master,#content .dh190Grid .du187Slot{height:60px!important;min-height:60px!important}
#content .dh190Board .dbAttention .dbFilters button.primary,#content .dh190Board .dbAttention .dbFilters button.secondary{min-height:44px!important;height:44px!important}
}
@media(min-width:1500px){#content .dh190Board #dispatchBoardDetail{min-width:0!important;max-width:300px!important}}
`;
document.head.appendChild(style);
window.BOS_DISPATCHER_HORIZONTAL_SCHEDULE_V190_FIX={version:'190d',fit:fitBoard};
})();