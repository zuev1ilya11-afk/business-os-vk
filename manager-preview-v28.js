(()=>{
  let managerPreviewUser=null;
  const isOwner=()=>String(state?.user?.role||'')==='owner';
  const isManagerPreview=()=>!!managerPreviewUser;
  const roleLabel=r=>({owner:'Владелец',manager:'Руководитель',dispatcher:'Диспетчер',master:'Мастер'}[r]||r);

  function updateManagerNav(){
    if(!isManagerPreview())return;
    const labels=['Главная','Заявки','График','Команда'];
    document.querySelectorAll('nav button').forEach((b,i)=>{if(labels[i])b.textContent=labels[i]});
    const badge=document.querySelector('#roleBadge');if(badge)badge.textContent='Руководитель · тест';
    const avatar=document.querySelector('#profileBtn');if(avatar)avatar.textContent=(managerPreviewUser.full_name||'Р').trim().split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();
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
    if(!isOwner())return;
    const modal=document.querySelector('#modalRoot .modal');if(!modal)return;
    const managers=(state.users||[]).filter(u=>u.role==='manager');
    if(!managers.length)return;
    const block=document.createElement('section');block.className='card';block.style.marginTop='14px';
    block.innerHTML=`<h3>Посмотреть как руководитель</h3><p class="muted">Тест интерфейса без смены реальной авторизации.</p>${managers.map(u=>{const id=String(u.id||u.vk_user_id||u.external_id||'');return `<button class="primary wide" style="margin:8px 0;text-align:left" onclick="enterManagerPreview('${esc(id)}')">Войти как ${esc(u.full_name||'Руководитель')}</button>`}).join('')}`;
    modal.appendChild(block);
  };

  document.addEventListener('click',e=>{
    if(!isManagerPreview())return;
    const p=e.target.closest?.('#profileBtn');if(!p)return;
    e.preventDefault();e.stopImmediatePropagation();window.openOwnerProfile();
  },true);
})();