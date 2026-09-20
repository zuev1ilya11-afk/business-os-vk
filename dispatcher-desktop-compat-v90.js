(()=>{
'use strict';
function normalizeDispatcherDesktopLabels(){
  document.querySelectorAll('.ddQuickEdit button.primary').forEach(button=>{
    if(String(button.textContent||'').trim()==='Сохранить')button.textContent='Сохранить изменения';
  });
}
normalizeDispatcherDesktopLabels();
const root=document.getElementById('content')||document.body;
if(root)new MutationObserver(normalizeDispatcherDesktopLabels).observe(root,{childList:true,subtree:true});
})();
