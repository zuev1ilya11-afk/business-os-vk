(()=>{
  'use strict';
  const MARK='bos_android_nav_v112';
  let applyingHistory=false;
  const rawShow=typeof window.show==='function'?window.show:null;
  const rawOpenModal=typeof window.openModal==='function'?window.openModal:null;
  const rawCloseModal=typeof window.closeModal==='function'?window.closeModal:null;

  function activePage(){
    return document.querySelector('nav button.active[data-page]')?.dataset.page||'home';
  }
  function pageState(page){
    return {[MARK]:true,kind:'page',page:String(page||'home')};
  }
  function pushPage(page){
    if(applyingHistory)return;
    const next=String(page||activePage()||'home');
    const current=history.state;
    if(current?.[MARK]&&current.kind==='page'&&current.page===next)return;
    history.pushState(pageState(next),'',location.href);
  }
  function seedHistory(){
    const current=history.state;
    if(current?.[MARK])return;
    history.replaceState({[MARK]:true,kind:'guard'},'',location.href);
    history.pushState(pageState(activePage()),'',location.href);
  }

  if(rawShow){
    window.show=function(name){
      const out=rawShow.apply(this,arguments);
      pushPage(name||activePage());
      return out;
    };
    try{show=window.show}catch(_){}
  }

  if(rawOpenModal){
    window.openModal=function(){
      const out=rawOpenModal.apply(this,arguments);
      if(!applyingHistory){
        const current=history.state;
        if(!(current?.[MARK]&&current.kind==='modal')){
          history.pushState({[MARK]:true,kind:'modal',page:activePage()},'',location.href);
        }
      }
      return out;
    };
    try{openModal=window.openModal}catch(_){}
  }

  window.addEventListener('popstate',event=>{
    applyingHistory=true;
    try{
      if(document.querySelector('#modalRoot .modalBackdrop')&&rawCloseModal)rawCloseModal();
      const s=event.state;
      if(s?.[MARK]&&s.kind==='page'){
        if(rawShow)rawShow(s.page||'home');
        return;
      }
      if(s?.[MARK]&&s.kind==='modal'){
        if(rawShow)rawShow(s.page||'home');
        return;
      }
      // The guard is the bottom of the in-app stack. Recreate the home entry
      // instead of letting Android leave/close the installed app or WebView.
      if(rawShow)rawShow('home');
      history.pushState(pageState('home'),'',location.href);
    }finally{
      applyingHistory=false;
    }
  });

  // Some role-specific patches attach their own nav handlers after app-public.
  // Record the resulting page as a fallback without duplicating show() entries.
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('nav button[data-page]');
    if(!button)return;
    const page=button.dataset.page;
    setTimeout(()=>pushPage(page),0);
  },true);

  seedHistory();
})();
