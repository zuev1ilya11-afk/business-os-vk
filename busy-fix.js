// Frontend hotfix: every successful flow closes its modal. Reset the shared busy flag here
// so the next edit/save/add action is never silently blocked.
function closeModal(){
  state.busy=false;
  const root=document.querySelector('#modalRoot');
  if(root)root.innerHTML='';
}
