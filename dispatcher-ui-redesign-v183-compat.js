(()=>{
'use strict';
if(window.BOS_DISPATCHER_UI_REDESIGN_V183_COMPAT)return;
window.BOS_DISPATCHER_UI_REDESIGN_V183_COMPAT=true;
let queued=false;
function apply(){
  queued=false;
  const board=document.querySelector('#content .du183Board');
  if(!board||window.innerWidth<1050)return;
  const toolbar=board.querySelector('.dbToolbar');
  const toggle=board.querySelector('#dbV21FreeToggle');
  if(!toolbar||!toggle||toggle.parentElement===toolbar)return;
  const add=[...toolbar.children].find(node=>node.matches?.('button.primary')&&String(node.textContent||'').includes('Новая'));
  toolbar.insertBefore(toggle,add||null);
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(apply)}
const start=()=>{
  const content=document.getElementById('content');
  if(content)new MutationObserver(schedule).observe(content,{childList:true,subtree:true});
  schedule();
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.addEventListener('resize',schedule);
const style=document.createElement('style');
style.textContent=`@media(min-width:1050px){#content .du183Board .dbToolbar>#dbV21FreeToggle{display:inline-flex!important;align-items:center;justify-content:center;min-height:44px;padding:8px 12px;margin-left:2px;white-space:nowrap}#content .du183Board .dbToolbar>.dbV21QuickDates>.secondary,#content .du183Board .dbToolbar>.dbV21QuickDates .dbDateNav>button{min-height:44px!important}#content .du183Board .dbToolbar>.dbV21QuickDates .dbDateNav>input{height:44px!important}#content .du183Board .dbV94ListCard[hidden]{display:none!important}}`;
document.head.appendChild(style);
})();