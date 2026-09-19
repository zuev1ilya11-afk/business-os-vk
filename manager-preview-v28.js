(()=>{
  let managerPreviewUser=null;
  const isOwner=()=>String(state?.user?.role||'')==='owner';
  const isManagerPreview=()=>!!managerPreviewUser;
  window.BOS_IS_MANAGER_PREVIEW=isManagerPreview;
  window.BOS_MANAGER_PREVIEW_USER=()=>managerPreviewUser;

  function updateManagerNav(){
    if(!isManagerPreview())return;
    const labels=['Главная','Заявки','График','Команда'];
    document.querySelectorAll('nav button').forEach((b,i)=>{if(labels[i])b.textContent=labels[i]});
    const badge=document.querySelector('#roleBadge');if(badge)badge.textContent='Руководитель · тест';
    const avatar=document.querySelector('#profileBtn');if(avatar)avatar.textContent=(managerPreviewUser.full_name||'Р').trim().split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();
    const ownerTools=document.querySelector('#ownerToolsBtn');if(ownerTools)ownerTools.style.display='none';
  }

  const previousShow=window.show;
  window.show=function(name){previousShow(name);updateManagerNav()};

  window.enterManagerPreview=function(id){
    if(!isOwner())return;
    const u=(state.users||[]).find(x=>String(x.id||x.vk_user_id||x.external_id)===String(id)&&x.role==='manager');
    if(!u)return;
    managerPreviewUser=u;
    try{if(typeof previewRole!=='undefined')previewRole='owner';if(typeof previewUser!=='undefined')previewUser=null;if(typeof dispatcherPreviewUser!=='undefined')dispatcherPreviewUser=null}catch(_){ }
    closeModal();show('home');updateManagerNav();
  };
  window.exitManagerPreview=function(){if(!isOwner())return;managerPreviewUser=null;show('home')};

  // Preview/impersonation is an owner-only diagnostic feature. Keep the guards
  // at the final wrapper layer so older preview modules cannot bypass them.
  const previousEnterMaster=window.enterMasterPreview;
  if(typeof previousEnterMaster==='function')window.enterMasterPreview=function(id){if(!isOwner())return;return previousEnterMaster(id)};
  const previousEnterDispatcher=window.enterDispatcherPreview;
  if(typeof previousEnterDispatcher==='function')window.enterDispatcherPreview=function(id){if(!isOwner())return;return previousEnterDispatcher(id)};
  const previousExitDispatcher=window.exitDispatcherPreview;
  if(typeof previousExitDispatcher==='function')window.exitDispatcherPreview=function(){if(!isOwner())return;return previousExitDispatcher()};

  const previousProfile=window.openOwnerProfile;
  window.openOwnerProfile=function(){
    if(isManagerPreview()){
      openModal(`<h2>Тест: руководитель</h2><section class="card"><p><b>${esc(managerPreviewUser.full_name||'Руководитель')}</b></p><p><span class="status info">Руководитель</span></p><p class="muted">Тестовый просмотр интерфейса и рабочих разделов руководителя.</p></section><button class="secondary wide" onclick="exitManagerPreview()">← Вернуться к владельцу</button>`);
      return;
    }
    const liveRole=String(state?.user?.role||'');
    if(liveRole==='manager'||liveRole==='dispatcher'){
      const u=state.user||{};
      const roleName=liveRole==='manager'?'Руководитель':'Диспетчер';
      openModal(`<h2>Мой профиль</h2><section class="card"><p><b>${esc(u.full_name||roleName)}</b></p><p><b>Роль:</b> ${roleName}</p><p><b>Город:</b> ${esc(u.city||'—')}</p><p><b>Телефон:</b> ${esc(u.phone||'—')}</p></section>`);
      return;
    }
    previousProfile();
  };
})();