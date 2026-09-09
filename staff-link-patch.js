(()=>{
  const baseEmployeeProfile=typeof openEmployeeProfile==='function'?openEmployeeProfile:null;
  if(baseEmployeeProfile){
    openEmployeeProfile=function(id){
      baseEmployeeProfile(id);
      if(String(state.user?.role||'')!=='owner')return;
      const u=(state.users||[]).find(x=>String(x.vk_user_id||x.id)===String(id));
      const modal=document.querySelector('.modal');if(!u||!modal)return;
      const linked=/^[1-9]\d*$/.test(String(u.vk_user_id||''));
      modal.insertAdjacentHTML('beforeend',`<section class="card"><h3>Доступ через VK</h3><p class="muted">${linked?`VK ID: ${esc(u.vk_user_id)}`:'VK ID ещё не привязан. Без него сотрудник не сможет войти в рабочий кабинет.'}</p><button class="secondary wide" onclick="openEmployeeVkLink('${esc(u.vk_user_id||u.id)}')">${linked?'Изменить VK ID':'Привязать VK ID'}</button></section>`);
    };
  }

  window.openEmployeeVkLink=function(id){
    const u=(state.users||[]).find(x=>String(x.vk_user_id||x.id)===String(id));if(!u)return;
    openModal(`<h2>Доступ VK</h2><p><b>${esc(u.full_name||'Сотрудник')}</b></p><form id="vkLinkForm" class="form"><input name="vk_user_id" inputmode="numeric" pattern="[0-9]*" placeholder="VK ID, например 123456789" required value="${/^[1-9]\d*$/.test(String(u.vk_user_id||''))?esc(u.vk_user_id):''}"><p class="muted">VK ID — цифры из адреса/профиля пользователя. После привязки сотрудник сможет входить только под этим аккаунтом VK.</p><button class="primary wide" type="submit">Сохранить доступ</button><p id="vkLinkMsg" class="muted"></p></form>`);
    const form=$('#vkLinkForm');form.onsubmit=async e=>{e.preventDefault();const msg=$('#vkLinkMsg');if(state.busy)return;const vk=String(form.elements.vk_user_id.value||'').trim();if(!/^[1-9]\d*$/.test(vk)){msg.textContent='Введите цифровой VK ID';return}setBusy(form,true);msg.textContent='Сохраняем…';try{const d=await api('linkEmployeeVk',{staff_id:u.id,current_external_id:u.vk_user_id,vk_user_id:vk});if(!d.ok)throw new Error(d.error);const i=state.users.findIndex(x=>String(x.id)===String(u.id));if(i>=0)state.users[i]={...state.users[i],...d.user};const mi=state.masters.findIndex(x=>String(x.id)===String(u.id));if(mi>=0)state.masters[mi]={...state.masters[mi],...d.user};state.busy=false;closeModal();openOwnerProfile()}catch(err){msg.textContent=err.message;setBusy(form,false)}finally{state.busy=false}};
  };

  openEmployeeForm=function(){
    openModal(`<h2>Новый сотрудник</h2><form id="empForm" class="form"><input name="full_name" placeholder="Имя" required><input name="vk_user_id" inputmode="numeric" pattern="[0-9]*" placeholder="VK ID для входа"><input name="phone" placeholder="Телефон"><input name="city" placeholder="Город" value="Москва"><select name="role"><option value="master">Мастер</option><option value="dispatcher">Диспетчер</option><option value="manager">Руководитель</option><option value="owner">Владелец</option></select><input name="specialization" placeholder="Специализация"><div class="two"><input type="time" name="work_start" value="09:00"><input type="time" name="work_end" value="18:00"></div><p class="muted">Если VK ID пока неизвестен, сотрудника можно добавить и привязать доступ позже из его профиля.</p><button class="primary wide" type="submit">Добавить</button><p id="empMsg" class="muted"></p></form>`);
    const form=$('#empForm');form.onsubmit=async e=>{e.preventDefault();if(state.busy)return;const p=Object.fromEntries(new FormData(form)),msg=$('#empMsg');msg.textContent='Добавляем…';setBusy(form,true);try{const d=await api('addEmployee',p);if(!d.ok)throw new Error(d.error);state.users.push(d.user);if(d.master)state.masters.push(d.master);state.busy=false;closeModal();show('team')}catch(err){msg.textContent=err.message;setBusy(form,false)}finally{state.busy=false}};
  };
})();
