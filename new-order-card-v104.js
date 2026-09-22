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

function enhanceNewOrderForm(){
  const form=document.getElementById('orderForm');
  if(!form||form.dataset.newOrderCard==='1')return;
  form.dataset.newOrderCard='1';
  form.classList.add('newOrderForm');

  const modal=form.closest('.modal');
  const title=modal?.querySelector('h2');
  if(title&&!modal.querySelector('.newOrderSubtitle')){
    title.classList.add('newOrderTitle');
    const subtitle=document.createElement('p');
    subtitle.className='newOrderSubtitle';
    subtitle.textContent='Заполните основные данные — остальное можно уточнить позже.';
    title.insertAdjacentElement('afterend',subtitle);
  }

  const client=makeSection('Клиент','Контакты и адрес выезда');
  const clientInput=form.elements.client;
  const phoneInput=form.querySelector('#bosPhone');
  const phoneGroup=phoneInput?.closest('.two');
  const addressInput=form.elements.address;
  [field(clientInput,'Клиент'),groupedField(phoneGroup,'Телефон'),field(addressInput,'Адрес',true)].filter(Boolean).forEach(node=>client.body.appendChild(node));
  if(phoneInput)phoneInput.setAttribute('aria-label','Телефон');
  const phonePrefix=phoneGroup?.querySelector('input[disabled]');
  if(phonePrefix)phonePrefix.setAttribute('aria-label','Код страны');

  const work=makeSection('Работа','Тип заявки, услуга и условия на объекте');
  const typeField=field(form.elements.order_type,'Тип заявки');
  if(typeField)work.body.appendChild(typeField);
  const service=form.querySelector('#bosService');
  if(service){
    const serviceField=field(service,'Услуга',true);
    const serviceInfo=form.querySelector('#bosServiceInfo');
    if(serviceInfo)serviceField.appendChild(serviceInfo);
    work.body.appendChild(serviceField);
  }
  const conditions=[...form.querySelectorAll(':scope > section.card')].find(section=>section.querySelector('[name="wall_material"]')||section.querySelector('[name="wall_over_3m"]'));
  if(conditions){
    conditions.classList.add('newOrderConditions');
    work.body.appendChild(conditions);
  }

  const plan=makeSection('Дата и назначение','Когда выполнить, кто отвечает и текущий статус');
  const dateInput=form.elements.scheduled_date;
  const dateGroup=dateInput?.closest('.two');
  if(dateGroup){
    const dateField=groupedField(dateGroup,'Дата и время',true);
    dateInput.setAttribute('aria-label','Дата');
    const slot=form.elements.time_slot;
    if(slot)slot.setAttribute('aria-label','Время');
    plan.body.appendChild(dateField);
  }
  const masterField=field(form.elements.master_vk_id,'Мастер');
  const statusField=field(form.elements.status,'Статус');
  [masterField,statusField].filter(Boolean).forEach(node=>plan.body.appendChild(node));
  const sourceControl=form.elements.source||form.querySelector('#bosSource');
  const sourceField=field(sourceControl,'Источник',true);
  if(sourceField)plan.body.appendChild(sourceField);

  const finance=makeSection('Стоимость','Сумма заявки и расчёт мастеру');
  const amountField=field(form.elements.original_amount,'Исходная сумма',true);
  if(amountField)finance.body.appendChild(amountField);
  const payoutCard=[...form.querySelectorAll(':scope > .card')].find(card=>card.querySelector('#bosMasterPay'));
  if(payoutCard){
    payoutCard.classList.add('newOrderTotals');
    finance.body.appendChild(payoutCard);
  }

  const completionBlock=form.querySelector(':scope > #completionBlock');
  let completionSection=null;
  if(completionBlock){
    const completion=makeSection('Завершение','Данные появляются при статусе «Выполнена»');
    completion.section.classList.add('newOrderCompletionSection');
    completion.body.appendChild(completionBlock);
    completionSection=completion.section;
  }

  const note=makeSection('Комментарий','Важная информация для мастера и диспетчера');
  const commentField=field(form.elements.comment,'Комментарий',true);
  if(commentField)note.body.appendChild(commentField);

  const submit=form.querySelector(':scope > button.primary.wide[type="submit"]');
  const msg=form.querySelector(':scope > #formMsg');
  const actions=document.createElement('div');
  actions.className='newOrderActions';
  if(submit)actions.appendChild(submit);
  const cancel=document.createElement('button');
  cancel.type='button';
  cancel.className='secondary newOrderCancel';
  cancel.textContent='Отмена';
  cancel.addEventListener('click',()=>closeModal());
  actions.appendChild(cancel);
  if(msg)actions.appendChild(msg);

  form.prepend(client.section,work.section,plan.section,finance.section);
  if(completionSection)form.appendChild(completionSection);
  form.append(note.section,actions);

  [...form.childNodes].forEach(node=>{
    if(node.nodeType===Node.TEXT_NODE&&!node.textContent.trim())node.remove();
  });
  [...form.children].forEach(node=>{
    if(node.tagName==='LABEL'&&!node.querySelector('input,select,textarea')&&!node.closest('.newOrderSection'))node.remove();
    if(node.classList?.contains('two')&&!node.children.length)node.remove();
  });

  const status=form.elements.status;
  const syncCompletion=()=>{
    if(!completionSection||!completionBlock)return;
    completionSection.hidden=getComputedStyle(completionBlock).display==='none';
  };
  if(status)status.addEventListener('change',()=>requestAnimationFrame(syncCompletion));
  requestAnimationFrame(syncCompletion);
}

window.openOrderForm=function(id){
  const result=previousOpenOrderForm.apply(this,arguments);
  if(id===undefined||id===null||id==='')requestAnimationFrame(enhanceNewOrderForm);
  return result;
};

const style=document.createElement('style');
style.textContent=`
.newOrderTitle{margin-bottom:2px}.newOrderSubtitle{margin:0 34px 14px 0;color:#8fa3b7;font-size:13px;line-height:1.4}.newOrderForm{gap:12px!important}.newOrderSection{padding:14px;border:1px solid rgba(255,255,255,.085);border-radius:16px;background:linear-gradient(155deg,rgba(17,30,46,.96),rgba(11,21,33,.96));box-shadow:0 7px 20px rgba(0,0,0,.12)}.newOrderSectionHead{margin-bottom:11px}.newOrderSectionHead h3{margin:0;font-size:15px;line-height:1.2}.newOrderSectionHead p{margin:4px 0 0;color:#8095aa;font-size:11.5px;line-height:1.35}.newOrderGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.newOrderField{display:flex!important;flex-direction:column;gap:6px;min-width:0;margin:0!important;color:inherit!important}.newOrderFieldWide{grid-column:1/-1}.newOrderFieldLabel{font-size:11.5px;font-weight:700;color:#9fb3c8}.newOrderField>input,.newOrderField>select,.newOrderField>textarea,.newOrderField>.two{width:100%;min-width:0;box-sizing:border-box;margin:0!important}.newOrderField>textarea{min-height:100px}.newOrderField>.two{display:grid!important}.newOrderConditions,.newOrderTotals{grid-column:1/-1;margin:0!important;background:rgba(255,255,255,.025)!important}.newOrderConditions{padding:12px!important}.newOrderTotals{padding:12px 13px!important}.newOrderCompletionSection[hidden]{display:none!important}.newOrderCompletionSection #completionBlock{display:grid;gap:10px}.newOrderCompletionSection #completionBlock>.card{margin:0}.newOrderActions{position:sticky;bottom:-1px;z-index:3;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:9px;margin:2px -2px -2px;padding:10px 2px 2px;background:linear-gradient(to bottom,rgba(7,11,18,0),rgba(7,11,18,.96) 26%)}.newOrderActions button{min-height:50px}.newOrderActions #formMsg{grid-column:1/-1;margin:0;min-height:18px}
@media(max-width:600px){.newOrderSubtitle{margin-right:28px}.newOrderSection{padding:12px;border-radius:15px}.newOrderGrid{grid-template-columns:1fr;gap:9px}.newOrderFieldWide{grid-column:auto}.newOrderActions{grid-template-columns:1fr 1fr;padding-bottom:calc(2px + env(safe-area-inset-bottom))}.newOrderActions button{min-height:52px;font-size:15px}.newOrderForm input:not([type="checkbox"]):not([type="radio"]),.newOrderForm select,.newOrderForm textarea{min-height:48px;font-size:16px;box-sizing:border-box}.newOrderField>textarea{min-height:100px}.newOrderConditions,.newOrderTotals{grid-column:auto}.newOrderForm .two{min-width:0}.newOrderForm .two>*{min-width:0}}
@media(max-width:350px){.newOrderSection{padding:10px}.newOrderActions{grid-template-columns:1fr}.newOrderActions #formMsg{grid-column:auto}}
`;
document.head.appendChild(style);
})();
