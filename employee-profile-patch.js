function employeeOrders(u){return u.role==='master'?state.orders.filter(o=>String(o.master_vk_id||o.master_id||'')===String(u.vk_user_id||u.id||'')):state.orders}
function employeeMasterData(u){return state.masters.find(m=>String(m.vk_user_id||m.user_id||m.id)===String(u.vk_user_id||u.id))||null}
function employeeClaims(u){const m=employeeMasterData(u);const ids=[u.vk_user_id,u.id,m?.id,m?.user_id].filter(Boolean).map(String);return (state.claims||[]).filter(c=>ids.includes(String(c.master_id||'')))}
function qualityLabel(rate){if(rate<=3)return'Отлично';if(rate<=7)return'Норма';if(rate<=12)return'Требует внимания';return'Высокий возврат'}
function openEmployeeProfile(id){const u=state.users.find(x=>String(x.vk_user_id||x.id)===String(id));if(!u)return;const orders=employeeOrders(u);const done=orders.filter(o=>o.status==='Выполнена');const active=orders.filter(o=>['Назначена','В работе'].includes(o.status));const total=done.reduce((a,o)=>a+Number(o.amount||0),0);const extras=done.reduce((a,o)=>a+Number(o.extra_work_amount||0),0);const m=employeeMasterData(u);let roleStats='';if(u.role==='master'){const pay=done.reduce((a,o)=>a+Number(window.BOS_ORDER_PAYROLL?.directMaster(o)??payout(o.amount)),0);const claims=employeeClaims(u);const claimCount=claims.length;const closedClaims=claims.filter(c=>c.status==='closed').length;const openClaims=claims.filter(c=>c.status==='open').length;const rate=done.length?Math.round(claimCount/done.length*1000)/10:0;const revisitPay=claims.reduce((a,c)=>a+Number(c.revisit_payment||0),0);roleStats=`<div class="grid"><div class="card metric"><span class="muted">В работе</span><strong>${active.length}</strong></div><div class="card metric"><span class="muted">Выполнено</span><strong>${done.length}</strong></div><div class="card metric"><span class="muted">Сумма заявок</span><strong>${money(total)}</strong></div><div class="card metric"><span class="muted">Начислено</span><strong>${money(pay)}</strong></div><div class="card metric"><span class="muted">Допработы</span><strong>${money(extras)}</strong></div><div class="card metric"><span class="muted">Претензии</span><strong>${claimCount}</strong></div><div class="card metric"><span class="muted">Возвраты</span><strong>${rate}%</strong><small class="muted">${qualityLabel(rate)}</small></div><div class="card metric"><span class="muted">Открыто претензий</span><strong>${openClaims}</strong></div><div class="card metric"><span class="muted">Закрыто претензий</span><strong>${closedClaims}</strong></div><div class="card metric"><span class="muted">Оплата повторных выездов</span><strong>${money(revisitPay)}</strong></div></div>${m?`<section class="card"><p><b>Специализация:</b> ${esc(m.specialization||'—')}</p><p><b>График:</b> ${esc(m.work_start||'—')}–${esc(m.work_end||'—')}</p></section>`:''}${claimCount?`<section class="card"><div class="row"><h3>Претензии мастера</h3><button class="secondary" onclick="closeModal();refreshClaims().then(()=>showClaims())">Все претензии</button></div>${claims.slice(0,5).map(c=>`<button class="secondary wide" style="margin:8px 0;text-align:left" onclick="openClaimDetails('${esc(c.id)}')"><b>${esc(c.reason||'Претензия')}</b><br><span class="muted">${c.status==='closed'?'Закрыта':'Открыта'}${c.scheduled_date?' · '+esc(c.scheduled_date):''}</span></button>`).join('')}</section>`:''}`}
else if(u.role==='manager'){const completed=state.orders.filter(o=>o.status==='Выполнена').length;const inWork=state.orders.filter(o=>['Новая','Назначена','В работе'].includes(o.status)).length;roleStats=`<div class="grid"><div class="card metric"><span class="muted">Выполнено заявок</span><strong>${completed}</strong></div><div class="card metric"><span class="muted">Заявок в работе</span><strong>${inWork}</strong></div></div>`}
else if(u.role==='dispatcher'){const inWork=state.orders.filter(o=>['Новая','Назначена','В работе'].includes(o.status)).length;const unassigned=state.orders.filter(o=>['Новая','Назначена','В работе'].includes(o.status)&&!String(o.master_staff_id||o.master_vk_id||o.master_id||'').trim()).length;roleStats=`<div class="grid"><div class="card metric"><span class="muted">Заявок в работе</span><strong>${inWork}</strong></div><div class="card metric"><span class="muted">Без мастера</span><strong>${unassigned}</strong></div></div>`}
openModal(`<h2>${esc(u.full_name||u.name)}</h2><p><span class="status info">${esc(ROLE_NAMES[u.role]||u.role)}</span></p><section class="card"><p><b>Телефон:</b> ${esc(u.phone||'—')}</p><p><b>Город:</b> ${esc(u.city||'—')}</p><p><b>Статус:</b> ${String(u.is_active??u.active)==='false'?'Неактивен':'Активен'}</p>${u.comment?`<p><b>Комментарий:</b> ${esc(u.comment)}</p>`:''}</section>${roleStats}${u.role==='master'?'<p class="muted">Фактически выплачено: —. Подтверждённых данных о переводах нет.</p>':''}${u.role==='master'&&orders.length?`<section class="card"><h3>Последние заявки</h3>${orders.slice(0,5).map(o=>`<div class="row" style="margin:10px 0"><span>${esc(o.id)} · ${esc(o.status)}</span><b>${money(o.amount)}</b></div>`).join('')}</section>`:''}<button class="secondary wide" onclick="openOwnerProfile()">← К списку сотрудников</button>`)}
function openOwnerProfile(){openModal(`<h2>Профиль владельца</h2><section class="card"><p><b>Имя:</b> ${esc(state.user.full_name||'Илья')}</p><p><b>Роль:</b> Владелец</p><p><b>Город:</b> ${esc(state.user.city||'Москва')}</p></section><div class="row"><h3>Сотрудники</h3><span class="muted">${state.users.filter(u=>u.role!=='owner').length}</span></div>${state.users.filter(u=>u.role!=='owner').map(u=>`<button class="secondary wide" style="margin:8px 0;text-align:left" onclick="openEmployeeProfile('${esc(u.vk_user_id||u.id)}')"><b>${esc(u.full_name||u.name)}</b><br><span class="muted">${esc(ROLE_NAMES[u.role]||u.role)} · ${esc(u.city||'')}</span></button>`).join('')||'<p class="muted">Других сотрудников пока нет.</p>'}<button class="primary wide" onclick="closeModal();reloadData(true)">Обновить данные</button>`)}
$('#profileBtn').onclick=openOwnerProfile;
const profileTeamBase=pages.team;
pages.team=function(){const html=profileTeamBase();return html.replace(/<section class="card"><div class="row"><div><b>([^<]+)<\/b>/g,(match,name)=>{const u=state.users.find(x=>String(x.full_name||x.name)===String(name));return u?`<section class="card" onclick="openEmployeeProfile('${esc(u.vk_user_id||u.id)}')"><div class="row"><div><b>${esc(name)}</b>`:match})};
// Presentation of management forms uses the original input nodes and listeners.
(()=>{
 function decorateManagementModal(){
  if(!['owner','manager'].includes(document.body.dataset.bosUiRole))return;
  const modal=document.querySelector('#modalRoot .modal');if(!modal)return;
  if(modal.querySelector('.ownerToolsHead'))modal.classList.add('bosManagementTools');
  if(modal.querySelector('button[onclick*=openStaffAdminCard]')||modal.querySelector('#staffCredForm'))modal.classList.add('bosManagementAccess');
  if(modal.querySelector('#empForm,#staffCredForm,#managerMemoForm,#ownerMemoForm,#manualCompletionForm,#bosDeleteOrderForm'))modal.classList.add('bosManagementForm');
  const title=modal.querySelector(':scope>h2');
  if(title&&['Мой профиль','Профиль владельца'].includes(title.textContent.trim())){
   modal.classList.add('bosManagementProfile');
   const identity=title.nextElementSibling;
   if(identity?.matches('section.card'))identity.classList.add('bosManagementIdentity');
   if(!modal.querySelector('.bosManagementProfileMenu')){
    const menu=document.createElement('div');menu.className='bosManagementProfileMenu';
    identity?.after(menu);
    if(!modal.querySelector('#bosOwnerLogout')&&window.BOS_PROFILE_LOGOUT){const b=document.createElement('button');b.id='bosOwnerLogout';b.className='secondary wide';b.textContent='Выйти';b.onclick=()=>window.BOS_PROFILE_LOGOUT();modal.appendChild(b)}
   }
  }
  modal.querySelectorAll('form label:not([for])').forEach(label=>{
   const input=label.nextElementSibling;
   if(!input?.matches('input,select,textarea'))return;
   if(!input.id)input.id='bosManagementField-'+(input.name||'input');
   label.htmlFor=input.id;
  });
 }
 let queued=false;
 const root=document.getElementById('modalRoot');if(root)new MutationObserver(()=>{if(!queued){queued=true;queueMicrotask(()=>{queued=false;decorateManagementModal()})}}).observe(root,{childList:true,subtree:true});
})();

// Approved shared presentation. Existing forms, permissions and submitters are retained.
(()=>{
 const current=()=>{
  if(window.BOS_IS_MANAGER_PREVIEW?.())return window.BOS_MANAGER_PREVIEW_USER?.()||{};
  if(typeof isDispatcherPreview==='function'&&isDispatcherPreview()&&typeof dispatcherPreviewUser!=='undefined')return dispatcherPreviewUser||{};
  return typeof liveMasterUser==='function'&&typeof liveMasterMode==='function'&&liveMasterMode()?liveMasterUser():state.user||{};
 };
 function info(kind){
  const u=current(),role=document.body.dataset.bosUiRole||u.role;
  const row=(a,b)=>`<div class="bosSharedRow"><span>${esc(a)}</span><b>${esc(b||'—')}</b></div>`;
  let body='';
  if(kind==='personal')body='<h2>Личные данные</h2><p class="muted">Информация вашего рабочего профиля</p>'+row('Фамилия и имя',u.full_name||u.name)+row('Телефон',u.phone)+row('Город',u.city)+row('Роль',ROLE_NAMES[role]||role)+'<p class="bosSharedNotice">Для изменения данных обратитесь к владельцу.</p>';
  if(kind==='help')body='<h2>Помощь</h2><p class="muted">Рабочие вопросы и инструкции</p>'+row('Вопрос по заявке','Свяжитесь с диспетчером или руководителем')+row('Отчёт о работе','Приложите читаемый акт и фотографии результата')+row('Перенос визита','Дата визита и обратного звонка задаются отдельно')+row('Проблема с доступом','Обратитесь к владельцу');
  if(kind==='about')body='<h2>О приложении</h2><p class="muted">Business OS · Рабочая система команды</p>'+row('Версия интерфейса',window.BOS_BUILD?.id)+row('Часовой пояс заявок','Москва')+row('Соединение',navigator.onLine?'В сети':'Нет соединения');
  openModal('<section class="bosSharedInfo">'+body+'</section>');
 }
 function entry(parent,kind,label,action){if(parent.querySelector(`[data-bos-shared="${kind}"]`))return;const b=document.createElement('button');b.type='button';b.className='secondary wide';b.dataset.bosShared=kind;b.textContent=label+' →';b.onclick=action||(()=>info(kind));parent.appendChild(b);}
 function decorate(){
  const role=document.body.dataset.bosUiRole;if(!role)return;
  const modal=document.querySelector('#modalRoot .modal'),master=document.querySelector('.bosProfileMenu');
  let menu=modal?.querySelector('.bosManagementProfileMenu');
  if(!menu&&role==='dispatcher'&&modal?.querySelector('h2')?.textContent==='Мой профиль'){
   menu=document.createElement('div');menu.className='bosManagementProfileMenu';modal.appendChild(menu);modal.classList.add('bosManagementProfile');
  }
  for(const target of [menu,master].filter(Boolean)){
   if(target===menu)entry(target,'personal','Личные данные');
   entry(target,'help','Помощь');entry(target,'about','О приложении');
   if(target===menu&&window.BOS_OPEN_AUTH_SETTINGS)entry(target,'login','Настройки входа',()=>BOS_OPEN_AUTH_SETTINGS());
   if(target===master&&window.BOS_PROFILE_LOGOUT)entry(target,'logout','Выйти из аккаунта',()=>BOS_PROFILE_LOGOUT());
  }
  if(menu){
   const device=modal.querySelector('[data-bos-push-entry]');
   if(device&&device.parentElement!==menu)menu.appendChild(device);
   // Earlier extensions append the same login entry asynchronously.
   if(menu.querySelector('[data-bos-shared=login]'))modal.querySelector('#authSettingsProfileSection')?.remove();
  }
  if(!modal)return;
  const catalog=modal.querySelector('.bosSharedCatalog'),avito=modal.querySelector('.bosAvitoCatalog'),materials=modal.querySelector('.bosPriceMaterials');
  if(catalog&&avito&&!modal.querySelector('.bosPriceTabs')){
   modal.classList.add('bosSharedScreen');const tabs=document.createElement('div');tabs.className='bosPriceTabs';tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Разделы прайса');
   const sections={catalog,avito,materials};
   for(const [key,title] of [['catalog','Каталог работ'],['avito','Прайс Авито'],['materials','Материалы']]){if(!sections[key])continue;const b=document.createElement('button');b.type='button';b.dataset.priceTab=key;b.textContent=title;b.onclick=()=>{for(const [name,section] of Object.entries(sections)){if(section)section.hidden=name!==key;}tabs.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button===b)));if(key==='materials')materials.open=true;};tabs.appendChild(b);}
   avito.before(tabs);tabs.querySelector('[data-price-tab=catalog]').click();
  }
  const toolsHead=modal.querySelector('.ownerToolsHead');
  if(toolsHead&&!modal.dataset.bosToolsOrdered){modal.dataset.bosToolsOrdered='1';const tools=[...modal.querySelectorAll(':scope>section.card')].find(s=>s.querySelector('h3')?.textContent==='Инструменты');if(tools)toolsHead.after(tools);}
  if(modal.querySelector('.bosSharedInfo,#bosPushMessage,#masterMemoItems'))modal.classList.add('bosSharedScreen');
  if(modal.classList.contains('bosManagementProfile')){
   // Keep existing financial adjustment values available, away from personal identity.
   for(const section of modal.querySelectorAll(':scope>section.card')){
    if(section.querySelector('h3')?.textContent==='Корректировки по выполненным заявкам'){
     const d=document.createElement('details');d.className='bosSharedDisclosure';const s=document.createElement('summary');s.textContent='Корректировки по выполненным заявкам';d.appendChild(s);section.before(d);d.appendChild(section);
    }
   }
  }
  const form=modal.querySelector('#apiIntForm,#apiMapForm,#avitoConnectForm,#claimForm,#masterProfileEditForm,#bosCredForm,#handsAssignForm,#handsReportForm,#handsFileForm');
  if(form){modal.classList.add('bosSharedForm');
   for(const input of form.querySelectorAll('input:not([type=checkbox]):not([type=hidden]),textarea,select')){
    if(input.closest('label'))continue;
    if(input.id&&modal.querySelector(`label[for="${input.id}"]`))continue;
    const previous=input.previousElementSibling;
    if(previous?.tagName==='LABEL'&&!previous.querySelector('input')){if(!input.id)input.id='bosShared-'+form.id+'-'+input.name;previous.htmlFor=input.id;continue;}
    const labels={scheduled_date:'Дата повторного визита',scheduled_time:'Время повторного визита',reason:'Причина',required_work:'Что нужно исправить',revisit_payment:'Сумма мастеру',payment_note:'Комментарий к оплате',client_id:'Client ID',client_secret:'Client Secret',specialist:'Мастер',relation:'Тип файла'};
    const label=document.createElement('label');if(!input.id)input.id='bosShared-'+form.id+'-'+input.name;label.htmlFor=input.id;label.textContent=labels[input.name]||input.placeholder||'Файл';input.before(label);
   }
  }
  if(modal.querySelector('.apiState,.avitoSetupCard,#avitoSyncBtn,#apiIntForm,#apiMapForm,#handsSyncMsg'))modal.classList.add('bosSharedIntegration');
  if(modal.querySelector('#claimForm')||/^Претензия$/.test(modal.querySelector('h2')?.textContent||''))modal.classList.add('bosSharedClaim');
 }
 let queued=false;function queue(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;decorate()});}
 for(const id of ['content','modalRoot']){const root=document.getElementById(id);if(root)new MutationObserver(queue).observe(root,{childList:true,subtree:true});}
})();
// A failed existing photo remains recoverable without changing its signed URL.
document.addEventListener('error',event=>{
 const img=event.target;if(!img?.matches?.('#reportPhotoViewer img'))return;
 const panel=img.closest('.reportPhotoViewerPanel');if(!panel||panel.querySelector('.bosSharedPhotoError'))return;
 const note=document.createElement('div');note.className='bosSharedPhotoError';note.setAttribute('role','status');
 note.innerHTML='<h3>Не удалось открыть фото</h3><p class="muted">Файл может быть временно недоступен. Повторите загрузку или откройте оригинал.</p><button type="button" class="primary">Повторить</button>';
 note.querySelector('button').onclick=()=>{note.remove();img.src=img.src;};img.after(note);
 img.addEventListener('load',()=>panel.querySelector('.bosSharedPhotoError')?.remove(),{once:true});
},true);
// Labels augment the existing authentication DOM; authentication code is untouched.
(()=>{
 const gate=document.getElementById('authGate');if(!gate)return;
 const label=()=>{for(const input of gate.querySelectorAll('form input[name]')){
  if(input.closest('label'))continue;if(input.id&&gate.querySelector(`label[for="${input.id}"]`))continue;
  if(!input.id)input.id='bosGate-'+input.name;const el=document.createElement('label');el.htmlFor=input.id;el.textContent={login:'Логин',password:'Пароль',code:'Код приглашения'}[input.name]||input.placeholder;input.before(el);
 }};
 new MutationObserver(label).observe(gate,{childList:true,subtree:true});label();
})();
// Push presentation reads browser/device state only; original connection actions own account binding.
(()=>{
 const root=document.getElementById('modalRoot');if(!root)return;
 let current=null,observeMessage=null,revision=0;
 function mount(){
  const message=root.querySelector('#bosPushMessage');if(message===current)return;
  observeMessage?.disconnect();current=message;revision++;if(!message)return;
  const rows=document.createElement('dl');rows.className='bosPushStates';
  rows.innerHTML='<div><dt>Поддержка браузера</dt><dd data-push-state="support"></dd></div><div><dt>Разрешение уведомлений</dt><dd data-push-state="permission"></dd></div><div><dt>Подписка устройства</dt><dd data-push-state="subscription"></dd></div>';
  message.before(rows);
  async function update(){
   const run=++revision;
   const set=(key,text)=>{const field=rows.querySelector(`[data-push-state="${key}"]`);if(field.textContent!==text)field.textContent=text;};
   const supported=isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
   set('support',supported?'Поддерживается':'Не поддерживается');
   set('permission','Notification' in window?({default:'Не запрошено',granted:'Разрешено',denied:'Запрещено'}[Notification.permission]||'Не удалось проверить'):'Недоступно в этом браузере');
   set('subscription',supported?'Не проверена':'Недоступна в этом браузере');
   if(!supported)return;
   try{
    if(typeof navigator.serviceWorker.getRegistration!=='function')throw new Error('Inspection unavailable');
    const reg=await navigator.serviceWorker.getRegistration();
    const subscription=reg?await reg.pushManager.getSubscription():null;
    if(run===revision&&current===message&&rows.isConnected)set('subscription',subscription?'Есть на этом устройстве':'Нет на этом устройстве');
   }catch{if(run===revision&&current===message&&rows.isConnected)set('subscription','Не удалось проверить');}
  }
  observeMessage=new MutationObserver(update);observeMessage.observe(message,{childList:true,subtree:true,characterData:true});
  void update();
 }
 new MutationObserver(mount).observe(root,{childList:true,subtree:true});mount();
})();
