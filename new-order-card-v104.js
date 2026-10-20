(()=>{
'use strict';
const previousOpenOrderForm=window.openOrderForm;
if(typeof previousOpenOrderForm!=='function')return;

function makeSection(title,description){
  const section=document.createElement('section');
  section.className='newOrderSection';
  const head=document.createElement('div');
  head.className='newOrderSectionHead';
  head.innerHTML=`<h3>${title}</h3>${description?`<p>${description}</p>`:''}`;
  const body=document.createElement('div');
  body.className='newOrderGrid';
  section.append(head,body);
  return {section,body};
}

function directLabelFor(node){
  let prev=node?.previousElementSibling;
  return prev&&prev.tagName==='LABEL'&&prev.parentElement===node.parentElement?prev:null;
}

function field(control,label,wide=false){
  if(!control)return null;
  const oldLabel=directLabelFor(control);
  if(oldLabel)oldLabel.remove();
  const wrapper=document.createElement('label');
  wrapper.className='newOrderField'+(wide?' newOrderFieldWide':'');
  const caption=document.createElement('span');
  caption.className='newOrderFieldLabel';
  caption.textContent=label;
  wrapper.append(caption,control);
  return wrapper;
}

function groupedField(group,label,wide=false){
  if(!group)return null;
  const oldLabel=directLabelFor(group);
  if(oldLabel)oldLabel.remove();
  const wrapper=document.createElement('div');
  wrapper.className='newOrderField'+(wide?' newOrderFieldWide':'');
  const caption=document.createElement('span');
  caption.className='newOrderFieldLabel';
  caption.textContent=label;
  wrapper.append(caption,group);
  return wrapper;
}

function enhanceNewOrderForm(id){
  const form=document.getElementById('orderForm');
  if(!form||form.dataset.newOrderCard==='1')return;
  form.dataset.newOrderCard='1';form.classList.add('newOrderForm');
  const modal=form.closest('.modal');modal?.classList.add('newOrderModal');
  const title=modal?.querySelector('h2');
  if(title){title.classList.add('newOrderTitle');const sub=document.createElement('p');sub.className='newOrderSubtitle';sub.textContent='Укажите данные заявки, работы и исполнителя';title.after(sub)}
  const basic=makeSection('1. Основная информация',''),client=makeSection('2. Клиент',''),address=makeSection('3. Адрес',''),work=makeSection('4. Работы',''),extra=makeSection('5. Дополнительно','');
  const add=(section,control,label,wide=false,hintId='')=>{
    const node=field(control,label,wide);if(!node)return;
    if(hintId){const hint=form.querySelector('#'+hintId);if(hint)node.append(hint)}
    if(control.name){const error=document.createElement('small');error.className='newOrderError';error.dataset.errorFor=control.name;error.id='error-'+control.name;error.setAttribute('aria-live','polite');node.append(error);control.setAttribute('aria-describedby',[control.getAttribute('aria-describedby'),error.id].filter(Boolean).join(' '));control.addEventListener('input',()=>{error.textContent='';control.removeAttribute('aria-invalid')})}
    section.body.append(node);return node;
  };
  add(basic,form.elements.order_number,'Номер заявки',false,'orderNumberHint');
  // Keep ISO storage/calendar, but show DD.MM.YYYY independently of browser locale.
  const receipt=form.elements.received_date,receiptRow=document.createElement('div'),receiptText=document.createElement('input'),calendar=document.createElement('button');
  directLabelFor(receipt)?.remove();receiptRow.className='newOrderReceipt';
  receiptText.id='bosReceivedDisplay';receiptText.type='text';receiptText.inputMode='numeric';receiptText.placeholder='ДД.ММ.ГГГГ';receiptText.maxLength=10;receiptText.setAttribute('aria-label','Дата поступления');receiptText.setAttribute('aria-describedby','receivedDateHint error-received_date');
  const showDate=()=>{receiptText.value=receipt.value?receipt.value.split('-').reverse().join('.'):'';receiptText.setCustomValidity('');receiptText.removeAttribute('aria-invalid')};showDate();
  receipt.tabIndex=-1;receipt.setAttribute('aria-hidden','true');receipt.setAttribute('aria-label','Дата поступления — календарь');receipt.classList.add('newOrderNativeDate');
  calendar.type='button';calendar.className='secondary';calendar.setAttribute('aria-label','Открыть календарь даты поступления');calendar.innerHTML='<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-11 4h3m2 0h3m-8 3h3"/></svg>';
  calendar.addEventListener('click',()=>{try{if(receipt.showPicker){receipt.showPicker();return}}catch(_){}receipt.classList.add('newOrderNativeDateFallback');receipt.removeAttribute('aria-hidden');receipt.tabIndex=0;receipt.focus()});
  receiptRow.append(receiptText,calendar,receipt);const receiptField=groupedField(receiptRow,'Дата поступления');receiptField.append(form.querySelector('#receivedDateHint'));const dateError=document.createElement('small');dateError.id='error-received_date';dateError.className='newOrderError';dateError.dataset.errorFor='received_date';dateError.setAttribute('aria-live','polite');receiptField.append(dateError);basic.body.append(receiptField);
  receiptText.addEventListener('input',()=>{if(/^\d{8}$/.test(receiptText.value))receiptText.value=receiptText.value.slice(0,2)+'.'+receiptText.value.slice(2,4)+'.'+receiptText.value.slice(4);const value=receiptText.value.trim(),parts=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value),iso=parts?parts[3]+'-'+parts[2]+'-'+parts[1]:'';receipt.value=iso;const valid=!value||(!!iso&&receipt.value===iso&&receipt.validity.valid);receiptText.setCustomValidity(valid?'':'Введите существующую дату в формате ДД.ММ.ГГГГ');dateError.textContent=valid?'':'Введите существующую дату в формате ДД.ММ.ГГГГ';if(valid)receiptText.removeAttribute('aria-invalid');else receiptText.setAttribute('aria-invalid','true')});
  receipt.addEventListener('change',()=>{showDate();dateError.textContent=''});
  add(client,form.elements.client,'Имя клиента');
  const phone=form.querySelector('#bosPhone'),phoneGroup=phone?.closest('.bosPhoneEditor,.two');
  const phones=groupedField(phoneGroup,'Телефон');if(phones)client.body.append(phones);
  if(phone)phone.setAttribute('aria-label','Телефон');
  add(address,form.elements.address,'Улица, дом, корпус',true);
  for(const [name,label] of [['apartment','Квартира'],['entrance','Подъезд'],['floor','Этаж'],['intercom','Домофон']])add(address,form.elements[name],label);
  add(work,form.querySelector('#bosWorkDescription'),'Описание работ',false,'workDescriptionHint');
  const stack=form.querySelector('#bosWorkStack'),catalog=groupedField(stack,'Быстрые варианты');if(catalog){work.body.append(catalog);const info=form.querySelector('#bosServiceInfo');if(info)catalog.append(info)}
  add(extra,form.elements.source,'Источник заявки');add(extra,form.elements.master_vk_id,'Мастер');
  const plan=makeSection('Визит и условия','Дата визита не меняет дату поступления');
  add(plan,form.elements.scheduled_date,'Дата визита');add(plan,form.elements.time_slot,'Время визита');add(plan,form.elements.status,'Статус');add(plan,form.elements.order_type,'Тип заявки');
  const conditions=[...form.querySelectorAll(':scope > section.card')].find(section=>section.querySelector('[name="wall_material"]'));
  if(conditions){conditions.classList.add('newOrderConditions');plan.body.append(conditions)}
  extra.body.append(plan.section);plan.section.classList.add('newOrderFieldWide');
  const finance=makeSection('Стоимость','Если стоимость ещё не согласована, оставьте поле пустым');
  add(finance,form.elements.original_amount,'Сумма заявки, ₽');
  const totals=[...form.querySelectorAll(':scope > .card')].find(card=>card.querySelector('#bosMasterPay'));
  if(totals){totals.classList.add('newOrderTotals');finance.body.append(totals)}
  extra.body.append(finance.section);finance.section.classList.add('newOrderFieldWide');
  add(extra,form.elements.comment,'Комментарий',true);
  const submit=form.querySelector(':scope > button[type="submit"]'),msg=form.querySelector('#formMsg'),actions=document.createElement('div');actions.className='newOrderActions';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary newOrderCancel';cancel.textContent='Отмена';cancel.addEventListener('click',()=>closeModal());actions.append(cancel);
  if(submit){submit.textContent=id?'Сохранить изменения':'Создать заявку';actions.append(submit)}
  if(msg){msg.setAttribute('role','status');actions.append(msg)}
  form.prepend(basic.section,client.section,address.section,work.section,extra.section);form.append(actions);
  [...form.children].forEach(node=>{if(node.tagName==='LABEL'&&!node.querySelector('input,select,textarea'))node.remove();if(node.classList.contains('two')&&!node.children.length)node.remove()});
  // Existing editors and planning wrappers keep their control instances/listeners.
  const fingerprint=()=>JSON.stringify([...form.querySelectorAll('input,select,textarea')].filter(el=>!(el.closest('.bosWorkNumbers')&&!el.closest('.bosWorkEditRow')?.querySelector('.bosWorkSelect')?.value)).filter(el=>(el.type==='checkbox'||el.type==='radio')?el.checked:el.value!=='').map(el=>[el.name||el.className,el.type==='checkbox'||el.type==='radio'?el.checked:el.value]));
  form.bosFieldError=(key,message,control)=>{let box=form.querySelector('[data-error-for="'+key+'"]');if(!box){box=document.createElement('small');box.className='newOrderError';box.dataset.errorFor=key;control.closest('.newOrderField')?.append(box)}box.textContent=message;control.setAttribute('aria-invalid','true');control.focus()};
  const initial=fingerprint();form.bosHasUnsavedChanges=()=>form.dataset.saved!=='1'&&fingerprint()!==initial;
  const fit=()=>{if(!modal?.isConnected){window.visualViewport?.removeEventListener('resize',fit);return}modal.style.maxHeight=Math.max(180,(window.visualViewport?.height||innerHeight)-24)+'px'};
  fit();window.visualViewport?.addEventListener('resize',fit);
  form.addEventListener('focusin',e=>{if(e.target.matches('input,textarea,select'))requestAnimationFrame(()=>e.target.scrollIntoView({block:'nearest'}))});
}
const previousClose=window.closeModal;
window.closeModal=function(){const form=document.querySelector('#orderForm.newOrderForm');if(form){if(state.busy&&form.dataset.saved!=='1')return;if(form.bosHasUnsavedChanges?.()&&!window.confirm('Закрыть форму? Несохранённые данные будут потеряны.'))return}return previousClose.apply(this,arguments)};
window.addEventListener('beforeunload',event=>{if(document.getElementById('orderForm')?.bosHasUnsavedChanges?.()){event.preventDefault();event.returnValue=''}});

window.openOrderForm=function(id){
  const result=previousOpenOrderForm.apply(this,arguments);
  requestAnimationFrame(()=>enhanceNewOrderForm(id));
  return result;
};

const style=document.createElement('style');
style.textContent=`
#modalRoot .modal.newOrderModal{width:980px;max-width:calc(100vw - 24px)!important;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;scroll-padding-block:16px 24px;padding:24px;border-radius:18px}
.newOrderTitle{margin:0 44px 4px 0}.newOrderSubtitle{margin:0 44px 20px 0;color:#96a9bd;font-size:14px}
#modalRoot .newOrderForm{display:grid;gap:14px!important;max-width:none;width:100%;margin:0;overflow:visible}
.newOrderSection{min-width:0;padding:18px;border:1px solid #2b3949;border-radius:14px;background:rgba(255,255,255,.015)}
.newOrderSectionHead{margin-bottom:14px}.newOrderSectionHead h3{margin:0;font-size:17px;line-height:1.4}.newOrderSectionHead p{margin:5px 0 0;color:#96a9bd;font-size:13px}
.newOrderGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}.newOrderField{display:flex!important;flex-direction:column;gap:7px;min-width:0;margin:0!important;color:inherit!important}.newOrderFieldWide{grid-column:1/-1}.newOrderFieldLabel{font-size:13px;font-weight:600;color:#b9c9da}.newOrderField>input,.newOrderField>select,.newOrderField>textarea{width:100%;min-width:0;box-sizing:border-box;margin:0!important}.newOrderField>small{font-size:12px;line-height:1.45;font-weight:400}.newOrderField>textarea{min-height:128px;resize:vertical}.newOrderError{color:#ffabb1}.newOrderError:empty{display:none}
.newOrderReceipt{display:grid;grid-template-columns:minmax(0,1fr) 48px;gap:8px;position:relative}.newOrderReceipt>input[type="text"]{min-width:0;width:100%;box-sizing:border-box}.newOrderReceipt>button{display:grid;place-items:center;min-height:48px;padding:0}.newOrderReceipt>.newOrderNativeDate{position:absolute;right:0;top:0;width:48px;height:48px;opacity:0;pointer-events:none}.newOrderReceipt>.newOrderNativeDateFallback{position:static;width:100%;opacity:1;pointer-events:auto;grid-column:1/-1}
.newOrderConditions{grid-column:1/-1;margin:0!important;padding:12px!important}.newOrderTotals{margin:0!important;padding:12px!important}.newOrderActions{position:static!important;display:grid;grid-template-columns:auto auto;justify-content:end;gap:10px;padding:8px 0 calc(8px + env(safe-area-inset-bottom));background:none!important;margin:0!important}.newOrderActions button{min-height:48px;padding-inline:22px}.newOrderActions #formMsg{grid-column:1/-1;margin:0;overflow-wrap:anywhere}
.newOrderForm .bosLegacyWork{grid-column:1/-1;width:100%;box-sizing:border-box}.newOrderForm .bosAddField,.newOrderForm .bosRemoveField{min-height:44px}.newOrderForm .bosPhoneEditRow,.newOrderForm .bosWorkEditRow{grid-template-columns:minmax(0,1fr) 44px}.newOrderForm .bosRemoveField{width:44px;min-width:44px}.newOrderForm .bosPhoneEditRow:has(.bosRemoveField[hidden]),.newOrderForm .bosWorkEditRow:has(.bosRemoveField[hidden]){grid-template-columns:minmax(0,1fr)}.newOrderForm .bosRemoveField[hidden]{display:none}.newOrderForm .bosPhonePrefix{min-height:48px}
@media(max-width:600px){#modalRoot .modal.newOrderModal{max-width:100vw!important;width:100%;padding:16px 12px calc(16px + env(safe-area-inset-bottom));border-radius:16px 16px 0 0}.newOrderGrid{grid-template-columns:minmax(0,1fr);gap:12px}.newOrderSection{padding:14px 12px}.newOrderSection .newOrderSection{padding:12px 10px}.newOrderFieldWide{grid-column:auto}.newOrderActions{grid-template-columns:1fr 1.5fr;justify-content:stretch}.newOrderActions button{padding-inline:10px;font-size:15px}.newOrderForm input:not([type="checkbox"]):not([type="radio"]),.newOrderForm select,.newOrderForm textarea{min-height:48px;font-size:16px;box-sizing:border-box}.newOrderForm .bosPhoneEditor{grid-template-columns:52px minmax(0,1fr)}.newOrderSubtitle{font-size:13px}.newOrderConditions{grid-column:auto}}
`;
document.head.appendChild(style);
})();
