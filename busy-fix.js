// Frontend hotfix: every successful flow closes its modal. Reset the shared busy flag here
// so the next edit/save/add action is never silently blocked.
function closeModal(){
  state.busy=false;
  const root=document.querySelector('#modalRoot');
  if(root)root.innerHTML='';
}

// Load management-only order details after all legacy/runtime patches have registered.
// This keeps the master cabinet untouched and makes this override deterministic.
window.addEventListener('DOMContentLoaded',()=>{
  if(document.querySelector('script[data-bos-management-order-compact]'))return;
  const s=document.createElement('script');
  s.src='management-order-compact-v82.js?v=20260915-v82';
  s.dataset.bosManagementOrderCompact='1';
  document.body.appendChild(s);
},{once:true});
