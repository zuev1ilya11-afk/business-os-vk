(()=>{
'use strict';

function isMasterRolePreview(){return typeof isMasterPreview==='function'&&!!isMasterPreview()}
function isDispatcherRolePreview(){return typeof isDispatcherPreview==='function'&&!!isDispatcherPreview()}
function isManagerRolePreview(){return !!window.BOS_IS_MANAGER_PREVIEW?.()}
function effectiveRole(){
  if(isManagerRolePreview())return'manager';
  if(isMasterRolePreview())return'master';
  if(isDispatcherRolePreview())return'dispatcher';
  return String(window.state?.user?.role||'owner');
}
function effectiveUser(role){
  if(role==='manager'&&isManagerRolePreview())return window.BOS_MANAGER_PREVIEW_USER?.()||state.user||{};
  if(role==='master'&&isMasterRolePreview()&&typeof previewUser!=='undefined'&&previewUser)return previewUser;
  if(role==='dispatcher'&&isDispatcherRolePreview()&&typeof dispatcherPreviewUser!=='undefined'&&dispatcherPreviewUser)return dispatcherPreviewUser;
  return window.state?.user||{};
}
function initials(user,fallback){
  const value=String(user?.full_name||user?.name||'').trim();
  if(!value)return fallback;
  return value.split(/\s+/).map(part=>part[0]||'').join('').slice(0,2).toUpperCase()||fallback;
}
function syncRoleChrome(){
  const role=effectiveRole();
  const labels=role==='master'?['Главная','Мои заявки','График','Профиль']:role==='dispatcher'?['Главная','Заявки','График','Мастера']:['Главная','Заявки','График','Команда'];
  document.querySelectorAll('nav button').forEach((button,index)=>{if(labels[index])button.textContent=labels[index]});
  const badge=document.querySelector('#roleBadge');
  if(badge)badge.textContent=role==='owner'?'Владелец':role==='manager'?(isManagerRolePreview()?'Руководитель · тест':'Руководитель'):role==='dispatcher'?'Диспетчер':'Мастер';
  const profile=document.querySelector('#profileBtn');
  if(profile&&role!=='owner')profile.textContent=initials(effectiveUser(role),role==='manager'?'Р':role==='dispatcher'?'Д':'М');
  const ownerTools=document.querySelector('#ownerToolsBtn');
  if(ownerTools)ownerTools.style.display=role==='owner'&&String(window.state?.page||'home')==='home'?'grid':'none';
}

const previousShow=window.show;
if(typeof previousShow==='function')window.show=function(){const result=previousShow.apply(this,arguments);setTimeout(syncRoleChrome,0);return result};
window.BOS_SYNC_ROLE_CHROME=syncRoleChrome;
setTimeout(syncRoleChrome,0);
})();
