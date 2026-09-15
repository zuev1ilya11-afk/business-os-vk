(()=>{
'use strict';
function isMasterMenu(){return String(window.state?.user?.role||'')==='master'||(typeof liveMasterMode==='function'&&liveMasterMode())||(typeof isMasterPreview==='function'&&isMasterPreview())}
function fixMasterNav(){
  const nav=document.querySelector('nav');if(!nav)return;
  if(!isMasterMenu()){nav.style.gridTemplateColumns='';[...nav.querySelectorAll('button')].forEach(b=>b.style.display='');return;}
  const config=[['home','Главная'],['orders','Заявки'],['dispatch','График'],['team','Профиль']];
  const buttons=[...nav.querySelectorAll('button')];
  config.forEach(([page,label])=>{
    const b=nav.querySelector(`button[data-page="${page}"]`);if(!b)return;
    b.style.display='';b.textContent=label;
  });
  buttons.forEach(b=>{if(!config.some(([page])=>b.dataset.page===page))b.style.display='none'});
  nav.style.gridTemplateColumns='repeat(4,minmax(0,1fr))';
}
const prevShow=window.show;
window.show=function(name){const out=prevShow.apply(this,arguments);fixMasterNav();setTimeout(fixMasterNav,0);return out};
setTimeout(fixMasterNav,0);
window.fixMasterNav=fixMasterNav;
})();