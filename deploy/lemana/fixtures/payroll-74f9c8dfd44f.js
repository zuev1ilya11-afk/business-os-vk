// Shared by the classic frontend and Edge handlers. Extras are deliberately separate.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BOS_ORDER_PAYROLL=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const version='source-60-40-v1';
  const text=v=>String(v??'').trim().toLowerCase();
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const round=v=>Math.round(Number(v||0)*100)/100;
  function isHands(o){
    return text(o?.external_source)==='hands'||text(o?.external_id).startsWith('hands:')||['hands','руки'].includes(text(o?.source));
  }
  // Untagged legacy rows keep their existing contract; newly created orders always have a source.
  function isDirect(o){return !isHands(o)&&!!(text(o?.external_source)||text(o?.source));}
  function closed(o){return o?.status==='Выполнена'||o?.report_review_status==='approved';}
  function snapshot(o){return closed(o)||!!o?.report_uploaded_at||['pending','rejected'].includes(o?.report_review_status);}
  function calculate(amount,o,hasMaster=true){
    const base=round(amount);
    if(isDirect(o))return {master_payout:hasMaster?round(base*.60):0,manager_payout:0,dispatcher_payout:0};
    return {master_payout:hasMaster?round(base*.85*.65):0,manager_payout:round(base*.85*.94*.20),dispatcher_payout:round(base*.85*.94*.15)};
  }
  // null means use the unchanged Hands/legacy reader. Zero is a real amount, never a fallback.
  function directMaster(o){
    if(!isDirect(o))return null;
    if(o.status==='Отменена')return 0;
    if(snapshot(o)&&finite(o.master_payout))return Number(o.master_payout);
    if(finite(o.amount))return round(Number(o.amount)*.60);
    return finite(o.master_payout)?Number(o.master_payout):0;
  }
  function directCompany(o){
    if(!isDirect(o)||!finite(o.amount))return null;
    if(o.status==='Отменена')return 0;
    return round(Number(o.amount)-directMaster(o));
  }
  function label(o){
    if(isHands(o))return 'Hands: действующий расчёт';
    if(!isDirect(o))return 'Прежний расчёт: источник не указан';
    if(snapshot(o)&&finite(o.master_payout)&&(round(o.master_payout)!==round(Number(o.amount)*.60)||Number(o.manager_payout||0)!==0||Number(o.dispatcher_payout||0)!==0))return 'Сохранённый расчёт отчёта';
    return 'Мастер 60% · Компания 40%';
  }
  return Object.freeze({version,isHands,isDirect,closed,snapshot,calculate,directMaster,directCompany,label});
});
