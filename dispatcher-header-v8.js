(()=>{
'use strict';
function dispatcherModeNow(){return (typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state.user?.role||'')==='dispatcher'}
function dispatcherUserNow(){return (typeof isDispatcherPreview==='function'&&isDispatcherPreview()&&dispatcherPreviewUser)||state.user||{}}
const previousHome=pages.home;
pages.home=function(){
  const html=previousHome();
  if(!dispatcherModeNow())return html;
  return String(html).replace(/<section class="hero">[\s\S]*?<\/section>/,'');
};
const previousShow=window.show;
window.show=function(name){
  previousShow(name);
  if(!dispatcherModeNow())return;
  const u=dispatcherUserNow();
  const badge=document.querySelector('#roleBadge');
  if(badge)badge.textContent=u.full_name||'Диспетчер';
};
try{
  if(dispatcherModeNow()){
    const badge=document.querySelector('#roleBadge');
    const u=dispatcherUserNow();
    if(badge)badge.textContent=u.full_name||'Диспетчер';
  }
}catch(e){}
})();