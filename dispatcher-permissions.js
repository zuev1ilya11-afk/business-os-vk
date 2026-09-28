(()=>{
'use strict';
// UI capability only: API authorization remains authoritative.
const canUseDispatcherWorkspace=user=>['owner','manager','dispatcher'].includes(String(user?.role||''));
const isDispatcherWorkspaceActive=user=>canUseDispatcherWorkspace(user)&&!(typeof isMasterPreview==='function'&&isMasterPreview());
window.BOS_PERMISSIONS=Object.freeze({canUseDispatcherWorkspace,isDispatcherWorkspaceActive});
})();
