(()=>{
'use strict';
const managementRoles=new Set(['owner','manager','dispatcher']);
const previousOpenOrder=window.openOrder;
const pick=(o,...keys)=>{for(const k of keys){const v=o?.[k];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v}return ''};
const line=(label,value)=>value?`<div class="bosOrderFact"><small>${esc(label)}</small><b>${esc(value)}</b></div>`:'';
window.openOrder=function(id){
  const role=String(state?.user?.role||'');
  if(!managementRoles.has(role)&&typeof previousOpenOrder==='function')return previousOpenOrder(id);
  const o=state.orders.find(x=>String(x.id)===String(id));if(!o)return;
  const source=pick(o,'store','shop','store_name','shop_name','source');
  const work=pick(o,'work','works','work_description','service');
  const conditions=pick(o,'conditions','work_conditions','terms','comment');
  const date=pick(o,'scheduled_date','date');
  const time=pick(o,'scheduled_time','time');
  const client=pick(o,'client','client_name');
  const phone=pick(o,'phone','client_phone');
  const address=pick(o,'address');
  const pay=o.master_vk_id?(o.master_payout||payout(o.amount)):0;
  openModal(`<style>
    .bosOrderHead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 12px}.bosOrderHead h2{margin:0;font-size:22px}.bosOrderFacts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.bosOrderFact{min-width:0;padding:9px 10px;border:1px solid rgba(127,127,127,.18);border-radius:12px}.bosOrderFact small{display:block;opacity:.65;font-size:11px;margin-bottom:2px}.bosOrderFact b{display:block;font-size:13px;line-height:1.25;overflow-wrap:anywhere}.bosOrderBlock{margin:10px 0;padding:10px 12px;border:1px solid rgba(127,127,127,.18);border-radius:12px}.bosOrderBlock>small{display:block;opacity:.65;font-size:11px;margin-bottom:4px}.bosOrderBlock p{margin:3px 0;line-height:1.3}.bosOrderFinance{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.bosOrderMoney{padding:10px 12px;border-radius:12px;background:rgba(127,127,127,.08)}.bosOrderMoney small{display:block;opacity:.65;font-size:11px}.bosOrderMoney b{font-size:17px}.bosOrderControls{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.bosOrderControls label{font-size:11px;opacity:.65}.bosOrderControls select{width:100%;margin-top:4px}.bosOrderActions{margin-top:10px}@media(max-width:430px){.bosOrderFacts,.bosOrderControls{grid-template-columns:1fr 1fr}.bosOrderFact{padding:8px}.bosOrderHead h2{font-size:20px}}
  </style>
  <div class="bosOrderHead"><h2>Заявка №${esc(o.id)}</h2><span class="status info">${esc(o.status||'В работе')}</span></div>
  <div class="bosOrderFacts">
    ${line('Магазин',source||'—')}
    ${line('Дата и время',[date,time].filter(Boolean).join(' · ')||'—')}
    ${line('Клиент',[client,phone].filter(Boolean).join(' · ')||'—')}
    ${line('Адрес',address||'—')}
  </div>
  <div class="bosOrderBlock"><small>Работы</small><p><b>${esc(work||'Не указаны')}</b></p>${conditions&&conditions!==work?`<p class="muted">${esc(conditions)}</p>`:''}</div>
  <div class="bosOrderControls"><div><label for="quickStatus">Статус</label><select id="quickStatus">${STATUSES.map(s=>`<option ${o.status===s?'selected':''}>${s}</option>`).join('')}</select></div><div><label for="quickMaster">Мастер</label><select id="quickMaster"><option value="">Не назначен</option>${state.masters.map(m=>`<option value="${esc(m.vk_user_id)}" ${String(o.master_vk_id||'')===String(m.vk_user_id)?'selected':''}>${esc(m.full_name)}</option>`).join('')}</select></div></div>
  <div class="bosOrderFinance"><div class="bosOrderMoney"><small>Сумма</small><b>${money(o.amount)}</b></div><div class="bosOrderMoney"><small>Мастеру</small><b id="payoutPreview">${money(pay)}</b></div></div>
  <div class="two bosOrderActions"><button class="primary" onclick="saveQuickOrder('${esc(o.id)}')">Сохранить</button><button class="secondary" onclick="openOrderForm('${esc(o.id)}')">Редактировать</button></div><p id="quickMsg" class="muted"></p>`);
  const master=document.querySelector('#quickMaster');
  if(master)master.addEventListener('change',()=>{const out=document.querySelector('#payoutPreview');if(out)out.textContent=money(master.value?(o.master_payout||payout(o.amount)):0)});
};
})();
