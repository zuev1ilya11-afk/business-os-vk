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
function phoneDigits(v){let d=String(v||'').replace(/\D/g,'');if(d[0]==='7'||d[0]==='8')d=d.slice(1);return d.slice(0,10)}
function authHeaders(){return window.BOS_AUTH_HEADERS?window.BOS_AUTH_HEADERS():Promise.resolve({'Content-Type':'application/json'})}
async function saveOrderType(id,type){const headers=await authHeaders();const r=await fetch('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/order-meta-api',{method:'POST',headers,body:JSON.stringify({action:'setOrderType',id,order_type:type})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось сохранить тип заявки');return d.order}
window.openOrderForm=function(id){
 if(!['owner','manager','dispatcher'].includes(String(state.user?.role||'')))return;
 const o=id?state.orders.find(x=>String(x.id)===String(id)):null;
 const phone=phoneDigits(o?.phone);
 const slot=o?.time_slot||((o?.scheduled_time||'').slice(0,5)?`${(o.scheduled_time||'').slice(0,5)}–${String(Number((o.scheduled_time||'').slice(0,2))+1).padStart(2,'0')}:00`:'');
 openModal(`<h2>${o?'Редактировать заявку':'Новая заявка'}</h2><form id="orderForm" class="form">${o?'':newOrderChannels()}
 <label>ФИО клиента</label><input name="client" required value="${esc(o?.client||'')}" placeholder="Иван Иванов">
 <label>Номер телефона</label><div class="two" style="grid-template-columns:70px 1fr"><input value="+7" disabled><input id="bosPhone" inputmode="numeric" maxlength="10" value="${esc(phone)}" placeholder="9991234567" required></div>
 <label>Мастер</label><select name="master_vk_id">${masterOptions(o?.master_vk_id||'')}</select>
 <label>Адрес</label><input name="address" required value="${esc(o?.address||'')}" placeholder="Улица, дом">
 <label for="orderApartment">Квартира</label><input id="orderApartment" name="apartment" maxlength="120" value="${esc(o?.apartment||'')}" placeholder="Номер квартиры">
 ${o?`<label>Тип заявки</label><select name="order_type"><option value="work" ${(o?.order_type||'work')==='work'?'selected':''}>Обычная заявка</option><option value="measurement" ${o?.order_type==='measurement'?'selected':''}>Замер</option></select>
 <label>Работа</label><select id="bosService" required>${serviceOptions(o?.work||'')}</select>`:"<label>Услуги</label><textarea id=\"bosService\" name=\"work\" rows=\"3\" required placeholder=\"Например: установка двух карнизов и навеска штор\"></textarea>"}<div id="bosServiceInfo" class="muted"></div>
 <label>Дата и время</label><div class="two"><input type="date" name="scheduled_date" value="${esc(o?.scheduled_date||'')}"><select name="time_slot">${slotOptions(slot)}</select></div>
 <label>Статус заявки</label><select name="status">${STATUSES.map(s=>`<option ${String(o?.status||'В работе')===s?'selected':''}>${s}</option>`).join('')}</select>
 <section class="card"><h3 style="margin-top:0">Условия на объекте</h3><label class="checkRow"><input type="checkbox" name="wall_over_3m" ${o?.wall_over_3m?'checked':''}><span>Высота более 3 метров</span></label><label>Материал стены</label><select name="wall_material">${WALLS.map(w=>`<option value="${w==='Не указан'?'':esc(w)}" ${(o?.wall_material||'')===(w==='Не указан'?'':w)?'selected':''}>${esc(w)}</option>`).join('')}</select>${o?'':'<label class="checkRow"><input type="checkbox" name="possible_extra_work"><span>Возможны допработы</span></label>'}</section>
 <label>Исходная сумма</label><input type="number" name="original_amount" min="0" step="1" value="${esc(o?.original_amount??o?.amount??'')}" placeholder="2800">
 <div class="card"><div class="row"><span>Расчёт мастера</span><b id="bosMasterPay">${money(o?.master_vk_id?(o?.master_payout||payout(o?.amount||o?.original_amount)):0)}</b></div></div>
 <label for="orderComment">Комментарий</label><textarea id="orderComment" maxlength="10000" name="comment" placeholder="Комментарий к заявке">${esc(o?.comment||'')}</textarea>
 <button class="primary wide" type="submit">Сохранить</button><p id="formMsg" class="muted"></p></form>`);
 const form=$('#orderForm'),service=$('#bosService'),phoneEl=$('#bosPhone'),amount=form.elements.original_amount,master=form.elements.master_vk_id,info=$('#bosServiceInfo');
 const editedDetails=new Set();for(const key of ['apartment','comment'])form.elements[key].addEventListener('input',()=>editedDetails.add(key));
 const selectedService=()=>!o?(service.value.trim()?{n:service.value.trim(),p:null}:null):service.value==='legacy'&&o?.work?{n:o.work,u:'Работа из ранее созданной заявки',p:null}:service.value!==''?SERVICES[Number(service.value)]:null;
 phoneEl.oninput=()=>phoneEl.value=phoneEl.value.replace(/\D/g,'').slice(0,10);
 const showService=()=>{const s=selectedService();info.textContent=!o?'Напишите своими словами, что нужно сделать':s?`${s.u||'Цена за услугу'}${s.p!=null?' · '+money(s.p):' · цена не указана в прайсе'}`:'';if(s&&s.p!=null&&!amount.value)amount.value=s.p;recalc()};
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
 service.onchange=()=>{const s=selectedService();if(s&&s.p!=null)amount.value=s.p;showService()};amount.oninput=recalc;master.onchange=()=>recalc();form.addEventListener('change',e=>{if(e.target.name==='source')recalc()});showService();
 form.onsubmit=async e=>{e.preventDefault();if(state.busy)return;const msg=$('#formMsg'),s=selectedService();if(!s){msg.textContent=o?'Выберите работу из списка':'Опишите услуги, которые нужно выполнить';service.focus();return}if(phoneEl.value.length!==10){msg.textContent='Введите 10 цифр телефона после +7';return}const f=Object.fromEntries(new FormData(form));f.edited_detail_fields=[...editedDetails];if(o)for(const key of ['apartment','comment'])if(!editedDetails.has(key))delete f[key];const type=o?f.order_type:'work';delete f.order_type;f.phone='+7'+phoneEl.value;f.work=s.n;f.original_amount=Number(f.original_amount||0);f.amount=f.original_amount;f.wall_over_3m=!!form.elements.wall_over_3m.checked;f.possible_extra_work=!!form.elements.possible_extra_work?.checked;f.city=master.options[master.selectedIndex]?.dataset?.city||o?.city||state.user?.city||'';f.scheduled_time=f.time_slot?f.time_slot.split('–')[0]:'';if(o)f.id=o.id;msg.textContent='Сохраняем…';setBusy(form,true);try{const d=await api(o?'updateOrder':'createOrder',f);if(!d.ok)throw new Error(d.error);const meta=o?await saveOrderType(d.order.id,type):{};const merged={...f,...d.order,...meta,order_type:type};if(o){const i=state.orders.findIndex(x=>String(x.id)===String(o.id));state.orders[i]=merged}else{const i=state.orders.findIndex(x=>String(x.id)===String(merged.id));if(i>=0)state.orders[i]=merged;else state.orders.unshift(merged)};state.busy=false;closeModal();show('orders')}catch(err){msg.textContent=err.message;setBusy(form,false)}finally{state.busy=false}}
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
})();