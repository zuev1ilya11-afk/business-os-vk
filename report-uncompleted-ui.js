(()=>{
'use strict';
const D=window.BOS_REPORT_DEDUCTION;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numeric=value=>String(value).trim()===''?NaN:Number(String(value).replace(',','.'));
window.BOS_INIT_REPORT_DEDUCTION=function(form,order){
  const box=form.querySelector('#mrUnfinishedBox');
  let rows=Array.isArray(order.uncompleted_work_items)?order.uncompleted_work_items.map(r=>({...r})):[];
  const visibleCost=window.BOS_ORDER_PAYROLL.isDirect(order)&&order.original_amount!=null;
  const base=visibleCost?Number(order.original_amount):null;
  box.innerHTML='<input id="mrUnfinishedDesc" type="hidden"><input id="mrUnfinishedAmount" type="hidden" value="0"><div id="mrDeductionSummary"></div><button type="button" class="secondary" id="mrEditDeduction">Что не было сделано</button>';
  box.classList.add('reportDeductionSummary');
  const dialog=document.createElement('dialog');dialog.id='mrDeductionDialog';dialog.className='reportDeductionDialog';
  dialog.setAttribute('aria-labelledby','mrDeductionTitle');
  dialog.innerHTML=`<div class="deductionHeading"><div><div class="eyebrow">ОТЧЁТ ПО ЗАЯВКЕ</div><h2 id="mrDeductionTitle">Что не было сделано</h2></div><button type="button" class="secondary" id="mrCloseDeduction" aria-label="Вернуться к отчёту">×</button></div>
    <p class="muted">Выберите работы и укажите невыполненное количество. Допработы заполняются отдельно.</p>
    <button type="button" class="secondary wide" id="mrAddCatalog">+ Добавить из прайса</button>
    <section id="mrCatalogPicker" hidden><label for="mrCatalogSearch">Поиск услуги</label><input id="mrCatalogSearch" type="search" placeholder="Например, карниз или шторы" autocomplete="off"><div id="mrCatalogResults"></div></section>
    <div id="mrDeductionRows"></div><p id="mrDeductionEmpty" class="muted">Пока нет выбранных работ</p>
    <div class="deductionTotals" aria-live="polite"><div><span>Сумма вычета</span><b id="mrDeductionTotal"></b></div>${visibleCost?'<div><span>После вычета</span><b id="mrAfterDeduction"></b></div>':'<p class="muted">Полная стоимость заявки скрыта. Допустимый вычет проверяется при отправке отчёта.</p>'}</div>
    <label for="mrDeductionComment">Комментарий к невыполненным работам</label><textarea id="mrDeductionComment" maxlength="4000" placeholder="Почему работы не выполнены"></textarea>
    <p id="mrDeductionError" role="alert"></p><button type="button" class="primary wide" id="mrDeductionContinue">Продолжить</button>`;
  form.append(dialog);
  const $=id=>form.querySelector('#'+id);
  $('mrDeductionComment').value=order.uncompleted_work_description||'';
  const enabled=()=>form.querySelector('[name=mrAllDone]:checked')?.value==='false';
  const total=()=>D.round(rows.reduce((sum,r)=>sum+(Number.isFinite(r.unit_price*r.quantity)?D.round(r.unit_price*r.quantity):0),0));
  function update(){
    const sum=total();$('mrDeductionTotal').textContent=money(sum);
    if(visibleCost)$('mrAfterDeduction').textContent=money(base-sum);
    $('mrUnfinishedAmount').value=String(enabled()?sum:0);
    $('mrUnfinishedDesc').value=enabled()?$('mrDeductionComment').value.trim():'';
    $('mrDeductionSummary').textContent=rows.length?`${rows.length} поз. · Сумма вычета: ${money(sum)}`:'Выберите невыполненные работы';
    $('mrDeductionEmpty').hidden=rows.length>0;
  }
  function renderRows(){
    $('mrDeductionRows').innerHTML=rows.map((r,i)=>{
      const s=D.catalog.find(s=>s.id===r.service_id);
      return `<article class="deductionItem" data-index="${i}"><div class="deductionItemHead"><b>${escape(s?.name||r.name)}</b><button type="button" class="secondary" data-remove="${i}" aria-label="Удалить ${escape(s?.name||r.name)}">×</button></div><p class="muted">${escape(s?.unit?'Единица: '+s.unit:'Единица в прайсе не указана; количество целое')}${s?.note?' · '+escape(s.note):''}</p><div class="deductionItemFields"><label>Цена за единицу${s?.mode==='from'?' (от '+money(s.price)+')':''}${s?.mode==='fixed'?`<span class="deductionFixedPrice">${money(s.price)}</span>`:`<input type="text" inputmode="decimal" data-price="${i}" aria-label="Согласованная цена ${escape(s?.name)}" value="${Number.isFinite(r.unit_price)?r.unit_price:''}" placeholder="Согласованная цена">`}</label><label>Количество<input type="text" inputmode="${D.fractional(s?.unit)?'decimal':'numeric'}" data-qty="${i}" aria-label="Количество ${escape(s?.name)}" value="${escape(r.quantity)}"></label><div>Сумма позиции<strong data-row-total="${i}">${money(Number.isFinite(r.unit_price*r.quantity)?D.round(r.unit_price*r.quantity):0)}</strong></div></div>${s?.mode!=='fixed'?`<label class="deductionAgreement"><input type="checkbox" data-confirm="${i}" ${r.price_confirmed?'checked':''}><span>Цена и объём согласованы с клиентом / диспетчером</span></label>`:''}</article>`;
    }).join('');update();
  }
  function search(){
    const q=$('mrCatalogSearch').value.trim().toLocaleLowerCase('ru');
    const found=D.catalog.filter(s=>(s.name+' '+s.group).toLocaleLowerCase('ru').includes(q));
    $('mrCatalogResults').innerHTML=found.length?found.map(s=>`<button type="button" class="secondary deductionCatalogItem" data-service="${s.id}" ${rows.some(r=>r.service_id===s.id)?'disabled':''}><span><b>${escape(s.name)}</b><small>${escape(s.group)}${s.unit?' · '+escape(s.unit):''}</small></span><strong>${s.mode==='fixed'?money(s.price):s.mode==='from'?'от '+money(s.price):'По согласованию'}</strong></button>`).join(''):'<p class="muted">Работы не найдены</p>';
  }
  function payload(){
    if(!enabled())return {uncompleted_work_done:false,uncompleted_work_items:[],uncompleted_work_amount:0,uncompleted_work_description:''};
    const items=D.items(rows.map(r=>({service_id:r.service_id,quantity:r.quantity,unit_price:r.unit_price,price_confirmed:r.price_confirmed})));
    const sum=D.round(items.reduce((v,r)=>v+r.amount,0));
    if(visibleCost&&sum>base)throw new Error('Сумма вычета превышает исходную сумму заявки');
    return {uncompleted_work_done:true,uncompleted_work_items:items,uncompleted_work_amount:sum,uncompleted_work_description:$('mrDeductionComment').value.trim()};
  }
  function open(){if(!dialog.open)dialog.showModal();$('mrDeductionError').textContent='';update();}
  form.bosDeductionPayload=payload;
  form.querySelectorAll('[name=mrAllDone]').forEach(input=>input.addEventListener('change',()=>{update();if(enabled())open();else if(dialog.open)dialog.close();}));
  $('mrEditDeduction').onclick=open;$('mrCloseDeduction').onclick=()=>dialog.close();
  $('mrAddCatalog').onclick=()=>{$('mrCatalogPicker').hidden=!$('mrCatalogPicker').hidden;if(!$('mrCatalogPicker').hidden){search();$('mrCatalogSearch').focus();}};
  $('mrCatalogSearch').oninput=search;
  $('mrCatalogResults').onclick=e=>{const button=e.target.closest('[data-service]');if(!button)return;const s=D.catalog.find(s=>s.id===button.dataset.service);if(rows.some(r=>r.service_id===s.id))return;rows.push({service_id:s.id,quantity:1,unit_price:s.mode==='fixed'?s.price:NaN,price_confirmed:false});renderRows();search();$('mrCatalogPicker').hidden=true;};
  $('mrDeductionRows').onclick=e=>{const button=e.target.closest('[data-remove]');if(!button)return;rows.splice(Number(button.dataset.remove),1);renderRows();};
  $('mrDeductionRows').oninput=e=>{
    const t=e.target;
    if(t.dataset.qty!=null)rows[Number(t.dataset.qty)].quantity=numeric(t.value);
    if(t.dataset.price!=null){rows[Number(t.dataset.price)].unit_price=numeric(t.value);rows[Number(t.dataset.price)].price_confirmed=false;const check=$('mrDeductionRows').querySelector(`[data-confirm="${t.dataset.price}"]`);if(check)check.checked=false;}
    if(t.dataset.confirm!=null)rows[Number(t.dataset.confirm)].price_confirmed=t.checked;
    rows.forEach((r,i)=>{const el=$('mrDeductionRows').querySelector(`[data-row-total="${i}"]`);if(el)el.textContent=money(Number.isFinite(r.quantity*r.unit_price)?D.round(r.quantity*r.unit_price):0);});update();
  };
  $('mrDeductionComment').oninput=update;
  $('mrDeductionContinue').onclick=()=>{try{payload();update();dialog.close();$('mrEditDeduction').focus();}catch(e){$('mrDeductionError').textContent=e.message;}};
  dialog.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.type!=='checkbox'){e.preventDefault();}});
  renderRows();
};
const style=document.createElement('style');style.textContent=`
.reportFixedV27 .reportOutcome .reportChoices{flex-wrap:wrap;max-width:100%;width:auto;gap:6px}.reportFixedV27 .reportOutcome .reportChoice{flex:1 0 130px}.reportFixedV27 .reportOutcome .reportChoice span{white-space:nowrap;word-break:normal;overflow-wrap:normal;min-width:130px;max-width:none;box-sizing:border-box}#mrUnfinishedBox.reportDeductionSummary{grid-template-columns:1fr}.reportDeductionDialog{box-sizing:border-box;width:min(660px,calc(100vw - 24px));max-height:calc(100dvh - 24px);margin:auto;padding:20px;border:1px solid #34455c;border-radius:20px;color:#ecf2fc;background:#111c2c;overflow:auto;overscroll-behavior:contain}.reportDeductionDialog::backdrop{background:rgba(0,0,0,.7)}.reportDeductionDialog [hidden]{display:none!important}.reportDeductionDialog input,.reportDeductionDialog textarea{box-sizing:border-box;width:100%;min-width:0;font-size:16px}.reportDeductionDialog button{min-height:44px;white-space:normal}.deductionHeading,.deductionItemHead{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.deductionHeading h2{margin:5px 0;font-size:23px}.deductionHeading button,.deductionItemHead button{flex:0 0 44px;padding:5px}.deductionItem{margin:12px 0;padding:14px;border:1px solid #34455c;border-radius:14px;overflow-wrap:anywhere}.deductionItem p{font-size:12px;margin:6px 0 12px}.deductionItemFields{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr) minmax(0,1fr);gap:10px;font-size:12px}.deductionItemFields label{display:grid;gap:6px;align-content:start}.deductionItemFields strong,.deductionFixedPrice{display:block;margin-top:8px;font-size:16px}.deductionAgreement{display:flex;gap:8px;align-items:center;margin-top:12px;font-size:13px}.deductionAgreement input{width:20px;min-height:20px;flex:0 0 20px}.deductionTotals{padding:14px;border-radius:12px;background:#1a2c43;margin:16px 0}.deductionTotals>div{display:flex;justify-content:space-between;gap:8px;padding:6px 0}.deductionCatalogItem{display:flex;width:100%;gap:8px;justify-content:space-between;text-align:left;margin:6px 0;padding:10px}.deductionCatalogItem span{min-width:0;overflow-wrap:anywhere}.deductionCatalogItem strong{flex:0 0 95px;text-align:right}.deductionCatalogItem small{display:block;margin-top:4px;color:#a7b7ce}#mrCatalogPicker{margin:12px 0}#mrCatalogResults{max-height:240px;overflow:auto}#mrDeductionError{color:#ffb0a8}#mrDeductionComment{margin-top:6px;min-height:80px}@media(max-width:560px){.reportFixedV27 .reportOutcome{display:flex;flex-direction:column;align-items:stretch}.reportFixedV27 .reportOutcome .reportChoices{width:100%;min-width:0}}@media(max-width:390px){.reportDeductionDialog{padding:12px}.deductionHeading h2{font-size:20px}.deductionItem{padding:10px}.deductionItemFields{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.deductionItemFields>div{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center}.deductionItemFields strong{margin-top:0}.deductionCatalogItem strong{flex-basis:75px}.deductionTotals{padding:10px;font-size:14px}}`;
document.head.append(style);
})();
