(()=>{
'use strict';
function reportRadio(name,value,label,checked){return `<label class="reportChoice"><input type="radio" name="${name}" value="${value}" ${checked?'checked':''}><span>${label}</span></label>`}
function reportToggleState(){
  const extra=document.querySelector('input[name="mrExtra"]:checked')?.value==='true';
  const allDone=document.querySelector('input[name="mrAllDone"]:checked')?.value==='true';
  const e=$('#mrExtraBox'),u=$('#mrUnfinishedBox');
  if(e)e.style.display=extra?'grid':'none';
  if(u)u.style.display=allDone?'none':'grid';
}
window.openMasterReportForm=function(id){
  const o=state.orders.find(x=>String(x.id)===String(id));if(!o)return;
  openModal(`<h2>Отчёт по заявке ${esc(o.id)}</h2><form id="masterReportForm" class="form reportCompactForm">
    <label>Акт выполненных работ *</label><input id="mrAct" type="file" accept="image/*,.pdf,application/pdf" required>
    <label>Фото выполненной работы *</label><input id="mrPhotos" type="file" accept="image/*" multiple required><p class="muted reportHint">Выберите до 5 фото из файлов или галереи.</p>
    <div class="reportQuestion"><b>Были ли допработы?</b><div class="reportChoices">${reportRadio('mrExtra','false','Нет',true)}${reportRadio('mrExtra','true','Да',false)}</div></div>
    <div id="mrExtraBox" class="reportConditional" style="display:none"><input id="mrExtraDesc" placeholder="Какие допработы"><input id="mrExtraAmount" type="number" min="0" step="0.01" placeholder="Сумма допработ"></div>
    <div class="reportQuestion"><b>Все ли на заявке выполнено?</b><div class="reportChoices">${reportRadio('mrAllDone','true','Да',true)}${reportRadio('mrAllDone','false','Нет',false)}</div></div>
    <div id="mrUnfinishedBox" class="reportConditional" style="display:none"><input id="mrUnfinishedDesc" placeholder="Что не выполнено"><input id="mrUnfinishedAmount" type="number" min="0" step="0.01" placeholder="Стоимость невыполненного"></div>
    <button class="primary wide" type="submit">Отправить отчёт и завершить</button><p id="mrMsg" class="muted"></p>
  </form>`);
  document.querySelectorAll('input[name="mrExtra"],input[name="mrAllDone"]').forEach(el=>el.addEventListener('change',reportToggleState));
  reportToggleState();
  $('#masterReportForm').onsubmit=e=>submitMasterReportV12(e,id);
};
async function compactFilePayload(file,photo=false){
  if(!file)throw new Error('Файл не выбран');
  const maxRaw=photo?12*1024*1024:7*1024*1024;if(file.size>maxRaw)throw new Error(`Файл ${file.name} слишком большой`);
  if(file.type.startsWith('image/')){
    const img=await loadImageFile(file),max=photo?1024:1200,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    const data=c.toDataURL('image/jpeg',photo?.55:.62);return{name:file.name.replace(/\.[^.]+$/,'.jpg'),mime:'image/jpeg',data:data.split(',')[1]};
  }
  const data=await readDataUrl(file);return{name:file.name,mime:file.type||'application/octet-stream',data:data.split(',')[1]};
}
function storedReportSession(){try{return sessionStorage.getItem('bos_vk_session_v2')||localStorage.getItem('bos_vk_session_v2')||''}catch(_){return ''}}
function clearStoredReportSession(){try{sessionStorage.removeItem('bos_vk_session_v2');localStorage.removeItem('bos_vk_session_v2')}catch(_){}}
async function cleanReportHeaders(){
  const h={'Content-Type':'application/json'};
  let session=storedReportSession();
  if(!session&&window.BOS_ENSURE_VK_SESSION){try{await window.BOS_ENSURE_VK_SESSION();session=storedReportSession()}catch(_){}}
  if(session)h['X-BOS-Session']=session;
  let launch=window.BOS_VK_LAUNCH_PARAMS||'';
  if(!launch&&window.BOS_ENSURE_VK_LAUNCH_PARAMS){try{launch=await window.BOS_ENSURE_VK_LAUNCH_PARAMS()}catch(_){}}
  if(launch)h['X-VK-Launch-Params']=launch;
  return h;
}
async function reportUploadRequest(fields){
  const preview=typeof isMasterPreview==='function'&&isMasterPreview();
  const url=preview?'https://obsropbslfwtanyspjbi.supabase.co/functions/v1/report-upload-gateway':'https://obsropbslfwtanyspjbi.supabase.co/functions/v1/report-api';
  let lastErr;
  for(let attempt=0;attempt<2;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),45000);
    try{
      const r=await fetch(url,{method:'POST',headers:await cleanReportHeaders(),body:JSON.stringify(fields),signal:controller.signal});
      let d={};try{d=await r.json()}catch(_){throw new Error(`Сервер не смог обработать отчёт (${r.status})`)}
      if(d?.session_token&&window.BOS_STORE_SESSION)window.BOS_STORE_SESSION(d.session_token);
      if(r.status===401&&attempt===0){clearStoredReportSession();if(window.BOS_ENSURE_VK_SESSION){try{await window.BOS_ENSURE_VK_SESSION()}catch(_){}}lastErr=new Error(d.error||'Доступ не подтверждён');await new Promise(r=>setTimeout(r,500));continue}
      if(!r.ok||!d.ok)throw new Error(d.error||`Ошибка загрузки (${r.status})`);return d;
    }catch(e){lastErr=e;if(e?.name==='AbortError')lastErr=new Error('Сервер слишком долго не отвечает. Повторите отправку.');if(attempt===0)await new Promise(r=>setTimeout(r,700));}
    finally{clearTimeout(timer)}
  }
  const text=String(lastErr?.message||lastErr||'');
  if(/failed to fetch|networkerror|load failed/i.test(text))throw new Error('Связь с сервером загрузки прервана. Повторите отправку ещё раз.');
  throw lastErr;
}
async function submitMasterReportV12(e,id){
  e.preventDefault();const form=e.currentTarget,msg=$('#mrMsg');if(state.busy)return;
  const act=$('#mrAct').files[0],photos=[...$('#mrPhotos').files].slice(0,5),extra=document.querySelector('input[name="mrExtra"]:checked')?.value==='true',allDone=document.querySelector('input[name="mrAllDone"]:checked')?.value==='true',unfinished=!allDone;
  if(!act){msg.textContent='Приложите акт выполненных работ';return}if(!photos.length){msg.textContent='Приложите хотя бы одно фото';return}
  if(extra&&(!$('#mrExtraDesc').value.trim()||Number($('#mrExtraAmount').value||0)<=0)){msg.textContent='Укажите допработы и сумму';return}
  if(unfinished&&(!$('#mrUnfinishedDesc').value.trim()||Number($('#mrUnfinishedAmount').value||0)<=0)){msg.textContent='Укажите, что не выполнено, и стоимость';return}
  state.busy=true;setBusy(form,true);msg.textContent='Подготавливаем файлы…';
  try{
    const actP=await compactFilePayload(act,false),photoP=[];for(const p of photos)photoP.push(await compactFilePayload(p,true));
    const token='report_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    const fields={action:'uploadMasterReport',order_id:id,upload_token:token,report_type:'work',act_name:actP.name,act_mime:actP.mime,act_data:actP.data,measurement_name:'',measurement_mime:'',measurement_data:'',photos_json:JSON.stringify(photoP),extra_work_done:extra,extra_work_description:extra?$('#mrExtraDesc').value.trim():'',extra_work_amount:extra?Number($('#mrExtraAmount').value||0):0,uncompleted_work_done:unfinished,uncompleted_work_description:unfinished?$('#mrUnfinishedDesc').value.trim():'',uncompleted_work_amount:unfinished?Number($('#mrUnfinishedAmount').value||0):0};
    if(typeof isMasterPreview==='function'&&isMasterPreview()&&typeof liveMasterUser==='function'){const mu=liveMasterUser();fields.acting_master_vk_id=mu?.vk_user_id||mu?.external_id||mu?.id||''}
    msg.textContent='Загружаем файлы и сохраняем отчёт…';const d=await reportUploadRequest(fields);let saved=d.order;
    msg.textContent='Отчёт сохранён';
    try{const fresh=await api('bootstrap');if(fresh?.ok){Object.assign(state,{orders:fresh.orders||state.orders,masters:fresh.masters||state.masters,users:fresh.users||state.users,masterSchedule:fresh.masterSchedule||state.masterSchedule});saved=state.orders.find(x=>String(x.id)===String(id))||saved}}catch(_){ }
    if(saved){const i=state.orders.findIndex(x=>String(x.id)===String(id));if(i>=0)state.orders[i]=saved}
    state.busy=false;closeModal();show('orders');
  }catch(err){msg.textContent=err.message||String(err);setBusy(form,false);state.busy=false}
}
const style=document.createElement('style');style.textContent=`.reportCompactForm{gap:10px}.reportCompactForm>label{margin-top:2px}.reportHint{margin:-4px 0 2px;font-size:12px}.reportQuestion{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid rgba(255,255,255,.07)}.reportQuestion b{font-size:14px}.reportChoices{display:flex;gap:6px}.reportChoice{cursor:pointer}.reportChoice input{position:absolute;opacity:0;pointer-events:none}.reportChoice span{display:block;min-width:52px;padding:7px 11px;text-align:center;border:1px solid #315271;border-radius:10px;font-size:13px}.reportChoice input:checked+span{background:#1f5f99;border-color:#4f91cf;color:#fff}.reportConditional{grid-template-columns:1fr 130px;gap:8px;margin:-2px 0 4px}.reportConditional input{min-height:40px;padding:9px 10px}.reportCompactForm input[type=file]{min-height:42px}@media(max-width:520px){.reportConditional{grid-template-columns:1fr}.reportQuestion{align-items:flex-start;flex-direction:column;gap:7px}.reportChoices{width:100%}.reportChoice{flex:1}.reportChoice span{width:100%;box-sizing:border-box}}`;document.head.appendChild(style);
})();