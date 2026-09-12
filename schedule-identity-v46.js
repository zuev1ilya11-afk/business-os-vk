(()=>{
'use strict';
function ids(x){return [x?.id,x?.staff_id,x?.master_staff_id,x?.master_id,x?.vk_user_id,x?.user_id,x?.external_id].filter(Boolean).map(String)}
function intersects(a,b){const s=new Set(ids(a));return ids(b).some(x=>s.has(x))}
function normalizeSchedule(){
  const masters=state.masters||[];
  state.masterSchedule=(state.masterSchedule||[]).map(r=>{
    if(r.master_vk_id||r.master_id||r.external_id)return r;
    const m=masters.find(x=>ids(x).includes(String(r.staff_id||r.master_staff_id||'')));
    if(!m)return r;
    return {...r,master_vk_id:String(m.vk_user_id||m.external_id||m.id||''),master_id:String(m.id||r.staff_id||''),external_id:String(m.external_id||m.vk_user_id||'')};
  });
  try{if(typeof masterSchedule!=='undefined')masterSchedule=state.masterSchedule}catch(_){ }
}
function liveMaster(){const u=typeof liveMasterUser==='function'?liveMasterUser():(state.user||{});return (state.masters||[]).find(m=>intersects(m,u))||u}
window.BOS_NORMALIZE_MASTER_SCHEDULE=normalizeSchedule;
const render=window.renderMonthCalendar;if(typeof render==='function')window.renderMonthCalendar=function(){normalizeSchedule();return render.apply(this,arguments)};
const dispatch=pages.dispatch;pages.dispatch=function(){normalizeSchedule();return dispatch.apply(this,arguments)};
const home=pages.home;pages.home=function(){normalizeSchedule();return home.apply(this,arguments)};
const oldReload=window.reloadData||reloadData;
const wrappedReload=async function(){const out=await oldReload.apply(this,arguments);normalizeSchedule();return out};
try{reloadData=wrappedReload}catch(_){ }
window.reloadData=wrappedReload;
normalizeSchedule();
})();
(()=>{
  if(window.BOS_CREATE_ORDER_IDEMPOTENCY_V56||typeof window.api!=='function')return;
  const nextApi=window.api;
  window.BOS_CREATE_ORDER_IDEMPOTENCY_V56=true;
  window.api=function(action,payload={}){
    if(action==='createOrder'&&!payload.request_id){
      const form=document.querySelector('#orderForm');
      let requestId=form?.dataset?.requestId||'';
      if(!requestId){
        requestId=globalThis.crypto?.randomUUID?.()||('req_'+Date.now()+'_'+Math.random().toString(36).slice(2));
        if(form?.dataset)form.dataset.requestId=requestId;
      }
      payload={...payload,request_id:requestId};
    }
    return nextApi(action,payload);
  };
})();
