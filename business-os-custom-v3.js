(()=>{
const SERVICES=[
{n:'Замер помещения. Выезд на объект, составление обмерного плана.',u:'выезд',p:1500},
{n:'Выезд за пределы города (в одну сторону за каждый км)',u:'км',p:70},
{n:'Минимальная стоимость выезда мастера',u:'',p:2800},
{n:'Повторный выезд по вине магазина',u:'выезд',p:1200},
{n:'Установка декоративного карниза длиной до 2,5 метров',u:'комплект',p:1699},
{n:'Установка декоративного карниза длиной до 3,5 метров',u:'комплект',p:2229},
{n:'Установка декоративного карниза длиной более 3,5 метров',u:'пог. м',p:999},
{n:'Установка горизонтальных жалюзи на створку окна',u:'комплект',p:1005},
{n:'Монтаж рулонной шторы / день-ночь на стену, потолок или в проём',u:'комплект',p:1340},
{n:'Установка рулонной шторы / день-ночь на створку окна',u:'комплект',p:1199},
{n:'Монтаж римской шторы на стену / потолок',u:'комплект',p:1290},
{n:'Монтаж вертикальных жалюзи на стену / потолок',u:'п.м.',p:1270},
{n:'Монтаж горизонтальных жалюзи на стену / потолок',u:'',p:null},
{n:'Монтаж шторы плиссе',u:'комплект',p:1199},
{n:'Установка декоративного крючка / подхвата',u:'шт',p:180},
{n:'Установка бленды',u:'п.м.',p:300},
{n:'Демонтаж декоративного крючка или подхвата',u:'шт',p:80},
{n:'Демонтаж карниза',u:'шт',p:400},
{n:'Демонтаж рулонных штор, римских штор и жалюзи всех видов',u:'шт',p:250},
{n:'Подрезка карниза по длине',u:'пил.',p:200},
{n:'Эркерное соединение карниза',u:'шт',p:250},
{n:'Монтаж направляющих для рулонной шторы',u:'комплект',p:580},
{n:'Монтаж дополнительной точки крепления декоративного карниза',u:'шт',p:380},
{n:'Доплата за работы на высоте более 3 метров',u:'п.м.',p:550},
{n:'Подрезка гладкой светопроницаемой рулонной шторы',u:'шт.',p:750},
{n:'Подрезка рулонной шторы Блэкаут',u:'шт.',p:750},
{n:'Подрезка рулонной шторы день-ночь',u:'шт.',p:750},
{n:'Установка магнита для нижней фиксации рулонной шторы / жалюзи',u:'точка',p:200},
{n:'Подрезка ламелей вертикальных жалюзи',u:'шт.',p:50},
{n:'Монтаж ламелей',u:'шт.',p:150},
{n:'Монтаж декоративного короба рулонной шторы',u:'шт.',p:550},
{n:'Подрезка декоративного короба рулонной шторы',u:'пил.',p:440},
{n:'Монтаж внешнего угла-поворота для карниза',u:'шт.',p:380},
{n:'Средство подмащивания для высоты от 3 метров',u:'шт.',p:830}
];
const WALLS=['Не указан','Бетон','Кирпич','Газобетон','Гипсокартон','Дерево','Плитка','Металл','Другое'];
const SLOTS=Array.from({length:11},(_,i)=>{const h=10+i;return `${String(h).padStart(2,'0')}:00–${String(h+1).padStart(2,'0')}:00`});
const mid=m=>String(m?.vk_user_id||m?.external_id||m?.id||'');
const serviceOptions=(selected='')=>'<option value="">Выберите услугу</option>'+SERVICES.map((s,i)=>`<option value="${i}" ${s.n===selected?'selected':''}>${esc(s.n)}${s.p!=null?' — '+money(s.p):''}</option>`).join('');
const masterOptions=(selected='')=>'<option value="">Назначить позже</option>'+state.masters.map(m=>`<option value="${esc(mid(m))}" data-city="${esc(m.city||'')}" ${String(selected)===mid(m)?'selected':''}>${esc(m.full_name||'Мастер')}${m.city?' — '+esc(m.city):''}</option>`).join('');
const slotOptions=(selected='')=>'<option value="">Выберите время</option>'+SLOTS.map(s=>`<option ${selected===s?'selected':''}>${s}</option>`).join('');
function phoneDigits(v){let d=String(v||'').replace(/\D/g,'');if(d[0]==='7'||d[0]==='8')d=d.slice(1);return d.slice(0,10)}
function authHeaders(){return window.BOS_AUTH_HEADERS?window.BOS_AUTH_HEADERS():Promise.resolve({'Content-Type':'application/json'})}
async function saveOrderType(id,type){const headers=await authHeaders();const r=await fetch('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/order-meta-api',{method:'POST',headers,body:JSON.stringify({action:'setOrderType',id,order_type:type})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось сохранить тип заявки');return d.order}
window.openOrderForm=function(id){
 const o=id?state.orders.find(x=>String(x.id)===String(id)):null;
 const selService=Math.max(0,SERVICES.findIndex(s=>s.n===o?.work));
 const chosen=o?.work&&selService>=0?String(selService):'';
 const phone=phoneDigits(o?.phone);
 const slot=o?.time_slot||((o?.scheduled_time||'').slice(0,5)?`${(o.scheduled_time||'').slice(0,5)}–${String(Number((o.scheduled_time||'').slice(0,2))+1).padStart(2,'0')}:00`:'');
 openModal(`<h2>${o?'Редактировать заявку':'Новая заявка'}</h2><form id="orderForm" class="form">
 <label>ФИО клиента</label><input name="client" required value="${esc(o?.client||'')}" placeholder="Иван Иванов">
 <label>Номер телефона</label><div class="two" style="grid-template-columns:70px 1fr"><input value="+7" disabled><input id="bosPhone" inputmode="numeric" maxlength="10" value="${esc(phone)}" placeholder="9991234567" required></div>
 <label>Мастер</label><select name="master_vk_id">${masterOptions(o?.master_vk_id||'')}</select>
 <label>Адрес</label><input name="address" required value="${esc(o?.address||'')}" placeholder="Улица, дом, квартира">
 <label>Тип заявки</label><select name="order_type"><option value="work" ${(o?.order_type||'work')==='work'?'selected':''}>Обычная заявка</option><option value="measurement" ${o?.order_type==='measurement'?'selected':''}>Замер</option></select>
 <label>Работа</label><select id="bosService" required>${serviceOptions(o?.work||'')}</select><div id="bosServiceInfo" class="muted"></div>
 <label>Дата и время</label><div class="two"><input type="date" name="scheduled_date" value="${esc(o?.scheduled_date||'')}"><select name="time_slot">${slotOptions(slot)}</select></div>
 <label>Статус заявки</label><select name="status">${STATUSES.map(s=>`<option ${String(o?.status||'В работе')===s?'selected':''}>${s}</option>`).join('')}</select>
 <section class="card"><h3 style="margin-top:0">Условия на объекте</h3><label class="checkRow"><input type="checkbox" name="wall_over_3m" ${o?.wall_over_3m?'checked':''}><span>Высота более 3 метров</span></label><label>Материал стены</label><select name="wall_material">${WALLS.map(w=>`<option value="${w==='Не указан'?'':esc(w)}" ${(o?.wall_material||'')===(w==='Не указан'?'':w)?'selected':''}>${esc(w)}</option>`).join('')}</select></section>
 <label>Исходная сумма</label><input type="number" name="original_amount" min="0" step="1" value="${esc(o?.original_amount??o?.amount??'')}" placeholder="2800">
 <div class="card"><div class="row"><span>Расчёт мастера</span><b id="bosMasterPay">${money(o?.master_vk_id?(o?.master_payout||payout(o?.amount||o?.original_amount)):0)}</b></div></div>
 <label>Комментарий</label><textarea name="comment" placeholder="Комментарий к заявке">${esc(o?.comment||'')}</textarea>
 <button class="primary wide" type="submit">Сохранить</button><p id="formMsg" class="muted"></p></form>`);
 const form=$('#orderForm'),service=$('#bosService'),phoneEl=$('#bosPhone'),amount=form.elements.original_amount,master=form.elements.master_vk_id,info=$('#bosServiceInfo');
 phoneEl.oninput=()=>phoneEl.value=phoneEl.value.replace(/\D/g,'').slice(0,10);
 const showService=()=>{const s=SERVICES[Number(service.value)];info.textContent=s?`${s.u||'Цена за услугу'}${s.p!=null?' · '+money(s.p):' · цена не указана в прайсе'}`:'';if(s&&s.p!=null&&!amount.value)amount.value=s.p;recalc()};
 const recalc=()=>{$('#bosMasterPay').textContent=money(master.value?payout(Number(amount.value||0)):0)};
 service.onchange=()=>{const s=SERVICES[Number(service.value)];if(s&&s.p!=null)amount.value=s.p;showService()};amount.oninput=recalc;master.onchange=()=>recalc();showService();
 form.onsubmit=async e=>{e.preventDefault();if(state.busy)return;const msg=$('#formMsg'),s=SERVICES[Number(service.value)];if(!s){msg.textContent='Выберите работу из списка';return}if(phoneEl.value.length!==10){msg.textContent='Введите 10 цифр телефона после +7';return}const f=Object.fromEntries(new FormData(form));const type=f.order_type;delete f.order_type;f.phone='+7'+phoneEl.value;f.work=s.n;f.original_amount=Number(f.original_amount||0);f.amount=f.original_amount;f.wall_over_3m=!!form.elements.wall_over_3m.checked;f.possible_extra_work=false;f.city=master.options[master.selectedIndex]?.dataset?.city||o?.city||state.user?.city||'';f.scheduled_time=f.time_slot?f.time_slot.split('–')[0]:'';if(o)f.id=o.id;msg.textContent='Сохраняем…';setBusy(form,true);try{const d=await api(o?'updateOrder':'createOrder',f);if(!d.ok)throw new Error(d.error);const meta=await saveOrderType(d.order.id,type);const merged={...d.order,...meta,...f,order_type:type};if(o){const i=state.orders.findIndex(x=>String(x.id)===String(o.id));state.orders[i]=merged}else state.orders.unshift(merged);state.busy=false;closeModal();show('orders')}catch(err){msg.textContent=err.message;setBusy(form,false)}finally{state.busy=false}}
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