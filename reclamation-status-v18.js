(()=>{
'use strict';
const RECLAMATION='Рекламация';
try{if(Array.isArray(STATUSES)&&!STATUSES.includes(RECLAMATION))STATUSES.push(RECLAMATION)}catch(_){}

function normalizeStatus(s){const v=String(s||'');return ['В работе','Выполнена','Отменена',RECLAMATION].includes(v)?v:'В работе'}

const oldReload=window.reloadData;
window.reloadData=async function(keepPage=true){
  state.busy=false;
  const d=await api('bootstrap');
  if(!d.ok)throw new Error(d.error);
  const normalizedOrders=(d.orders||[]).map(o=>({...o,status:normalizeStatus(o.status)}));
  Object.assign(state,{user:d.user||state.user,orders:normalizedOrders,masters:d.masters||[],users:d.users||[],sources:d.sources||[],settings:d.settings||{},masterSchedule:d.masterSchedule||[],claims:d.claims||state.claims||[]});
  show(keepPage?state.page:'home');
  return d;
};

setTimeout(async()=>{
  try{
    const d=await api('bootstrap');
    if(!d?.ok)return;
    state.orders=(d.orders||[]).map(o=>({...o,status:normalizeStatus(o.status)}));
    if(state.page&&typeof show==='function')show(state.page);
  }catch(_){}
},700);
})();