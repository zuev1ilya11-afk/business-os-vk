(()=>{
  const baseHome=pages.home,baseOrders=pages.orders,baseTeam=pages.team;
  function masterMode(){return String(state.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())}
  function masterUser(){return (typeof isMasterPreview==='function'&&isMasterPreview())?previewUser:state.user}
  function mOrders(){if(typeof ownOrders==='function'&&typeof isMasterPreview==='function'&&isMasterPreview())return ownOrders();return state.orders||[]}
  function activeOrders(){return mOrders().filter(o=>!['Выполнена','Отменена'].includes(String(o.status||'')))}
  function doneOrders(){return mOrders().filter(o=>String(o.status||'')==='Выполнена')}
  function basePay(){return doneOrders().reduce((a,o)=>a+Number(o.master_payout||0),0)}
  function extras(){return doneOrders().reduce((a,o)=>a+Number(o.extra_work_amount||0),0)}
  function unfinished(){return doneOrders().reduce((a,o)=>a+Number(o.uncompleted_work_amount||0),0)}
  function salary(){return Math.max(0,basePay()+extras())}
  function localDate(){const d=new Date(),z=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
  function slot(o){return o.time_slot||((o.scheduled_time||'').slice(0,5)||'Время не указано')}
  function flags(o){const out=[];if(o.wall_over_3m)out.push('🪜 >3 м');if(o.wall_material)out.push('🧱 '+esc(o.wall_material));if(o.possible_extra_work)out.push('🛠 Возможны допработы');if(o.comment)out.push('💬 Комментарий');return out}
  function jobCard(o){const f=flags(o);return `<button class="masterJob" onclick="openOrder('${esc(o.id)}')"><div class="masterJobTop"><span class="masterJobTime">${esc(slot(o))}</span><span class="status info">${esc(o.status||'В работе')}</span></div><div class="masterJobTitle">${esc(o.work||'Заявка')}</div><div class="masterJobMeta">${esc(o.scheduled_date||'Дата не указана')} · ${esc(o.address||'Адрес не указан')}</div>${f.length?`<div class="masterJobFlags">${f.map(x=>`<span class="masterFlag">${x}</span>`).join('')}</div>`:''}</button>`}

  pages.home=function(){
    if(!masterMode())return baseHome();
    const u=masterUser()||{},active=activeOrders(),done=doneOrders(),today=localDate(),todayOrders=active.filter(o=>String(o.scheduled_date||'')===today),upcoming=active.slice().sort((a,b)=>String((a.scheduled_date||'9999')+(a.scheduled_time||'')).localeCompare(String((b.scheduled_date||'9999')+(b.scheduled_time||'')))).slice(0,5);
    return `<div class="masterSimple"><section class="masterWelcome"><div class="eyebrow">КАБИНЕТ МАСТЕРА</div><h2>${esc(u.full_name||'Мастер')}</h2><div class="muted">Сегодня ${todayOrders.length?todayOrders.length+' заяв.':'заявок нет'}</div></section><div class="masterKpis"><div class="masterKpi"><span>В работе</span><strong>${active.length}</strong></div><div class="masterKpi"><span>Выполнено</span><strong>${done.length}</strong></div><div class="masterKpi"><span>Моя выплата</span><strong>${money(basePay())}</strong></div><div class="masterKpi"><span>Общая зарплата</span><strong>${money(salary())}</strong></div></div><section class="card"><div class="masterSectionTitle"><h2>Ближайшие заявки</h2><button class="secondary" onclick="show('orders')">Все</button></div>${upcoming.length?upcoming.map(jobCard).join(''):'<div class="masterEmpty">Активных заявок нет</div>'}</section><section class="card"><h3>Расчёт зарплаты</h3><div class="salaryBreakdown"><span>Выплата по заявкам <b>${money(basePay())}</b></span><span>Допработы <b>+ ${money(extras())}</b></span><span>Невыполненные работы <b>− ${money(unfinished())}</b></span></div><p class="muted" style="font-size:12px">Невыполненные работы уже уменьшают базу заявки, поэтому повторно из зарплаты не вычитаются.</p></section></div>`;
  };

  pages.orders=function(){
    if(!masterMode())return baseOrders();
    const all=mOrders(),active=all.filter(o=>!['Выполнена','Отменена'].includes(String(o.status||''))),done=all.filter(o=>String(o.status||'')==='Выполнена');
    return `<div class="masterSimple"><div class="masterSectionTitle"><div><h2>Мои заявки</h2><div class="muted">В работе ${active.length} · Выполнено ${done.length}</div></div></div>${all.length?all.slice().sort((a,b)=>String((a.scheduled_date||'9999')+(a.scheduled_time||'')).localeCompare(String((b.scheduled_date||'9999')+(b.scheduled_time||'')))).map(jobCard).join(''):'<div class="masterEmpty">Заявок пока нет</div>'}</div>`;
  };

  pages.team=function(){
    if(!masterMode())return baseTeam();
    const u=masterUser()||{};
    return `<div class="masterSimple"><h2>Профиль</h2><section class="card"><h3>${esc(u.full_name||'Мастер')}</h3><p class="muted">Мастер${u.city?' · '+esc(u.city):''}</p>${u.phone?`<p>☎️ ${esc(u.phone)}</p>`:''}${u.specialization?`<p>🛠 ${esc(u.specialization)}</p>`:''}</section><section class="card"><h3>Зарплата</h3><div class="salaryBreakdown"><span>Выплата по заявкам <b>${money(basePay())}</b></span><span>Допработы <b>+ ${money(extras())}</b></span><span>Невыполненные <b>− ${money(unfinished())}</b></span><span>Итого <b>${money(salary())}</b></span></div></section><button class="primary masterAction" onclick="show('dispatch');setTimeout(()=>{if(typeof bindWeekToggles==='function')bindWeekToggles()},0)">Настроить график недели</button>${(typeof isMasterPreview==='function'&&isMasterPreview()&&String(state.user?.role||'')!=='master')?'<button class="secondary masterAction" onclick="exitMasterPreview()">Вернуться к владельцу</button>':''}</div>`;
  };

  const oldUpdateNav=typeof updateNavForRole==='function'?updateNavForRole:null;
  if(oldUpdateNav)updateNavForRole=function(){oldUpdateNav();if(masterMode()){const buttons=[...document.querySelectorAll('nav button')];const labels=['Главная','Заявки','График','Профиль'];buttons.forEach((b,i)=>{if(labels[i])b.textContent=labels[i]});$('#roleBadge').textContent='Мастер'}};
})();