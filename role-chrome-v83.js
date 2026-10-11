(()=>{
'use strict';

function appState(){try{return typeof state!=='undefined'&&state?state:null}catch(_){return null}}
function isMasterRolePreview(){return String(appState()?.user?.role||'')!=='master'&&typeof isMasterPreview==='function'&&!!isMasterPreview()}
function isDispatcherRolePreview(){return typeof isDispatcherPreview==='function'&&!!isDispatcherPreview()}
function isManagerRolePreview(){return !!window.BOS_IS_MANAGER_PREVIEW?.()}
function isLiveMaster(){return !isMasterRolePreview()&&String(appState()?.user?.role||'')==='master'}
function effectiveRole(){
  if(isManagerRolePreview())return'manager';
  if(isMasterRolePreview())return'master';
  if(isDispatcherRolePreview())return'dispatcher';
  return String(appState()?.user?.role||'owner');
}
function effectiveUser(role){
  if(role==='manager'&&isManagerRolePreview())return window.BOS_MANAGER_PREVIEW_USER?.()||appState()?.user||{};
  if(role==='master'&&isMasterRolePreview()&&typeof previewUser!=='undefined'&&previewUser)return previewUser;
  if(role==='dispatcher'&&isDispatcherRolePreview()&&typeof dispatcherPreviewUser!=='undefined'&&dispatcherPreviewUser)return dispatcherPreviewUser;
  return appState()?.user||{};
}
function identityValues(row){return [row?.id,row?.staff_id,row?.master_id,row?.user_id,row?.vk_user_id,row?.external_id].filter(Boolean).map(String)}
function liveMasterIds(){
  const s=appState(),user=s?.user||{},ids=new Set(identityValues(user));
  for(const master of s?.masters||[]){const values=identityValues(master);if(values.some(value=>ids.has(value)))values.forEach(value=>ids.add(value))}
  return ids;
}
function liveMasterOrders(list){
  if(!isLiveMaster())return Array.isArray(list)?list:[];
  const ids=liveMasterIds();
  return (Array.isArray(list)?list:[]).filter(order=>[order?.master_staff_id,order?.master_id,order?.master_user_id,order?.master_vk_id,order?.master_external_id].filter(Boolean).map(String).some(value=>ids.has(value)));
}
function initials(user,fallback){
  const value=String(user?.full_name||user?.name||'').trim();
  if(!value)return fallback;
  return value.split(/\s+/).map(part=>part[0]||'').join('').slice(0,2).toUpperCase()||fallback;
}
// Presentation links invoke the authoritative, existing shell controls. They do
// not load modules, grant capabilities or replace the original route handlers.
function setText(node,value){if(node&&node.textContent!==value)node.textContent=value}
function financeAvailable(){const s=appState();return !!window.BOS_PERMISSIONS?.isFinanceWorkspaceActive(s?.user,s?.settings?.permissions)&&!!document.querySelector('#app > nav [data-page="finance"]')}
function destinations(){
  if(effectiveRole()==='master')return [];
  const items=[['team','Команда','Мастера и их загрузка','○']];
  if(document.querySelector('#bosAvitoNav'))items.push(['avito','Авито','Диалоги клиентов','A']);
  if(financeAvailable())items.push(['finance','Финансы','Обзор, расходы, начисления','₽']);
  items.push(['profile','Мой профиль','Личные данные и помощь','○']);
  if(effectiveRole()==='owner'&&document.querySelector('#ownerToolsBtn'))items.push(['owner-tools','Инструменты','Администрирование','⚙']);
  return items;
}
function activateDestination(name){
  if(!destinations().some(item=>item[0]===name))return;
  const control=name==='profile'?document.querySelector('#profileBtn'):name==='owner-tools'?document.querySelector('#ownerToolsBtn'):document.querySelector(`#app > nav [data-page="${name}"]`);
  control?.click();
}
function moreHtml(){
  if(effectiveRole()==='master')return '';
  return `<section class="bosMore"><div class="bosMoreHeading"><h1>Ещё</h1><p class="muted">Рабочие разделы</p></div><div class="bosMoreMenu">${destinations().map(([name,label,detail,symbol])=>`<button type="button" data-bos-destination="${name}" aria-controls="${['profile','owner-tools'].includes(name)?'modalRoot':'content'}"><span class="bosMoreSymbol" aria-hidden="true">${symbol}</span><span class="bosMoreText"><span>${label}</span><small>${detail}</small></span><span class="bosMoreChevron" aria-hidden="true">›</span></button>`).join('')}</div></section>`;
}
function ensureNavigation(){
  const nav=document.querySelector('#app > nav');if(!nav)return;
  nav.setAttribute('aria-label','Основная навигация');
  if(!nav.querySelector('.bosNavBrand')){
    const brand=document.createElement('div');brand.className='bosNavBrand';brand.innerHTML='<span class="bosNavBrandMark" aria-hidden="true">B</span><span>Business OS</span>';nav.prepend(brand);
  }
  if(!nav.querySelector('.bosNavIdentity')){
    const identity=document.createElement('div');identity.className='bosNavIdentity';identity.innerHTML='<div class="bosNavPerson"><span class="bosNavAvatar"></span><div><div class="bosNavName"></div><div class="bosNavRole"></div></div></div><div class="bosNavCity"></div>';nav.appendChild(identity);
  }
  if(!nav.querySelector('[data-page="more"]')){
    const more=document.createElement('a');more.href='#more';more.dataset.page='more';more.textContent='Ещё';more.setAttribute('aria-controls','content');
    more.onclick=event=>{event.preventDefault();if(effectiveRole()!=='master')window.show('more')};nav.appendChild(more);
  }
  for(const [action,label] of [['profile','Профиль'],['owner-tools','Инструменты']]){
    if(nav.querySelector(`[data-action="${action}"]`))continue;
    const link=document.createElement('a');link.href='#'+action;link.dataset.action=action;link.textContent=label;
    link.onclick=event=>{event.preventDefault();activateDestination(action)};nav.appendChild(link);
  }
  const role=effectiveRole(),current=String(appState()?.page||'home');
  const user=effectiveUser(role);
  setText(nav.querySelector('.bosNavAvatar'),initials(user,'БО'));
  setText(nav.querySelector('.bosNavName'),String(user.full_name||user.name||''));
  setText(nav.querySelector('.bosNavRole'),{owner:'Владелец',manager:'Руководитель',dispatcher:'Диспетчер',master:'Мастер'}[role]||role);
  setText(nav.querySelector('.bosNavCity'),String(user.city||''));
  if(document.body.dataset.bosUiRole!==role)document.body.dataset.bosUiRole=role;
  nav.querySelector('[data-action="owner-tools"]').hidden=role!=='owner';
  nav.querySelectorAll('[data-page],[data-action]').forEach(entry=>{const label=entry.textContent.trim();if(entry.getAttribute('aria-label')!==label)entry.setAttribute('aria-label',label)});
  nav.querySelectorAll('[data-page]').forEach(entry=>{
    const destination=['opsScheduleMonth','opsFreeSlots'].includes(current)?'dispatch':current;
    const active=entry.dataset.page===destination||(entry.dataset.page==='more'&&role!=='master'&&!['home','orders','dispatch'].includes(destination));
    entry.classList.toggle('active',active);
    if(active){if(entry.getAttribute('aria-current')!=='page')entry.setAttribute('aria-current','page')}else if(entry.hasAttribute('aria-current'))entry.removeAttribute('aria-current');
  });
  if(current==='more'){
    const host=document.querySelector('#content'),html=moreHtml();
    if(host&&host.innerHTML!==html)host.innerHTML=html;
  }
}
function syncRoleChrome(){
  const role=effectiveRole();
  const dispatcherPreview=String(appState()?.user?.role||'')==='owner'&&isDispatcherRolePreview();
  const labels=role==='master'?['Главная','Мои заявки','Расписание','Профиль']:['Главная','Заявки','Расписание','Команда'];
  document.querySelectorAll('#app > nav button').forEach((button,index)=>{if(labels[index])setText(button,labels[index])});
  const badge=document.querySelector('#roleBadge');
  if(badge)setText(badge,role==='owner'?'Владелец':role==='manager'?(isManagerRolePreview()?'Руководитель · тест':'Руководитель'):role==='dispatcher'?'Диспетчер':'Мастер');
  let exit=document.getElementById('dispatcherPreviewReturn');
  if(dispatcherPreview&&badge){
    badge.textContent='Диспетчер · просмотр';
    if(!exit){
      exit=document.createElement('button');exit.id='dispatcherPreviewReturn';exit.type='button';exit.className='secondary';exit.textContent='К владельцу';
      exit.title='Завершить просмотр интерфейса диспетчера';
      exit.onclick=()=>{if(String(appState()?.user?.role||'')==='owner'&&isDispatcherRolePreview())window.exitDispatcherPreview?.()};
      badge.after(exit);
    }
  }else if(exit)exit.remove();
  const profile=document.querySelector('#profileBtn');
  if(profile&&role!=='owner')profile.textContent=initials(effectiveUser(role),role==='manager'?'Р':role==='dispatcher'?'Д':'М');
  const ownerTools=document.querySelector('#ownerToolsBtn');
  if(ownerTools)ownerTools.style.display=role==='owner'&&String(appState()?.page||'home')==='home'?'grid':'none';
  ensureNavigation();
}

const baseOwnOrders=typeof ownOrders==='function'?ownOrders:null;
if(baseOwnOrders){
  ownOrders=function(){if(isLiveMaster())return liveMasterOrders(appState()?.orders||[]);return baseOwnOrders.apply(this,arguments)};
}
if(typeof pages==='object'&&pages){
  pages.more=moreHtml;
  ['home','orders','dispatch','team'].forEach(name=>{
    const render=pages[name];if(typeof render!=='function')return;
    pages[name]=function(){
      if(!isLiveMaster())return render.apply(this,arguments);
      const s=appState();if(!s)return render.apply(this,arguments);
      const original=s.orders;s.orders=liveMasterOrders(original);
      try{return render.apply(this,arguments)}finally{s.orders=original}
    };
  });
}
const baseOpenOrder=window.openOrder;
if(typeof baseOpenOrder==='function')window.openOrder=function(id){
  if(isLiveMaster()&&!liveMasterOrders(appState()?.orders||[]).some(order=>String(order?.id)===String(id)))return;
  return baseOpenOrder.apply(this,arguments);
};
const previousShow=window.show;
if(typeof previousShow==='function')window.show=function(){const result=previousShow.apply(this,arguments);setTimeout(syncRoleChrome,0);return result};
window.BOS_SYNC_ROLE_CHROME=syncRoleChrome;
const style=document.createElement('style');
style.textContent='#app > header .brandText:has(#dispatcherPreviewReturn){display:grid!important;grid-template-columns:max-content 1fr;align-items:center;flex:1}#app > header .brandText:has(#dispatcherPreviewReturn) > h1,#app > header .brandText:has(#dispatcherPreviewReturn) > .brandSub{grid-column:1/-1}#app > header #dispatcherPreviewReturn{justify-self:start;display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin-left:7px;padding:7px 10px;font-size:12px;vertical-align:middle;white-space:nowrap}';
document.head.appendChild(style);
document.addEventListener('click',event=>{const button=event.target.closest?.('[data-bos-destination]');if(button)activateDestination(button.dataset.bosDestination)});
// Later role scripts wrap show and relabel controls. Observe the real shell so
// bundled boot, background renders and preview transitions keep approved labels.
let chromeQueued=false;
function queueChrome(){if(chromeQueued)return;chromeQueued=true;queueMicrotask(()=>{chromeQueued=false;syncRoleChrome()})}
const nav=document.querySelector('#app > nav'),content=document.querySelector('#content');
if(nav)new MutationObserver(queueChrome).observe(nav,{childList:true,subtree:true,characterData:true});
if(content)new MutationObserver(queueChrome).observe(content,{childList:true});
window.addEventListener('resize',queueChrome);
setTimeout(syncRoleChrome,0);
})();
