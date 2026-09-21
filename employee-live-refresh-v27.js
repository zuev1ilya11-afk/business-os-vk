(()=>{
'use strict';
if(window.BOS_EMPLOYEE_LIVE_REFRESH_V27)return;
window.BOS_EMPLOYEE_LIVE_REFRESH_V27=true;

const POLL_MS=20000;
let inFlight=false;
let lastSync=0;

const authReady=()=>{
  const gate=document.getElementById('authGate');
  return !!state?.user&&document.body?.classList.contains('bos-auth-ok')&&(!gate||gate.style.display==='none'||getComputedStyle(gate).display==='none');
};
const idsOf=u=>[u?.vk_user_id,u?.external_id,u?.staff_id,u?.user_id,u?.id].filter(v=>v!=null&&v!=='').map(String);
const matchesId=(u,id)=>idsOf(u).includes(String(id));
const normalizeOrders=list=>(list||[]).map(o=>({...o,status:['В работе','Выполнена','Отменена'].includes(String(o?.status))?String(o.status):String(o?.status||'В работе')}));
const dataSignature=data=>JSON.stringify({
  user:data.user,settings:data.settings,users:data.users||[],masters:data.masters||[],
  orders:data.orders||[],schedule:data.masterSchedule||[]
});
const stateSignature=()=>dataSignature(state||{});

function employeeProfileModal(){return document.querySelector('#modalRoot .modal[data-bos-employee-profile-id]')}
function renderChanged(){
  const profile=employeeProfileModal();
  if(profile&&typeof window.openEmployeeProfile==='function'){
    const id=profile.dataset.bosEmployeeProfileId;
    const exists=(state.users||[]).some(u=>matchesId(u,id));
    if(exists){if(typeof show==='function'&&state.page)show(state.page);window.openEmployeeProfile(id);return;}
    if(typeof closeModal==='function')closeModal();
    if(typeof show==='function')show('team');
    return;
  }
  if(!document.querySelector('#modalRoot .modal')&&typeof show==='function'&&state?.page)show(state.page);
}

async function syncEmployeeData(reason='manual'){
  const modal=document.querySelector('#modalRoot .modal');
  if(inFlight||document.hidden||state?.busy||!authReady()||typeof api!=='function'||(modal&&!employeeProfileModal()))return false;
  inFlight=true;
  try{
    const before=stateSignature();
    const d=await api('bootstrap');
    // A background response must not roll back a save or interrupt a newly opened form.
    if(!d?.ok||state.busy||before!==stateSignature()||!authReady()||
      (document.querySelector('#modalRoot .modal')&&!employeeProfileModal()))return false;
    const normalizedOrders=normalizeOrders(d.orders||[]);
    Object.assign(state,{
      user:d.user||state.user,
      orders:normalizedOrders,
      masters:d.masters||[],
      users:d.users||[],
      sources:d.sources||state.sources||[],
      settings:d.settings||state.settings||{},
      masterSchedule:d.masterSchedule||[]
    });
    window.BOS_NORMALIZE_MASTER_SCHEDULE?.();
    if(typeof isMasterPreview==='function'&&isMasterPreview()&&typeof previewUser!=='undefined'&&previewUser){
      const current=(state.users||[]).find(u=>idsOf(previewUser).some(id=>matchesId(u,id)));
      if(current)previewUser={...current};
      else if(typeof exitMasterPreview==='function')exitMasterPreview();
    }
    const changed=before!==stateSignature();
    lastSync=Date.now();
    if(changed)renderChanged();
    window.bosRefreshNotifications?.();
    window.dispatchEvent(new CustomEvent('bos:employee-data-refreshed',{detail:{changed,reason,at:lastSync}}));
    return changed;
  }catch(_){
    return false;
  }finally{
    inFlight=false;
  }
}

window.BOS_REFRESH_EMPLOYEE_DATA=syncEmployeeData;

const baseOpenEmployeeProfile=window.openEmployeeProfile;
if(typeof baseOpenEmployeeProfile==='function'){
  window.openEmployeeProfile=function(id){
    const out=baseOpenEmployeeProfile.apply(this,arguments);
    const modal=document.querySelector('#modalRoot .modal');
    if(modal)modal.dataset.bosEmployeeProfileId=String(id);
    return out;
  };
}

window.addEventListener('focus',()=>syncEmployeeData('focus'));
window.addEventListener('pageshow',()=>syncEmployeeData('pageshow'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncEmployeeData('visible')});
setInterval(()=>syncEmployeeData('poll'),POLL_MS);
})();
