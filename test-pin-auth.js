(()=>{
  const SESSION_KEY='bos_vk_session_v2';
  const MANUAL_KEY='bos_manual_logout_v1';
  const API='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/test-pin-session';
  function getSession(){try{return sessionStorage.getItem(SESSION_KEY)||localStorage.getItem(SESSION_KEY)||''}catch(_){return ''}}
  function setSession(v){try{sessionStorage.setItem(SESSION_KEY,v);localStorage.setItem(SESSION_KEY,v);localStorage.removeItem(MANUAL_KEY)}catch(_){}}
  function showPin(){
    if(getSession())return;
    const c=document.querySelector('#content');if(!c)return;
    c.innerHTML=`<section class="hero"><h2>Тестовый вход</h2><p class="muted">Введите PIN для входа владельца.</p><form id="bosPinForm" class="form"><input name="pin" type="tel" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="6-значный PIN" required><button class="primary wide" type="submit">Войти</button><p id="bosPinMsg" class="muted"></p></form></section>`;
    const form=document.querySelector('#bosPinForm');
    form.onsubmit=async e=>{e.preventDefault();const msg=document.querySelector('#bosPinMsg');msg.textContent='Входим…';try{const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:form.elements.pin.value})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Ошибка входа');setSession(d.session_token);location.reload()}catch(err){msg.textContent=err.message}};
  }
  const originalInit=typeof init==='function'?init:null;
  if(originalInit){init=async function(){if(!getSession())return showPin();return originalInit()}}
  window.BOS_SHOW_TEST_PIN=showPin;
  if(!getSession())setTimeout(showPin,0);
})();