(()=>{
'use strict';
if(window.BOS_CLAIMS_ROLE_V117)return;window.BOS_CLAIMS_ROLE_V117=true;
const allowed=()=>['owner','manager','dispatcher'].includes(String(state?.user?.role||''))||(typeof isDispatcherPreview==='function'&&isDispatcherPreview());
const removeForbidden=()=>{if(allowed())return;document.querySelectorAll('.lifecycleClaimAction,.lifecycleClaimModal').forEach(el=>el.remove());document.querySelectorAll('#modalRoot button').forEach(btn=>{if((btn.textContent||'').trim()==='Открыть рекламацию')btn.remove()})};
const base=window.openReopenClaimForm;
if(typeof base==='function')window.openReopenClaimForm=function(){if(!allowed())return;return base.apply(this,arguments)};
let queued=false;const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;removeForbidden()})};
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
setTimeout(schedule,0);
})();
