(()=>{
'use strict';
function isMasterMenu(){return (typeof liveMasterMode==='function'&&liveMasterMode())||(typeof isMasterPreview==='function'&&isMasterPreview())}
function fixMasterNav(){
  const nav=document.querySelector('nav');if(!nav)return;
  if(!isMasterMenu()){nav.style.gridTemplateColumns='';[...nav.querySelectorAll('button')].forEach(b=>b.style.display='');return;}
  const buttons=[...nav.querySelectorAll('button')];
  const labels=['Главная','Заявки','График','Профиль'];
  buttons.forEach((b,i)=>{
    if(i<4){b.style.display='';b.textContent=labels[i];}
    else b.style.display='none';
  });
  nav.style.gridTemplateColumns='repeat(4,minmax(0,1fr))';
}
const prevShow=window.show;
window.show=function(name){prevShow(name);fixMasterNav()};
setTimeout(fixMasterNav,0);
window.fixMasterNav=fixMasterNav;
})();