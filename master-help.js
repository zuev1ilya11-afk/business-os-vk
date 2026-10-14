(()=>{
'use strict';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(label,action,value='',cls='')=>`<button type="button" class="bhButton ${cls}" data-action="${action}" data-value="${escape(value)}">${escape(label)}</button>`;
const states=new WeakMap();
const data=()=>window.BOS_MASTER_HELP_DATA;
const imageUrl=name=>window.BOS_ASSET_URL?window.BOS_ASSET_URL('./'+name):'./'+name;
function focusBody(dialog){const body=dialog.querySelector('.bhBody');body.scrollTop=0;body.querySelector('h2')?.focus({preventScroll:true})}
function render(dialog){
 const s=states.get(dialog),d=data(),lesson=d.lessons.find(x=>x.id===s.topic);
 const group=lesson||s.topic==='home'||s.topic==='materials'?'home':s.topic==='talk'?'talk':'faq';
 dialog.innerHTML=`<div class="bhHeader"><div><span class="bhEyebrow">ДОМАШНИЙ МАСТЕР</span><strong>Подсказки по работе</strong></div>${button('Закрыть помощь','close','','bhClose')}</div><div class="bhTabs" role="navigation" aria-label="Разделы помощи">${[['home','Работа в приложении'],['talk','Общение с клиентом'],['faq','Частые вопросы']].map(([id,label])=>`<button type="button" class="bhButton ${group===id?'isActive':''}" data-action="topic" data-value="${id}" ${group===id?'aria-current="page"':''}>${label}</button>`).join('')}</div><div class="bhBody"></div><div class="bhStatus" role="status" aria-live="polite"></div><div class="bhFooter"></div>`;
 const body=dialog.querySelector('.bhBody'),footer=dialog.querySelector('.bhFooter');
 if(lesson){
  const step=lesson.steps[s.step];
  if(s.zoom){
   body.innerHTML=`${button('Вернуться к шагу','zoom-close')}<h2 tabindex="-1">${escape(step.title)}</h2><div class="bhZoom"><img src="${escape(imageUrl(step.image))}" alt="${escape(step.alt)}"></div><p>${escape(step.text)}</p>`;
  }else if(s.list){
   body.innerHTML=`<span class="bhEyebrow">СПИСОК ШАГОВ</span><h2 tabindex="-1">${escape(lesson.title)}</h2><div class="bhStepList">${lesson.steps.map((x,i)=>button(`${i+1}. ${x.title}`,'step',i,i===s.step?'isActive':'')).join('')}</div>`;
  }else{
   body.innerHTML=`<div class="bhLessonTop"><span class="bhEyebrow">${escape(lesson.title)}</span>${button('Список шагов','steps')}</div><div class="bhProgress"><span>Шаг ${s.step+1} из ${lesson.steps.length}</span><div role="progressbar" aria-label="Шаги урока" aria-valuemin="0" aria-valuemax="${lesson.steps.length}" aria-valuenow="${s.step+1}"><i style="width:${(s.step+1)/lesson.steps.length*100}%"></i></div></div><h2 tabindex="-1">${escape(step.title)}</h2><div class="bhLesson"><div class="bhFigure"><button type="button" class="bhImageButton" data-action="zoom" aria-label="Увеличить иллюстрацию"><img loading="lazy" src="${escape(imageUrl(step.image))}" alt="${escape(step.alt)}"></button><small>Учебный пример · Нажмите, чтобы увеличить</small></div><div class="bhInstruction"><p class="bhLead">${escape(step.text)}</p>${step.warning?`<aside class="bhWarning"><b>Важно</b><p>${escape(step.warning)}</p></aside>`:''}${step.detail?`<details class="bhDetails"><summary>Подробнее</summary><p>${escape(step.detail)}</p></details>`:''}${step.branches?`<fieldset class="bhBranches"><legend>Попробуйте выбрать итог — это учебный пример</legend>${step.branches.map((x,i)=>button(x.label,'branch',i)).join('')}<p class="bhBranchResult" role="status"></p></fieldset>`:''}</div></div>`;
   footer.innerHTML=button(s.step?'Назад':'К урокам',s.step?'prev':'topic',s.step?'':'home')+button(s.step===lesson.steps.length-1?'Завершить урок':'Далее',s.step===lesson.steps.length-1?'finish':'next','','bhPrimary');
  }
 }else if(s.topic==='home'){
  body.innerHTML=`<span class="bhEyebrow">ПО ОДНОМУ ДЕЙСТВИЮ ЗА РАЗ</span><h2 tabindex="-1">Что нужно сделать?</h2><p class="bhMuted">Выберите тему. Покажем, куда нажать.</p><div class="bhLessons">${d.lessons.map((x,i)=>`<button type="button" class="bhLessonCard" data-action="topic" data-value="${x.id}"><span class="bhNumber">${String(i+1).padStart(2,'0')}</span><span><b>${escape(x.title)}</b><small>${x.steps.length} ${x.steps.length>=5?'шагов':'шага'}</small></span><span aria-hidden="true">›</span></button>`).join('')}</div><div class="bhResources">${button('Памятки и файлы','topic','materials')}${button('Возникла проблема','topic','problems')}</div>`;
 }else if(s.topic==='talk'){
  body.innerHTML=`<span class="bhEyebrow">СПОКОЙНО И ПО ДЕЛУ</span><h2 tabindex="-1">Общение с клиентом</h2><p class="bhMuted">Готовые фразы и следующий шаг.</p><div class="bhCards">${d.talk.map((x,i)=>`<details class="bhDetails" data-talk="${i}"><summary><span class="bhNumber">${i+1}</span>${escape(x.title)}</summary><div class="bhDetailBody"><span class="bhEyebrow">Что сказать</span><blockquote>${escape(x.say)}</blockquote>${button('Скопировать фразу','copy-talk',i)}<h3>Что сделать</h3><ul>${x.actions.map(v=>`<li>${escape(v)}</li>`).join('')}</ul><aside class="bhWarning"><b>Важно</b><p>${escape(x.warning)}</p></aside></div></details>`).join('')}</div>`;
 }else if(s.topic==='faq'){
  body.innerHTML=`<h2 tabindex="-1">Частые вопросы</h2><label class="bhSearch">Поиск по вопросам и ответам<input type="search" autocomplete="off" placeholder="Например: оплата, гарантия" value="${escape(s.query)}"></label><div class="bhFilters">${[['all','Все'],['price','Цена'],['work','Работы'],['payment','Оплата'],['problem','Проблемы']].map(([v,label])=>button(label,'category',v,s.category===v?'isActive':'')).join('')}</div><div class="bhResults"></div><div class="bhResources">${button('Возникла проблема','topic','problems')}</div>`;
  body.querySelector('input').addEventListener('input',event=>{s.query=event.target.value;renderResults(dialog)});renderResults(dialog);
 }else if(s.topic==='problems'){
  body.innerHTML=`<span class="bhEyebrow">НЕ НУЖНО РЕШАТЬ ВСЁ В ОДИНОЧКУ</span><h2 tabindex="-1">Возникла проблема</h2><div class="bhCards">${d.problems.map((x,i)=>`<details class="bhDetails" data-problem="${i}"><summary>${escape(x.title)}</summary><ol>${x.actions.map(v=>`<li>${escape(v)}</li>`).join('')}</ol></details>`).join('')}</div><section class="bhManager"><h3>Передать руководителю</h3><p class="bhTemplate">${escape(d.managerTemplate)}</p>${button('Скопировать шаблон','copy-manager')}<small>Только копирование. Сообщение не отправляется.</small></section>`;
 }else if(s.topic==='materials'){
  body.innerHTML=`<h2 tabindex="-1">Памятки и файлы</h2><p class="bhMuted">Ранее добавленные подсказки и вложения.</p><div id="bosHelpMaterials"></div><p class="bhMuted">Акты, листы замера и прайс доступны в профиле → «Памятки и прайс».</p>`;
  window.BOS_LOAD_HELP_MATERIALS?.(body.querySelector('#bosHelpMaterials'));
 }
 body.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{const fallback=document.createElement('p');fallback.className='bhImageFallback';fallback.textContent='Иллюстрация недоступна. Следуйте тексту шага: '+img.alt;const target=img.closest('button')||img;target.replaceWith(fallback)},{once:true}));
 if(!footer.children.length)footer.hidden=true;
 focusBody(dialog);
}
function renderResults(dialog){
 const s=states.get(dialog),norm=x=>x.toLocaleLowerCase('ru').replaceAll('ё','е'),q=norm(s.query.trim());
 const rows=data().faq.map((x,i)=>({...x,index:i})).filter(x=>(s.category==='all'||s.category===x.category)&&norm(x.question+' '+x.answer+' '+(x.note||'')).includes(q));
 dialog.querySelector('.bhResults').innerHTML=rows.length?rows.map(x=>`<details class="bhDetails" data-faq="${x.index}"><summary>${escape(x.question)}</summary><div class="bhDetailBody"><p>${escape(x.answer)}</p>${x.note?`<aside class="bhWarning">${escape(x.note)}</aside>`:''}${button('Скопировать ответ','copy-faq',x.index)}</div></details>`).join(''):'<p class="bhEmpty">Ничего не найдено. Попробуйте другое слово.</p>';
 if(s.query||s.category!=='all')dialog.querySelector('.bhResults').insertAdjacentHTML('beforeend',`<div class="bhResources">${button('Очистить поиск','clear')}${button('Вернуться к категориям','categories')}</div>`);
}
async function copy(dialog,text){
 const status=dialog.querySelector('.bhStatus');
 try{if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(text);status.textContent='Скопировано. Сообщение не отправлено.'}
 catch(_){status.textContent='Не удалось скопировать. Выделите текст и скопируйте вручную.'}
}
window.BOS_MASTER_HELP_VIEW=function(dialog,topic='home'){
 if(!states.has(dialog)){
  states.set(dialog,{topic:'home',step:0,list:false,zoom:false,query:'',category:'all'});
  dialog.addEventListener('click',event=>{
   const target=event.target.closest('[data-action]');if(!target)return;event.preventDefault();
   const s=states.get(dialog),action=target.dataset.action,value=target.dataset.value;
   if(action==='close'){dialog.close();return}
   if(action==='copy-talk'){copy(dialog,data().talk[Number(value)].say);return}
   if(action==='copy-faq'){copy(dialog,data().faq[Number(value)].answer);return}
   if(action==='copy-manager'){copy(dialog,data().managerTemplate);return}
   if(action==='branch'){const step=data().lessons.find(x=>x.id===s.topic).steps[s.step];dialog.querySelector('.bhBranchResult').textContent=step.branches[Number(value)].text;return}
   if(action==='topic'){s.topic=value;s.step=0;s.list=false;s.zoom=false}
   if(action==='next')s.step++;
   if(action==='prev')s.step--;
   if(action==='finish'){s.topic='home';s.step=0}
   if(action==='steps')s.list=true;
   if(action==='step'){s.step=Number(value);s.list=false}
   if(action==='zoom')s.zoom=true;
   if(action==='zoom-close')s.zoom=false;
   if(action==='category')s.category=value;
   if(action==='clear'||action==='categories'){s.query='';s.category='all'}
   render(dialog);
  });
 }
 const s=states.get(dialog);s.topic=[...data().lessons.map(x=>x.id),'home','talk','faq','problems','materials'].includes(topic)?topic:'home';s.step=0;s.list=false;s.zoom=false;render(dialog);
};
window.BOS_MASTER_HELP_ESCAPE=dialog=>{const s=states.get(dialog);if(s?.zoom||s?.list){s.zoom=false;s.list=false;render(dialog);return true}return false};
})();
