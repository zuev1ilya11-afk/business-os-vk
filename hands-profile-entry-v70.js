(()=>{
'use strict';
if(window.BOS_HANDS_PROFILE_ENTRY_V70)return;window.BOS_HANDS_PROFILE_ENTRY_V70=true;
const base=window.openOwnerProfile;
if(typeof base!=='function')return;
window.openOwnerProfile=function(){
  const out=base.apply(this,arguments);
  setTimeout(()=>{
    const modal=document.querySelector('.modal');
    if(!modal)return;
    const isOwner=String(state?.user?.role||'')==='owner';
    if(!isOwner)return;
    if(!modal.querySelector('#handsProfileSection')){
      const section=document.createElement('section');
      section.className='card';
      section.id='handsProfileSection';
      section.innerHTML='<h3 style="margin-top:0">Интеграции</h3><button class="secondary wide" id="handsProfileBtn"><span>Hands.ru</span><b>Открыть ›</b></button>';
      const refresh=[...modal.querySelectorAll('button')].find(b=>/обновить данные/i.test(b.textContent||''));
      if(refresh)modal.insertBefore(section,refresh);else modal.appendChild(section);
      const btn=document.getElementById('handsProfileBtn');if(btn)btn.onclick=()=>{if(typeof openHandsIntegration==='function')openHandsIntegration()};
    }
    if(!modal.querySelector('#authSettingsProfileSection')){
      const section=document.createElement('section');
      section.className='card';
      section.id='authSettingsProfileSection';
      section.innerHTML='<h3 style="margin-top:0">Вход и безопасность</h3><button class="secondary wide" id="authSettingsProfileBtn"><span>Логин и пароль</span><b>Настроить ›</b></button>';
      const refresh=[...modal.querySelectorAll('button')].find(b=>/обновить данные/i.test(b.textContent||''));
      if(refresh)modal.insertBefore(section,refresh);else modal.appendChild(section);
      const btn=document.getElementById('authSettingsProfileBtn');if(btn)btn.onclick=()=>{if(typeof window.BOS_OPEN_AUTH_SETTINGS==='function')window.BOS_OPEN_AUTH_SETTINGS()};
    }
  },0);
  return out;
};
})();
