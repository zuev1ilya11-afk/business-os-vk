(function(root,factory){
 'use strict';
 const core=factory();
 if(typeof module==='object'&&module.exports){module.exports=core;return;}
 if(root.BOS_CONTROL_TASKS)return;
 const API='https://business-os-api-gateway.netlify.app/api/proxy/push-api',SESSION='bos_vk_session_v2';
 const stateNow=()=>typeof state==='undefined'?{}:state;
 const token=()=>{try{return sessionStorage.getItem(SESSION)||localStorage.getItem(SESSION)||''}catch{return ''}};
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let identity='',generation=0,tasks=[],staff=[],enabled=false,more=false,loaded=false,error='',loading=false,paintQueued=false,lastLoad=0,dialog=null;
 function who(){
  const s=stateNow(),u=s.user,session=token();
  if(!u?.id||!session||!document.body.classList.contains('bos-auth-ok')||(u.external_id&&String(u.external_id)!==session.split('.')[0]))return '';
  try{const shared=localStorage.getItem(SESSION)||'';if(localStorage.getItem('bos_manual_logout_v1')==='1'||(shared&&shared.split('.')[0]!==session.split('.')[0]))return ''}catch{return ''}
  if(u.role!=='master'&&!root.BOS_PERMISSIONS?.isDispatcherWorkspaceActive(u))return '';
  return JSON.stringify([u.id,u.external_id,u.role,session.split('.')[0]]);
 }
 function reset(){identity=who();generation++;tasks=[];staff=[];loaded=false;loading=false;error='';lastLoad=0;closeEditor();}
 async function request(action,data={}){
  const id=identity,run=generation,session=token(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
  try{
   const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json','X-BOS-Session':session},body:JSON.stringify({action,...data}),signal:controller.signal});
   const result=await response.json().catch(()=>({}));
   if(run!==generation||id!==who())throw new Error('Аккаунт изменился.');
   if(!response.ok||!result.ok)throw new Error(result.error||'Не удалось загрузить поручения.');
   return result;
  }catch(e){if(e.name==='AbortError')throw new Error('Сервер не ответил. Проверьте соединение.');throw e}finally{clearTimeout(timer)}
 }
 async function load(force=false){
  if(who()!==identity)reset();
  if(!identity||stateNow().page!=='home'||document.hidden||loading||(!force&&Date.now()-lastLoad<60000))return;
  const run=generation;loading=true;lastLoad=Date.now();refresh();
  try{const data=await request('controlList');if(run!==generation)return;tasks=data.tasks||[];staff=data.staff||[];enabled=!!data.reminders_enabled;more=!!data.more;loaded=true;error=''}
  catch(e){if(run===generation)error=e.message}finally{if(run===generation){loading=false;refresh()}}
 }
 function reminder(t){
  const labels={off:'Без push-напоминания',accepted:'Push принят сервисом; показ на телефоне не подтверждён',queued:'Push в очереди',not_delivered:'Доставка не подтверждена. Автоповтора нет.',expired:'Срок напоминания пропущен. Автоповтора нет.'};
  if(labels[t.reminder_status])return labels[t.reminder_status];
  if(!enabled)return 'Серверные напоминания пока выключены';
  return t.has_push?'Один push при наступлении срока':'У сотрудника нет активного подключения push';
 }
 function taskText(t){return `<b>${escape(t.assignee_name)}</b><span>Срок: ${escape(core.displayDue(t.due_at))} МСК${Date.parse(t.due_at)<=Date.now()?' · Просрочено':''}</span><span>${escape(reminder(t))}</span>`}
 function update(node,html){if(node.__ctHTML!==html){node.__ctHTML=html;node.innerHTML=html}}
 function paint(){
  paintQueued=false;
  if(who()!==identity)reset();
  const s=stateNow(),panel=document.getElementById('bosOrderControl');
  if(!identity||s.page!=='home'){
   document.querySelectorAll('.ctBar,.ctMeta,#bosMyControlTasks').forEach(n=>n.remove());return;
  }
  if(s.user.role==='master'){
   let own=document.getElementById('bosMyControlTasks');
   if(!loaded||!tasks.length){own?.remove();load();return;}
   if(!own){own=document.createElement('section');own.id='bosMyControlTasks';own.className='card';document.getElementById('content')?.appendChild(own)}
   update(own,`<h2>Мои поручения</h2><p class="muted">Поручения по заявкам. Сроки — по Москве.</p>${error?`<p role="status">${escape(error)}</p>`:''}${tasks.map(t=>`<article class="ctOwn"><b>Заявка № ${escape(t.order_id)} · ${escape(core.titles[t.issue_code]||t.issue_code)}</b>${taskText(t)}<button type="button" class="secondary" data-ct-open="${escape(t.order_id)}">Открыть заявку</button></article>`).join('')}${more?'<p>Показаны первые 500 поручений.</p>':''}<button type="button" class="secondary" data-ct-refresh>Обновить поручения</button>`);
  }else if(panel){
   let bar=panel.querySelector('.ctBar');
   if(!bar){bar=document.createElement('div');bar.className='ctBar';panel.querySelector('.ocFilters')?.before(bar)}
   update(bar,`<span role="status">${escape(error||(loaded?'Назначьте сотрудника и срок у нужной проблемы.':'Загрузка ответственных и сроков…'))}</span><button class="secondary" type="button" data-ct-refresh ${loading?'disabled':''}>Обновить поручения</button>${more?'<span>Показаны первые 500 поручений. Открытие назначения загрузит его актуальное состояние отдельно.</span>':''}`);
   if(loaded){const note=panel.querySelector('.ocNote');const text='По загруженным заявкам. Даты визитов и сроки поручений — по Москве. Напоминание включается отдельно для каждого поручения.';if(note&&note.textContent!==text)note.textContent=text;}
   for(const issue of panel.querySelectorAll('.ocIssue')){
    const oid=issue.closest('[data-oc-order]')?.dataset.ocOrder,code=issue.dataset.ocReason;
    let meta=issue.querySelector('.ctMeta');if(!meta){meta=document.createElement('div');meta.className='ctMeta';issue.appendChild(meta)}
    const task=tasks.find(t=>t.active&&t.order_id===oid&&t.issue_code===code);
    update(meta,`${task?taskText(task):`<span>${!loaded?'Статус поручения ещё не загружен':more?'Проверьте актуальное назначение':'Персональное поручение не назначено'}</span>`}<button type="button" class="secondary" data-ct-edit="${escape(oid)}" data-ct-code="${escape(code)}">${task?'Изменить поручение':'Назначить ответственного и срок'}</button>`);
   }
  }
  load();
 }
 function refresh(){if(!paintQueued){paintQueued=true;requestAnimationFrame(paint)}}
 function closeEditor(){if(dialog){dialog.close();dialog.remove();dialog=null}}
 async function edit(oid,code){
  if(!identity||stateNow().user?.role==='master')return;
  closeEditor();const run=generation;
  const box=document.createElement('dialog');box.className='ctDialog';dialog=box;
  box.innerHTML='<p role="status">Загрузка актуального поручения…</p><button type="button" data-ct-close>Закрыть</button>';
  document.body.appendChild(box);box.showModal();
  try{
   const data=await request('controlList',{order_id:oid,issue_code:code});
   if(run!==generation||dialog!==box)return;
   const task=data.tasks?.[0],active=task?.active,order=(stateNow().orders||[]).find(o=>String(o.id)===oid);
   const people=(data.staff||[]).filter(p=>p.role!=='master'||(['agreement','report_rejected'].includes(code)&&String(order?.master_staff_id)===String(p.id)));
   box.innerHTML=`<form><h2>Ответственный и срок</h2><p>Заявка № ${escape(oid)} · ${escape(core.titles[code]||code)}</p><label>Ответственный<select name="assignee" required><option value="">Выберите сотрудника</option>${people.map(p=>`<option value="${escape(p.id)}" ${active&&p.id===task.assignee_id?'selected':''}>${escape(p.name)}${p.role==='master'?' · мастер':''}</option>`).join('')}</select></label><label>Срок реакции, московское время<input type="datetime-local" name="due" required value="${active?escape(core.toInput(task.due_at)):''}"></label><label class="ctCheckbox"><input type="checkbox" name="remind" ${active&&task.remind?'checked':''}>Один push при наступлении срока</label><p class="muted">Поручение закроется, когда проблема заявки решена. Повторной отправки после неопределённого ответа сервиса нет.</p><p data-ct-device class="muted"></p><p data-ct-error role="alert"></p><div class="ctActions"><button type="submit" class="primary">Сохранить</button>${active?'<button type="button" class="secondary" data-ct-clear>Снять поручение</button>':''}<button type="button" class="secondary" data-ct-close>Закрыть</button></div></form>`;
   const form=box.querySelector('form'),message=box.querySelector('[data-ct-error]');let saving=false;
   function device(){const person=people.find(p=>p.id===form.elements.assignee.value);box.querySelector('[data-ct-device]').textContent=!data.reminders_enabled?'Серверные напоминания выключены. Поручение всё равно сохранится.':person&&!person.has_push?'У сотрудника нет активного подключения push. Поручение будет видно в приложении.':''}
   form.elements.assignee.addEventListener('change',device);device();
   async function save(clear=false){
    if(saving||!who())return;
    if(!clear&&!form.reportValidity())return;
    saving=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);message.textContent='';
    try{
     const input={order_id:oid,issue_code:code,expected_version:task?.version||0};
     if(!clear)Object.assign(input,{assignee_id:form.elements.assignee.value,due_at:core.parseDue(form.elements.due.value),remind:form.elements.remind.checked});
     const result=await request(clear?'controlClear':'controlSave',input);
     if(run!==generation)return;
     tasks=tasks.filter(t=>!(t.order_id===oid&&t.issue_code===code));if(result.task?.active)tasks.push(result.task);
     closeEditor();refresh();await load(true);
    }catch(e){message.textContent=e.message}finally{saving=false;if(dialog===box)form.querySelectorAll('button').forEach(b=>b.disabled=false)}
   }
   form.addEventListener('submit',e=>{e.preventDefault();save()});box.querySelector('[data-ct-clear]')?.addEventListener('click',()=>save(true));
   form.elements.assignee.focus();
  }catch(e){if(dialog===box)box.querySelector('[role="status"]').textContent=e.message}
 }
 document.addEventListener('click',event=>{
  if(event.target.closest?.('[data-ct-close]')){closeEditor();return;}
  if(!who())return;
  const editButton=event.target.closest?.('[data-ct-edit]');if(editButton){edit(editButton.dataset.ctEdit,editButton.dataset.ctCode);return;}
  if(event.target.closest?.('[data-ct-refresh]')){load(true);return;}
  const open=event.target.closest?.('[data-ct-open]');if(open&&typeof root.openOrder==='function')root.openOrder(open.dataset.ctOpen);
 });
 function start(){
  new MutationObserver(refresh).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  refresh();
 }
 document.addEventListener('bos:data-refreshed',()=>{refresh();load()});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();load()}});
 root.addEventListener('storage',refresh);root.addEventListener('pageshow',refresh);
 setInterval(()=>{refresh();load()},60000);
 const style=document.createElement('style');style.textContent='.ctBar,.ctMeta,.ctOwn{display:flex;flex-direction:column;gap:8px;min-width:0}.ctBar{font-size:12px;padding:10px 0}.ctMeta{border-top:1px dashed var(--line,#778);padding-top:10px}.ctMeta button,.ctOwn button{min-height:44px;white-space:normal}.ctOwn{border-top:1px solid var(--line,#778);padding:12px 0}.ctDialog{background:var(--card,#101b2a);color:var(--text,#edf3ff);border:1px solid var(--line,#778);border-radius:16px;width:min(520px,calc(100vw - 24px));max-height:90dvh;overflow:auto;box-sizing:border-box;padding:18px}.ctDialog::backdrop{background:rgba(0,0,0,.65)}.ctDialog label{display:flex;flex-direction:column;gap:7px;margin:14px 0}.ctDialog select,.ctDialog input:not([type=checkbox]){width:100%;min-width:0;box-sizing:border-box;min-height:44px}.ctDialog .ctCheckbox{flex-direction:row;align-items:center}.ctActions{display:flex;flex-wrap:wrap;gap:8px}.ctActions button{min-height:44px;flex:1 1 120px}.ctDialog [role=alert]{color:#ffb9b9;overflow-wrap:anywhere}';document.head.appendChild(style);
 root.BOS_CONTROL_TASKS=Object.freeze({...core,refresh,reload:()=>load(true)});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 const titles={reschedule:'Перенос визита',overdue:'Проверить результат визита',unassigned:'Назначить мастера',undated:'Согласовать дату',untimed:'Согласовать время',agreement:'Связаться с клиентом',report_review:'Проверить отчёт',report_rejected:'Исправить отчёт',unfinished_work:'Уточнить невыполненные работы'};
 function parseDue(value){
  if(!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(String(value)))throw new Error('Укажите корректные дату и время.');
  const result=new Date(value+':00+03:00');
  if(!Number.isFinite(result.getTime())||toInput(result)!==value)throw new Error('Укажите существующую дату.');
  return result.toISOString();
 }
 function toInput(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';return new Date(d.getTime()+10800000).toISOString().slice(0,16)}
 function displayDue(value){return new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value))}
 return {parseDue,toInput,displayDue,titles};
});
