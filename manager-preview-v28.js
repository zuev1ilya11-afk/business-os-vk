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
  window.exitManagerPreview=function(){managerPreviewUser=null;show('home')};

  const previousProfile=window.openOwnerProfile;
  window.openOwnerProfile=function(){
    if(isManagerPreview()){
      openModal(`<h2>Тест: руководитель</h2><section class="card"><p><b>${esc(managerPreviewUser.full_name||'Руководитель')}</b></p><p><span class="status info">Руководитель</span></p><p class="muted">Тестовый просмотр интерфейса и рабочих разделов руководителя.</p></section><button class="secondary wide" onclick="exitManagerPreview()">← Вернуться к владельцу</button>`);
      return;
    }
    previousProfile();
  };
})();