(()=>{
  window.openEmployeeForm=function(){
    if(String(state?.user?.role||'')!=='owner'){
      openModal('<h2>Нет доступа</h2><p class="muted">Назначать роли и добавлять сотрудников может только владелец.</p><button class="secondary wide" onclick="closeModal()">Закрыть</button>');
      return;
    }
    openModal(`<h2>Новый сотрудник</h2><form id="empForm" class="form"><input name="full_name" placeholder="Имя" required><input name="phone" type="tel" inputmode="tel" placeholder="Номер телефона" required><input name="city" placeholder="Город" value="Москва"><select name="role"><option value="master">Мастер</option><option value="dispatcher">Диспетчер</option><option value="manager">Руководитель</option></select><input name="specialization" placeholder="Специализация"><div class="two"><input type="time" name="work_start" value="09:00"><input type="time" name="work_end" value="18:00"></div><p class="muted">Сотрудник войдёт в приложение и зарегистрируется по этому номеру телефона. Роли назначает только владелец.</p><button class="primary wide" type="submit">Добавить</button><p id="empMsg" class="muted"></p></form>`);
    const form=document.querySelector('#empForm');
    form.onsubmit=async e=>{e.preventDefault();if(state.busy)return;const p=Object.fromEntries(new FormData(form)),msg=document.querySelector('#empMsg');msg.textContent='Добавляем…';setBusy(form,true);try{const d=await api('addEmployee',p);if(!d.ok)throw new Error(d.error);state.users.push(d.user);if(d.master)state.masters.push(d.master);state.busy=false;closeModal();show('team')}catch(err){msg.textContent=err.message;setBusy(form,false)}finally{state.busy=false}};
  };
})();