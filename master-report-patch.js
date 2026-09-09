const baseReportOpenOrder=openOrder;

function reportLinksHtml(o){
  if(!o||!o.report_act_url)return '';
  let photos=[];try{photos=JSON.parse(o.report_photo_urls||'[]')}catch(_){photos=[]}
  const measurement=o.report_type==='measurement'&&o.report_measurement_url?`<a class="secondary wide" target="_blank" rel="noopener" href="${esc(o.report_measurement_url)}">Открыть лист замера</a>`:'';
  const photoLinks=photos.map((u,i)=>`<a class="secondary wide" target="_blank" rel="noopener" href="${esc(u)}">Фото ${i+1}</a>`).join('');
  return `<section class="card"><h3>Отчёт мастера</h3><p class="muted">${o.report_type==='measurement'?'Замер':'Выполненные работы'}</p><a class="secondary wide" target="_blank" rel="noopener" href="${esc(o.report_act_url)}">Открыть акт</a>${measurement}${photoLinks}</section>`;
}

openOrder=function(id){
  const o=state.orders.find(x=>String(x.id)===String(id));if(!o)return;
  if(typeof isMasterPreview==='function'&&isMasterPreview()){
    const done=o.status==='Выполнена';
    openModal(`<h2>${esc(o.id)}</h2><p><b>${esc(o.work)}</b></p><p>${esc(o.client)} · ${esc(o.phone||'')}</p><p>${esc(o.address)}</p><p><b>Когда:</b> ${esc(o.scheduled_date||'—')} ${esc(o.scheduled_time||'')}</p><p><b>Моя выплата:</b> ${money(o.master_payout||payout(o.amount))}</p><p><span class="status info">${esc(o.status||'В работе')}</span></p>${reportLinksHtml(o)}${!done?`<button class="primary wide" onclick="openMasterReportForm('${esc(o.id)}')">Оформить отчёт и завершить</button>`:''}<button class="secondary wide" onclick="closeModal()">Закрыть</button>`);
    return;
  }
  baseReportOpenOrder(id);
  const modal=document.querySelector('.modal');
  if(modal&&o.report_act_url) modal.insertAdjacentHTML('beforeend',reportLinksHtml(o));
};

function toggleReportBlocks(){
  const type=$('#mrType')?.value||'work';
  const measure=$('#mrMeasurementWrap');if(measure)measure.style.display=type==='measurement'?'block':'none';
  const extra=$('#mrExtra')?.value==='true';const extraBox=$('#mrExtraBox');if(extraBox)extraBox.style.display=extra?'block':'none';
  const unfinished=$('#mrUnfinished')?.value==='true';const unfinishedBox=$('#mrUnfinishedBox');if(unfinishedBox)unfinishedBox.style.display=unfinished?'block':'none';
}

function openMasterReportForm(id){
  const o=state.orders.find(x=>String(x.id)===String(id));if(!o)return;
  openModal(`<h2>Отчёт по заявке ${esc(o.id)}</h2><form id="masterReportForm" class="form"><label>Тип отчёта</label><select id="mrType" name="report_type"><option value="work">Выполненные работы</option><option value="measurement">Замер</option></select><label>Акт выполненных работ *</label><input id="mrAct" type="file" accept="image/*,.pdf" required><div id="mrMeasurementWrap" style="display:none"><label>Лист замера *</label><input id="mrMeasurement" type="file" accept="image/*,.pdf"></div><label>Фото выполненной работы / объекта *</label><input id="mrPhotos" type="file" accept="image/*" capture="environment" multiple required><p class="muted">Можно выбрать до 5 фото.</p><label>Были допработы?</label><select id="mrExtra"><option value="false">Нет</option><option value="true">Да</option></select><div id="mrExtraBox" style="display:none"><textarea id="mrExtraDesc" placeholder="Какие допработы"></textarea><input id="mrExtraAmount" type="number" min="0" step="0.01" placeholder="Сумма допработ"></div><label>Все заявленные работы выполнены?</label><select id="mrUnfinished"><option value="false">Да, все</option><option value="true">Нет</option></select><div id="mrUnfinishedBox" style="display:none"><textarea id="mrUnfinishedDesc" placeholder="Какие работы не выполнены"></textarea><input id="mrUnfinishedAmount" type="number" min="0" step="0.01" placeholder="Стоимость невыполненных работ"></div><button class="primary wide" type="submit">Загрузить отчёт и завершить</button><p id="mrMsg" class="muted"></p></form>`);
  ['mrType','mrExtra','mrUnfinished'].forEach(x=>$('#'+x).onchange=toggleReportBlocks);toggleReportBlocks();
  $('#masterReportForm').onsubmit=e=>submitMasterReport(e,id);
}

async function fileToPayload(file,compressImage=false){
  if(!file)throw new Error('Файл не выбран');
  if(file.size>8*1024*1024)throw new Error('Файл слишком большой. Максимум 8 МБ');
  if(compressImage&&file.type.startsWith('image/')){
    const img=await loadImageFile(file);const max=1600,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    const data=c.toDataURL('image/jpeg',0.78);return{name:file.name.replace(/\.[^.]+$/,'.jpg'),mime:'image/jpeg',data:data.split(',')[1]};
  }
  const data=await readDataUrl(file);return{name:file.name,mime:file.type||'application/octet-stream',data:data.split(',')[1]};
}
function readDataUrl(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=()=>rej(new Error('Не удалось прочитать файл'));r.readAsDataURL(file)})}
function loadImageFile(file){return new Promise((res,rej)=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{URL.revokeObjectURL(url);res(img)};img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error('Не удалось обработать фото'))};img.src=url})}

async function submitMasterReport(e,id){
  e.preventDefault();const form=e.currentTarget,msg=$('#mrMsg');if(state.busy)return;
  const type=$('#mrType').value,act=$('#mrAct').files[0],measurement=$('#mrMeasurement').files[0],photos=[...$('#mrPhotos').files].slice(0,5);
  if(!act){msg.textContent='Приложите акт выполненных работ';return}
  if(type==='measurement'&&!measurement){msg.textContent='Для замера приложите лист замера';return}
  if(!photos.length){msg.textContent='Приложите хотя бы одно фото';return}
  const extra=$('#mrExtra').value==='true',unfinished=$('#mrUnfinished').value==='true';
  if(extra&&(!$('#mrExtraDesc').value.trim()||Number($('#mrExtraAmount').value||0)<=0)){msg.textContent='Заполните описание и сумму допработ';return}
  if(unfinished&&(!$('#mrUnfinishedDesc').value.trim()||Number($('#mrUnfinishedAmount').value||0)<=0)){msg.textContent='Заполните невыполненные работы и их стоимость';return}
  state.busy=true;setBusy(form,true);msg.textContent='Подготавливаем файлы…';
  try{
    const actP=await fileToPayload(act,act.type.startsWith('image/'));
    const measureP=measurement?await fileToPayload(measurement,measurement.type.startsWith('image/')):null;
    const photoP=[];for(const p of photos){photoP.push(await fileToPayload(p,true))}
    const token='report_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    msg.textContent='Загружаем отчёт…';
    submitReportPost({action:'uploadMasterReport',order_id:id,upload_token:token,report_type:type,act_name:actP.name,act_mime:actP.mime,act_data:actP.data,measurement_name:measureP?.name||'',measurement_mime:measureP?.mime||'',measurement_data:measureP?.data||'',photos_json:JSON.stringify(photoP),extra_work_done:extra,extra_work_description:extra?$('#mrExtraDesc').value:'',extra_work_amount:extra?Number($('#mrExtraAmount').value||0):0,uncompleted_work_done:unfinished,uncompleted_work_description:unfinished?$('#mrUnfinishedDesc').value:'',uncompleted_work_amount:unfinished?Number($('#mrUnfinishedAmount').value||0):0});
    const saved=await waitForReport(id,token,45000);
    const i=state.orders.findIndex(x=>String(x.id)===String(id));if(i>=0)state.orders[i]=saved;
    state.busy=false;closeModal();show('orders');
  }catch(err){msg.textContent=err.message;setBusy(form,false);state.busy=false}
}

function submitReportPost(fields){
  const iframe=document.createElement('iframe'),name='reportFrame_'+Date.now();iframe.name=name;iframe.style.display='none';document.body.appendChild(iframe);
  const f=document.createElement('form');f.method='POST';f.action=cfg.GAS_WEB_APP_URL;f.target=name;f.style.display='none';
  Object.entries(fields).forEach(([k,v])=>{const i=document.createElement('input');i.type='hidden';i.name=k;i.value=String(v??'');f.appendChild(i)});document.body.appendChild(f);f.submit();setTimeout(()=>{f.remove();iframe.remove()},50000);
}

async function waitForReport(id,token,timeout){
  const started=Date.now();
  while(Date.now()-started<timeout){await new Promise(r=>setTimeout(r,1800));const d=await api('bootstrap');if(d.ok){Object.assign(state,{orders:d.orders||state.orders,masters:d.masters||state.masters,users:d.users||state.users,masterSchedule:d.masterSchedule||state.masterSchedule});const o=state.orders.find(x=>String(x.id)===String(id));if(o&&String(o.report_upload_token||'')===String(token)&&o.status==='Выполнена')return o}}
  throw new Error('Отчёт загружается слишком долго. Проверьте соединение и повторите.')
}
