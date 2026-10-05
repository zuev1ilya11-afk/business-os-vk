(()=>{
window.BOS_AVITO_PRICE_CATALOG=window.BOS_PRICE_CATALOG.avito;
const SERVICES=window.BOS_PRICE_CATALOG.standard;
window.BOS_SERVICE_CATALOG=SERVICES;
const WALLS=['Не указан','Бетон','Кирпич','Газобетон','Гипсокартон','Дерево','Плитка','Металл','Другое'];
const SLOTS=Array.from({length:11},(_,i)=>{const h=10+i;return `${String(h).padStart(2,'0')}:00–${String(h+1).padStart(2,'0')}:00`});
const mid=m=>String(m?.vk_user_id||m?.external_id||m?.id||'');
const serviceOptions=(selected='')=>'<option value="">Выберите услугу</option>'+
 (selected&&!SERVICES.some(s=>s.n===selected)?`<option value="legacy" selected>${esc(selected)} — работа из заявки</option>`:'')+
 SERVICES.map((s,i)=>`<option value="${i}" ${s.n===selected?'selected':''}>${esc(s.n)}${s.p!=null?' — '+money(s.p):' — цена по согласованию'}${s.u?' / '+esc(s.u):''}</option>`).join('');
const newOrderChannels=()=>'<fieldset class="newOrderChannels"><legend>Канал поступления заявки</legend><div class="newOrderChannelOptions">'+['Авито','Руки','VK','Телефон','Рекомендация','Другое'].map((source,i)=>'<label class="newOrderChannel"><input type="radio" name="source" value="'+source+'" '+(!i?'checked':'')+' required><span>'+source+'</span></label>').join('')+'</div></fieldset>';
const masterOptions=(selected='')=>'<option value="">Назначить позже</option>'+state.masters.map(m=>`<option value="${esc(mid(m))}" data-city="${esc(m.city||'')}" ${String(selected)===mid(m)?'selected':''}>${esc(m.full_name||'Мастер')}${m.city?' — '+esc(m.city):''}</option>`).join('');
const slotOptions=(selected='')=>'<option value="">Выберите время</option>'+SLOTS.map(s=>`<option ${selected===s?'selected':''}>${s}</option>`).join('');
function phoneDigitsList(value){
 const raw=String(value||'').trim(),hits=raw.match(/(?:\+?7|8)?[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g)||[],source=hits.length?hits:(raw?[raw]:[]),seen=new Set(),out=[];
 for(const item of source){const digits=String(item||'').replace(/\D/g,'');const ten=digits.length===10?digits:(digits.length===11&&(digits[0]==='7'||digits[0]==='8')?digits.slice(1):'');if(ten.length===10&&!seen.has(ten)){seen.add(ten);out.push(ten)}}
 return out.length?out:[''];
}
const phoneEditRow=(value='',primary=false)=>`<div class="bosPhoneEditRow"><input ${primary?'id="bosPhone" ':''}class="bosPhoneInput" inputmode="numeric" maxlength="10" value="${esc(value)}" placeholder="9991234567" aria-label="Номер телефона"><button class="bosRemoveField bosRemovePhone" type="button" aria-label="Удалить номер">×</button></div>`;
const phoneEditor=value=>`<div class="bosPhoneEditor"><div class="bosPhonePrefix">+7</div><div class="bosPhoneStack" id="bosPhoneStack">${phoneDigitsList(value).map((phone,index)=>phoneEditRow(phone,index===0)).join('')}<button id="bosAddPhone" class="secondary bosAddField" type="button">＋ Добавить телефон</button></div></div>`;
const workLines=value=>String(value||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
function workOptions(selected=''){
 const exact=SERVICES.findIndex(s=>s.n===selected);
 return '<option value="">Выберите работу</option>'+(selected&&exact<0?`<option value="legacy" data-work="${esc(selected)}" selected>${esc(selected)}</option>`:'')+SERVICES.map((item,index)=>`<option value="${index}" ${index===exact?'selected':''}>${esc(item.n)}${item.p!=null?' — '+money(item.p):''}${item.u?' / '+esc(item.u):''}</option>`).join('');
}
const workEditRow=(value='',primary=false,allowCustom=false)=>`<div class="bosWorkEditRow"><select ${primary?'id="bosService" ':''}class="bosWorkSelect" aria-label="Работа">${workOptions(value)}${allowCustom?'<option value="custom">Своя работа</option>':''}</select><button class="bosRemoveField bosRemoveWork" type="button" aria-label="Удалить работу">×</button>${allowCustom?'<textarea class="bosCustomWork" rows="2" hidden aria-label="Своя работа" placeholder="Опишите работу своими словами"></textarea>':''}</div>`;
const workEditor=(value,allowCustom=false)=>{const rows=workLines(value);return `<div class="bosWorkStack" id="bosWorkStack">${(rows.length?rows:['']).map((work,index)=>workEditRow(work,index===0,allowCustom)).join('')}<button id="bosAddWork" class="secondary bosAddField" type="button">＋ Добавить работу</button></div>`};
function selectedWork(select){
 if(!select||!select.value)return null;
 if(select.value==='custom'){const name=select.closest('.bosWorkEditRow')?.querySelector('.bosCustomWork')?.value.trim();return name?{n:name,p:null}:null}
 if(select.value==='legacy')return {n:String(select.selectedOptions?.[0]?.dataset?.work||select.selectedOptions?.[0]?.textContent||'').trim(),p:null};
 return SERVICES[Number(select.value)]||null;
}
function authHeaders(){return window.BOS_AUTH_HEADERS?window.BOS_AUTH_HEADERS():Promise.resolve({'Content-Type':'application/json'})}
async function saveOrderType(id,type){const headers=await authHeaders();const r=await fetch('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/order-meta-api',{method:'POST',headers,body:JSON.stringify({action:'setOrderType',id,order_type:type})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось сохранить тип заявки');return d.order}
window.openOrderForm=function(id){
 if(!['owner','manager','dispatcher'].includes(String(state.user?.role||'')))return;
 const o=id?state.orders.find(x=>String(x.id)===String(id)):null;
 const slot=o?.time_slot||((o?.scheduled_time||'').slice(0,5)?`${(o.scheduled_time||'').slice(0,5)}–${String(Number((o.scheduled_time||'').slice(0,2))+1).padStart(2,'0')}:00`:'');
 openModal(`<h2>${o?'Редактировать заявку':'Новая заявка'}</h2><form id="orderForm" class="form ${o?'bosLeadershipOrderForm':''}">${o?'':newOrderChannels()}
 <label>ФИО клиента</label><input name="client" required value="${esc(o?.client||'')}" placeholder="Иван Иванов">
 <label>Номер телефона</label>${phoneEditor(o?.phone)}
 <label>Мастер</label><select name="master_vk_id">${masterOptions(o?.master_vk_id||'')}</select>
 <label>Адрес</label><input name="address" required value="${esc(o?.address||'')}" placeholder="Улица, дом">
 <label for="orderApartment">Квартира</label><input id="orderApartment" name="apartment" maxlength="120" value="${esc(o?.apartment||'')}" placeholder="Номер квартиры">
 ${o?`<label>Тип заявки</label><select name="order_type"><option value="work" ${(o?.order_type||'work')==='work'?'selected':''}>Обычная заявка</option><option value="measurement" ${o?.order_type==='measurement'?'selected':''}>Замер</option></select>
 `:''}<label>${o?'Работа':'Услуги'}</label>${workEditor(o?.work||'',!o)}<div id="bosServiceInfo" class="muted"></div>
 <label>Дата и время</label><div class="two"><input type="date" name="scheduled_date" value="${esc(o?.scheduled_date||'')}"><select name="time_slot">${slotOptions(slot)}</select></div>
 <label>Статус заявки</label><select name="status">${STATUSES.map(s=>`<option ${String(o?.status||'В работе')===s?'selected':''}>${s}</option>`).join('')}</select>
 <section class="card"><h3 style="margin-top:0">Условия на объекте</h3><label class="checkRow"><input type="checkbox" name="wall_over_3m" ${o?.wall_over_3m?'checked':''}><span>Высота более 3 метров</span></label><label>Материал стены</label><select name="wall_material">${WALLS.map(w=>`<option value="${w==='Не указан'?'':esc(w)}" ${(o?.wall_material||'')===(w==='Не указан'?'':w)?'selected':''}>${esc(w)}</option>`).join('')}</select>${o?'':'<label class="checkRow"><input type="checkbox" name="possible_extra_work"><span>Возможны допработы</span></label>'}</section>
 <label>Исходная сумма</label><input type="number" name="original_amount" min="0" step="1" value="${esc(o?.original_amount??o?.amount??'')}" placeholder="2800">
 <div class="card"><div class="row"><span>Расчёт мастера</span><b id="bosMasterPay">${money(o?.master_vk_id?(o?.master_payout||payout(o?.amount||o?.original_amount)):0)}</b></div></div>
 <label for="orderComment">${o?'Комментарий мастеру':'Комментарий'}</label><textarea id="orderComment" maxlength="10000" name="comment" placeholder="${o?'Что важно сообщить мастеру':'Комментарий к заявке'}">${esc(o?.comment||'')}</textarea>${o?'<div class="muted bosMasterCommentHint">Комментарий будет виден мастеру в карточке заявки.</div>':''}
 <button class="primary wide" type="submit">Сохранить</button><p id="formMsg" class="muted"></p></form>`);
 const form=$('#orderForm'),service=$('#bosService'),phoneEl=$('#bosPhone'),phoneStack=$('#bosPhoneStack'),workStack=$('#bosWorkStack'),amount=form.elements.original_amount,master=form.elements.master_vk_id,info=$('#bosServiceInfo');
 const editedDetails=new Set();for(const key of ['apartment','comment'])form.elements[key].addEventListener('input',()=>editedDetails.add(key));
 const syncPhoneButtons=()=>{if(!phoneStack)return;const rows=[...phoneStack.querySelectorAll('.bosPhoneEditRow')];rows.forEach((row,index)=>{row.querySelector('.bosPhoneInput').id=index===0?'bosPhone':'';const button=row.querySelector('.bosRemovePhone');if(button)button.hidden=rows.length<=1})};
 const syncWorkButtons=()=>{if(!workStack)return;const rows=[...workStack.querySelectorAll('.bosWorkEditRow')];rows.forEach((row,index)=>{row.querySelector('.bosWorkSelect').id=index===0?'bosService':'';const button=row.querySelector('.bosRemoveWork');if(button)button.hidden=rows.length<=1})};
 if(phoneStack){phoneStack.addEventListener('input',event=>{if(event.target.classList.contains('bosPhoneInput'))event.target.value=event.target.value.replace(/\D/g,'').slice(0,10)});phoneStack.addEventListener('click',event=>{const remove=event.target.closest('.bosRemovePhone');if(remove){const rows=phoneStack.querySelectorAll('.bosPhoneEditRow');if(rows.length>1)remove.closest('.bosPhoneEditRow').remove();syncPhoneButtons()}});$('#bosAddPhone').onclick=()=>{const add=$('#bosAddPhone'),holder=document.createElement('div');holder.innerHTML=phoneEditRow('');add.insertAdjacentElement('beforebegin',holder.firstElementChild);syncPhoneButtons();phoneStack.querySelector('.bosPhoneEditRow:last-of-type .bosPhoneInput')?.focus()}}else if(phoneEl)phoneEl.oninput=()=>phoneEl.value=phoneEl.value.replace(/\D/g,'').slice(0,10);
 if(workStack){workStack.addEventListener('click',event=>{const remove=event.target.closest('.bosRemoveWork');if(remove){const rows=workStack.querySelectorAll('.bosWorkEditRow');if(rows.length>1)remove.closest('.bosWorkEditRow').remove();syncWorkButtons();workStack.dispatchEvent(new Event('change',{bubbles:true}))}});workStack.addEventListener('change',event=>{if(!event.target.classList.contains('bosWorkSelect'))return;const custom=event.target.closest('.bosWorkEditRow').querySelector('.bosCustomWork');if(custom){custom.hidden=event.target.value!=='custom';if(!custom.hidden)custom.focus()}});$('#bosAddWork').onclick=()=>{const add=$('#bosAddWork'),holder=document.createElement('div');holder.innerHTML=workEditRow('',false,!o);add.insertAdjacentElement('beforebegin',holder.firstElementChild);syncWorkButtons();workStack.querySelector('.bosWorkEditRow:last-of-type select')?.focus()}}
 syncPhoneButtons();syncWorkButtons();
 const showService=()=>{info.textContent='';recalc()};
 form.bosWorkText=()=>[...workStack.querySelectorAll('.bosWorkSelect')].map(selectedWork).filter(Boolean).map(item=>item.n).join('\n');
 form.bosSetWork=value=>{workStack.querySelectorAll('.bosWorkEditRow').forEach(row=>row.remove());const rows=workLines(value);$('#bosAddWork').insertAdjacentHTML('beforebegin',(rows.length?rows:['']).map((work,index)=>workEditRow(work,index===0,!o)).join(''));syncWorkButtons();workStack.dispatchEvent(new Event('change',{bubbles:true}))};
 const recalc=()=>{
    const base=Math.max(0,Number(amount.value||0)-Number(o?.uncompleted_work_amount||0));
    const pricing={...(o||{external_source:'mini_app'}),source:form.elements.source?.value||o?.source||'Авито'};
    const model={...pricing,amount:base};
    const pay=window.BOS_ORDER_PAYROLL.calculate(base,model,!!master.value);
    const saved=window.BOS_ORDER_PAYROLL.snapshot(model)&&base===Number(o?.amount);
    $('#bosMasterPay').textContent=money(master.value?(saved?(o.master_payout??pay.master_payout):pay.master_payout):0);
    let note=form.querySelector('#bosPricingRule');if(!note){note=document.createElement('p');note.id='bosPricingRule';note.className='muted';$('#bosMasterPay').closest('.card').appendChild(note)}
    note.textContent=window.BOS_ORDER_PAYROLL.label(saved?model:{...model,status:'В работе',report_review_status:'not_submitted',report_uploaded_at:null})+(window.BOS_ORDER_PAYROLL.isDirect(model)?' · Компании: '+money(saved?window.BOS_ORDER_PAYROLL.directCompany(model):Math.round((base-Math.round(base*.6*100)/100)*100)/100):'')+' · Допработы учитываются отдельно';
  };
 if(service)service.oninput=showService;amount.oninput=recalc;master.onchange=()=>recalc();form.addEventListener('change',e=>{if(e.target.name==='source')recalc()});showService();
 form.onsubmit=async e=>{e.preventDefault();if(state.busy)return;const msg=$('#formMsg');const rawPhones=[...phoneStack.querySelectorAll('.bosPhoneInput')].map(input=>input.value.trim()).filter(Boolean);if(!rawPhones.length||rawPhones.some(value=>value.length!==10)){msg.textContent='Введите по 10 цифр для каждого номера после +7';(phoneStack?.querySelector('.bosPhoneInput')||phoneEl)?.focus();return}const phones=[...new Set(rawPhones)];const works=[...workStack.querySelectorAll('.bosWorkSelect')].map(selectedWork).filter(Boolean);if(!works.length){msg.textContent='Добавьте хотя бы одну работу';(workStack?.querySelector('.bosWorkSelect')||service)?.focus();return}const f=Object.fromEntries(new FormData(form));f.edited_detail_fields=[...editedDetails];if(o)for(const key of ['apartment','comment'])if(!editedDetails.has(key))delete f[key];const type=o?f.order_type:'work';delete f.order_type;f.phone=phones.map(value=>'+7'+value).join('; ');f.work=[...new Map(works.map(item=>[item.n,item])).values()].map(item=>item.n).join('\n');f.original_amount=Number(f.original_amount||0);f.amount=f.original_amount;f.wall_over_3m=!!form.elements.wall_over_3m.checked;f.possible_extra_work=!!form.elements.possible_extra_work?.checked;f.city=master.options[master.selectedIndex]?.dataset?.city||o?.city||state.user?.city||'';f.scheduled_time=f.time_slot?f.time_slot.split('–')[0]:'';if(o)f.id=o.id;msg.textContent='Сохраняем…';setBusy(form,true);try{const d=await api(o?'updateOrder':'createOrder',f);if(!d.ok)throw new Error(d.error);const meta=o?await saveOrderType(d.order.id,type):{};const merged={...f,...d.order,...meta,order_type:type};if(o){const i=state.orders.findIndex(x=>String(x.id)===String(o.id));state.orders[i]=merged}else{const i=state.orders.findIndex(x=>String(x.id)===String(merged.id));if(i>=0)state.orders[i]=merged;else state.orders.unshift(merged)};state.busy=false;closeModal();show('orders')}catch(err){msg.textContent=err.message;setBusy(form,false)}finally{state.busy=false}}
};
const prevOpen=window.openOrder;
window.openOrder=function(id){prevOpen(id);const o=state.orders.find(x=>String(x.id)===String(id)),modal=document.querySelector('.modal');if(!o||!modal)return;const has=modal.querySelector('.bosConditionsView');if(has)return;const box=document.createElement('section');box.className='card bosConditionsView';box.innerHTML=`<h3>Детали заявки</h3><p><b>Тип:</b> ${o.order_type==='measurement'?'Замер':'Обычная заявка'}</p><p><b>Условия:</b> ${o.wall_over_3m?'высота > 3 м':'высота до 3 м'} · ${esc(o.wall_material||'материал не указан')}</p>${o.comment?`<p><b>Комментарий:</b> ${esc(o.comment)}</p>`:''}`;modal.insertBefore(box,modal.children[1]||null)};
const prevReportForm=window.openMasterReportForm;
if(typeof prevReportForm==='function')window.openMasterReportForm=function(id){prevReportForm(id);const o=state.orders.find(x=>String(x.id)===String(id));if(o&&$('#mrType')){$('#mrType').value=o.order_type==='measurement'?'measurement':'work';if(typeof toggleReportBlocks==='function')toggleReportBlocks()}};
window.submitReportPost=function(fields){
 const url='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/report-upload-gateway';
 if(typeof isMasterPreview==='function'&&isMasterPreview()&&window.previewUser)fields.acting_master_vk_id=mid(window.previewUser);
 else if(typeof isMasterPreview==='function'&&isMasterPreview()&&typeof previewUser!=='undefined'&&previewUser)fields.acting_master_vk_id=mid(previewUser);
 __reportUploadPromise=(async()=>{const headers=await authHeaders();const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(fields)});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось загрузить отчёт');return d})();return __reportUploadPromise;
};
const style=document.createElement('style');style.textContent=`
.bosLeadershipOrderForm{max-width:720px;margin:0 auto}
.bosPhoneEditor{display:grid;grid-template-columns:70px minmax(0,1fr);gap:10px;align-items:start}
.bosPhonePrefix{min-height:48px;display:flex;align-items:center;padding:0 12px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#081321;box-sizing:border-box}
.bosPhoneStack,.bosWorkStack{display:grid;gap:7px;min-width:0}
.bosPhoneEditRow,.bosWorkEditRow{display:grid;grid-template-columns:minmax(0,1fr) 42px;gap:7px;align-items:center;min-width:0}
.bosPhoneEditRow input,.bosWorkEditRow select{margin:0!important;width:100%;min-width:0;box-sizing:border-box}
.bosRemoveField{width:42px;height:42px;min-width:42px;padding:0;border:1px solid rgba(125,176,235,.28);border-radius:9px;background:#102238;color:#91bfff;font-size:21px;line-height:1}
.bosRemoveField[hidden]{visibility:hidden}
.bosCustomWork{grid-column:1/-1;min-width:0;width:100%;box-sizing:border-box}.bosCustomWork[hidden]{display:none!important}
.bosAddField{width:100%;min-height:40px;margin:0!important;text-align:left;color:#8fbcff}
.bosMasterCommentHint{font-size:12px;margin-top:-5px}
#bosServiceInfo:empty{display:none}
@media(max-width:520px){.bosPhoneEditor{grid-template-columns:58px minmax(0,1fr);gap:7px}.bosLeadershipOrderForm{max-width:none}.bosPhoneEditRow,.bosWorkEditRow{grid-template-columns:minmax(0,1fr) 40px}.bosRemoveField{width:40px;min-width:40px}}
`;document.head.appendChild(style);
})();
