(()=>{
  const MINI='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api';
  const PASS='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/password-session-api';
  const VK='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/vk-session-api';
  const KEY='bos_vk_session_v2';
  const gate=document.getElementById('authGate');
  const body=document.body;
  function getSession(){try{return sessionStorage.getItem(KEY)||localStorage.getItem(KEY)||''}catch(_){return ''}}
  function setSession(v){try{sessionStorage.setItem(KEY,v);localStorage.setItem(KEY,v)}catch(_){}}
  function clearSession(){try{sessionStorage.removeItem(KEY);localStorage.removeItem(KEY)}catch(_){}}
  function escs(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function showGate(html){if(!gate)return;gate.innerHTML=`<div class="authGateCard">${html}</div>`;gate.style.display='flex';body.classList.remove('bos-auth-ok')}
  function unlock(){if(gate)gate.style.display='none';body.classList.add('bos-auth-ok')}
  async function json(url,payload,headers={}){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(payload)});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw Object.assign(new Error(d.error||('Ошибка сервера '+r.status)),{status:r.status,data:d});return d}
  async function validate(){const s=getSession();if(!s)return false;try{await json(MINI,{action:'bootstrap'},{'X-BOS-Session':s});return true}catch(_){clearSession();return false}}
  async function loadAuthorizedApp(){
    if(typeof reloadData!=='function')throw new Error('Приложение не готово к запуску');
    await reloadData(false);
    if(!state?.user?.role)throw new Error('Не удалось определить роль сотрудника');
    try{if(typeof updateNavForRole==='function')updateNavForRole()}catch(_){ }
    try{if(typeof window.show==='function')window.show(state.page||'home')}catch(_){ }
  }
  function startScreen(msg=''){
    showGate(`<div class="authLogo">Домашний мастер</div><h1>Вход в приложение</h1><p class="muted">Для работы необходимо авторизоваться.</p>${msg?`<p class="authError">${escs(msg)}</p>`:''}<button id="authVk" class="primary wide">Войти через VK</button><button id="authPass" class="wide">Войти по логину и паролю</button>`);
    document.getElementById('authVk').onclick=vkLogin;
    document.getElementById('authPass').onclick=passwordScreen;
  }
  function passwordScreen(){
    showGate(`<div class="authLogo">Домашний мастер</div><h1>Вход по логину</h1><form id="authPassForm" class="form"><input name="login" autocomplete="username" placeholder="Логин" required><input name="password" type="password" autocomplete="current-password" placeholder="Пароль" required><button class="primary wide" type="submit">Войти</button><button id="authBack" class="wide" type="button">Назад</button><p id="authMsg" class="muted"></p></form>`);
    document.getElementById('authBack').onclick=()=>startScreen();
    document.getElementById('authPassForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,m=document.getElementById('authMsg');m.textContent='Проверяем…';try{const d=await json(PASS,{action:'login',login:f.elements.login.value,password:f.elements.password.value});setSession(d.session_token);location.reload()}catch(err){m.textContent=err.message}};
  }
  async function vkPayload(){
    let launch='';try{if(window.BOS_ENSURE_VK_LAUNCH_PARAMS)launch=await window.BOS_ENSURE_VK_LAUNCH_PARAMS()}catch(_){ }
    if(launch)return {launch_params:launch};
    if(window.vkBridge?.send){await window.vkBridge.send('VKWebAppInit',{}).catch(()=>{});const app_id=Number((window.BUSINESS_OS_CONFIG||{}).VK_APP_ID||54758847);const t=await window.vkBridge.send('VKWebAppGetAuthToken',{app_id,scope:''});if(t?.access_token)return {access_token:t.access_token}}
    throw new Error('Не удалось получить данные VK. Откройте приложение через ВКонтакте.');
  }
  async function vkLogin(){
    showGate(`<div class="authLogo">Домашний мастер</div><h1>Вход через VK</h1><p class="muted">Подтверждаем аккаунт…</p>`);
    try{const d=await json(VK,await vkPayload());setSession(d.session_token);if(d.registration_required)return phoneRegistration();location.reload()}catch(err){startScreen(err.message)}
  }
  function phoneRegistration(){
    showGate(`<div class="authLogo">Домашний мастер</div><h1>Регистрация сотрудника</h1><p class="muted">Введите номер телефона, который указан у вас в карточке сотрудника.</p><form id="authPhoneForm" class="form"><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 999 123-45-67" required><button class="primary wide" type="submit">Продолжить</button><p id="authPhoneMsg" class="muted"></p></form>`);
    document.getElementById('authPhoneForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,m=document.getElementById('authPhoneMsg');m.textContent='Проверяем…';try{const d=await json(MINI,{action:'registerByPhone',phone:f.elements.phone.value},{'X-BOS-Session':getSession()});if(d.session_token)setSession(d.session_token);location.reload()}catch(err){m.textContent=err.message}};
  }
  window.BOS_FORCE_AUTH_SCREEN=()=>{clearSession();startScreen()};
  (async()=>{
    showGate(`<div class="authLogo">Домашний мастер</div><h1>Проверяем вход…</h1><p class="muted">Пожалуйста, подождите.</p>`);
    if(!await validate())return startScreen();
    try{await loadAuthorizedApp();unlock()}catch(err){clearSession();startScreen(err.message||'Не удалось загрузить приложение')}
  })();
})();