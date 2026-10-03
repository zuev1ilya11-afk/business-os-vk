(()=>{
'use strict';
const managementRoles=new Set(['owner','manager','dispatcher']);
const previousOpenOrder=window.openOrder;
const previousSaveQuickOrder=window.saveQuickOrder;
const masterContext=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&!!isMasterPreview())||(typeof liveMasterMode==='function'&&!!liveMasterMode());
const pick=(o,...keys)=>{for(const k of keys){const v=o?.[k];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v}return ''};
const displayNo=o=>{const ext=String(o?.external_id||'');return ext.startsWith('hands:')?ext.slice(6):String(o?.id||'')};
const dateTime=o=>{const d=String(o?.scheduled_date||o?.date||'').slice(0,10);const t=String(o?.scheduled_time||o?.time||o?.time_slot||'').slice(0,5);return [d||'Дата не назначена',t||'Время не назначено'].join(' · ')};
const received=o=>{const raw=String(o?.created_at||'').slice(0,10),m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}.${m[2]}.${m[1]}`:'—'};
const unit=u=>({PIECE:'шт.',PCS:'шт.',FIX:'шт.',METER:'м',METERS:'м',KM:'км'}[String(u||'').toUpperCase()]||String(u||''));
const works=o=>String(o?.work||o?.works||o?.work_description||o?.service||'Работа не указана').split(/\n+/).map(x=>x.trim()).filter(Boolean);
function parseWork(x){const clean=String(x||'').trim();const m=clean.match(/^(.*?)\s*[×x]\s*([\d.,]+)\s*(.*?)\s*$/i);if(!m)return{title:clean,qty:''};return{title:m[1].trim(),qty:`${m[2]}${m[3]?' '+unit(m[3]):''}`}}
const workRow=x=>{const w=parseWork(x);return `<div class="bosHandsWorkRow"><span>${esc(w.title)}</span>${w.qty?`<b>${esc(w.qty)}</b>`:''}</div>`};
const workCount=n=>n%10===1&&n%100!==11?'работа':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'работы':'работ';
const workRows=o=>{const all=works(o);return all.slice(0,2).map(workRow).join('')+(all.length>2?`<details class="bosMoreWorks"><summary><span class="bosExpand">Ещё ${all.length-2} ${workCount(all.length-2)}</span><span class="bosCollapse">Свернуть работы</span></summary>${all.slice(2).map(workRow).join('')}</details>`:'')};
const handsOrder=o=>String(o?.external_source||o?.source||'').trim().toLowerCase()==='hands'||String(o?.external_id||'').toLowerCase().startsWith('hands:');
const visibleComment=o=>{
  const raw=String(o?.comment||'').trim();if(!handsOrder(o))return raw;
  const manual=!!o?.hands_detail_overrides?.comment,source=o?.hands_comment_source;
  if(!manual&&source&&Object.prototype.hasOwnProperty.call(source,'comment'))return String(source.comment||'').trim();
  return raw.split(/\n+/).map(x=>x.trim()).filter(x=>x&&!/^(?:Как добраться|Магазин|Оплата)\s*:/iu.test(x)).join('\n').trim();
};
const commentHtml=o=>{const text=visibleComment(o);if(!text)return'';const long=text.length>180||text.split('\n').length>3;return `<section class="bosOrderComment"><b>Комментарий</b>${long?`<details><summary><span class="bosCommentPreview">${esc(text.slice(0,180))}…</span><span class="bosExpand">Показать полностью</span><span class="bosCollapse">Свернуть комментарий</span></summary><p>${esc(text)}</p></details>`:`<p>${esc(text)}</p>`}</section>`};
const routeAddress=o=>{const address=String(o?.address||'').trim();if(!address)return'';const city=String(o?.city||'').trim();return city&&!address.toLowerCase().includes(city.toLowerCase())?`${city}, ${address}`:address};
const addressHtml=o=>{const address=String(o?.address||'').trim();if(!address)return'<b>Адрес не указан</b>';const href=`https://yandex.ru/maps/?text=${encodeURIComponent(routeAddress(o))}`;return `<b><a class="bosHandsAddressLink" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(address)}</a></b>`};
const apartmentHtml=o=>{const flat=String(o?.apartment||'').trim().replace(/^(?:квартира|кв\.?)\s*/iu,'');const bits=[flat?'кв. '+flat:'',o?.floor?'этаж '+o.floor:'',o?.entrance?'подъезд '+o.entrance:''].filter(Boolean);return bits.length?`<div class="bosApartment">${bits.map(esc).join(' · ')}</div>`:''};
const phoneHtml=o=>{const label=String(o?.phone||o?.client_phone||'').trim(),phone=label.replace(/[^+0-9]/g,'');return phone?`<div class="bosCompactPhone"><a class="masterV126Phone" href="tel:${esc(phone)}">${esc(label)}</a><a class="secondary bosClientCallAction" href="tel:${esc(phone)}" aria-label="Позвонить клиенту">Позвонить</a></div>`:'<small>Телефон не указан</small>'};
const sourceLabel=o=>String(pick(o,'external_source','source','store','shop','store_name','shop_name')||'').trim();
window.openOrder=function(id){
  const role=String(state?.user?.role||'');
  if(masterContext()||!managementRoles.has(role))return typeof previousOpenOrder==='function'?previousOpenOrder.apply(this,arguments):undefined;
  const o=(state.orders||[]).find(x=>String(x.id)===String(id));if(!o)return;
  const date=String(pick(o,'scheduled_date','date')||'').slice(0,10);
  const time=String(pick(o,'scheduled_time','time','time_slot')||'').slice(0,5);
  const client=pick(o,'client','client_name')||'Клиент не указан';
  const source=sourceLabel(o);
  const pay=o.master_vk_id?(window.BOS_ORDER_PAYROLL?.directMaster(o)??(o.master_payout||payout(o.amount))):0;
  openModal(`<div class="bosManageOrder">
    <div class="bosManageHead">
      <div class="bosManageTitle"><b>№ ${esc(displayNo(o))}</b><small>Поступила ${esc(received(o))}</small></div>
      <div class="bosManageMoney"><strong>Сумма: ${money(o.amount)}</strong><span>Мастеру: ${money(pay)}</span></div>
    </div>
    <div class="bosManageMeta"><span class="status info">${esc(o.status||'В работе')}</span>${source?`<span class="bosSourceChip">${esc(source)}</span>`:''}</div>
    <div class="bosHandsBlock"><span class="bosHandsIcon">⌖</span><div>${addressHtml(o)}${apartmentHtml(o)}</div></div>
    <div class="bosHandsBlock"><span class="bosHandsIcon">◷</span><div>${esc(dateTime(o))}</div></div>
    <div class="bosHandsBlock"><span class="bosHandsIcon">◉</span><div><b>${esc(client)}</b>${phoneHtml(o)}<div data-bos-contact-order="${esc(o.id)}">${window.BOS_CONTACT_STATUS?.html(o,{details:true})||''}</div></div></div>
    ${commentHtml(o)}
    <section class="bosHandsWorks"><b class="bosWorksLabel">Состав работ</b><div class="bosHandsWorkList">${workRows(o)}</div></section>
    <section class="bosManagementQuickEdit" aria-label="Быстрое редактирование">
      <div class="bosQuickEditLabel">Быстрое редактирование</div>
      <div class="bosOrderControls"><div><label for="quickScheduledDate">Дата заявки</label><input id="quickScheduledDate" type="date" value="${esc(date)}"></div><div><label for="quickScheduledTime">Время</label><input id="quickScheduledTime" type="time" value="${esc(time)}"></div></div>
      <div class="bosOrderControls"><div><label for="quickStatus">Статус</label><select id="quickStatus">${STATUSES.map(s=>`<option ${o.status===s?'selected':''}>${s}</option>`).join('')}</select></div><div><label for="quickMaster">Мастер</label><select id="quickMaster"><option value="">Не назначен</option>${state.masters.map(m=>`<option value="${esc(m.vk_user_id)}" ${String(o.master_vk_id||'')===String(m.vk_user_id)?'selected':''}>${esc(m.full_name)}</option>`).join('')}</select></div></div>
      <div class="bosOrderFinance"><div class="bosOrderMoney"><small>Сумма</small><b>${money(o.amount)}</b></div><div class="bosOrderMoney"><small>Мастеру</small><b id="payoutPreview">${money(pay)}</b></div></div>
      ${window.BOS_ORDER_PAYROLL?.isDirect(o)?`<div class="bosOrderMoney bosCompanyPool" data-payroll-company><small>${esc(window.BOS_ORDER_PAYROLL.label(o))} · Компании из основной суммы</small><b>${money(window.BOS_ORDER_PAYROLL.directCompany(o))}</b><p class="muted">Допработы учитываются отдельно. Это доля компании, не чистая прибыль.</p></div>`:''}
      <button class="primary wide" type="button" onclick="saveQuickOrder('${esc(o.id)}')">Сохранить</button>
    </section>
    <button class="secondary wide bosManageFullEdit" type="button" onclick="openOrderForm('${esc(o.id)}')">Редактировать заявку</button>
    <p id="quickMsg" class="muted"></p>
  </div>`);
  const modal=document.querySelector('#modalRoot .modal');modal?.classList.add('bosManageOrderModal');
  const close=modal?.querySelector('.modalClose');if(close){close.setAttribute('aria-label','Закрыть заявку');modal.querySelector('.bosManageHead')?.appendChild(close)}
  const master=document.querySelector('#quickMaster');
  if(master)master.addEventListener('change',()=>{const out=document.querySelector('#payoutPreview');if(out)out.textContent=money(master.value?(window.BOS_ORDER_PAYROLL?.directMaster(o)??(o.master_payout||payout(o.amount))):0)});
  window.BOS_HANDS_RENDER_ORDER?.(id);
  window.BOS_OPS_CONTACT_STATUS?.refresh?.();
};
window.saveQuickOrder=async function(id){
  const dateInput=document.querySelector('#quickScheduledDate');
  const timeInput=document.querySelector('#quickScheduledTime');
  if(!dateInput&&!timeInput)return typeof previousSaveQuickOrder==='function'?previousSaveQuickOrder.apply(this,arguments):undefined;
  const o=(state.orders||[]).find(x=>String(x.id)===String(id));
  const msg=document.querySelector('#quickMsg');
  if(!o||state.busy)return;
  state.busy=true;
  if(msg)msg.textContent='Сохраняем…';
  try{
    const status=document.querySelector('#quickStatus');
    const master=document.querySelector('#quickMaster');
    const d=await api('updateOrder',{
      id,
      status:status?status.value:o.status,
      master_vk_id:master?master.value:(o.master_vk_id||''),
      scheduled_date:dateInput?dateInput.value:'',
      scheduled_time:timeInput?timeInput.value:''
    });
    if(!d.ok)throw new Error(d.error);
    const i=(state.orders||[]).findIndex(x=>String(x.id)===String(id));
    if(i>=0)state.orders[i]={...state.orders[i],...d.order,scheduled_date:dateInput?dateInput.value:'',scheduled_time:timeInput?timeInput.value:''};
    closeModal();
    show(state.page);
  }catch(e){if(msg)msg.textContent=e?.message||'Не удалось сохранить дату и время'}finally{state.busy=false}
};
const style=document.createElement('style');style.textContent=`
.modal.bosManageOrderModal{padding:16px!important;max-width:620px!important;overflow-x:hidden!important}
.bosManageOrder{font-size:14px;line-height:1.45;min-width:0}
.bosManageHead{display:grid;grid-template-columns:minmax(0,1fr) auto 44px;gap:10px;align-items:center;padding:0 0 10px;margin:0}
.bosManageTitle{display:flex;align-items:baseline;gap:10px;min-width:0;flex-wrap:wrap}.bosManageTitle>b{font-size:19px;overflow-wrap:anywhere}.bosManageTitle small{font-size:12px;color:var(--muted,#91a3b7);white-space:nowrap}
.bosManageMoney{text-align:right;display:grid;gap:2px;min-width:0}.bosManageMoney strong{font-size:14px}.bosManageMoney span{font-size:12px;color:var(--muted,#91a3b7)}
.bosManageOrderModal .bosManageHead .modalClose{position:static!important;float:none!important;margin:0!important;width:44px;height:44px;min-width:44px;min-height:44px;font-size:26px;padding:0}
.bosManageMeta{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:0 0 4px}.bosManageMeta .status,.bosManageMeta .bosSourceChip{display:inline-flex;width:auto;margin:0}
.bosManageOrder .bosHandsBlock{padding:10px 0;gap:10px;font-size:14px}.bosManageOrder .bosHandsBlock b{font-size:15px;line-height:1.4}.bosManageOrder .bosApartment{color:var(--muted,#91a3b7);font-size:13px;margin-top:4px}
.bosManageOrder .bosHandsWorks{padding:0;margin:0}.bosManageOrder .bosHandsWorkRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:8px 0;font-size:14px;line-height:1.45}.bosManageOrder .bosHandsWorkRow span{overflow-wrap:anywhere}.bosManageOrder .bosHandsWorkRow b{font-size:14px;white-space:nowrap;color:var(--muted,#91a3b7)}
.bosManageOrder summary{cursor:pointer;min-height:44px;box-sizing:border-box;padding:10px 0;color:#7eb9ff;font-size:14px}.bosManageOrder .bosCollapse{display:none}.bosManageOrder details[open]>summary .bosExpand{display:none}.bosManageOrder details[open]>summary .bosCollapse{display:inline}
.bosManagementQuickEdit{margin-top:10px;border-top:1px solid rgba(255,255,255,.08);padding-top:10px}.bosQuickEditLabel{font-size:12px;color:var(--muted,#91a3b7);margin:0 0 6px}.bosManagementQuickEdit>.bosOrderControls{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}.bosManagementQuickEdit label{display:block;font-size:11px;color:var(--muted,#91a3b7)}.bosManagementQuickEdit select,.bosManagementQuickEdit input{width:100%;min-height:44px;margin-top:4px;box-sizing:border-box}.bosManagementQuickEdit .bosOrderFinance{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}.bosManagementQuickEdit .bosOrderMoney{padding:10px 12px;border-radius:12px;background:rgba(127,127,127,.08)}.bosManagementQuickEdit .bosOrderMoney small{display:block;color:var(--muted,#91a3b7);font-size:11px}.bosManagementQuickEdit .bosOrderMoney b{font-size:16px}.bosManagementQuickEdit .bosCompanyPool{margin:8px 0}.bosManagementQuickEdit .bosCompanyPool p{margin:4px 0 0;font-size:11px}
.bosManageFullEdit{margin-top:10px}.bosManageOrder #quickMsg:empty{display:none}
@media(max-width:520px){.bosManagementQuickEdit>.bosOrderControls{grid-template-columns:1fr}}
@media(max-width:430px){.modal.bosManageOrderModal{padding:12px!important}.bosManageHead{grid-template-columns:minmax(0,1fr) 44px}.bosManageMoney{grid-column:1/-1;grid-row:2;text-align:left;display:flex;gap:10px;align-items:baseline}.bosManageOrderModal .bosManageHead .modalClose{grid-column:2;grid-row:1}.bosManagementQuickEdit>.bosOrderControls{grid-template-columns:1fr}}
`;document.head.appendChild(style);
})();
