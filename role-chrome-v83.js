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
function syncRoleChrome(){
  const role=effectiveRole();
  const labels=role==='master'?['Главная','Мои заявки','График','Профиль']:role==='dispatcher'?['Главная','Заявки','График','Мастера']:['Главная','Заявки','График','Команда'];
  document.querySelectorAll('nav button').forEach((button,index)=>{if(labels[index])button.textContent=labels[index]});
  const badge=document.querySelector('#roleBadge');
  if(badge)badge.textContent=role==='owner'?'Владелец':role==='manager'?(isManagerRolePreview()?'Руководитель · тест':'Руководитель'):role==='dispatcher'?'Диспетчер':'Мастер';
  const profile=document.querySelector('#profileBtn');
  if(profile&&role!=='owner')profile.textContent=initials(effectiveUser(role),role==='manager'?'Р':role==='dispatcher'?'Д':'М');
  const ownerTools=document.querySelector('#ownerToolsBtn');
  if(ownerTools)ownerTools.style.display=role==='owner'&&String(appState()?.page||'home')==='home'?'grid':'none';
}

const baseOwnOrders=typeof ownOrders==='function'?ownOrders:null;
if(baseOwnOrders){
  ownOrders=function(){if(isLiveMaster())return liveMasterOrders(appState()?.orders||[]);return baseOwnOrders.apply(this,arguments)};
}
if(typeof pages==='object'&&pages){
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
setTimeout(syncRoleChrome,0);
})();
