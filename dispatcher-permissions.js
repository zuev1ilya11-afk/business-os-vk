(()=>{
'use strict';
// UI capability only: API authorization remains authoritative.
const canUseDispatcherWorkspace=user=>['owner','manager','dispatcher'].includes(String(user?.role||''));
const isDispatcherWorkspaceActive=user=>canUseDispatcherWorkspace(user)&&!(typeof isMasterPreview==='function'&&isMasterPreview());
// Read the existing server capability; never grant finance access by an owner-only shortcut.
const canViewFinance=(user,permissions)=>!!user&&user.role!=='master'&&permissions?.can_view_finance===true;
const isFinanceWorkspaceActive=(user,permissions)=>canViewFinance(user,permissions)&&!(typeof isMasterPreview==='function'&&isMasterPreview())&&!(typeof isDispatcherPreview==='function'&&isDispatcherPreview());
window.BOS_PERMISSIONS=Object.freeze({canUseDispatcherWorkspace,isDispatcherWorkspaceActive,canViewFinance,isFinanceWorkspaceActive});
})();
