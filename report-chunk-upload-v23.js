(()=>{
'use strict';
const REPORT_PROXY='https://business-os-api-gateway.netlify.app/api/proxy/report-api';
const REPORT_DIRECT='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/report-api';
const submitting=new WeakSet();
function session(){try{return sessionStorage.getItem('bos_vk_session_v2')||localStorage.getItem('bos_vk_session_v2')||''}catch(_){return ''}}
function clearSession(){try{sessionStorage.removeItem('bos_vk_session_v2');localStorage.removeItem('bos_vk_session_v2')}catch(_){}}
function clearReportRoute(){try{window.BOS_NETWORK_DIRECT_V86?.clearPreferredTarget?.('report-api')}catch(_){}}
async function headers(){const h={'Content-Type':'application/json'};let s=session();if(!s&&window.BOS_ENSURE_VK_SESSION){try{await window.BOS_ENSURE_VK_SESSION();s=session()}catch(_){}}if(s)h['X-BOS-Session']=s;let lp=window.BOS_VK_LAUNCH_PARAMS||'';if(!lp&&window.BOS_ENSURE_VK_LAUNCH_PARAMS){try{lp=await window.BOS_ENSURE_VK_LAUNCH_PARAMS()}catch(_){}}if(lp)h['X-VK-Launch-Params']=lp;return h}
function retryable(err,status){const t=String(err?.message||err||'');return !status||status===500||status===502||status===503||status===504||/failed to fetch|load failed|networkerror|upstream_|server.*answer|abort/i.test(t)}
async function once(url,body,timeout=35000){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{const r=await fetch(url,{method:'POST',headers:await headers(),body:JSON.stringify(body),signal:controller.signal,bosReconcileBeforeRetry:body.action==='finalizeMasterReport'});const d=await r.json().catch(()=>({}));if(d?.session_token&&window.BOS_STORE_SESSION)window.BOS_STORE_SESSION(d.session_token);if(r.status===401){const e=new Error(d.error||'Доступ не подтверждён');e.status=401;throw e}if(!r.ok||!d.ok){const e=new Error(d.message||d.error||`Ошибка загрузки (${r.status})`);e.status=r.status;e.code=d.error;throw e}return d}catch(e){if(e?.name==='AbortError'){const x=new Error('Сервер загрузки не ответил вовремя. Повторите отправку.');x.status=504;throw x}throw e}finally{clearTimeout(timer)}}
async function request(body){let authRetried=false,lastErr;for(const url of [REPORT_PROXY,REPORT_DIRECT]){for(let attempt=0;attempt<2;attempt++){try{return await once(url,body,url===REPORT_PROXY?35000:45000)}catch(e){lastErr=e;if(e?.status===401&&!authRetried){authRetried=true;clearSession();if(window.BOS_ENSURE_VK_SESSION){try{await window.BOS_ENSURE_VK_SESSION()}catch(_){}}continue}if(e?.status===500){clearReportRoute();if(url===REPORT_PROXY)break}if(body.action==='finalizeMasterReport'||!retryable(e,e?.status))throw e;if(attempt===0)await new Promise(r=>setTimeout(r,450));else break}}}const text=String(lastErr?.message||lastErr||'');if(/failed to fetch|load failed|networkerror|upstream_|не ответил вовремя/i.test(text))throw new Error('Не удалось связаться с сервером отчётов. Проверьте интернет и повторите отправку.');throw lastErr}
function dataUrl(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result||''));r.onerror=()=>rej(new Error('Не удалось прочитать файл'));r.readAsDataURL(file)})}
function image(file){return new Promise((res,rej)=>{const u=URL.createObjectURL(file),i=new Image();i.onload=()=>{URL.revokeObjectURL(u);res(i)};i.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('Не удалось обработать изображение'))};i.src=u})}
async function compact(file,photo=false){if(!file)throw new Error('Файл не выбран');const isImage=String(file.type||'').startsWith('image/'),maxRaw=isImage?30*1024*1024:(photo?12*1024*1024:7*1024*1024);if(file.size>maxRaw)throw new Error(isImage?`Файл ${file.name} слишком большой. Максимум 30 МБ`:`Файл ${file.name} слишком большой. Для PDF и других файлов максимум ${photo?12:7} МБ`);if(isImage){const img=await image(file),max=photo?1920:1600,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);const u=c.toDataURL('image/jpeg',photo?.82:.78);return{name:file.name.replace(/\.[^.]+$/,'.jpg'),mime:'image/jpeg',data:u.split(',')[1]}}const u=await dataUrl(file);return{name:file.name,mime:file.type||'application/octet-stream',data:u.split(',')[1]}}
function acting(body){if(typeof isMasterPreview==='function'&&isMasterPreview()&&typeof liveMasterUser==='function'){const m=liveMasterUser();body.acting_master_vk_id=m?.vk_user_id||m?.external_id||m?.id||''}return body}
// A lost response or a stale form must not present an already saved report as a failed upload.
// Use a fresh authorized read; cached rows cannot prove that a report was saved.
async function reconcileReport(form,msg,id){
  const d=await api('bootstrap');
  if(!d?.ok||!Array.isArray(d.orders))throw new Error('Не удалось обновить заявку');
  form.dataset.reportReconciled='true';
  const o=d.orders.find(x=>String(x.id)===String(id));
  if(!o){form.dataset.reportLocked='true';setBusy(form,true);msg.textContent='Заявка больше не доступна вам. Обновите список заявок.';return true}
  const i=state.orders.findIndex(x=>String(x.id)===String(id));
  if(i>=0)state.orders[i]={...state.orders[i],...o};
  let text='';
  if(o.status==='Отменена')text='Заявка отменена. Отправка отчёта недоступна.';
  else if(o.report_uploaded_at&&o.report_review_status==='approved')text='Отчёт уже принят. Повторная отправка не нужна.';
  else if(o.report_uploaded_at&&o.report_review_status==='pending')text='Отчёт уже загружен и ожидает проверки. Повторная отправка не нужна.';
  else if(o.status==='Выполнена')text='Заявка уже завершена. Отправка отчёта недоступна.';
  if(!text)return false;
  form.dataset.reportLocked='true';
  setBusy(form,true);
  msg.textContent=text;
  const open=document.createElement('button');
  open.type='button';open.className='secondary wide';open.textContent='Открыть заявку';
  open.onclick=()=>openOrder(id);
  msg.after(open);
  return true;
}
async function submit(e,id){e.preventDefault();const form=e.currentTarget,msg=document.querySelector('#mrMsg');if(state.busy||submitting.has(form)||form.dataset.reportLocked==='true')return;const act=document.querySelector('#mrAct')?.files?.[0],photos=[...(document.querySelector('#mrPhotos')?.files||[])].slice(0,5),extra=document.querySelector('input[name="mrExtra"]:checked')?.value==='true',allDone=document.querySelector('input[name="mrAllDone"]:checked')?.value==='true',unfinished=!allDone,extraDesc=document.querySelector('#mrExtraDesc')?.value?.trim()||'',extraAmount=Number(document.querySelector('#mrExtraAmount')?.value||0),unfinishedDesc=document.querySelector('#mrUnfinishedDesc')?.value?.trim()||'',unfinishedAmount=Number(document.querySelector('#mrUnfinishedAmount')?.value||0);if(!act){msg.textContent='Приложите акт выполненных работ';return}if(!photos.length){msg.textContent='Приложите хотя бы одно фото';return}if(extra&&(!extraDesc||extraAmount<=0)){msg.textContent='Укажите допработы и сумму';return}let deduction;try{deduction=form.bosDeductionPayload?.();if(!deduction&&unfinished&&(!unfinishedDesc||unfinishedAmount<=0))throw new Error('Укажите, что не выполнено, и стоимость')}catch(e){msg.textContent=e.message;return}submitting.add(form);state.busy=true;setBusy(form,true);let finalizing=false;const token='report_'+Date.now()+'_'+Math.random().toString(36).slice(2);try{msg.textContent='Подготавливаем акт…';const a=await compact(act,false);msg.textContent='Загружаем акт…';const ar=await request(acting({action:'uploadReportFile',order_id:id,upload_token:token,file_kind:'act',file_index:0,file_name:a.name,file_mime:a.mime,file_data:a.data}));const photoUrls=[];for(let i=0;i<photos.length;i++){msg.textContent=`Подготавливаем фото ${i+1} из ${photos.length}…`;const p=await compact(photos[i],true);msg.textContent=`Загружаем фото ${i+1} из ${photos.length}…`;const pr=await request(acting({action:'uploadReportFile',order_id:id,upload_token:token,file_kind:'photo',file_index:i+1,file_name:p.name,file_mime:p.mime,file_data:p.data}));photoUrls.push(pr.url)}msg.textContent='Сохраняем отчёт…';finalizing=true;const d=await request(acting({action:'finalizeMasterReport',order_id:id,upload_token:token,act_url:ar.url,photo_urls:photoUrls,extra_work_done:extra,extra_work_description:extra?extraDesc:'',extra_work_amount:extra?extraAmount:0,uncompleted_work_done:unfinished,uncompleted_work_description:unfinished?unfinishedDesc:'',uncompleted_work_amount:unfinished?unfinishedAmount:0,...deduction}));if(d.order){const i=state.orders.findIndex(x=>String(x.id)===String(id));if(i>=0)state.orders[i]={...state.orders[i],...d.order}}msg.textContent='Отчёт отправлен';state.busy=false;closeModal();try{await reloadData(true)}catch(_){show('orders')}}catch(err){
  const conflict=err?.code==='REPORT_CHANGED'||err?.message==='REPORT_CHANGED';
  let reconciled=false;
  if(conflict||finalizing){
    msg.textContent='Проверяем, сохранился ли отчёт…';
    form.dataset.reportReconciled='false';
    try{reconciled=await reconcileReport(form,msg,id)}catch(_){}
    if(form.dataset.reportReconciled!=='true'){
      form.dataset.reportLocked='true';setBusy(form,true);
      msg.textContent='Результат отправки неизвестен. Проверьте соединение и обновите состояние перед повтором.';
      const refresh=document.createElement('button');refresh.type='button';refresh.className='secondary wide';refresh.textContent='Проверить состояние';
      refresh.onclick=async()=>{refresh.disabled=true;try{const locked=await reconcileReport(form,msg,id);if(!locked){form.dataset.reportLocked='false';setBusy(form,false);msg.textContent='Отчёт не отправлен. Можно повторить отправку.'}refresh.remove()}catch(_){msg.textContent='Не удалось проверить состояние. Проверьте интернет.';refresh.disabled=false}};
      msg.after(refresh);reconciled=true;
    }
  }
  if(!reconciled)msg.textContent=conflict?'Состояние заявки изменилось. Закройте форму и откройте заявку заново.':(err?.message||String(err));
}finally{
  submitting.delete(form);
  if(form.dataset.reportLocked!=='true')setBusy(form,false);
  state.busy=false;
}}
window.BOS_MASTER_REPORT_SUBMIT=submit;
const original=window.openMasterReportForm;
window.openMasterReportForm=function(id){original(id);const form=document.querySelector('#masterReportForm');if(form)form.onsubmit=e=>window.BOS_MASTER_REPORT_SUBMIT(e,id)};
})();