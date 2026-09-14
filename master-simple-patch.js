(()=>{
  const baseHome=pages.home,baseOrders=pages.orders,baseTeam=pages.team;
  let masterOrderDay='all';
  function masterMode(){return String(state.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())}
  function masterUser(){return (typeof isMasterPreview==='function'&&isMasterPreview())?previewUser:state.user}
  function mOrders(){if(typeof ownOrders==='function'&&typeof isMasterPreview==='function'&&isMasterPreview())return ownOrders();return state.orders||[]}
  function activeOrders(){return mOrders().filter(o=>!['Выполнена','Отменена'].includes(String(o.status||'')))}
  function doneOrders(){return mOrders().filter(o=>String(o.status||'')==='Выполнена')}
  function orderPay(o){const raw=o?.amount;if(raw!==null&&raw!==undefined&&raw!==''){const amount=Number(raw);if(Number.isFinite(amount))return amount*0.85*0.65}const stored=Number(o?.master_payout||0);return Number.isFinite(stored)?stored:0}
  function basePay(){return doneOrders().reduce((a,o)=>a+orderPay(o),0)}
  function extras(){return doneOrders().reduce((a,o)=>a+Number(o.extra_work_amount||0),0)}
  function unfinished(){return doneOrders().reduce((a,o)=>a+Number(o.uncompleted_work_amount||0),0)}
  function salary(){return Math.max(0,basePay()+extras())}
  function localDate(offset=0){const d=new Date();d.setDate(d.getDate()+offset);const z=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
  function slot(o){return o.time_slot||((o.scheduled_time||'').slice(0,5)||'Время не указано')}
  function flags(o){const out=[];if(o.wall_over_3m)out.push('🪜 >3 м');if(o.wall_material)out.push('🧱 '+esc(o.wall_material));if(o.possible_extra_work)out.push('🛠 Возможны допработы');if(o.comment)out.push('💬 Комментарий');return out}
  function jobCard(o){const f=flags(o);return `<button class="masterJob" onclick="openOrder('${esc(o.id)}')"><div class="masterJobTop"><span class="masterJobTime">${esc(slot(o))}</span><span class="status info">${esc(o.status||'В работе')}</span></div><div class="masterJobTitle">${esc(o.work||'Заявка')}</div><div class="masterJobMeta">${esc(o.scheduled_date||'Дата не указана')} · ${esc(o.address||'Адрес не указан')}</div>${f.length?`<div class="masterJobFlags">${f.map(x=>`<span class="masterFlag">${x}</span>`).join('')}</div>`:''}</button>`}
  function sortOrders(list){return list.slice().sort((a,b)=>String((a.scheduled_date||'9999')+(a.scheduled_time||'99:99')).localeCompare(String((b.scheduled_date||'9999')+(b.scheduled_time||'99:99'))))}
  function dateLabel(date){
    if(!date)return 'Без даты';
    if(date===localDate())return 'Сегодня';
    if(date===localDate(1))return 'Завтра';
    const d=new Date(`${date}T12:00:00`);
    if(Number.isNaN(d.getTime()))return date;
    return d.toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'short'}).replace(/^./,c=>c.toUpperCase());
  }
  function dateTitle(date){
    if(!date)return 'Без даты';
    const prefix=dateLabel(date),d=new Date(`${date}T12:00:00`);
    if(Number.isNaN(d.getTime())||(!['Сегодня','Завтра'].includes(prefix)))return prefix;
    return `${prefix}, ${d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}`;
  }
  function groupByDate(list){
    const groups=[];
    sortOrders(list).forEach(o=>{
      const key=String(o.scheduled_date||'');
      let group=groups.find(x=>x.date===key);
      if(!group){group={date:key,orders:[]};groups.push(group)}
      group.orders.push(o);
    });
    return groups;
  }
  function dayFilters(all){
    const dates=[...new Set(sortOrders(all).map(o=>String(o.scheduled_date||'')).filter(Boolean))].slice(0,10);
    if(masterOrderDay!=='all'&&!dates.includes(masterOrderDay))masterOrderDay='all';
    return `<div class="masterDayFilters"><button data-master-filter-day="all" class="${masterOrderDay==='all'?'primary':'secondary'}" onclick="setMasterOrderDay('all')">Все</button>${dates.map(date=>`<button data-master-filter-day="${esc(date)}" class="${masterOrderDay===date?'primary':'secondary'}" onclick="setMasterOrderDay('${esc(date)}')">${esc(dateLabel(date))}</button>`).join('')}</div>`;
  }
  function groupedOrdersHtml(list,limitDays=0){
    let groups=groupByDate(list);
    if(limitDays>0)groups=groups.slice(0,limitDays);
    return groups.map(group=>`<section class="masterDayGroup" data-master-day="${esc(group.date||'none')}"><div class="masterDayHeading"><strong>${esc(dateTitle(group.date))}</strong><span>${group.orders.length} заяв.</span></div>${group.orders.map(jobCard).join('')}</section>`).join('');
  }

  window.setMasterOrderDay=function(day){masterOrderDay=String(day||'all');show('orders')};

  pages.home=function(){
    if(!masterMode())return baseHome();
    const u=masterUser()||{},active=activeOrders(),done=doneOrders(),today=localDate(),todayOrders=active.filter(o=>String(o.scheduled_date||'')===today),upcoming=active.filter(o=>!o.scheduled_date||String(o.scheduled_date)>=today);
    return `<div class="masterSimple"><section class="masterWelcome"><div class="eyebrow">КАБИНЕТ МАСТЕРА</div><h2>${esc(u.full_name||'Мастер')}</h2><div class="muted">Сегодня ${todayOrders.length?todayOrders.length+' заяв.':'заявок нет'}</div></section><div class="masterKpis"><div class="masterKpi"><span>В работе</span><strong>${active.length}</strong></div><div class="masterKpi"><span>Выполнено</span><strong>${done.length}</strong></div><div class="masterKpi"><span>Моя выплата</span><strong>${money(basePay())}</strong></div><div class="masterKpi"><span>Общая зарплата</span><strong>${money(salary())}</strong></div></div><section class="card"><div class="masterSectionTitle"><h2>Ближайшие заявки</h2><button class="secondary" onclick="show('orders')">Все</button></div>${upcoming.length?groupedOrdersHtml(upcoming,3):'<div class="masterEmpty">Активных заявок нет</div>'}</section><section class="card"><h3>Расчёт зарплаты</h3><div class="salaryBreakdown"><span>Выплата по заявкам <b>${money(basePay())}</b></span><span>Допработы <b>+ ${money(extras())}</b></span><span>Невыполненные работы <b>− ${money(unfinished())}</b></span></div><p class="muted" style="font-size:12px">Невыполненные работы уже уменьшают базу заявки, поэтому повторно из зарплаты не вычитаются.</p></section></div>`;
  };

  pages.orders=function(){
    if(!masterMode())return baseOrders();
    const all=mOrders(),active=all.filter(o=>!['Выполнена','Отменена'].includes(String(o.status||''))),done=all.filter(o=>String(o.status||'')==='Выполнена'),filtered=masterOrderDay==='all'?all:all.filter(o=>String(o.scheduled_date||'')===masterOrderDay);
    return `<div class="masterSimple"><div class="masterSectionTitle"><div><h2>Мои заявки</h2><div class="muted">В работе ${active.length} · Выполнено ${done.length}</div></div></div>${dayFilters(all)}${filtered.length?groupedOrdersHtml(filtered):'<div class="masterEmpty">На выбранный день заявок нет</div>'}</div>`;
  };

  pages.team=function(){
    if(!masterMode())return baseTeam();
    const u=masterUser()||{};
    return `<div class="masterSimple"><h2>Профиль</h2><section class="card"><h3>${esc(u.full_name||'Мастер')}</h3><p class="muted">Мастер${u.city?' · '+esc(u.city):''}</p>${u.phone?`<p>☎️ ${esc(u.phone)}</p>`:''}${u.specialization?`<p>🛠 ${esc(u.specialization)}</p>`:''}</section><section class="card"><h3>Зарплата</h3><div class="salaryBreakdown"><span>Выплата по заявкам <b>${money(basePay())}</b></span><span>Допработы <b>+ ${money(extras())}</b></span><span>Невыполненные <b>− ${money(unfinished())}</b></span><span>Итого <b>${money(salary())}</b></span></div></section><button class="primary masterAction" onclick="show('dispatch');setTimeout(()=>{if(typeof bindWeekToggles==='function')bindWeekToggles()},0)">Настроить график недели</button>${(typeof isMasterPreview==='function'&&isMasterPreview()&&String(state.user?.role||'')!=='master')?'<button class="secondary masterAction" onclick="exitMasterPreview()">Вернуться к владельцу</button>':''}</div>`;
  };

  const oldUpdateNav=typeof updateNavForRole==='function'?updateNavForRole:null;
  if(oldUpdateNav)updateNavForRole=function(){oldUpdateNav();if(masterMode()){const buttons=[...document.querySelectorAll('nav button')];const labels=['Главная','Заявки','График','Профиль'];buttons.forEach((b,i)=>{if(labels[i])b.textContent=labels[i]});$('#roleBadge').textContent='Мастер'}};
})();