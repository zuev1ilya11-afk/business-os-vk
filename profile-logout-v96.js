(()=>{
  const SESSION_KEY='bos_vk_session_v2';
  const MANUAL_KEY='bos_manual_logout_v1';

  function logout(){
    try{
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
      localStorage.setItem(MANUAL_KEY,'1');
    }catch(_){}
    try{document.querySelector('#modalRoot').innerHTML=''}catch(_){}
    if(typeof window.BOS_FORCE_AUTH_SCREEN==='function'){
      window.BOS_FORCE_AUTH_SCREEN();
      return;
    }
    location.reload();
  }

  window.BOS_PROFILE_LOGOUT=logout;

  if(typeof window.openOwnerProfile==='function'&&!window.openOwnerProfile.__bosLogoutPatched){
    const base=window.openOwnerProfile;
    const wrapped=function(...args){
      const result=base.apply(this,args);
      const modal=document.querySelector('#modalRoot .modal');
      if(modal&&!modal.querySelector('#bosOwnerLogout')){
        const button=document.createElement('button');
        button.id='bosOwnerLogout';
        button.className='wide';
        button.style.marginTop='14px';
        button.textContent='Выйти';
        button.onclick=logout;
        modal.appendChild(button);
      }
      return result;
    };
    wrapped.__bosLogoutPatched=true;
    window.openOwnerProfile=wrapped;
    try{openOwnerProfile=wrapped}catch(_){}
  }

  document.addEventListener('click',e=>{
    const button=e.target.closest?.('#bosLogout,#bosOwnerLogout');
    if(!button)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    logout();
  },true);
})();