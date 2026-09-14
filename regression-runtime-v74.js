(()=>{
'use strict';

const REQUEST_TIMEOUT_MS=12000;
const timeoutTargets=['/api/proxy/master-memo-api','/api/proxy/claims-api'];
const nativeFetch=window.fetch.bind(window);
window.fetch=async function(input,init={}){
  const url=typeof input==='string'?input:String(input?.url||'');
  if(!timeoutTargets.some(path=>url.includes(path))||init.signal)return nativeFetch(input,init);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    return await nativeFetch(input,{...init,signal:controller.signal});
  }catch(error){
    if(controller.signal.aborted)throw new Error('Сервер не ответил');
    throw error;
  }finally{
    clearTimeout(timer);
  }
};

window.reportMasterId=function(order){
  return String(order?.master_staff_id||order?.master_id||order?.master_vk_id||'');
};

function reportPayout(order){
  const raw=order?.master_payout;
  if(raw!==null&&raw!==undefined&&raw!==''){
    const value=Number(raw);
    if(Number.isFinite(value))return value;
  }
  return Number(payout(order?.amount)||0);
}

window.dispatcherReportData=function(kind,anchor){
  const bounds=reportPeriodBounds(kind,anchor);
  const orders=reportOrdersSource().filter(order=>String(order.status)==='Выполнена'&&reportDoneDate(order)>=bounds.start&&reportDoneDate(order)<=bounds.end&&!order.is_claim);
  const claims=(state.claims||[]).filter(claim=>claim.status==='closed'&&String(claim.closed_at||claim.scheduled_date||'').slice(0,10)>=bounds.start&&String(claim.closed_at||claim.scheduled_date||'').slice(0,10)<=bounds.end);
  const map={};
  orders.forEach(order=>{
    const id=reportMasterId(order);
    if(!id)return;
    const row=map[id]||(map[id]={id,name:reportMasterNameById(id),count:0,revenue:0,pay:0,revisit:0});
    row.count++;
    row.revenue+=Number(order.amount||0);
    row.pay+=reportPayout(order);
  });
  claims.forEach(claim=>{
    const id=String(claim.master_id||'');
    if(!id)return;
    const row=map[id]||(map[id]={id,name:reportMasterNameById(id),count:0,revenue:0,pay:0,revisit:0});
    row.revisit+=Number(claim.revisit_payment||0);
  });
  return{
    bounds,
    rows:Object.values(map).sort((a,b)=>String(a.name).localeCompare(String(b.name),'ru')),
    ordersCount:orders.length,
    totalRevenue:orders.reduce((sum,order)=>sum+Number(order.amount||0),0),
    totalPay:orders.reduce((sum,order)=>sum+reportPayout(order),0),
    totalRevisit:claims.reduce((sum,claim)=>sum+Number(claim.revisit_payment||0),0)
  };
};
})();
