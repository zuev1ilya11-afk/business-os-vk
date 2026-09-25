(()=>{
'use strict';
if(window.BOS_DISPATCHER_DESKTOP_MOBILE_V158)return;
window.BOS_DISPATCHER_DESKTOP_MOBILE_V158={version:'158'};

const style=document.createElement('style');
style.textContent=`
@media(min-width:1050px){
  #content .dbBoard .dbLayout{
    grid-template-columns:210px minmax(0,1fr) 300px;
    gap:10px;
    align-items:start;
  }
  #content .dbBoard .dbAttention{
    position:sticky;
    top:12px;
    align-self:start;
    max-height:calc(100vh - 24px);
    overflow:auto;
    scrollbar-width:thin;
  }
  #content .dbBoard #dispatchBoardDetail{
    position:sticky;
    top:12px;
    align-self:start;
    max-height:calc(100vh - 24px);
    overflow:auto;
    scrollbar-width:thin;
  }
  #content .dbBoard .dbSchedule{min-width:0}
  #content .dbBoard .dbToolbar,
  #content .dbBoard .dbFilters{gap:8px}
  #content .dbBoard .dbOrderCard{padding:8px}
  #content .dbBoard .dbDetail{margin:0}
  #content .dbBoard .dbAttentionMetrics{gap:5px}
}
@media(min-width:1050px) and (max-width:1280px){
  #content .dbBoard .dbLayout{grid-template-columns:190px minmax(0,1fr) 270px;gap:8px}
}
@media(max-width:760px){
  #content .dmOperationalFlags{order:8}
  #content .dmOperationalFlag.dmFlagUrgent{font-weight:900}
  #content .dmOperationalFlag.dmFlagToday{font-weight:850}
}
`;
document.head.appendChild(style);
})();