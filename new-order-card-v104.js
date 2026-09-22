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

function field(form,name,label,wide=false){
  const control=form.elements[name];
  if(!control)return null;
  const wrapper=document.createElement('label');
  wrapper.className='newOrderField'+(wide?' newOrderFieldWide':'');
  const caption=document.createElement('span');
  caption.className='newOrderFieldLabel';
  caption.textContent=label;
  wrapper.append(caption,control);
  return wrapper;
}

function removeLegacyLabel(form,text){
  [...form.children].forEach(node=>{
    if(node.tagName==='LABEL'&&node.textContent.trim()===text)node.remove();
  });
}

function enhanceNewOrderForm(){
  const form=document.getElementById('orderForm');
  if(!form||form.dataset.newOrderCard==='1')return;
  form.dataset.newOrderCard='1';
  form.classList.add('newOrderForm');

  const modal=form.closest('.modal');
  const title=modal?.querySelector('h2');
  if(title){
    title.classList.add('newOrderTitle');
    const subtitle=document.createElement('p');
    subtitle.className='newOrderSubtitle';
    subtitle.textContent='Заполните основные данные — заявку можно уточнить позже.';
    title.insertAdjacentElement('afterend',subtitle);
  }

  removeLegacyLabel(form,'Дата и время');
  removeLegacyLabel(form,'Исходная сумма заявки');
  removeLegacyLabel(form,'Источник заявки');

  const client=makeSection('Клиент','Контакты и адрес выезда');
  [field(form,'client','Клиент'),field(form,'phone','Телефон'),field(form,'address','Адрес',true)].filter(Boolean).forEach(x=>client.body.appendChild(x));

  const work=makeSection('Работа','Что нужно сделать на объекте');
  const workField=field(form,'work','Работы',true);if(workField)work.body.appendChild(workField);
  const conditions=form.querySelector(':scope > .orderConditions');
  if(conditions){conditions.classList.add('newOrderConditions');work.body.appendChild(conditions)}

  const plan=makeSection('Дата и назначение','Когда выполнить и кто отвечает');
  [field(form,'scheduled_date','Дата'),field(form,'time_slot','Время'),field(form,'status','Статус'),field(form,'master_vk_id','Мастер'),field(form,'source','Источник',true)].filter(Boolean).forEach(x=>plan.body.appendChild(x));

  const finance=makeSection('Стоимость','Сумма заявки и расчёт мастеру');
  const amount=field(form,'original_amount','Исходная сумма',true);if(amount)finance.body.appendChild(amount);
  const totals=form.querySelector(':scope > .orderTotals');
  if(totals){totals.classList.add('newOrderTotals');finance.body.appendChild(totals)}

  const completionBlock=form.querySelector(':scope > #completionBlock');
  let completionSection=null;
  if(completionBlock){
    const completion=makeSection('Завершение','Появится при статусе «Выполнена»');
    completion.section.classList.add('newOrderCompletionSection');
    completion.body.appendChild(completionBlock);
    completionSection=completion.section;
  }

  const note=makeSection('Комментарий','Важная информация для мастера и диспетчера');
  const comment=field(form,'comment','Комментарий',true);if(comment)note.body.appendChild(comment);

  const oldPair=form.querySelector(':scope > .two');
  if(oldPair&&!oldPair.children.length)oldPair.remove();

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

  form.prepend(client.section,work.section,plan.section,finance.section);
  if(completionSection)form.appendChild(completionSection);
  form.append(note.section,actions);

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
.newOrderTitle{margin-bottom:2px}.newOrderSubtitle{margin:0 34px 14px 0;color:#8fa3b7;font-size:13px;line-height:1.4}.newOrderForm{gap:12px!important}.newOrderSection{padding:14px;border:1px solid rgba(255,255,255,.085);border-radius:16px;background:linear-gradient(155deg,rgba(17,30,46,.96),rgba(11,21,33,.96));box-shadow:0 7px 20px rgba(0,0,0,.12)}.newOrderSectionHead{margin-bottom:11px}.newOrderSectionHead h3{margin:0;font-size:15px;line-height:1.2}.newOrderSectionHead p{margin:4px 0 0;color:#8095aa;font-size:11.5px;line-height:1.35}.newOrderGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.newOrderField{display:flex!important;flex-direction:column;gap:6px;min-width:0;margin:0!important;color:inherit!important}.newOrderFieldWide{grid-column:1/-1}.newOrderFieldLabel{font-size:11.5px;font-weight:700;color:#9fb3c8}.newOrderField>input,.newOrderField>select,.newOrderField>textarea{width:100%;min-width:0;box-sizing:border-box;margin:0!important}.newOrderField>textarea{min-height:100px}.newOrderConditions,.newOrderTotals{grid-column:1/-1;margin:0!important;background:rgba(255,255,255,.025)!important}.newOrderConditions{padding:12px!important}.newOrderTotals{padding:12px 13px!important}.newOrderCompletionSection[hidden]{display:none!important}.newOrderCompletionSection #completionBlock{display:grid;gap:10px}.newOrderCompletionSection #completionBlock>.card{margin:0}.newOrderActions{position:sticky;bottom:-1px;z-index:3;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:9px;margin:2px -2px -2px;padding:10px 2px 2px;background:linear-gradient(to bottom,rgba(7,11,18,0),rgba(7,11,18,.96) 26%)}.newOrderActions button{min-height:50px}.newOrderActions #formMsg{grid-column:1/-1;margin:0;min-height:18px}.newOrderForm>.two:empty{display:none}
@media(max-width:600px){.newOrderSubtitle{margin-right:28px}.newOrderSection{padding:12px;border-radius:15px}.newOrderGrid{grid-template-columns:1fr;gap:9px}.newOrderFieldWide{grid-column:auto}.newOrderActions{grid-template-columns:1fr 1fr;padding-bottom:calc(2px + env(safe-area-inset-bottom))}.newOrderActions button{min-height:52px;font-size:15px}.newOrderField>input,.newOrderField>select,.newOrderField>textarea{font-size:16px}.newOrderConditions,.newOrderTotals{grid-column:auto}}
@media(max-width:350px){.newOrderSection{padding:10px}.newOrderActions{grid-template-columns:1fr}.newOrderActions #formMsg{grid-column:auto}}
`;
document.head.appendChild(style);
})();
