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
  modal?.classList.add('newOrderModal');
  const title=modal?.querySelector('h2');
  if(title&&!modal.querySelector('.newOrderSubtitle')){
    title.classList.add('newOrderTitle');
    const subtitle=document.createElement('p');
    subtitle.className='newOrderSubtitle';
    subtitle.textContent='Контакты, работы и назначение';
    title.insertAdjacentElement('afterend',subtitle);
  }

  const channels=form.querySelector('.newOrderChannels');
  const client=makeSection('Клиент','');
  const clientInput=form.elements.client;
  const phoneInput=form.querySelector('#bosPhone');
  const phoneGroup=phoneInput?.closest('.two');
  const addressInput=form.elements.address;
  [field(clientInput,'Имя клиента'),groupedField(phoneGroup,'Телефон'),field(addressInput,'Адрес',true)].filter(Boolean).forEach(node=>client.body.appendChild(node));
  if(phoneInput)phoneInput.setAttribute('aria-label','Телефон');
  const phonePrefix=phoneGroup?.querySelector('input[disabled]');
  if(phonePrefix)phonePrefix.setAttribute('aria-label','Код страны');

  const work=makeSection('Услуги','');
  const service=form.querySelector('#bosService');
  if(service){
    const serviceField=field(service,'Услуги',true);
    serviceField.querySelector('.newOrderFieldLabel').hidden=true;
    service.setAttribute('aria-label','Услуги');
    const serviceInfo=form.querySelector('#bosServiceInfo');
    if(serviceInfo){service.setAttribute('aria-describedby','bosServiceInfo');serviceField.appendChild(serviceInfo)}
    work.body.appendChild(serviceField);
  }
  const conditions=[...form.querySelectorAll(':scope > section.card')].find(section=>section.querySelector('[name="wall_material"]')||section.querySelector('[name="wall_over_3m"]'));
  if(conditions){
    conditions.classList.add('newOrderConditions');
    work.body.appendChild(conditions);
  }

  const plan=makeSection('Дата и назначение','');
  const dateInput=form.elements.scheduled_date;
  const dateGroup=dateInput?.closest('.two');
  const slot=form.elements.time_slot;
  if(dateGroup){
    const dateField=groupedField(dateGroup,'Дата и время',true);
    dateInput.setAttribute('aria-label','Дата');
    if(slot)slot.setAttribute('aria-label','Время');
    plan.body.appendChild(dateField);
  }
  const masterField=field(form.elements.master_vk_id,'Мастер');
  const statusField=field(form.elements.status,'Статус');
  [masterField,statusField].filter(Boolean).forEach(node=>plan.body.appendChild(node));

  const finance=makeSection('Стоимость','');
  const amountField=field(form.elements.original_amount,'Сумма заявки, ₽',true);
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

  const note=makeSection('Комментарий','');
  const commentInput=form.elements.comment;
  const commentField=field(commentInput,'Комментарий',true);
  if(commentField){commentField.querySelector('.newOrderFieldLabel').hidden=true;commentInput.setAttribute('aria-label','Комментарий');note.body.appendChild(commentField)}

  const submit=form.querySelector(':scope > button.primary.wide[type="submit"]');
  const msg=form.querySelector(':scope > #formMsg');
  const actions=document.createElement('div');
  actions.className='newOrderActions';
  if(submit){submit.textContent='Создать заявку';actions.appendChild(submit)}
  const cancel=document.createElement('button');
  cancel.type='button';
  cancel.className='secondary newOrderCancel';
  cancel.textContent='Отмена';
  cancel.addEventListener('click',()=>closeModal());
  actions.appendChild(cancel);
  if(msg)actions.appendChild(msg);

  form.prepend(...[channels,client.section,work.section,plan.section].filter(Boolean));
  const bottom=document.createElement('div');bottom.className='newOrderBottom';bottom.append(finance.section,note.section);form.appendChild(bottom);
  if(completionSection)form.appendChild(completionSection);
  form.appendChild(actions);

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
.modal.newOrderModal{max-width:980px!important}
.newOrderTitle{margin-bottom:2px}.newOrderSubtitle{margin:0 34px 14px 0;color:#8fa3b7;font-size:14px;line-height:1.4}
.newOrderForm{gap:12px!important}.newOrderSection{padding:12px 0;border:0;border-top:1px solid rgba(255,255,255,.10);background:transparent;min-width:0}.newOrderSectionHead{margin-bottom:11px}.newOrderSectionHead h3{margin:0;font-size:18px;line-height:1.25}.newOrderSectionHead p{margin:4px 0 0;color:#8095aa;font-size:12px;line-height:1.35}
.newOrderGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.newOrderField{display:flex!important;flex-direction:column;gap:6px;min-width:0;margin:0!important;color:inherit!important}.newOrderFieldWide{grid-column:1/-1}.newOrderFieldLabel{font-size:13px;font-weight:600;color:#afc2d5}.newOrderFieldLabel[hidden]{display:none}.newOrderField>input,.newOrderField>select,.newOrderField>textarea,.newOrderField>.two{width:100%;min-width:0;box-sizing:border-box;margin:0!important}.newOrderField>textarea{min-height:96px;resize:vertical}.newOrderField>.two{display:grid!important}
.newOrderConditions,.newOrderTotals{grid-column:1/-1;margin:0!important;background:rgba(255,255,255,.025)!important;box-shadow:none!important}.newOrderConditions{padding:10px!important}.newOrderTotals{padding:10px 12px!important}.newOrderCompletionSection[hidden]{display:none!important}.newOrderCompletionSection #completionBlock{display:grid;gap:10px}.newOrderCompletionSection #completionBlock>.card{margin:0}
.newOrderChannels{border:0;padding:0;margin:0;min-width:0}.newOrderChannels legend{font-size:14px;font-weight:600;margin-bottom:10px;padding:0;color:#d8e5f3}.newOrderChannelOptions{display:flex;flex-wrap:wrap;gap:8px}.newOrderChannel{display:flex!important;align-items:center;justify-content:center;gap:7px;min-height:44px;padding:9px 13px!important;margin:0!important;border:1px solid #304b63;border-radius:10px;background:#142638;color:#ecf4ff!important;cursor:pointer;font-size:14px;line-height:1.3}.newOrderChannel input[type=radio]{width:16px!important;height:16px!important;min-height:16px!important;padding:0!important;margin:0!important;flex:none;accent-color:#6cb7ff}.newOrderChannel:has(input:checked){background:#086bd7;border-color:#419cfb;color:white!important}.newOrderChannel:focus-within{outline:2px solid #8cc9ff;outline-offset:2px}.newOrderBottom{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}
.newOrderActions{position:sticky;bottom:-1px;z-index:3;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:9px;margin:2px -2px -2px;padding:10px 2px 2px;background:linear-gradient(to bottom,rgba(7,11,18,0),rgba(7,11,18,.96) 26%)}.newOrderActions button{min-height:50px}.newOrderActions #formMsg{grid-column:1/-1;margin:0;min-height:18px}
@media(min-width:761px){.newOrderActions{grid-template-columns:minmax(180px,auto) minmax(100px,auto);justify-content:end}.newOrderConditions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:center}.newOrderConditions h3{grid-column:1/-1}.newOrderConditions select{grid-column:2;grid-row:3}.newOrderConditions>label:not(.checkRow){grid-column:2;grid-row:2}.newOrderConditions .checkRow{grid-column:1}}
@media(max-width:760px){.newOrderBottom{grid-template-columns:minmax(0,1fr);gap:0}}
@media(max-width:600px){.newOrderSubtitle{margin-right:28px}.newOrderSection{padding:10px 0}.newOrderGrid{grid-template-columns:1fr;gap:9px}.newOrderFieldWide{grid-column:auto}.newOrderActions{grid-template-columns:1fr 1fr;padding-bottom:calc(2px + env(safe-area-inset-bottom))}.newOrderActions button{min-height:52px;font-size:15px}.newOrderForm input:not([type="checkbox"]):not([type="radio"]),.newOrderForm select,.newOrderForm textarea{min-height:48px;font-size:16px;box-sizing:border-box}.newOrderConditions,.newOrderTotals{grid-column:auto}.newOrderForm .two{min-width:0}.newOrderForm .two>*{min-width:0}.newOrderChannel{flex:1 0 calc(33.333% - 8px);padding:8px!important;font-size:13px}}
@media(max-width:350px){.newOrderChannel{flex-basis:calc(50% - 8px)}.newOrderActions{grid-template-columns:1fr}.newOrderActions #formMsg{grid-column:auto}}
`;
document.head.appendChild(style);
})();
