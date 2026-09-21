(()=>{
'use strict';
if(window.BOS_EMPLOYEE_PROFILE_REFRESH_V94)return;
window.BOS_EMPLOYEE_PROFILE_REFRESH_V94=true;

let refreshPromise=null;

function normalizeOrders(rows){
  return (rows||[]).map(o=>({...o,status:['В работе','Выполнена','Отменена'].includes(String(o.status))?String(o.status):'В работе'}));
}

async function refreshStaffState(){
  if(refreshPromise)return refreshPromise;
  refreshPromise=(async()=>{
    const d=await api('bootstrap');
    if(!d?.ok)throw new Error(d?.error||'Не удалось обновить данные сотрудников');
    if(Array.isArray(d.orders))state.orders=normalizeOrders(d.orders);
    if(Array.isArray(d.users))state.users=d.users;
    if(Array.isArray(d.masters))state.masters=d.masters;
    if(Array.isArray(d.masterSchedule)){
      state.masterSchedule=d.masterSchedule;
      if(typeof masterSchedule!=='undefined')masterSchedule=d.masterSchedule;
    }
    if(Array.isArray(d.sources))state.sources=d.sources;
    if(d.settings&&typeof d.settings==='object')state.settings=d.settings;
    if(d.user&&typeof d.user==='object'&&!(typeof isMasterPreview==='function'&&isMasterPreview()))state.user=d.user;
    if(typeof refreshClaims==='function'){
      try{await refreshClaims()}catch(_){ }
    }
    window.dispatchEvent(new CustomEvent('bos:staff-data-refreshed'));
    return d;
  })().finally(()=>{refreshPromise=null});
  return refreshPromise;
}

window.BOS_REFRESH_STAFF_STATE=refreshStaffState;
const refreshQuietly=()=>refreshStaffState().catch(()=>null);

function markEmployeeModal(id){
  const modal=document.querySelector('#modalRoot .modal');
  if(modal){modal.dataset.bosEmployeeProfileId=String(id);modal.dataset.bosProfileKind='employee'}
}

const baseEmployeeProfile=window.openEmployeeProfile;
if(typeof baseEmployeeProfile==='function'){
  window.openEmployeeProfile=function(id){
    const out=baseEmployeeProfile.apply(this,arguments);
    markEmployeeModal(id);
    refreshQuietly().then(()=>{
      const current=document.querySelector('#modalRoot .modal');
      if(!current||current.dataset.bosProfileKind!=='employee'||current.dataset.bosEmployeeProfileId!==String(id))return;
      baseEmployeeProfile.call(this,id);
      markEmployeeModal(id);
    });
    return out;
  };
}

const baseOwnerProfile=window.openOwnerProfile;
if(typeof baseOwnerProfile==='function'){
  window.openOwnerProfile=function(){
    const out=baseOwnerProfile.apply(this,arguments);
    const modal=document.querySelector('#modalRoot .modal');
    if(modal)modal.dataset.bosProfileKind='owner';
    refreshQuietly().then(()=>{
      const current=document.querySelector('#modalRoot .modal');
      if(!current||current.dataset.bosProfileKind!=='owner')return;
      baseOwnerProfile.apply(this,arguments);
      const next=document.querySelector('#modalRoot .modal');
      if(next)next.dataset.bosProfileKind='owner';
    });
    return out;
  };
  const profileBtn=document.getElementById('profileBtn');
  if(profileBtn)profileBtn.onclick=window.openOwnerProfile;
}

function wrapFormOpener(name,selector){
  const base=window[name];
  if(typeof base!=='function')return;
  window[name]=function(){
    const out=base.apply(this,arguments);
    setTimeout(()=>{
      const form=document.querySelector(selector);
      if(!form||form.dataset.bosStaffRefreshWrapped==='1'||typeof form.onsubmit!=='function')return;
      form.dataset.bosStaffRefreshWrapped='1';
      const submit=form.onsubmit;
      form.onsubmit=async function(){
        const result=await submit.apply(this,arguments);
        await refreshQuietly();
        return result;
      };
    },0);
    return out;
  };
}

wrapFormOpener('openMasterProfileEdit','#masterProfileEditForm');
wrapFormOpener('openEmployeeForm','#empForm');
wrapFormOpener('openMasterReportForm','#masterReportForm');

function wrapAsyncAction(name){
  const base=window[name];
  if(typeof base!=='function')return;
  window[name]=async function(){
    const result=await base.apply(this,arguments);
    await refreshQuietly();
    return result;
  };
}

wrapAsyncAction('saveMasterCalendarMonth');
wrapAsyncAction('saveMasterWeek');
wrapAsyncAction('masterWorkflowSetStage');
})();
