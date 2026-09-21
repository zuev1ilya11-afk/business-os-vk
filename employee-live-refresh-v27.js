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
const idOf=u=>idsOf(u)[0]||'';
const matchesId=(u,id)=>idsOf(u).includes(String(id));
const normalizeOrders=list=>(list||[]).map(o=>({...o,status:['В работе','Выполнена','Отменена'].includes(String(o?.status))?String(o.status):String(o?.status||'В работе')}));
const dataSignature=data=>JSON.stringify({
  users:(data.users||[]).map(u=>[idOf(u),u.full_name,u.role,u.is_active??u.active,u.phone,u.city,u.district,u.specialization,u.work_start,u.work_end]),
  masters:(data.masters||[]).map(u=>[idOf(u),u.full_name,u.is_active??u.active,u.phone,u.city,u.district,u.specialization,u.work_start,u.work_end]),
  orders:(data.orders||[]).map(o=>[o.id,o.status,o.master_workflow_stage,o.master_vk_id,o.master_staff_id,o.master_name,o.scheduled_date,o.scheduled_time,o.amount,o.master_payout,o.reschedule_requested,o.reschedule_reason,o.updated_at]),
  schedule:(data.masterSchedule||[]).map(s=>[s.id,s.staff_id,s.master_id,s.master_vk_id,s.work_date||s.date,s.is_working,s.work_start,s.work_end])
});
const stateSignature=()=>dataSignature(state||{});

function employeeProfileModal(){return document.querySelector('#modalRoot .modal[data-bos-employee-profile-id]')}
function renderChanged(){
  const profile=employeeProfileModal();
  if(profile&&typeof window.openEmployeeProfile==='function'){
    const id=profile.dataset.bosEmployeeProfileId;
    const exists=(state.users||[]).some(u=>matchesId(u,id));
    if(exists){window.openEmployeeProfile(id);return;}
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
    if(!d?.ok)return false;
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
