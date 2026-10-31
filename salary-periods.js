(function(root){
'use strict';
const ZONE='Europe/Moscow';
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
function day(value=new Date()){
  const date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))return '';
  const parts=Object.fromEntries(dayFormat.formatToParts(date).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function valid(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value))&&Number.isFinite(Date.parse(`${value}T12:00:00Z`))&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value}
function addDays(value,count){const d=new Date(`${value}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10)}
function bounds(kind,value=day()){
  if(!valid(value))throw new Error('Некорректная дата периода');
  const d=new Date(`${value}T12:00:00Z`);
  if(kind==='day')return {start:value,end:value};
  if(kind==='month')return {start:value.slice(0,8)+'01',end:new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0,12)).toISOString().slice(0,10)};
  const start=addDays(value,-((d.getUTCDay()+6)%7));
  return {start,end:addDays(start,6)};
}
function shift(kind,value,amount){
  const p=bounds(kind,value);
  if(kind!=='month')return addDays(p.start,amount*(kind==='day'?1:7));
  const d=new Date(`${p.start}T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+amount);return d.toISOString().slice(0,10);
}
// Reclamation visits retain their first financial event. Operational status and
// report dates stay on the original object; never mutate the live order here.
function financialOrder(order){
  const o=order||{},s=o.financial_snapshot;
  if(s&&typeof s==='object'&&!Array.isArray(s)&&String(s.id)===String(o.id)&&s.status==='Выполнена'){
    const result={...o};
    // Missing original values must never come from the later reclamation.
    for(const key of ['completed_at','report_reviewed_at','scheduled_date','created_at','received_date','master_agreed_at','master_staff_id','master_id','master_vk_id','master_external_id','master_name','source','external_source','external_id','lead_source','order_number','address','city','amount','original_amount','master_payout','extra_work_amount','extra_work_description','uncompleted_work_amount','uncompleted_work_description','uncompleted_work_items','work','work_items','manual_completion_history','master_paid_amount','master_payment_amount','master_payout_paid_amount','master_paid','master_payment_status'])delete result[key];
    const knownPay=s.master_payout!==null&&s.master_payout!==undefined&&s.master_payout!==''&&Number.isFinite(Number(s.master_payout));
    const knownDate=[s.completed_at,s.report_reviewed_at].some(v=>v&&day(v))||valid(String(s.scheduled_date||'').slice(0,10));
    Object.assign(result,s,{is_claim:false,financial_origin_claim:true,financial_unresolved:!knownPay||!knownDate});
    delete result.financial_snapshot;
    return result;
  }
  if(o.financial_snapshot_status==='other_master')return {...o,status:'Рекламация',report_review_status:null,completed_at:null,report_reviewed_at:null,scheduled_date:null,master_payout:0,extra_work_amount:0};
  if(o.is_claim===true||o.status==='Рекламация')return {...o,status:'Выполнена',completed_at:null,report_reviewed_at:null,scheduled_date:null,amount:null,master_payout:null,extra_work_amount:0,financial_unresolved:true};
  return o;
}
function masterFinancialOrders(orders,user,assigned=orders){
  const ids=new Set([user?.id,user?.staff_id,user?.master_id,user?.vk_user_id,user?.external_id].filter(v=>v!==null&&v!==undefined&&v!=='').map(String));
  const belongs=o=>[o?.master_staff_id,o?.master_id,o?.master_vk_id].some(id=>id!==null&&id!==undefined&&ids.has(String(id)));
  const result=new Map();
  for(const raw of assigned||[]){const o=financialOrder(raw);if(!o.financial_origin_claim||belongs(o))result.set(String(o.id),o)}
  const snapshots=[...(Array.isArray(user?.financial_history)?user.financial_history:[]),...(orders||[]).map(o=>o.financial_snapshot).filter(Boolean)];
  for(const snapshot of snapshots)if(snapshot.status==='Выполнена'&&belongs(snapshot))result.set(String(snapshot.id),financialOrder({id:snapshot.id,financial_snapshot:snapshot}));
  return [...result.values()];
}
function completedDay(order){
  order=financialOrder(order);
  if(order.financial_unresolved)return '';
  for(const value of [order?.completed_at,order?.report_reviewed_at]){if(value){const result=day(value);if(result)return result}}
  const fallback=String(order?.scheduled_date||'').slice(0,10);return valid(fallback)?fallback:'';
}
function contains(period,value){return !!value&&value>=period.start&&value<=period.end}
function nextMidnight(now=Date.now()){return Date.parse(`${addDays(day(now),1)}T00:00:00+03:00`)}
const api={ZONE,day,valid,addDays,bounds,shift,completedDay,contains,nextMidnight,financialOrder,masterFinancialOrders};
if(typeof module==='object'&&module.exports)module.exports=api;else root.BOS_SALARY_PERIODS=api;
})(globalThis);
