(()=>{
  const SESSION_KEY='bos_vk_session_v2';
  const MANUAL_KEY='bos_manual_logout_v1';
  const PASS_API='https://business-os-api-gateway.netlify.app/api/proxy/password-session-api';

  function clearSession(){
    try{
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
      localStorage.setItem(MANUAL_KEY,'1');
    }catch(_){}
  }

  function setSession(token){
    if(!token)return;
    try{
      sessionStorage.setItem(SESSION_KEY,token);
      localStorage.setItem(SESSION_KEY,token);
      localStorage.removeItem(MANUAL_KEY);
    }catch(_){}
  }

  function hasVkLaunch(){
    const raw=[location.search,String(location.hash||'').replace(/^#/,'')].join('&');
    const p=new URLSearchParams(raw.replace(/^\?/,''));
    return p.has('vk_app_id')&&p.has('vk_user_id')&&p.has('sign');
  }

  function loggedOutScreen(){
    const gate=document.querySelector('#authGate');
    if(!gate){location.reload();return}
    document.body.classList.remove('bos-auth-ok');
    gate.style.display='flex';
    gate.innerHTML=`<div class="authGateCard"><div class="authLogo">Домашний мастер</div><h1>Вы вышли</h1><p class="muted">Для продолжения войдите снова.</p><form id="bosLogoutLoginForm" class="form"><input name="login" autocomplete="username" placeholder="Логин" required><input name="password" type="password" autocomplete="current-password" placeholder="Пароль" required><button class="primary wide" type="submit">Войти по логину и паролю</button><p id="bosLogoutLoginMsg" class="muted"></p></form>${hasVkLaunch()?'<button id="bosLogoutVkLogin" class="wide">Войти через VK</button>':''}</div>`;

    const form=document.querySelector('#bosLogoutLoginForm');
    form.onsubmit=async e=>{
      e.preventDefault();
      const msg=document.querySelector('#bosLogoutLoginMsg');
      const button=form.querySelector('button[type="submit"]');
      if(form.dataset.pending)return;
      form.dataset.pending='1';button.disabled=true;msg.textContent='Входим…';
      try{
        const r=await fetch(PASS_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',login:form.elements.login.value,password:form.elements.password.value})});
        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d?.ok||!d?.session_token)throw new Error(d?.error||'Не удалось войти');
        setSession(d.session_token);
        location.reload();
      }catch(err){msg.textContent=String(err?.message||'Ошибка входа')}
      finally{delete form.dataset.pending;button.disabled=false}
    };

    const vkButton=document.querySelector('#bosLogoutVkLogin');
    if(vkButton)vkButton.onclick=()=>{
      try{localStorage.removeItem(MANUAL_KEY)}catch(_){}
      if(typeof window.BOS_FORCE_AUTH_SCREEN==='function')window.BOS_FORCE_AUTH_SCREEN();
      else location.reload();
    };
  }

  function logout(){
    clearSession();
    try{document.querySelector('#modalRoot').innerHTML=''}catch(_){}
    loggedOutScreen();
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