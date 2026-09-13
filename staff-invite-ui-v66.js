(()=>{
  const ENDPOINT='https://business-os-api-gateway.netlify.app/api/proxy/staff-invite-api';
  const escInvite=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function invitePost(action,payload={}){
    const headers=typeof window.BOS_AUTH_HEADERS==='function'?await window.BOS_AUTH_HEADERS():{'Content-Type':'application/json'};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const r=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({action,...payload}),signal:controller.signal});
      const d=await r.json().catch(()=>({}));
      if(!r.ok||d?.ok===false)throw new Error(d?.error||`Ошибка сервера ${r.status}`);
      return d;
    }catch(e){
      if(e?.name==='AbortError')throw new Error('Сервер не ответил. Повторите попытку.');
      throw e;
    }finally{clearTimeout(timer)}
  }

  function replacePhoneRegistration(){
    const old=document.getElementById('simplePhoneForm');
    if(!old||old.dataset.inviteMode==='1')return;
    const card=old.closest('.authGateCard');
    if(!card)return;
    const h=card.querySelector('h1');if(h)h.textContent='Вход по приглашению';
    const lead=card.querySelector('h1 + .muted');if(lead)lead.textContent='Введите одноразовый код, который выдал владелец. Код действует 1 час.';
    old.dataset.inviteMode='1';
    old.innerHTML='<input name="code" type="text" inputmode="text" autocomplete="one-time-code" autocapitalize="characters" maxlength="14" placeholder="Код приглашения" required><button class="primary wide" type="submit">Войти</button><p id="simpleInviteMsg" class="muted"></p>';
    old.id='simpleInviteForm';
    old.onsubmit=async e=>{
      e.preventDefault();
      const f=e.currentTarget,msg=f.querySelector('#simpleInviteMsg'),btn=f.querySelector('button');
      if(f.dataset.pending)return;
      f.dataset.pending='1';btn.disabled=true;msg.textContent='Проверяем код…';
      try{
        const d=await invitePost('redeem',{code:f.elements.code.value});
        if(!d?.user?.role)throw new Error('Не удалось привязать сотрудника');
        msg.textContent='Готово. Открываем кабинет…';
        location.reload();
      }catch(err){msg.textContent=err.message}
      finally{delete f.dataset.pending;btn.disabled=false}
    };
  }

  replacePhoneRegistration();
  const observer=new MutationObserver(replacePhoneRegistration);
  observer.observe(document.documentElement,{childList:true,subtree:true});

  function isLinked(u){return /^[1-9]\d*$/.test(String(u?.vk_user_id||u?.external_id||''))}
  function findStaff(id){return (window.state?.users||[]).find(x=>String(x.id)===String(id)||String(x.vk_user_id||x.external_id)===String(id))}

  const base=typeof window.openEmployeeProfile==='function'?window.openEmployeeProfile:null;
  if(base){
    window.openEmployeeProfile=function(id){
      const result=base.apply(this,arguments);
      try{
        if(String(window.state?.user?.role||'')!=='owner')return result;
        const u=findStaff(id),modal=document.querySelector('.modal');
        if(!u||!modal||isLinked(u)||modal.querySelector('[data-staff-invite-card]'))return result;
        const section=document.createElement('section');
        section.className='card';section.dataset.staffInviteCard='1';
        section.innerHTML=`<h3>Доступ через VK</h3><p class="muted">Сотрудник ещё не привязан к VK. Выдайте одноразовый код — он действует 1 час, а новый код отменяет предыдущий.</p><button class="secondary wide" data-issue-staff-invite>Выдать код приглашения</button><p class="muted" data-staff-invite-msg></p>`;
        const button=section.querySelector('[data-issue-staff-invite]'),msg=section.querySelector('[data-staff-invite-msg]');
        button.onclick=async()=>{
          button.disabled=true;msg.textContent='Создаём код…';
          try{
            const d=await invitePost('issue',{staff_id:u.id});
            const until=new Date(d.expires_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
            const code=String(d.code||'');
            section.innerHTML=`<h3>Код приглашения</h3><div style="font-size:28px;font-weight:800;letter-spacing:.12em;text-align:center;margin:14px 0;user-select:all">${escInvite(code)}</div><p class="muted">Передайте код сотруднику. Он действует до ${escInvite(until)} и погасится после первого входа.</p><button class="secondary wide" data-copy-invite>Скопировать код</button><button class="secondary wide" data-reissue-invite>Выдать новый код</button><p class="muted" data-staff-invite-msg></p>`;
            section.querySelector('[data-copy-invite]').onclick=async()=>{try{await navigator.clipboard.writeText(code);section.querySelector('[data-staff-invite-msg]').textContent='Код скопирован'}catch(_){section.querySelector('[data-staff-invite-msg]').textContent='Выделите код и скопируйте вручную'}};
            section.querySelector('[data-reissue-invite]').onclick=()=>{closeModal();window.openEmployeeProfile(u.id)};
          }catch(err){msg.textContent=err.message;button.disabled=false}
        };
        modal.appendChild(section);
      }catch(_){ }
      return result;
    };
  }
})();
