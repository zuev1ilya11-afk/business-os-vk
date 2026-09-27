(()=>{
'use strict';
if(window.BOS_DISPATCHER_SCHEDULE_V187_BOOTSTRAP)return;
const MIN_DESKTOP=1050;
let queued=false,ensuring=false;
function st(){try{return typeof state!=='undefined'?state:null}catch(_){return null}}
function active(){const s=st();return window.innerWidth>=MIN_DESKTOP&&((typeof isDispatcherPreview==='function'&&!!isDispatcherPreview())||String(s?.user?.role||'')==='dispatcher')&&String(s?.page||'')==='orders'}
function ensure(){
  queued=false;
  if(ensuring||!active())return;
  const board=document.querySelector('#content .dbBoard');
  if(!board||board.querySelector('.dbV24Control')||board.querySelector('.dbV24Tab.primary'))return;
  const host=board.querySelector('.dbSchedule');
  if(!host)return;
  let plan=host.querySelector(':scope>.dbV23Plan');
  if(!plan){
    ensuring=true;
    try{
      host.innerHTML='<div class="dbV23Plan du187Plan" data-du187-host="1"></div>';
      plan=host.querySelector(':scope>.dbV23Plan');
    }finally{ensuring=false}
  }else{
    plan.classList.add('du187Plan');
    plan.dataset.du187Host='1';
  }
  window.BOS_DISPATCHER_SCHEDULE_V187?.refresh?.();
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(ensure)}
function start(){const content=document.getElementById('content');if(content)new MutationObserver(schedule).observe(content,{subtree:true,childList:true});schedule()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.addEventListener('resize',schedule);
window.BOS_DISPATCHER_SCHEDULE_V187_BOOTSTRAP={version:'187a',refresh:schedule};
})();