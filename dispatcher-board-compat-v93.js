(()=>{
'use strict';
const isDispatcher=()=>window.BOS_PERMISSIONS.isDispatcherWorkspaceActive(state?.user);
const shouldRefresh=()=>isDispatcher()&&window.innerWidth>=1050&&String(state?.page||'')==='orders'&&typeof show==='function';
const renderIfNeeded=()=>{
  if(!shouldRefresh())return;
  const board=document.querySelector('.dbBoard');
  const list=document.querySelector('.dbListMode');
  if(board||list)return;
  show('orders');
};
requestAnimationFrame(renderIfNeeded);
setTimeout(renderIfNeeded,0);
window.addEventListener('pageshow',()=>requestAnimationFrame(renderIfNeeded));
})();
