(()=>{
'use strict';
const clone=x=>structuredClone(x),uuid=()=>crypto.randomUUID();
const labels={lessons:'Название урока',talk:'Название ситуации',faq:'Вопрос',problems:'Название ситуации'};
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function input(label,value,key,multiline=false,required=true){return `<label class="bhField">${label}<${multiline?'textarea rows="4"':'input type="text"'} aria-label="${label}" data-field="${key}" ${required?'required':''} maxlength="${multiline?12000:300}">${multiline?escape(value):''}${multiline?'</textarea>':''}</label>`.replace(multiline?'__none__':'maxlength="300">',multiline?'__none__':`maxlength="300" value="${escape(value)}">`)}
function step(){return {id:'step-'+uuid(),title:'',text:''}}
function newItem(kind){const id='help-'+uuid();return {id,kind,version:0,content:{id,...(kind==='faq'?{question:'',answer:'',category:'work'}:kind==='lessons'?{title:'',steps:[step()]}:kind==='talk'?{title:'',say:'',actions:[''],warning:''}:{title:'',actions:['']})}}}
function read(form,editor){
 const c=clone(editor.item.content);
 for(const el of form.querySelectorAll('[data-field]'))if(el.value!==''||c[el.dataset.field]!==undefined)c[el.dataset.field]=el.value;
 if(c.steps)for(const el of form.querySelectorAll('[data-step-field]')){const step=c.steps.find(s=>s.id===el.dataset.stepId);if(el.value!==''||step[el.dataset.stepField]!==undefined)step[el.dataset.stepField]=el.value;}
 if(c.actions)c.actions=[...form.querySelectorAll('[data-list-action]')].map(e=>e.value);
 return {...editor.item,content:c};
}
function dirty(dialog,s){if(!s.editor)return false;const form=dialog.querySelector('.bhEditor');if(form)s.editor.item=read(form,s.editor);return JSON.stringify(s.editor.item)!==s.editor.original}
window.BOS_HELP_EDITOR={
 begin(s,kind,id){const item=id?window.BOS_HELP_STORE.get(id):newItem(kind);s.editor={item,original:JSON.stringify(item),saving:false,error:'',conflict:false,originalSteps:new Set((item.content.steps||[]).map(x=>x.id))}},
 leave(dialog,s){if(!s.editor)return true;if(s.editor.saving){s.editor.error='Дождитесь ответа сервера.';const el=dialog.querySelector('[data-editor-error]');if(el)el.textContent=s.editor.error;return false}if(dirty(dialog,s)&&!confirm('Есть несохранённые изменения. Закрыть форму и потерять их?'))return false;s.editor=null;return true},
 dirty,
 render(dialog,s,done){
  const e=s.editor,c=e.item.content,body=dialog.querySelector('.bhBody');
  dialog.querySelector('.bhTabs').hidden=true;dialog.querySelector('.bhFooter').hidden=true;
  body.innerHTML=`<h2 tabindex="-1">${e.item.version?'Редактировать подсказку':'Добавить подсказку'}</h2><form class="bhEditor">${input(labels[e.item.kind],c.question??c.title,e.item.kind==='faq'?'question':'title')}${e.item.kind==='faq'?input('Ответ',c.answer,'answer',true)+`<label class="bhField">Категория<select data-field="category">${[['price','Цена'],['work','Работы'],['payment','Оплата'],['problem','Проблемы']].map(([v,l])=>`<option value="${v}" ${c.category===v?'selected':''}>${l}</option>`).join('')}</select></label>`+input('Примечание (необязательно)',c.note,'note',true,false):''}${e.item.kind==='talk'?input('Готовая фраза',c.say,'say',true):''}${c.steps?`<div class="bhEditSteps">${c.steps.map((x,i)=>`<fieldset class="bhEditStep" data-step="${x.id}"><legend>Шаг ${i+1}</legend>${['title','text','warning','detail'].map(k=>input({title:'Заголовок шага',text:'Текст шага',warning:'Предупреждение (необязательно)',detail:'Дополнительное пояснение (необязательно)'}[k],x[k],k,k!=='title',['title','text'].includes(k)).replace('data-field=',`data-step-id="${x.id}" data-step-field=`)).join('')}${x.image?'<small>Существующая иллюстрация сохранится.</small>':''}${x.branches?'<small>Учебные варианты действий сохранены.</small>':''}${!e.originalSteps.has(x.id)?`<button class="bhButton" type="button" data-remove-step="${x.id}">Убрать новый шаг</button>`:''}</fieldset>`).join('')}</div><button class="bhButton" type="button" data-add-step>Добавить шаг</button>`:''}${c.actions?`<fieldset class="bhEditStep"><legend>Последовательность действий</legend>${c.actions.map((x,i)=>`<div class="bhActionRow"><label class="bhField">Действие ${i+1}<textarea rows="2" required maxlength="12000" aria-label="Действие ${i+1}" data-list-action>${escape(x)}</textarea></label>${c.actions.length>1?`<button class="bhButton" type="button" data-remove-action="${i}" aria-label="Удалить действие ${i+1}">×</button>`:''}</div>`).join('')}<button class="bhButton" type="button" data-add-action>Добавить действие</button></fieldset>`:''}${e.item.kind==='talk'?input('Предупреждение (необязательно)',c.warning,'warning',true,false):''}<p data-editor-error role="alert">${escape(e.error)}</p>${e.conflict?'<details class="bhDetails"><summary>Актуальная версия для сравнения</summary><div data-current-version class="bhDetailBody">Нажмите, чтобы загрузить. Ваш черновик останется в форме.</div></details>':''}<div class="bhEditorButtons"><button class="bhButton bhPrimary" type="submit">Сохранить</button><button class="bhButton" type="button" data-editor-cancel>Отмена</button></div></form>`;
  const form=body.querySelector('form');
  form.addEventListener('click',async event=>{
   const target=event.target.closest('button');if(!target||e.saving)return;
   if(target.hasAttribute('data-editor-cancel')){if(this.leave(dialog,s))done();return}
   if(target.hasAttribute('data-add-step')||target.hasAttribute('data-remove-step')||target.hasAttribute('data-add-action')||target.hasAttribute('data-remove-action')){
    e.item=read(form,e);const d=e.item.content;
    if(target.hasAttribute('data-add-step')&&d.steps.length<50)d.steps.push(step());
    if(target.hasAttribute('data-remove-step'))d.steps=d.steps.filter(x=>x.id!==target.dataset.removeStep);
    if(target.hasAttribute('data-add-action')&&d.actions.length<50)d.actions.push('');
    if(target.hasAttribute('data-remove-action'))d.actions.splice(Number(target.dataset.removeAction),1);
    this.render(dialog,s,done);return;
   }
  });
  form.querySelector('details')?.addEventListener('toggle',async event=>{if(!event.target.open)return;const dest=form.querySelector('[data-current-version]');try{dest.textContent='Загружаем актуальную версию…';const row=await window.BOS_HELP_STORE.latest(e.item.id);dest.textContent=row?[row.content.title||row.content.question,row.content.answer||row.content.say,...(row.content.actions||[]),...(row.content.steps||[]).flatMap(x=>[x.title,x.text,x.warning,x.detail]),row.content.warning,row.content.note].filter(Boolean).join('\n\n'):'Материал не найден';}catch(_){dest.textContent='Не удалось загрузить актуальную версию.'}});
  form.onsubmit=async event=>{
   event.preventDefault();if(e.saving)return;
   e.item=read(form,e);if(!form.reportValidity())return;
   const blank=[...form.querySelectorAll('[required]')].find(x=>!x.value.trim());if(blank){e.error='Заполните обязательные поля.';form.querySelector('[data-editor-error]').textContent=e.error;blank.focus();return}
   e.saving=true;e.error='';form.querySelector('[data-editor-error]').textContent='';const submit=form.querySelector('[type=submit]');submit.textContent='Сохранение…';form.querySelectorAll('input,textarea,select,button').forEach(x=>x.disabled=true);
   try{await window.BOS_HELP_STORE.save(e.item);s.editor=null;s.data=window.BOS_HELP_STORE.data;done('Сохранено на сервере. Сотрудники увидят изменения при следующем открытии подсказок.');}
   catch(error){e.error=error.message;e.conflict=error.code==='HELP_CONFLICT';e.saving=false;this.render(dialog,s,done);}
   finally{e.saving=false}
  };
 }
};
})();
