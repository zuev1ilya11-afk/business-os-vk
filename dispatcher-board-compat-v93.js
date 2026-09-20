(()=>{
'use strict';
const isDispatcher=()=>String(window.state?.user?.role||'')==='dispatcher'||(typeof window.isDispatcherPreview==='function'&&window.isDispatcherPreview());
const shouldRefresh=()=>isDispatcher()&&window.innerWidth>=1050&&String(window.state?.page||'')==='orders'&&typeof window.show==='function';
const renderIfNeeded=()=>{
  if(!shouldRefresh())return;
  const board=document.querySelector('.dbBoard');
  const list=document.querySelector('.dbListMode');
  if(board||list)return;
  window.show('orders');
};
requestAnimationFrame(renderIfNeeded);
setTimeout(renderIfNeeded,0);
window.addEventListener('pageshow',()=>requestAnimationFrame(renderIfNeeded));
})();
