(()=>{
'use strict';
function dispatcherModeNow(){return (typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state.user?.role||'')==='dispatcher'}
function dispatcherUserNow(){return (typeof isDispatcherPreview==='function'&&isDispatcherPreview()&&dispatcherPreviewUser)||state.user||{}}

const dispatcherUsabilityModules=[
  'dispatcher-smart-assign-v119.js',
  'dispatcher-free-slots-v120.js',
  'dispatcher-smart-dispatch-v121.js',
  'dispatcher-unassigned-queue-v122.js',
  'dispatcher-attention-v123.js',
  'dispatcher-responsive-workbench-v157.js',
  'dispatcher-desktop-mobile-v158.js'
];
let dispatcherUsabilityLoading=null;
function loadDispatcherModule(src){
  if(document.querySelector(`script[data-bos-dispatcher-usability="${src}"]`))return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=`${src}?v=20260925-dispatcher-v158`;
    script.dataset.bosDispatcherUsability=src;
    script.onload=resolve;
    script.onerror=()=>reject(new Error(`Не удалось загрузить ${src}`));
    document.head.appendChild(script);
  });
}
async function loadDispatcherUsabilityNow(){
  for(const src of dispatcherUsabilityModules){
    try{await loadDispatcherModule(src)}catch(error){console.error('Dispatcher usability:',error)}
  }
}
function ensureDispatcherUsability(){
  if(!dispatcherModeNow())return Promise.resolve();
  if(dispatcherUsabilityLoading)return dispatcherUsabilityLoading;
  dispatcherUsabilityLoading=document.readyState==='complete'
    ?loadDispatcherUsabilityNow()
    :new Promise(resolve=>window.addEventListener('load',()=>loadDispatcherUsabilityNow().then(resolve),{once:true}));
  return dispatcherUsabilityLoading;
}

const previousHome=pages.home;
pages.home=function(){
  const html=previousHome();
  if(!dispatcherModeNow())return html;
  ensureDispatcherUsability();
  return String(html).replace(/<section class="hero">[\s\S]*?<\/section>/,'');
};
const previousShow=window.show;
window.show=function(name){
  previousShow(name);
  if(!dispatcherModeNow())return;
  ensureDispatcherUsability();
  const u=dispatcherUserNow();
  const badge=document.querySelector('#roleBadge');
  if(badge)badge.textContent=u.full_name||'Диспетчер';
};
try{
  if(dispatcherModeNow()){
    ensureDispatcherUsability();
    const badge=document.querySelector('#roleBadge');
    const u=dispatcherUserNow();
    if(badge)badge.textContent=u.full_name||'Диспетчер';
  }
}catch(e){}
})();