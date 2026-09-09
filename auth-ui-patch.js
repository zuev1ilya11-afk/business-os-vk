(()=>{
  const API='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/password-session-api';
  const SESSION_KEY='bos_vk_session_v2', MANUAL_KEY='bos_manual_logout_v1';
  function getSession(){try{return sessionStorage.getItem(SESSION_KEY)||localStorage.getItem(SESSION_KEY)||''}catch(_){return ''}}
  function setSession(v){try{sessionStorage.setItem(SESSION_KEY,v);localStorage.setItem(SESSION_KEY,v)}catch(_){}}
  function clearSession(){try{sessionStorage.removeItem(SESSION_KEY);localStorage.removeItem(SESSION_KEY)}catch(_){}}
  function setManual(v){try{if(v)localStorage.setItem(MANUAL_KEY,'1');else localStorage.removeItem(MANUAL_KEY)}catch(_){}}
  function manual(){try{return localStorage.getItem(MANUAL_KEY)==='1'}catch(_){return false}}
  async function call(action,body={}){const h={'Content-Type':'application/json'},s=getSession();if(s)h['X-BOS-Session']=s;let r;try{r=await fetch(API,{method:'POST',headers:h,body:JSON.stringify({action,...body})})}catch(_){throw new Error('Не удалось подключиться к серверу')};const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||('Ошибка сервера '+r.status));return d}
  async function loginViaVk(){
    const c=document.querySelector('#content');if(!c)return;
    c.innerHTML='<section class="hero"><h2>Вход через VK</h2><p class="muted" id="bosVkMsg">Подтверждаем аккаунт…</p></section>';
    clearSession();setManual(false);
    try{
      if(window.BOS_ENSURE_VK_SESSION){const d=await window.BOS_ENSURE_VK_SESSION();if(d?.session_token)setSession(d.session_token)}
      if(!getSession())throw new Error('VK не создал сессию');
      location.reload();
    }catch(e){
      setManual(true);
      c.innerHTML=`<section class="hero"><h2>Не удалось войти через VK</h2><p class="muted">${String(e?.message||'Ошибка авторизации')}</p><button id="bosVkRetry" class="primary wide">Повторить</button><button id="bosVkBack" class="wide">Назад</button></section>`;
      document.querySelector('#bosVkRetry').onclick=loginViaVk;
      document.querySelector('#bosVkBack').onclick=loginScreen;
    }
  }
  function loginScreen(){const c=document.querySelector('#content');if(!c)return;c.innerHTML=`<section class="hero"><h2>Вход</h2><p class="muted">Выберите способ входа</p><div class="form" style="margin-top:18px"><button id="bosLoginPassword" class="primary wide">Войти по логину и паролю</button><button id="bosLoginVk" class="wide">Войти через VK</button></div></section>`;document.querySelector('#bosLoginPassword').onclick=showPasswordLogin;document.querySelector('#bosLoginVk').onclick=loginViaVk}
  function showPasswordLogin(){const c=document.querySelector('#content');if(!c)return;c.innerHTML=`<section class="hero"><h2>Вход по логину</h2><form id="bosPasswordLoginForm" class="form"><input name="login" autocomplete="username" placeholder="Логин" required><input name="password" type="password" autocomplete="current-password" placeholder="Пароль" required><button class="primary wide" type="submit">Войти</button><button id="bosBackLogin" class="wide" type="button">Назад</button><p id="bosLoginMsg" class="muted"></p></form></section>`;document.querySelector('#bosBackLogin').onclick=loginScreen;document.querySelector('#bosPasswordLoginForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,msg=document.querySelector('#bosLoginMsg');msg.textContent='Входим…';try{const d=await call('login',{login:f.elements.login.value,password:f.elements.password.value});setSession(d.session_token);setManual(false);location.reload()}catch(err){msg.textContent=err.message}}}
  function profileModal(){const root=document.querySelector('#modalRoot');if(!root)return;root.innerHTML=`<div class="modalBackdrop"><div class="modal"><button id="bosCloseProfile" class="modalClose" aria-label="Закрыть">×</button><h2>Профиль</h2><p class="muted">Настройте логин и пароль для входа без VK.</p><form id="bosCredForm" class="form"><input name="login" autocomplete="username" placeholder="Новый логин" minlength="3" required><input name="password" type="password" autocomplete="new-password" placeholder="Новый пароль (от 6 символов)" minlength="6" required><button class="primary wide" type="submit">Сохранить логин и пароль</button><p id="bosCredMsg" class="muted"></p></form><button id="bosLogout" class="wide" style="margin-top:14px">Выйти</button></div></div>`;document.querySelector('#bosCloseProfile').onclick=()=>root.innerHTML='';document.querySelector('#bosCredForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,msg=document.querySelector('#bosCredMsg');msg.textContent='Сохраняем…';try{await call('setCredentials',{login:f.elements.login.value,password:f.elements.password.value});msg.textContent='Готово. Логин и пароль сохранены.';f.elements.password.value=''}catch(err){msg.textContent=err.message}};document.querySelector('#bosLogout').onclick=()=>{clearSession();setManual(true);root.innerHTML='';loginScreen()}}
  document.addEventListener('click',e=>{const t=e.target.closest?.('#profileBtn');if(!t)return;e.preventDefault();e.stopImmediatePropagation();profileModal()},true);
  if(manual()&&!getSession())setTimeout(loginScreen,50);
})();