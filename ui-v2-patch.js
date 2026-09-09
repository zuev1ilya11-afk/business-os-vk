(()=>{
  const header=document.querySelector('header');
  if(header){
    const role=document.getElementById('roleBadge');
    header.innerHTML=`<div class="brandWrap"><div class="brandLogo">🏠🔧</div><div class="brandText"><h1>Домашний мастер</h1><div class="brandSub">Сервисная компания</div><div id="roleBadge" class="roleBadge">${esc(role?.textContent||'Владелец')}</div></div></div><button class="avatar" id="profileBtn" aria-label="Профиль">БО</button>`;
  }

  const nav=document.querySelector('nav');
  if(nav&&!nav.querySelector('[data-action="profile"]')){
    const p=document.createElement('button');p.dataset.action='profile';p.textContent='Профиль';nav.appendChild(p);
  }
  const profileNav=()=>document.querySelector('nav [data-action="profile"]');
  function bindProfile(){const p=profileNav();if(p)p.onclick=()=>{if(typeof openOwnerProfile==='function')openOwnerProfile();else document.getElementById('profileBtn')?.click()};const h=document.getElementById('profileBtn');if(h)h.onclick=()=>{if(typeof isMasterPreview==='function'&&isMasterPreview())show('team');else if(typeof openOwnerProfile==='function')openOwnerProfile()}}

  function go(page){show(page)}
  window.dashboardGo=go;

  const previousHome=pages.home;
  function fmtSlot(o){if(o.time_slot)return o.time_slot;const t=String(o.scheduled_time||'').slice(0,5);if(!t)return 'Без времени';const h=Number(t.slice(0,2));return `${t}–${String((h+1)%24).padStart(2,'0')}:00`}
  function chips(o){const out=[];if(o.wall_material)out.push(`🧱 ${esc(o.wall_material)}`);if(o.wall_over_3m)out.push('🪜 > 3 м');if(o.possible_extra_work)out.push('🛠 Доп. работы');if(o.comment)out.push('💬 Комментарий');return out.length?`<div class="dashChips">${out.map(x=>`<span>${x}</span>`).join('')}</div>`:''}
  function upcoming(){const today=new Date().toISOString().slice(0,10);return (state.orders||[]).filter(o=>o.status!=='Отменена'&&String(o.scheduled_date||'')>=today).sort((a,b)=>String((a.scheduled_date||'')+(a.scheduled_time||'')).localeCompare(String((b.scheduled_date||'')+(b.scheduled_time||'')))).slice(0,3)}
  function upcomingHtml(){const list=upcoming();return `<section class="dashSection"><div class="row"><h2>Ближайшие заявки</h2><button class="linkBtn" onclick="dashboardGo('orders')">Все заявки →</button></div>${list.length?list.map(o=>`<button class="dashOrder" onclick="openOrder('${esc(o.id)}')"><div class="dashOrderTime"><b>${esc(String(o.scheduled_date||'').slice(5)||'')}</b><span>${esc(fmtSlot(o))}</span></div><div class="dashOrderBody"><strong>${esc(o.work||'Заявка')}</strong><span>${esc(o.address||'')}</span><small>${esc(o.master_name||'Не назначен')}</small>${chips(o)}</div><div class="dashArrow">›</div></button>`).join(''):'<section class="card"><p class="muted">Ближайших заявок нет.</p></section>'}</section>`}
  function metricButton(icon,label,value,sub,page){return `<button class="card dashMetric buttonCard" onclick="dashboardGo('${page}')"><span class="dashIcon">${icon}</span><span class="metricLabel">${label}</span><strong>${value}</strong><small>${sub}</small><span class="dashChevron">›</span></button>`}
  function metrics(dispatcher){const done=state.orders.filter(o=>o.status==='Выполнена'),active=state.orders.filter(o=>o.status==='В работе');const today=new Date().toISOString().slice(0,10),todayCount=state.orders.filter(o=>String(o.scheduled_date||'')===today&&o.status!=='Отменена').length;const rev=done.reduce((s,o)=>s+Number(o.amount||0),0);return dispatcher?
    `<div class="dashMetrics">${metricButton('📋','В работе',active.length,'Активных заявок','orders')}${metricButton('🗓️','Сегодня',todayCount,'Заявок на сегодня','dispatch')}${metricButton('✅','Выполнено',done.length,'Всего выполнено','orders')}${metricButton('👥','Мастеров',state.masters.length,'В команде','team')}</div>`:
    `<div class="dashMetrics">${metricButton('📋','Заявок',state.orders.length,'Всего заявок','orders')}${metricButton('👥','Мастеров',state.masters.length,'В команде','team')}${metricButton('🕒','В работе',active.length,'Активных заявок','orders')}${metricButton('₽','Выручка',money(rev),'По выполненным','orders')}</div>`}

  pages.home=function(){
    if(typeof isMasterPreview==='function'&&isMasterPreview())return previousHome();
    const dispatcher=typeof isDispatcherPreview==='function'&&isDispatcherPreview();
    let html=`${typeof loadChart==='function'?loadChart():''}${metrics(dispatcher)}${upcomingHtml()}`;
    if(dispatcher)html+=`<section class="card"><div class="row"><div><h3>Отчёт по мастерам</h3><p class="muted">Неделя / месяц · выполненные заявки и зарплата</p></div><button class="primary" onclick="dispatcherReportAnchor=new Date();dispatcherReportKind='week';showDispatcherReport()">Создать</button></div></section>`;
    return html;
  };

  const oldShow=show;
  show=function(name){oldShow(name);bindProfile();const rb=document.getElementById('roleBadge');if(rb){if(typeof isDispatcherPreview==='function'&&isDispatcherPreview())rb.textContent='Диспетчер';else if(typeof isMasterPreview==='function'&&isMasterPreview())rb.textContent='Мастер';else rb.textContent='Владелец'}};
  bindProfile();
})();