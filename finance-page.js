(()=>{
 'use strict';
 if(window.BOS_FINANCE_PAGE)return;
 const F=window.BOS_FINANCE_DATA,E=window.BOS_FINANCE_EXPENSES;
 let expenseGeneration=0,expenseState={key:"",ready:false,rows:[],error:"",loading:false};
 const tabs=[['overview','Обзор'],['expenses','Расходы'],['masters','Мастера'],['orders','Заявки'],['sources','Источники'],['works','Работы'],['periods','Периоды']];
 const periods=[['today','Сегодня'],['yesterday','Вчера'],['week','Неделя'],['month','Месяц'],['quarter','Квартал'],['year','Год'],['all','Всё время'],['custom','Свой период']];
 const columns=[['total','Заявок всего'],['completed','Выполнено'],['cancelled','Отменено'],['revenue','Выручка'],['extras','Доп. работы'],['pay','Мастеру'],['company','Компании'],['average','Средний чек']];
 const measures=[['revenue','Выручка','₽'],['pay','Начислено мастерам','↗'],['company','Доля компании','▥'],['extras','Дополнительные работы','＋'],['completed','Выполненные заявки','✓'],['average','Средний чек','◇']];
 let actor='',ui=defaults(),error='',queued=false;
 function defaults(){return {tab:'overview',period:'month',from:'',to:'',master:'',city:'',source:'',work:'',search:'',sort:'revenue',direction:-1,selected:'',group:'month',limit:30}}
 const allowed=()=>!!window.BOS_ORDER_CONTROL?.identity()&&window.BOS_PERMISSIONS.isFinanceWorkspaceActive(state.user,state.settings?.permissions);
 function identity(){const next=window.BOS_ORDER_CONTROL?.identity()||'';if(next!==actor){actor=next;ui=defaults();error='';resetExpenses()}}
 const currency=n=>n===null?'—':money(n);
 const format=(k,v)=>v===null?'—':k==='delta'?(v>0?'+':'')+v+'%':['total','completed','cancelled','quantity'].includes(k)?String(v):currency(v);
 const selected=(a,b)=>a===b?' selected':'';
 const button=(attr,value,label,active=false)=>`<button type="button" class="${active?'primary':'secondary'}" ${attr}="${esc(value)}" aria-pressed="${active}">${label}</button>`;
 const name=o=>String(o.external_id||'').startsWith('hands:')?String(o.external_id).slice(6):String(o.id);
 function resetExpenses(){expenseGeneration++;expenseState={key:'',ready:false,rows:[],error:'',loading:false};if(document.querySelector('[data-fin-expense-dialog]'))closeModal()}
 function expenseScope(){const p=range(),previous=F.previous(p,ui.period);return {start:previous?.start||p.start,end:p.end}}
 async function expenseRequest(action,payload){
  const who=actor;if(!allowed()||!who)throw Error('Недостаточно прав.');
  const result=await api(action,payload);
  if(who!==window.BOS_ORDER_CONTROL?.identity()||!allowed())throw Error('Аккаунт изменился.');
  if(!result?.ok)throw Error(result?.error||'Не удалось сохранить расход.');
  return result;
 }
 async function loadExpenses(force=false){
  if(state.page!=='finance'||!allowed())return;
  let scope;try{scope=expenseScope()}catch{return}
  const key=JSON.stringify(scope);
  if(expenseState.key===key&&(expenseState.loading||(!force&&(expenseState.ready||expenseState.error))))return;
  if(expenseState.key!==key){expenseGeneration++;expenseState={key,ready:false,rows:[],error:'',loading:false}}
  const run=++expenseGeneration,who=actor;expenseState.loading=true;
  try{const data=await expenseRequest('listExpenses',scope);if(run!==expenseGeneration||who!==actor)return;expenseState.rows=data.expenses;expenseState.ready=true;expenseState.error=''}
  catch(e){if(run===expenseGeneration&&who===actor)expenseState.error=e.message}
  finally{if(run===expenseGeneration&&who===actor){expenseState.loading=false;refresh()}}
 }
 function expenseSelection(p,all){return E.select(expenseState.rows,{period:p,master:ui.master,source:ui.source,city:ui.city,work:ui.work},all)}
 function withExpenses(total,rows,ready){return {...total,...(ready?E.summary(rows,total.company):{expenses:null,net:null})}}
 function expenseContent(m){
  const summary=E.summary(m.expenses,m.total.company),list=[...m.expenses].sort((a,b)=>b.expense_date.localeCompare(a.expense_date)||b.created_at.localeCompare(a.created_at));
  return `<section class="card finExpenseCategories"><h2>По статьям</h2>${summary.categories.map(c=>`<div class="finExpenseCategory" data-fin-key="category:${esc(c.key)}"><span>${esc(c.name)}</span><b>${currency(c.amount)}</b></div>`).join('')||'<p class="muted">Расходов за выбранный период нет.</p>'}</section><section class="card finExpenseList"><h2>Операции <span class="softChip">${list.length}</span></h2>${list.slice(0,ui.limit).map(e=>`<article class="finExpense" data-fin-key="expense:${esc(e.id)}"><div class="finExpenseHeading"><div><small>${esc(e.expense_date)}</small><h3>${esc(E.label(e.category))}</h3></div><strong>${currency(e.amount)}</strong></div>${e.comment?`<p>${esc(e.comment)}</p>`:''}<small class="muted">${esc(e.created_by_name)} · добавлено ${esc(new Date(e.created_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}))}${e.city?' · '+esc(e.city):''}${e.order_id?' · заявка № '+esc(e.order_id):''}</small><div class="finExpenseActions"><button type="button" class="secondary" data-fin-expense-edit="${esc(e.id)}">Редактировать</button><button type="button" class="secondary" data-fin-expense-delete="${esc(e.id)}">Удалить</button></div></article>`).join('')||'<p class="muted">Здесь будут расходы компании.</p>'}${list.length>ui.limit?button('data-fin-more','',`Показать ещё (${list.length-ui.limit})`):''}</section>`;
 }
 function expenseSaved(result,form){
  if(!allowed())return;expenseGeneration++;expenseState.loading=false;
  expenseState.rows=expenseState.rows.filter(e=>e.id!==(result.expense?.id||result.deleted_id));
  if(result.expense)expenseState.rows.push(result.expense);
  if(form.isConnected)closeModal();refresh();loadExpenses(true);
 }
 function expenseEditor(id=''){
  if(!allowed())return;
  const record=expenseState.rows.find(e=>e.id===id);if(id&&!record)return;
  const e=record||{id:crypto.randomUUID(),expense_date:window.BOS_SALARY_PERIODS.day(new Date()),amount:'',category:'',comment:'',city:'',order_id:'',employee_id:''};
  const title=record?'Редактировать расход':'Добавить расход';
  const staff=(state.users||state.masters||[]).filter(x=>E.validId(x.id));
  // Keep an existing association even when bootstrap omits inactive staff.
  if(e.employee_id&&!staff.some(x=>String(x.id)===String(e.employee_id)))staff.push({id:e.employee_id,full_name:(state.orders||[]).find(o=>String(o.master_staff_id)===String(e.employee_id))?.master_name||'Сотрудник вне текущего списка'});
  const options=(list,value)=>list.map(([key,name])=>`<option value="${esc(key)}"${selected(String(value||''),String(key))}>${esc(name)}</option>`).join('');
  openModal(`<section data-fin-expense-dialog><h2>${title}</h2><form id="finExpenseForm" class="form"><label>Сумма, ₽ *<input name="amount" inputmode="decimal" autocomplete="off" value="${esc(e.amount)}" required></label><label>Статья *<select name="category" required><option value="">Выберите статью</option>${options(E.categories.map(c=>[c.key,c.label]),e.category)}</select></label><label>Дата *<input name="expense_date" type="date" value="${esc(e.expense_date)}" required></label><label>Комментарий<textarea name="comment" maxlength="500" rows="3" placeholder="Описание расхода; обязательно для «Прочее»">${esc(e.comment)}</textarea></label><details class="finExpenseOptional"><summary>Город, заявка или сотрудник</summary><label>Город<input name="city" maxlength="100" value="${esc(e.city||'')}" placeholder="Необязательно"></label><label>Заявка<select name="order_id"><option value="">Без привязки</option>${options((state.orders||[]).map(o=>[o.id,`№ ${name(o)} · ${o.client||''}`]),e.order_id)}</select></label><label>Сотрудник<select name="employee_id"><option value="">Без привязки</option>${options(staff.map(x=>[x.id,x.full_name||'Сотрудник']),e.employee_id)}</select></label></details><p role="status" class="finError"></p><button type="submit" class="primary wide">${record?'Сохранить':'Добавить расход'}</button></form></section>`);
  const form=document.getElementById('finExpenseForm');let busy=false;
  form.onsubmit=async event=>{
   event.preventDefault();if(busy)return;const msg=form.querySelector('[role="status"]');let fields;
   try{fields=E.validate(Object.fromEntries(new FormData(form)))}catch(e){msg.textContent=e.message;return}
   busy=true;const button=form.querySelector('[type="submit"]');button.disabled=true;msg.textContent='Сохраняем…';
   try{const result=await expenseRequest(record?'updateExpense':'createExpense',{id:e.id,...fields,...(record?{updated_at:e.updated_at}:{})});expenseSaved(result,form)}
   catch(e){msg.textContent=e.message}finally{busy=false;button.disabled=false}
  };
 }
 function expenseDelete(id){
  const e=expenseState.rows.find(x=>x.id===id);if(!e||!allowed())return;
  openModal(`<section data-fin-expense-dialog><h2>Удалить расход?</h2><p>${esc(E.label(e.category))} · ${currency(e.amount)} · ${esc(e.expense_date)}</p><form id="finExpenseDeleteForm"><p role="status" class="finError"></p><button type="submit" class="primary wide">Удалить расход</button></form></section>`);
  const form=document.getElementById('finExpenseDeleteForm');let busy=false;
  form.onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;const button=form.querySelector('button');button.disabled=true;try{expenseSaved(await expenseRequest('deleteExpense',{id:e.id,updated_at:e.updated_at}),form)}catch(e){form.querySelector('[role="status"]').textContent=e.message}finally{busy=false;button.disabled=false}};
 }

 function range(){return F.period(ui.period,new Date(),ui.from,ui.to)}
 function model(){
  const all=F.records(state.orders,state.masters),p=range(),filters={period:p,master:ui.master,source:ui.source,city:ui.city,work:ui.work};
  const rows=F.select(all,filters),previous=F.previous(p,ui.period);
  const ready=expenseState.ready&&expenseState.key===JSON.stringify(expenseScope()),expenses=ready?expenseSelection(p,all):[];
  return {all,rows,p,expenses,total:withExpenses(F.aggregate(rows),expenses,ready),before:previous?withExpenses(F.aggregate(F.select(all,{...filters,period:previous})),expenseSelection(previous,all),ready):null};
 }
 function select(label,key,values){return `<label class="finFilter">${label}<select data-fin-filter="${key}" aria-label="${label}"><option value="">Все${key==='city'?' города':key==='master'?' мастера':key==='source'?' источники':' работы'}</option>${values.map(([keyValue,title])=>`<option value="${esc(keyValue)}"${selected(ui[key],keyValue)}>${esc(title)}</option>`).join('')}</select></label>`}
 function filters(m){
  const masters=new Map();for(const r of m.all)masters.set(r.master,r.name);for(const master of state.masters||[])if(!masters.has(String(master.id)))masters.set(String(master.id),master.full_name||'Мастер');
  for(const e of expenseState.rows)if(e.employee_id&&!masters.has(String(e.employee_id)))masters.set(String(e.employee_id),(state.users||[]).find(u=>String(u.id)===String(e.employee_id))?.full_name||'Сотрудник вне текущего списка');
  const values=k=>[...new Set([...m.all.map(r=>r[k]),...(k==='city'?expenseState.rows.map(e=>e.city).filter(Boolean):[]),...(ui[k]?[ui[k]]:[])])].sort().map(x=>[x,x]);
  const workIds=new Set(m.all.flatMap(r=>r.works.map(w=>w.key))),works=F.catalog.filter(w=>workIds.has(w.id)).map(w=>[w.id,w.name]);
  if(m.all.some(r=>!r.workKnown))works.push(['unknown','Без точного соответствия каталогу']);
  return `<details class="finFilters" open><summary>Фильтры</summary><div class="finFilterGrid">${select('Город','city',values('city'))}${select('Мастер','master',[...masters])}${select('Источник','source',values('source'))}${select('Тип работ','work',works)}</div></details>`;
 }
 function kpis(total,before=null,detail=false){return `<div class="finKpis">${(detail?measures:[...measures.slice(0,3),['expenses','Расходы','−'],['net','Чистая прибыль','₽'],...measures.slice(3)]).map(([k,label,icon])=>{const delta=before?F.change(total[k],before[k]):null;return `<section class="card finKpi" ${detail?'data-fin-detail-kpi':'data-fin-kpi'}="${k}"><span class="finIcon" aria-hidden="true">${icon}</span><span class="muted">${label}</span><strong>${format(k,total[k])}</strong><small>${total.missing?.[k]?`Нет сохранённой суммы у ${total.missing[k]} заяв. • известная часть ${currency(total.known[k])}`:delta!==null?`${delta>0?'+':''}${delta}% к предыдущему периоду`:k==='pay'?'Начисления, включая допработы':k==='revenue'?'Основные работы + допработы':k==='company'?'По доступному расчёту источника':k==='net'?(total.company===null?'Неизвестен полный доход компании':before?.net!==null&&before?.net!==undefined?'Предыдущий период: '+currency(before.net):'Доход компании минус расходы'):k==='expenses'?'Расходы за выбранный период':'За выбранный период'}</small></section>`}).join('')}</div>`}
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
  if(ui.tab==='expenses')return expenseContent(m);
  if(ui.tab==='overview')return masterTable(m)+rankings(m)+chart(m.rows);
  if(ui.tab==='masters')return masterTable(m);
  if(ui.tab==='orders')return ordersTable(m.rows);
  if(ui.tab==='sources')return summaryTable(F.groups(m.rows,'source'),'Источник');
  if(ui.tab==='works')return `<p class="finNote">Точные названия из существующего каталога. Выручка и средний чек здесь — только основные работы. Допработы без разбивки по каталогу не приписываются основной работе. Количество — по составу работ заявки. Для нескольких работ без сохранённых цен по позициям выручка и допработы не распределяются; «—» означает отсутствие разбивки, а не ноль. Невыполненные позиции не считаются выполненными.</p>`+summaryTable(F.workGroups(m.rows),'Тип работы',[['quantity','Количество'],['total','Заявок'],['revenue','Выручка'],['extras','Доп. работы'],['average','Средний чек']]);
  const gs=E.periodGroups(m.rows,m.expenses,ui.group,F).map(g=>({...g,expenses:m.total.expenses===null?null:g.expenses,net:m.total.expenses===null?null:g.net}));
  return `<div class="finSegments">${[['day','По дням'],['week','По неделям'],['month','По месяцам'],['quarter','По кварталам'],['year','По годам']].map(([key,label])=>button('data-fin-group',key,label,ui.group===key)).join('')}</div>`+chart(m.rows)+summaryTable(gs,'Период',[...columns,['expenses','Расходы'],['net','Чистая прибыль'],['delta','Изменение выручки']])+`<p class="finNote">Изменение — к предыдущему календарному периоду той же длительности. При отсутствии сравнимых сумм — «—».</p>`;
 }
 function render(){
  if(!allowed())return '<section class="card"><h2>Раздел недоступен</h2><p class="muted">Недостаточно прав для просмотра финансов.</p></section>';
  identity();queueMicrotask(()=>loadExpenses());let m;try{m=model()}catch(e){error=e.message;const all=F.records(state.orders,state.masters);m={invalid:true,all,rows:[],expenses:[],p:{start:ui.from,end:ui.to},total:F.aggregate([]),before:null}}
  const undated=m.all.filter(r=>!r.date).length;
  return `<div id="financePage"><div class="finHeading"><div><h1>Финансы</h1><p class="muted">Результаты компании и каждого мастера</p></div><div class="finHeadingActions"><button type="button" class="primary" data-fin-expense-add>+ Добавить расход</button><span class="softChip">МСК · ${esc(m.p.start||'Всё время')}${m.p.end?' — '+esc(m.p.end):''}</span></div></div><div class="finSegments">${periods.map(([key,label])=>button('data-fin-period',key,label,ui.period===key)).join('')}</div>${ui.period==='custom'?`<form class="finDates" id="finPeriodForm"><label>Дата от<input type="date" name="from" value="${esc(ui.from)}" required></label><label>Дата до<input type="date" name="to" value="${esc(ui.to)}" required></label><button class="primary">Применить</button></form>`:''}<p class="finError" role="status" ${error||window.BOS_LAST_REFRESH_ERROR?'':'hidden'}>${esc(error|| (window.BOS_LAST_REFRESH_ERROR?'Не удалось обновить данные. Показаны последние успешные значения.':''))}</p>${filters(m)}<p class="finExpenseError" role="status" ${expenseState.error?'':'hidden'}>${esc(expenseState.error)} ${expenseState.ready?'Показаны последние загруженные расходы.':''} <button type="button" class="secondary" data-fin-expense-retry>Повторить загрузку расходов</button></p>${!expenseState.ready?'<p class="finNote">Расходы загружаются…</p>':''}${ui.master||ui.source||ui.work||ui.city?'<p class="finNote">При фильтрах расходы учитываются только по указанному городу, сотруднику или связанной заявке. Общие расходы без привязки не распределяются. Для прибыли всей компании сбросьте фильтры.</p>':''}${m.invalid?'':kpis(m.total,m.before)}<div class="finTabs" aria-label="Разделы финансов">${tabs.map(([key,label])=>button('data-fin-tab',key,label,ui.tab===key)).join('')}</div><div id="finContent">${m.invalid?'<p class="finNote">Исправьте период для расчёта показателей.</p>':contents(m)}</div><p class="finNote">Выручка включает основные работы после вычетов и допработы. Начисления мастерам — сохранённая выплата плюс допработы, это не подтверждение фактической оплаты. Чистая прибыль — доля компании минус внесённые расходы за период; выплаты мастерам не меняются. Для Hands без сохранённого расчёта доли компании показано «—». При отсутствии даты завершения используется дата проверки отчёта, затем дата визита.${undated?` Без даты: ${undated} заяв. Они доступны в «Всё время».`:''} Итоги рассчитаны по доступным данным приложения.</p></div>`;
 }
 pages.finance=render;
 function refresh(){if(state.page!=='finance')return;if(!allowed()){resetExpenses();document.getElementById('financePage')?.remove();return}const host=document.getElementById('content');if(host)window.BOS_PATCH_CONTENT(host,render())}
 function sync(){
  queued=false;identity();const nav=document.querySelector('#app > nav');if(!nav)return;
  let b=nav.querySelector('[data-page="finance"]');
  if(!allowed()){if(expenseState.ready||expenseState.loading||document.querySelector('[data-fin-expense-dialog]'))resetExpenses();b?.remove();document.getElementById('financePage')?.remove();if(document.querySelector('[data-fin-snapshot]'))closeModal();return}
  if(!b){b=document.createElement('button');b.dataset.page='finance';b.textContent='Финансы';b.onclick=()=>show('finance');const profile=nav.querySelector('[data-action="profile"]');nav.insertBefore(b,profile||null)}
  b.classList.toggle('active',state.page==='finance');
 }
 function scheduleSync(){if(!queued){queued=true;queueMicrotask(sync)}}
 document.addEventListener('click',event=>{
  if(!allowed())return;
  const root=event.target.closest?.('#financePage');if(!root)return;
  const b=event.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-fin-expense-retry')){loadExpenses(true);return}
  if(b.hasAttribute('data-fin-expense-add')){expenseEditor();return}
  if(b.hasAttribute('data-fin-expense-edit')){expenseEditor(b.dataset.finExpenseEdit);return}
  if(b.hasAttribute('data-fin-expense-delete')){expenseDelete(b.dataset.finExpenseDelete);return}
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
 window.addEventListener('bos:employee-data-refreshed',()=>{sync();refresh();loadExpenses(true)});
 window.addEventListener('bos:employee-data-refresh-error',refresh);
 window.addEventListener('storage',scheduleSync);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
 new MutationObserver(scheduleSync).observe(document.body,{attributes:true,attributeFilter:['class']});
 new MutationObserver(scheduleSync).observe(document.getElementById('content'),{childList:true});
 window.BOS_FINANCE_PAGE=Object.freeze({refresh,allowed});
 sync();
})();
