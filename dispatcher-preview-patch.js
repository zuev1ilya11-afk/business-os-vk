let dispatcherPreviewUser=null;
function isDispatcherPreview(){return !!dispatcherPreviewUser}
const dispatcherPreviewHomeBase=pages.home;
const dispatcherPreviewOrdersBase=pages.orders;
const dispatcherPreviewDispatchBase=pages.dispatch;
const dispatcherPreviewTeamBase=pages.team;
const dispatcherPreviewShowBase=show;
const dispatcherPreviewOwnerProfileBase=openOwnerProfile;

function dispatcherOrders(){return state.orders||[]}
function dispatcherActiveOrders(){return dispatcherOrders().filter(o=>!['Выполнена','Отменена'].includes(String(o.status)))}
function dispatcherDoneOrders(){return dispatcherOrders().filter(o=>String(o.status)==='Выполнена')}

pages.home=function(){
  if(!isDispatcherPreview())return dispatcherPreviewHomeBase();
  const active=dispatcherActiveOrders(),done=dispatcherDoneOrders(),today=isoDate(new Date());
  const todayOrders=dispatcherOrders().filter(o=>String(o.scheduled_date||'')===today&&String(o.status)!=='Отменена');
  return `<section class="hero"><div class="eyebrow">КАБИНЕТ ДИСПЕТЧЕРА</div><h2>${esc(dispatcherPreviewUser.full_name||'Диспетчер')}</h2><p class="muted">Распределение заявок, графики мастеров и отчёты</p></section><div class="grid"><div class="card metric"><span class="muted">В работе</span><strong>${active.length}</strong></div><div class="card metric"><span class="muted">Сегодня</span><strong>${todayOrders.length}</strong></div><div class="card metric"><span class="muted">Выполнено</span><strong>${done.length}</strong></div><div class="card metric"><span class="muted">Мастеров</span><strong>${state.masters.length}</strong></div></div><section class="card"><div class="row"><div><h3>Отчёт по мастерам</h3><p class="muted">Неделя / месяц · выполненные заявки и зарплата</p></div><button class="primary" onclick="dispatcherReportAnchor=new Date();dispatcherReportKind='week';showDispatcherReport()">Создать отчёт</button></div></section>`;
};

pages.orders=function(){
  if(!isDispatcherPreview())return dispatcherPreviewOrdersBase();
  const orders=dispatcherOrders();
  return `<div class="row"><div><h2>Заявки</h2><div class="muted">${orders.length} шт.</div></div><button class="primary" onclick="openOrderForm()">+ Новая</button></div>${orders.map(o=>`<section class="card" onclick="openOrder('${esc(o.id)}')"><div class="row"><b>${esc(o.id)}</b><span class="status info">${esc(o.status||'В работе')}</span></div><h3>${esc(o.work)}</h3><p class="muted">${esc(o.client)} · ${esc(o.address)}</p><div class="row"><span>${esc(o.master_name||'Не назначен')}</span><b>${money(o.amount)}</b></div><p class="muted">${esc(o.scheduled_date||'Без даты')} ${esc(String(o.scheduled_time||'').slice(0,5))}</p></section>`).join('')||'<p class="muted">Заявок пока нет.</p>'}`;
};

pages.dispatch=function(){
  if(!isDispatcherPreview())return dispatcherPreviewDispatchBase();
  return typeof teamCalendarHtml==='function'?teamCalendarHtml():dispatcherPreviewDispatchBase();
};

pages.team=function(){
  if(!isDispatcherPreview())return dispatcherPreviewTeamBase();
  return `<div class="row"><div><h2>Мастера</h2><div class="muted">${state.masters.length} сотрудников</div></div></div>${state.masters.map(m=>{const active=dispatcherOrders().filter(o=>String(o.master_vk_id||'')===String(m.vk_user_id||'')&&!['Выполнена','Отменена'].includes(String(o.status))).length;return `<section class="card"><div class="row"><div><b>${esc(m.full_name)}</b><p class="muted">${esc(m.specialization||m.city||'Мастер')}</p></div><span class="status info">${active} актив.</span></div><p class="muted">${esc(m.work_start||'—')}–${esc(m.work_end||'—')}</p></section>`}).join('')||'<p class="muted">Мастеров пока нет.</p>'}`;
};

show=function(name){
  dispatcherPreviewShowBase(name);
  if(!isDispatcherPreview())return;
  const labels=['Главная','Заявки','График','Мастера'];
  document.querySelectorAll('nav button').forEach((b,i)=>{if(labels[i])b.textContent=labels[i]});
  const badge=$('#roleBadge');if(badge)badge.textContent='Диспетчер';
  const profile=$('#profileBtn');if(profile)profile.textContent='Д';
};

function enterDispatcherPreview(id){
  const u=state.users.find(x=>String(x.vk_user_id||x.id)===String(id)&&x.role==='dispatcher');if(!u)return;
  dispatcherPreviewUser=u;previewRole='owner';previewUser=null;closeModal();show('home');
}
function exitDispatcherPreview(){dispatcherPreviewUser=null;closeModal();show('home')}

openOwnerProfile=function(){
  if(isDispatcherPreview()){
    openModal(`<h2>Профиль диспетчера</h2><section class="card"><p><b>${esc(dispatcherPreviewUser.full_name||'Диспетчер')}</b></p><p><b>Роль:</b> Диспетчер</p><p><b>Город:</b> ${esc(dispatcherPreviewUser.city||'—')}</p><p><b>Телефон:</b> ${esc(dispatcherPreviewUser.phone||'—')}</p></section><button class="primary wide" onclick="dispatcherReportAnchor=new Date();dispatcherReportKind='week';closeModal();showDispatcherReport()">Создать отчёт</button><button class="secondary wide" onclick="exitDispatcherPreview()">← Вернуться к владельцу</button>`);return;
  }
  dispatcherPreviewOwnerProfileBase();
  const modal=document.querySelector('.modal');if(!modal)return;
  const dispatchers=state.users.filter(u=>u.role==='dispatcher');
  if(!dispatchers.length)return;
  const block=document.createElement('section');block.className='card';block.innerHTML=`<h3>Посмотреть как диспетчер</h3>${dispatchers.map(u=>`<button class="primary wide" style="margin:8px 0;text-align:left" onclick="enterDispatcherPreview('${esc(u.vk_user_id||u.id)}')">Войти как ${esc(u.full_name||'Диспетчер')}</button>`).join('')}`;
  const last=modal.querySelector('button.secondary.wide:last-of-type');if(last)modal.insertBefore(block,last);else modal.appendChild(block);
};

const dispatcherPreviewProfileButton=$('#profileBtn');
if(dispatcherPreviewProfileButton)dispatcherPreviewProfileButton.onclick=()=>{if(isDispatcherPreview())openOwnerProfile();else if(typeof isMasterPreview==='function'&&isMasterPreview())show('team');else openOwnerProfile()};