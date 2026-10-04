(()=>{
 'use strict';
 if(window.BOS_FINANCE_PAGE)return;
 const F=window.BOS_FINANCE_DATA;
 const tabs=[['overview','Обзор'],['masters','Мастера'],['orders','Заявки'],['sources','Источники'],['works','Работы'],['periods','Периоды']];
 const periods=[['today','Сегодня'],['yesterday','Вчера'],['week','Неделя'],['month','Месяц'],['quarter','Квартал'],['year','Год'],['all','Всё время'],['custom','Свой период']];
 const columns=[['total','Заявок всего'],['completed','Выполнено'],['cancelled','Отменено'],['revenue','Выручка'],['extras','Доп. работы'],['pay','Мастеру'],['company','Компании'],['average','Средний чек']];
 const measures=[['revenue','Выручка','₽'],['pay','Начислено мастерам','↗'],['company','Доля компании','▥'],['extras','Дополнительные работы','＋'],['completed','Выполненные заявки','✓'],['average','Средний чек','◇']];
 let actor='',ui=defaults(),error='',queued=false;
 function defaults(){return {tab:'overview',period:'month',from:'',to:'',master:'',city:'',source:'',work:'',search:'',sort:'revenue',direction:-1,selected:'',group:'month',limit:30}}
 const allowed=()=>!!window.BOS_ORDER_CONTROL?.identity()&&window.BOS_PERMISSIONS.isFinanceWorkspaceActive(state.user,state.settings?.permissions);
 function identity(){const next=window.BOS_ORDER_CONTROL?.identity()||'';if(next!==actor){actor=next;ui=defaults();error=''}}
 const currency=n=>n===null?'—':money(n);
 const format=(k,v)=>v===null?'—':k==='delta'?(v>0?'+':'')+v+'%':['total','completed','cancelled','quantity'].includes(k)?String(v):currency(v);
 const selected=(a,b)=>a===b?' selected':'';
 const button=(attr,value,label,active=false)=>`<button type="button" class="${active?'primary':'secondary'}" ${attr}="${esc(value)}" aria-pressed="${active}">${label}</button>`;
 const name=o=>String(o.external_id||'').startsWith('hands:')?String(o.external_id).slice(6):String(o.id);
 function range(){return F.period(ui.period,new Date(),ui.from,ui.to)}
 function model(){
  const all=F.records(state.orders,state.masters),p=range(),filters={period:p,master:ui.master,source:ui.source,city:ui.city,work:ui.work};
  const rows=F.select(all,filters),previous=F.previous(p,ui.period);
  return {all,rows,p,total:F.aggregate(rows),before:previous?F.aggregate(F.select(all,{...filters,period:previous})):null};
 }
 function select(label,key,values){return `<label class="finFilter">${label}<select data-fin-filter="${key}" aria-label="${label}"><option value="">Все${key==='city'?' города':key==='master'?' мастера':key==='source'?' источники':' работы'}</option>${values.map(([keyValue,title])=>`<option value="${esc(keyValue)}"${selected(ui[key],keyValue)}>${esc(title)}</option>`).join('')}</select></label>`}
 function filters(m){
  const masters=new Map();for(const r of m.all)masters.set(r.master,r.name);for(const master of state.masters||[])if(!masters.has(String(master.id)))masters.set(String(master.id),master.full_name||'Мастер');
  const values=k=>[...new Set(m.all.map(r=>r[k]))].sort().map(x=>[x,x]);
  const workIds=new Set(m.all.flatMap(r=>r.works.map(w=>w.key))),works=F.catalog.filter(w=>workIds.has(w.id)).map(w=>[w.id,w.name]);
  if(m.all.some(r=>!r.workKnown))works.push(['unknown','Без точного соответствия каталогу']);
  return `<details class="finFilters" open><summary>Фильтры</summary><div class="finFilterGrid">${select('Город','city',values('city'))}${select('Мастер','master',[...masters])}${select('Источник','source',values('source'))}${select('Тип работ','work',works)}</div></details>`;
 }
 function kpis(total,before=null,detail=false){return `<div class="finKpis">${measures.map(([k,label,icon])=>{const delta=before?F.change(total[k],before[k]):null;return `<section class="card finKpi" ${detail?'data-fin-detail-kpi':'data-fin-kpi'}="${k}"><span class="finIcon" aria-hidden="true">${icon}</span><span class="muted">${label}</span><strong>${format(k,total[k])}</strong><small>${total.missing?.[k]?`Нет сохранённой суммы у ${total.missing[k]} заяв. • известная часть ${currency(total.known[k])}`:delta!==null?`${delta>0?'+':''}${delta}% к предыдущему периоду`:k==='pay'?'Начисления, включая допработы':k==='revenue'?'Основные работы + допработы':k==='company'?'По доступному расчёту источника':'За выбранный период'}</small></section>`}).join('')}</div>`}
 function sorted(rows){return [...rows].sort((a,b)=>{const x=ui.sort==='name'?a.name:a[ui.sort],y=ui.sort==='name'?b.name:b[ui.sort];if(x===null)return y===null?0:1;if(y===null)return-1;return ui.direction*(typeof x==='string'?x.localeCompare(y,'ru'):x-y)||a.name.localeCompare(b.name,'ru')})}
 function masterTable(m){
  let rows=F.groups(m.rows,'master');
  for(const master of state.masters||[]){const key=String(master.id);if(!rows.some(g=>g.key===key)&&(!ui.master||ui.master===key)&&(!ui.city||master.city===ui.city))rows.push({key,name:master.full_name||'Мастер',inactive:master.is_active===false,rows:[],...F.aggregate([])})}
  rows=sorted(rows.filter(r=>r.name.toLocaleLowerCase('ru-RU').includes(ui.search.toLocaleLowerCase('ru-RU'))));
  const total=F.aggregate(rows.flatMap(r=>r.rows));
  return `<section class="card finMasters"><div class="finHeading"><div><h2>Финансы по мастерам</h2><p class="muted">Заявки, начисления и вклад каждого мастера</p></div><div class="finMasterTools"><label class="finSearch"><span class="sr-only">Поиск мастера</span><input data-fin-search placeholder="Поиск мастера…" value="${esc(ui.search)}" aria-label="Поиск мастера"></label><label class="finSort">Сортировка<select data-fin-sort-select aria-label="Сортировка мастеров">${[['name','Мастер'],...columns].map(([key,title])=>`<option value="${key}"${selected(ui.sort,key)}>${title}</option>`).join('')}</select></label></div></div><div class="finTableWrap"><table class="finTable"><thead><tr><th scope="col" aria-sort="${ui.sort==='name'?(ui.direction===1?'ascending':'descending'):'none'}">${button('data-fin-sort','name','Мастер')}</th>${columns.map(([k,label])=>`<th scope="col" aria-sort="${ui.sort===k?(ui.direction===1?'ascending':'descending'):'none'}">${button('data-fin-sort',k,label+(ui.sort===k?(ui.direction===1?' ↑':' ↓'):''))}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr data-fin-key="master:${esc(r.key)}"><th scope="row"><button class="finPerson" data-fin-master="${esc(r.key)}"><span class="odAvatar">${esc(r.name.split(/\s+/).map(s=>s[0]).slice(0,2).join(''))}</span><span>${esc(r.name)}<small class="muted">${r.inactive?'История заявок':'Мастер'} →</small></span></button></th>${columns.map(([k,label])=>`<td data-label="${label}" class="${k==='revenue'?'finRevenue':''}">${format(k,r[k])}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="9">Мастера не найдены.</td></tr>'}</tbody><tfoot><tr><th scope="row">ИТОГО</th>${columns.map(([k,label])=>`<td data-label="${label}">${format(k,total[k])}</td>`).join('')}</tr></tfoot></table></div></section>`;
 }
 function chart(rows,group=ui.group){
  const all=F.periodGroups(rows,group),data=all.slice(-24),keys=['revenue','pay','company'];
  const max=Math.max(1,...data.flatMap(x=>keys.map(k=>x[k]||0)));
  return `<section class="card finChart"><div class="finHeading"><h3>Динамика по ${group==='day'?'дням':group==='week'?'неделям':group==='month'?'месяцам':group==='quarter'?'кварталам':'годам'}</h3><div class="finLegend">${keys.map((k,i)=>`<span><i class="finSeries${i}"></i>${{revenue:'Выручка',pay:'Мастерам',company:'Компания'}[k]}</span>`).join('')}</div></div>${data.length?`<div class="finBars" role="img" aria-label="Динамика: точные значения доступны в таблице периодов">${data.map(g=>`<div class="finBarGroup" data-fin-key="bar:${esc(g.key)}"><div>${keys.map((k,i)=>`<span class="finSeries${i}" style="height:${g[k]===null?0:Math.max(0,g[k]/max*100)}%" title="${esc(g.key)} · ${{revenue:'Выручка',pay:'Мастерам',company:'Компания'}[k]}: ${currency(g[k])}"></span>`).join('')}</div><small>${esc(g.key)}</small></div>`).join('')}</div>`:'<p class="muted finEmpty">Нет данных за выбранный период.</p>'}${all.length>24?'<p class="finNote">На графике последние 24 периода; полная история — в таблице.</p>':''}</section>`;
 }
 function rankings(m){return `<div class="finBottom">${[['revenue','ТОП по выручке'],['completed','ТОП по выполненным заявкам']].map(([k,title])=>`<section class="card"><h3>${title}</h3>${F.groups(m.rows,'master').filter(r=>r.completed&&r[k]!==null).sort((a,b)=>b[k]-a[k]).slice(0,5).map((r,i)=>`<button class="finRank" data-fin-master="${esc(r.key)}"><span class="finRankNumber">${i+1}</span><span>${esc(r.name)}</span><b>${format(k,r[k])}</b></button>`).join('')||'<p class="muted">Нет завершённых заявок.</p>'}</section>`).join('')}<section class="card"><h3>Выручка по источникам</h3>${F.groups(m.rows,'source').filter(g=>g.completed).sort((a,b)=>(b.revenue||0)-(a.revenue||0)).map(g=>`<button class="finSource" data-fin-source="${esc(g.key)}"><span>${esc(g.name)}</span><b>${currency(g.revenue)}</b><progress max="${m.total.known.revenue||1}" value="${g.known.revenue}"></progress></button>`).join('')||'<p class="muted">Нет завершённых заявок.</p>'}</section></div>`}
 function manual(o){const history=o.manual_completion_history;return Array.isArray(history)&&history.some(x=>Date.parse(x.at)===Date.parse(o.completed_at))?'Руководителем вручную':o.report_review_status==='approved'?'Принят отчёт':'—'}
 function ordersTable(rows,detail=false){
  const list=[...rows].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id)),hasManual=list.some(r=>Array.isArray(r.order.manual_completion_history)&&r.order.manual_completion_history.length);
  return `<section class="card finOrders"><h3>${detail?'Заявки мастера':'Финансовый реестр заявок'} <span class="softChip">${list.length}</span></h3><p class="finNote">День завершения — по Москве. Для активных заявок и отмен — дата визита, затем поступления. Они показаны для контроля, без начислений.</p><div class="finTableWrap"><table class="finTable"><thead><tr>${['№ / дата','Мастер / клиент','Источник / город','Работы','Стоимость','Доп. работы','Мастеру','Компании','Статус',...(hasManual?['Завершение']:[])].map(x=>`<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${list.slice(0,ui.limit).map(r=>`<tr data-fin-key="order:${esc(r.id)}"><th scope="row"><button class="linkBtn" data-fin-order="${esc(r.id)}">№ ${esc(name(r.order))} →</button><small>${esc(r.date||'Без даты')}</small></th><td data-label="Мастер / клиент">${esc(r.name)}<small>${esc(r.order.client||'—')}</small></td><td data-label="Источник / город">${esc(r.source)}<small>${esc(r.city)}</small></td><td data-label="Работы">${esc(r.order.work||'Не указаны')}</td><td data-label="Стоимость">${currency(r.revenue)}</td><td data-label="Доп. работы">${currency(r.extras)}</td><td data-label="Мастеру">${currency(r.pay)}</td><td data-label="Компании">${currency(r.company)}</td><td data-label="Статус">${esc(r.order.status)}</td>${hasManual?`<td data-label="Завершение">${manual(r.order)}</td>`:''}</tr>`).join('')||`<tr><td colspan="10">За выбранный период заявок нет.</td></tr>`}</tbody></table></div>${list.length>ui.limit?button('data-fin-more','',`Показать ещё (${list.length-ui.limit})`):''}</section>`;
 }
 function masterDetail(m){const rows=m.rows.filter(r=>r.master===ui.selected),master=F.groups(m.all,'master').find(r=>r.key===ui.selected),known=(state.masters||[]).find(x=>String(x.id)===ui.selected);return `<section id="finMasterDetail" class="finDetail"><div class="finHeading"><div><h2>${esc(master?.name||known?.full_name||'Мастер')}</h2><p class="muted">${esc(m.p.start||'Начало истории')} — ${esc(m.p.end||'сегодня')}</p></div>${button('data-fin-close-master','','Закрыть детализацию')}</div>${kpis(F.aggregate(rows),null,true)}${chart(rows)}${ordersTable(rows,true)}</section>`}
 function summaryTable(groups,label,cols=columns){return `<section class="card"><div class="finTableWrap"><table class="finTable"><thead><tr><th scope="col">${label}</th>${cols.map(([,name])=>`<th scope="col">${name}</th>`).join('')}</tr></thead><tbody>${groups.map(g=>`<tr data-fin-key="group:${esc(g.key)}"><th scope="row">${esc(g.name)}</th>${cols.map(([k,title])=>`<td data-label="${title}">${format(k,g[k])}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${cols.length+1}">Нет данных за выбранный период.</td></tr>`}</tbody></table></div></section>`}
 function contents(m){
  if(ui.selected)return masterDetail(m);
  if(ui.tab==='overview')return masterTable(m)+rankings(m)+chart(m.rows);
  if(ui.tab==='masters')return masterTable(m);
  if(ui.tab==='orders')return ordersTable(m.rows);
  if(ui.tab==='sources')return summaryTable(F.groups(m.rows,'source'),'Источник');
  if(ui.tab==='works')return `<p class="finNote">Точные названия из существующего каталога. Выручка и средний чек здесь — только основные работы. Допработы без разбивки по каталогу не приписываются основной работе. Количество — по составу работ заявки. Для нескольких работ без сохранённых цен по позициям выручка и допработы не распределяются; «—» означает отсутствие разбивки, а не ноль. Невыполненные позиции не считаются выполненными.</p>`+summaryTable(F.workGroups(m.rows),'Тип работы',[['quantity','Количество'],['total','Заявок'],['revenue','Выручка'],['extras','Доп. работы'],['average','Средний чек']]);
  const gs=F.periodGroups(m.rows,ui.group);
  return `<div class="finSegments">${[['day','По дням'],['week','По неделям'],['month','По месяцам'],['quarter','По кварталам'],['year','По годам']].map(([key,label])=>button('data-fin-group',key,label,ui.group===key)).join('')}</div>`+chart(m.rows)+summaryTable(gs,'Период',[...columns,['delta','Изменение выручки']])+`<p class="finNote">Изменение — к предыдущему календарному периоду той же длительности. При отсутствии сравнимых сумм — «—».</p>`;
 }
 function render(){
  if(!allowed())return '<section class="card"><h2>Раздел недоступен</h2><p class="muted">Недостаточно прав для просмотра финансов.</p></section>';
  identity();let m;try{m=model()}catch(e){error=e.message;const all=F.records(state.orders,state.masters);m={invalid:true,all,rows:[],p:{start:ui.from,end:ui.to},total:F.aggregate([]),before:null}}
  const undated=m.all.filter(r=>!r.date).length;
  return `<div id="financePage"><div class="finHeading"><div><h1>Финансы</h1><p class="muted">Результаты компании и каждого мастера</p></div><span class="softChip">МСК · ${esc(m.p.start||'Всё время')}${m.p.end?' — '+esc(m.p.end):''}</span></div><div class="finSegments">${periods.map(([key,label])=>button('data-fin-period',key,label,ui.period===key)).join('')}</div>${ui.period==='custom'?`<form class="finDates" id="finPeriodForm"><label>Дата от<input type="date" name="from" value="${esc(ui.from)}" required></label><label>Дата до<input type="date" name="to" value="${esc(ui.to)}" required></label><button class="primary">Применить</button></form>`:''}<p class="finError" role="status" ${error||window.BOS_LAST_REFRESH_ERROR?'':'hidden'}>${esc(error|| (window.BOS_LAST_REFRESH_ERROR?'Не удалось обновить данные. Показаны последние успешные значения.':''))}</p>${filters(m)}${m.invalid?'':kpis(m.total,m.before)}<div class="finTabs" aria-label="Разделы финансов">${tabs.map(([key,label])=>button('data-fin-tab',key,label,ui.tab===key)).join('')}</div><div id="finContent">${m.invalid?'<p class="finNote">Исправьте период для расчёта показателей.</p>':contents(m)}</div><p class="finNote">Выручка включает основные работы после вычетов и допработы. Начисления мастерам — сохранённая выплата плюс допработы, это не подтверждение фактической оплаты. Доля компании не является чистой прибылью. Для Hands без сохранённого расчёта доли компании показано «—». При отсутствии даты завершения используется дата проверки отчёта, затем дата визита.${undated?` Без даты: ${undated} заяв. Они доступны в «Всё время».`:''} Итоги рассчитаны по доступным данным приложения.</p></div>`;
 }
 pages.finance=render;
 function refresh(){if(state.page!=='finance')return;if(!allowed()){document.getElementById('financePage')?.remove();return}const host=document.getElementById('content');if(host)window.BOS_PATCH_CONTENT(host,render())}
 function sync(){
  queued=false;identity();const nav=document.querySelector('#app > nav');if(!nav)return;
  let b=nav.querySelector('[data-page="finance"]');
  if(!allowed()){b?.remove();document.getElementById('financePage')?.remove();if(document.querySelector('[data-fin-snapshot]'))closeModal();return}
  if(!b){b=document.createElement('button');b.dataset.page='finance';b.textContent='Финансы';b.onclick=()=>show('finance');const profile=nav.querySelector('[data-action="profile"]');nav.insertBefore(b,profile||null)}
  b.classList.toggle('active',state.page==='finance');
 }
 function scheduleSync(){if(!queued){queued=true;queueMicrotask(sync)}}
 document.addEventListener('click',event=>{
  if(!allowed())return;
  const root=event.target.closest?.('#financePage');if(!root)return;
  const b=event.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-fin-order')){
   const record=F.records(state.orders,state.masters).find(r=>r.id===b.dataset.finOrder);
   window.openOrder(b.dataset.finOrder);
   const modal=document.querySelector('#modalRoot .modal');
   if(record?.completed&&modal){const box=document.createElement('section');box.className='card';box.dataset.finSnapshot='';box.innerHTML=`<h3>Сохранённый финансовый расчёт</h3><dl class="masterCostBreakdown">${[['Основные работы после вычетов',record.base],['Дополнительные работы',record.extras],['Итоговая стоимость',record.revenue],['Начислено мастеру, включая допработы',record.pay],['Доля компании',record.company]].map(([label,value])=>`<div class="masterCostRow"><dt>${label}</dt><dd>${currency(value)}</dd></div>`).join('')}</dl><p class="muted">${esc(record.source)} · ${esc(record.name)} · ${esc(record.date||'Без даты')}<br>«—» означает отсутствие сохранённого значения или действующего расчёта для источника. Исторические выплаты не пересчитываются.</p>`;modal.appendChild(box)}
   return;
  }
  if(b.hasAttribute('data-fin-period')){ui.period=b.dataset.finPeriod;error='';if(ui.period==='custom'&&!ui.from){const p=F.period('month');ui.from=p.start;ui.to=p.end}}
  else if(b.hasAttribute('data-fin-tab')){ui.tab=b.dataset.finTab;ui.selected='';ui.limit=30}
  else if(b.hasAttribute('data-fin-master')){ui.selected=b.dataset.finMaster;ui.limit=30}
  else if(b.hasAttribute('data-fin-close-master'))ui.selected='';
  else if(b.hasAttribute('data-fin-sort')){const key=b.dataset.finSort;ui.direction=ui.sort===key?-ui.direction:key==='name'?1:-1;ui.sort=key}
  else if(b.hasAttribute('data-fin-source')){ui.source=b.dataset.finSource;ui.tab='sources'}
  else if(b.hasAttribute('data-fin-group'))ui.group=b.dataset.finGroup;
  else if(b.hasAttribute('data-fin-more'))ui.limit+=30;
  else return;
  refresh();
 });
 document.addEventListener('change',event=>{const input=event.target;if(!allowed()||!input.closest?.('#financePage'))return;if(input.hasAttribute('data-fin-sort-select')){ui.sort=input.value;ui.direction=ui.sort==='name'?1:-1;refresh();return}if(!input.dataset.finFilter)return;ui[input.dataset.finFilter]=input.value;ui.selected='';ui.limit=30;refresh()});
 document.addEventListener('input',event=>{if(!allowed()||!event.target.matches?.('#financePage [data-fin-search]'))return;ui.search=event.target.value;refresh()});
 document.addEventListener('submit',event=>{if(event.target.id!=='finPeriodForm'||!allowed())return;event.preventDefault();const f=new FormData(event.target);ui.from=String(f.get('from'));ui.to=String(f.get('to'));error='';refresh()});
 function direct(){sync();if(allowed()&&(location.hash==='#finance'||new URLSearchParams(location.search).get('page')==='finance'))show('finance')}
 window.addEventListener('bos:auth-ready',direct);
 window.addEventListener('hashchange',direct);
 window.addEventListener('bos:employee-data-refreshed',()=>{sync();refresh()});
 window.addEventListener('bos:employee-data-refresh-error',refresh);
 window.addEventListener('storage',scheduleSync);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
 new MutationObserver(scheduleSync).observe(document.body,{attributes:true,attributeFilter:['class']});
 new MutationObserver(scheduleSync).observe(document.getElementById('content'),{childList:true});
 window.BOS_FINANCE_PAGE=Object.freeze({refresh,allowed});
 sync();
})();
