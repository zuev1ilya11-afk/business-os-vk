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
  const orders=reportOrdersSource().filter(order=>String(order.status)==='Выполнена'&&reportDoneDate(order)>=bounds.start&&reportDoneDate(order)<=bounds.end);
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
    const id=String(claim.master_staff_id||claim.master_id||claim.master_vk_id||'');
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

window.ymd=function(date){
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
};

function isWorkingSchedule(row){
  return row?.is_working===true||row?.is_working===1||String(row?.is_working||'').toLowerCase()==='true';
}
function scheduleMasterId(row){
  return String(row?.staff_id||row?.master_staff_id||row?.master_id||row?.master_vk_id||row?.vk_user_id||'');
}
function orderMasterId(order){
  return String(order?.master_staff_id||order?.master_id||order?.master_vk_id||'');
}

window.weeklyLoad=function(){
  const start=weekStart(),days=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  return days.map((label,index)=>{
    const d=new Date(start);d.setDate(start.getDate()+index);
    const date=ymd(d);
    const schedules=(state.masterSchedule||[]).filter(row=>String(row.work_date||row.date||'').slice(0,10)===date&&isWorkingSchedule(row));
    const scheduledMasters=new Set(schedules.map(scheduleMasterId).filter(Boolean)).size;
    const orders=(state.orders||[]).filter(order=>String(order.scheduled_date||'').slice(0,10)===date&&order.status!=='Отменена');
    const workingMasters=new Set(orders.map(orderMasterId).filter(Boolean)).size;
    const total=(state.masters||[]).length;
    const available=Math.min(total,Math.max(scheduledMasters,workingMasters));
    const busy=Math.min(workingMasters,total);
    const off=Math.max(total-available,0);
    const pct=total?Math.round(busy/total*100):0;
    return{label,date,day:d.getDate(),busy,available,off,pct,total};
  });
};

function explicitPayout(order){
  const raw=order?.master_payout;
  if(raw===null||raw===undefined||raw==='')return null;
  const value=Number(raw);
  return Number.isFinite(value)?value:null;
}
const previousOpenOrder=window.openOrder;
if(typeof previousOpenOrder==='function')window.openOrder=function(id){
  const result=previousOpenOrder.apply(this,arguments);
  const order=(state.orders||[]).find(item=>String(item.id)===String(id));
  const value=explicitPayout(order),node=document.getElementById('payoutPreview');
  if(node&&order?.master_vk_id&&value!==null)node.textContent=money(value);
  return result;
};
const previousOpenOrderForm=window.openOrderForm;
if(typeof previousOpenOrderForm==='function')window.openOrderForm=function(id){
  const result=previousOpenOrderForm.apply(this,arguments);
  const order=id?(state.orders||[]).find(item=>String(item.id)===String(id)):null;
  const value=explicitPayout(order),node=document.getElementById('calcPay');
  if(node&&order?.master_vk_id&&value!==null)node.textContent=money(value);
  return result;
};

if(!document.querySelector('script[data-bos-master-cabinet-final]')){
  const script=document.createElement('script');
  script.src='master-cabinet-final-v81.js?v=20260914-v81';
  script.dataset.bosMasterCabinetFinal='1';
  document.head.appendChild(script);
}
})();
