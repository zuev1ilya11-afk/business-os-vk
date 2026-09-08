let previewRole='owner';
let previewUser=null;
const baseShow=show;
const baseOwnerProfile=openOwnerProfile;
const baseOpenEmployeeProfile=openEmployeeProfile;
const ownerHomeWithExtras=pages.home;

function isMasterPreview(){return previewRole==='master'&&previewUser}
function ownOrders(){return isMasterPreview()?state.orders.filter(o=>String(o.master_vk_id||'')===String(previewUser.vk_user_id||'')):state.orders}
function completedOwnOrders(){return ownOrders().filter(o=>o.status==='Выполнена')}
function ownExtraTotal(){return completedOwnOrders().reduce((a,o)=>a+Number(o.extra_work_amount||0),0)}
function ownUncompletedTotal(){return completedOwnOrders().reduce((a,o)=>a+Number(o.uncompleted_work_amount||0),0)}
function ownPayoutTotal(){return completedOwnOrders().reduce((a,o)=>a+Number(o.master_payout||payout(o.amount)),0)}

function ownerAdjustmentMetricHtml(){const done=state.orders.filter(o=>o.status==='Выполнена');const extras=done.reduce((a,o)=>a+Number(o.extra_work_amount||0),0);const uncompleted=done.reduce((a,o)=>a+Number(o.uncompleted_work_amount||0),0);return `<section class="card"><h3>Корректировки по выполненным заявкам</h3><div class="grid"><div class="metric"><span class="muted">Допработы</span><strong>${money(extras)}</strong></div><div class="metric"><span class="muted">Невыполненные</span><strong>− ${money(uncompleted)}</strong></div></div></section>`}

pages.home=function(){
  if(!isMasterPreview()) return ownerHomeWithExtras();
  const orders=ownOrders(),done=completedOwnOrders(),active=orders.filter(o=>o.status==='В работе');
  const sum=done.reduce((a,o)=>a+Number(o.amount||0),0);
  return `<section class="hero"><div class="eyebrow">КАБИНЕТ МАСТЕРА</div><h2>${esc(previewUser.full_name)}</h2><p class="muted">${esc(previewUser.city||'')}</p></section><div class="grid"><div class="card metric"><span class="muted">В работе</span><strong>${active.length}</strong></div><div class="card metric"><span class="muted">Выполнено</span><strong>${done.length}</strong></div><div class="card metric"><span class="muted">Сумма заявок</span><strong>${money(sum)}</strong></div><div class="card metric"><span class="muted">Моя выплата</span><strong>${money(ownPayoutTotal())}</strong></div><div class="card metric"><span class="muted">Допработы</span><strong>${money(ownExtraTotal())}</strong></div><div class="card metric"><span class="muted">Невыполненные</span><strong>− ${money(ownUncompletedTotal())}</strong></div></div><section class="card"><h3>Ближайшие заявки</h3>${active.slice(0,4).map(o=>`<div class="row" style="margin:10px 0"><span>${esc(o.id)} · ${esc(o.work)}</span><b>${esc(o.scheduled_date||'')}</b></div>`).join('')||'<p class="muted">Активных заявок нет.</p>'}</section>`;
};

const ownerOrdersPage=pages.orders;
pages.orders=function(){
  if(!isMasterPreview()) return ownerOrdersPage();
  const orders=ownOrders();
  return `<div class="row"><div><h2>Мои заявки</h2><div class="muted">${orders.length} шт.</div></div></div>${orders.map(o=>`<section class="card" onclick="openOrder('${esc(o.id)}')"><div class="row"><b>${esc(o.id)}</b><span class="status info">${esc(o.status)}</span></div><h3>${esc(o.work)}</h3><p class="muted">${esc(o.client)} · ${esc(o.address)}</p><div class="row"><span>${esc(o.scheduled_date||'')} ${esc(o.scheduled_time||'')}</span><b>${money(o.amount)}</b></div>${o.status==='Выполнена'?`<p class="muted">Моя выплата: ${money(o.master_payout||payout(o.amount))}${Number(o.extra_work_amount||0)>0?` · Допработы: ${money(o.extra_work_amount)}`:''}${Number(o.uncompleted_work_amount||0)>0?` · Невыполнено: −${money(o.uncompleted_work_amount)}`:''}</p>`:''}</section>`).join('')||'<p class="muted">Заявок пока нет.</p>'}`;
};

const ownerDispatchPage=pages.dispatch;
pages.dispatch=function(){
  if(!isMasterPreview()) return ownerDispatchPage();
  const a=ownOrders().filter(o=>o.scheduled_date).sort((x,y)=>String(x.scheduled_date+x.scheduled_time).localeCompare(String(y.scheduled_date+y.scheduled_time)));
  return `<h2>Мой график</h2>${a.map(o=>`<section class="card" onclick="openOrder('${esc(o.id)}')"><b>${esc(o.scheduled_date)} · ${esc(o.scheduled_time||'')}</b><p>${esc(o.work)} · ${esc(o.address)}</p><span class="status info">${esc(o.status)}</span></section>`).join('')||'<p class="muted">Нет запланированных заявок.</p>'}`;
};

const ownerTeamPage=pages.team;
pages.team=function(){
  if(!isMasterPreview()) return ownerTeamPage();
  const u=previewUser,m=employeeMasterData(u),done=completedOwnOrders(),active=ownOrders().filter(o=>o.status==='В работе');
  return `<h2>Мой профиль</h2><section class="card"><p><b>${esc(u.full_name)}</b></p><p><span class="status info">Мастер</span></p><p><b>Телефон:</b> ${esc(u.phone||'—')}</p><p><b>Город:</b> ${esc(u.city||'—')}</p>${m?`<p><b>Специализация:</b> ${esc(m.specialization||'—')}</p><p><b>Базовый график:</b> ${esc(m.work_start||'—')}–${esc(m.work_end||'—')}</p>`:''}</section><div class="grid"><div class="card metric"><span class="muted">В работе</span><strong>${active.length}</strong></div><div class="card metric"><span class="muted">Выполнено</span><strong>${done.length}</strong></div><div class="card metric"><span class="muted">Выплата</span><strong>${money(ownPayoutTotal())}</strong></div><div class="card metric"><span class="muted">Допработы</span><strong>${money(ownExtraTotal())}</strong></div><div class="card metric"><span class="muted">Невыполненные</span><strong>− ${money(ownUncompletedTotal())}</strong></div></div><button class="secondary wide" onclick="exitMasterPreview()">← Вернуться в профиль владельца</button>`;
};

function updateNavForRole(){
  const buttons=[...document.querySelectorAll('nav button')];
  const labels=isMasterPreview()?['Главная','Мои заявки','График','Профиль']:['Главная','Заявки','График','Команда'];
  buttons.forEach((b,i)=>{if(labels[i])b.textContent=labels[i]});
  $('#roleBadge').textContent=isMasterPreview()?'Мастер':'Владелец';
  $('#profileBtn').textContent=isMasterPreview()?(previewUser.full_name||'М').trim().split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase():'БО';
}

show=function(name){state.busy=false;state.page=name;$('#content').innerHTML=pages[name]();document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===name));updateNavForRole()};

function enterMasterPreview(id){
  const u=state.users.find(x=>String(x.vk_user_id)===String(id)&&x.role==='master');
  if(!u)return;
  previewRole='master';previewUser=u;closeModal();updateNavForRole();show('home');
}
function exitMasterPreview(){previewRole='owner';previewUser=null;closeModal();updateNavForRole();show('home')}

openOwnerProfile=function(){
  if(isMasterPreview()) return pages.team&&show('team');
  const masters=state.users.filter(u=>u.role==='master');
  openModal(`<h2>Профиль владельца</h2><section class="card"><p><b>Имя:</b> ${esc(state.user.full_name||'Илья')}</p><p><b>Роль:</b> Владелец</p><p><b>Город:</b> ${esc(state.user.city||'Москва')}</p></section>${ownerAdjustmentMetricHtml()}<h3>Посмотреть приложение как мастер</h3>${masters.map(u=>`<button class="primary wide" style="margin:8px 0;text-align:left" onclick="enterMasterPreview('${esc(u.vk_user_id)}')">Войти как ${esc(u.full_name)}</button>`).join('')||'<p class="muted">Сначала добавьте мастера.</p>'}<div class="row"><h3>Сотрудники</h3><span class="muted">${state.users.filter(u=>u.role!=='owner').length}</span></div>${state.users.filter(u=>u.role!=='owner').map(u=>`<button class="secondary wide" style="margin:8px 0;text-align:left" onclick="openEmployeeProfile('${esc(u.vk_user_id)}')"><b>${esc(u.full_name)}</b><br><span class="muted">${esc(ROLE_NAMES[u.role]||u.role)} · ${esc(u.city||'')}</span></button>`).join('')||'<p class="muted">Других сотрудников пока нет.</p>'}<button class="secondary wide" onclick="closeModal();reloadData(true)">Обновить данные</button>`)
};

$('#profileBtn').onclick=()=>{if(isMasterPreview())show('team');else openOwnerProfile()};
updateNavForRole();