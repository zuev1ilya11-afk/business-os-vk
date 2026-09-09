let __reportUploadPromise=null;
submitReportPost=function(fields){
  const url='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/report-api';
  __reportUploadPromise=fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось загрузить отчёт');return d});
  return __reportUploadPromise;
};
waitForReport=async function(id,token,timeout){
  if(__reportUploadPromise){const d=await __reportUploadPromise;__reportUploadPromise=null;if(d?.order){const fresh=await api('bootstrap');if(fresh?.ok){Object.assign(state,{orders:fresh.orders||state.orders,masters:fresh.masters||state.masters,users:fresh.users||state.users,masterSchedule:fresh.masterSchedule||state.masterSchedule});const o=state.orders.find(x=>String(x.id)===String(id));if(o)return o}}}
  const started=Date.now();while(Date.now()-started<timeout){await new Promise(r=>setTimeout(r,1200));const d=await api('bootstrap');if(d?.ok){Object.assign(state,{orders:d.orders||state.orders,masters:d.masters||state.masters,users:d.users||state.users,masterSchedule:d.masterSchedule||state.masterSchedule});const o=state.orders.find(x=>String(x.id)===String(id));if(o&&String(o.report_upload_token||'')===String(token)&&o.status==='Выполнена')return o}}
  throw new Error('Отчёт не сохранился. Повторите загрузку.');
};