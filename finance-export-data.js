// Export projections use the same read models as the Finance workspace.
(function(root,factory){
 const common=typeof module==='object'&&module.exports;
 const api=factory(common?require('./finance-data.js'):root.BOS_FINANCE_DATA,common?require('./finance-expenses.js'):root.BOS_FINANCE_EXPENSES,common?require('./salary-periods.js'):root.BOS_SALARY_PERIODS,common?require('./order-work-items.js'):root.BOS_WORK_ITEMS);
 if(common)module.exports=api;else root.BOS_FINANCE_EXPORT_DATA=api;
})(globalThis,function(F,E,D,W){
 'use strict';
 const text=v=>String(v??'').trim();
 const number=v=>v!==null&&v!==undefined&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))?Number(v):null;
 const round=n=>Math.round((n+Number.EPSILON)*100)/100;
 const sum=values=>values.some(x=>x===null)?null:values.reduce((n,x)=>n+Math.round(x*100),0)/100;
 const date=v=>D.valid(text(v).slice(0,10))?{type:'date',value:text(v).slice(0,10)}:null;
 const day=v=>v?date(D.day(v)):null;
 const money=v=>v===null?null:{type:'money',value:v};
 const orderNumber=o=>text(o.order_number)||(text(o.external_id).startsWith('hands:')?text(o.external_id).slice(6):text(o.id));
 function filters(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['period','master','source','city','work','selected','search'].includes(k)))throw Error('INVALID_FILTER');
  const p=input.period||{start:'',end:''};
  if(!p||typeof p!=='object'||Object.keys(p).some(k=>!['start','end'].includes(k))||typeof p.start!=='string'||typeof p.end!=='string'||((p.start||p.end)&&(!E.validDate(p.start)||!E.validDate(p.end)||p.start>p.end)))throw Error('INVALID_PERIOD');
  const result={period:{start:p.start,end:p.end}};
  for(const k of ['master','source','city','work','selected','search']){
   if(input[k]!==undefined&&(typeof input[k]!=='string'||input[k].length>500))throw Error('INVALID_FILTER');
   result[k]=input[k]||'';
  }
  return result;
 }
 function snapshot(orders,staff,expenses,input,claims=null){
  const f=filters(input),masters=staff.filter(s=>s.role==='master'&&s.is_active!==false);
  // Match bootstrap's master aliases and missing-name fallback exactly.
  const active=new Map(staff.filter(s=>s.is_active!==false).map(s=>[String(s.id),s]));
  const normalized=orders.map(o=>({...o,id:String(o.id),master_vk_id:active.get(String(o.master_staff_id))?.external_id||'',master_name:o.master_name||active.get(String(o.master_staff_id))?.full_name||''}));
  const all=F.records(normalized,masters),allMap=new Map(all.map(r=>[r.id,r]));
  const nameMatch=name=>!f.search||name.toLocaleLowerCase('ru-RU').includes(f.search.toLocaleLowerCase('ru-RU'));
  const scopeMatch=r=>(!f.selected||r.master===f.selected)&&nameMatch(r.name);
  const rows=F.select(all,f).filter(scopeMatch);
  const staffNames=new Map(staff.map(s=>[String(s.id),text(s.full_name)])),activeNames=new Map([...active].map(([key,s])=>[key,text(s.full_name)]));
  const expenseRows=E.select(expenses,f,all).filter(e=>{
   const order=allMap.get(String(e.order_id)),key=String(e.employee_id||order?.master||'unassigned');
   // Bootstrap exposes active staff only. Historical names used for selection must
   // not change when the server also knows a renamed inactive employee.
   const filterName=activeNames.get(key)||(order?.master===key?order.name:'')||'Без мастера';
   return (!f.selected||key===f.selected)&&nameMatch(filterName);
  });
  const total=F.aggregate(rows);
  const days=[...rows.map(r=>r.date),...expenseRows.map(e=>e.expense_date)].filter(Boolean).sort();
  // All-time files use observed date bounds in the filename; undated rows remain included.
  const period=f.period.start?f.period:{start:days[0]||D.day(),end:days.at(-1)||D.day()};
  const selectedIds=new Set(rows.map(r=>r.id)),seenClaims=new Set();
  const claimRows=claims===null?null:claims.filter(c=>{const d=D.day(c.opened_at);return c.id&&!seenClaims.has(String(c.id))&&selectedIds.has(String(c.order_id))&&(!f.period.start||(d>=f.period.start&&d<=f.period.end))&&seenClaims.add(String(c.id))});
  return {filters:f,rows,allMap,masters,staffNames,activeNames,claims:claimRows,expenses:expenseRows,total:{...total,...E.summary(expenseRows,total.company)},period,filename:`business-os-finance-${period.start}_${period.end}.xlsx`};
 }
 function grouped(s,kind){
  const map=new Map(F.groups(s.rows,kind).map(g=>[g.key,{...g,expenseRows:[]}]));
  const add=(key,name)=>{if(!map.has(key))map.set(key,{key,name,rows:[],...F.aggregate([]),expenseRows:[]});return map.get(key)};
  if(kind==='master')for(const m of s.masters){
   const key=String(m.id),f=s.filters,name=text(m.full_name)||'Мастер';
   if((!f.master||f.master===key)&&(!f.selected||f.selected===key)&&(!f.city||f.city===m.city)&&(!f.search||name.toLocaleLowerCase('ru-RU').includes(f.search.toLocaleLowerCase('ru-RU'))))add(key,name);
  }
  for(const e of s.expenses){
   const order=s.allMap.get(String(e.order_id));
   const key=kind==='master'?String(e.employee_id||order?.master||'unassigned'):order?.source||'Без привязки к источнику';
   const name=kind==='master'?(s.staffNames.get(key)||(order?.master===key?order.name:'')||'Без мастера'):key;
   add(key,name).expenseRows.push(e);
  }
  const claimCounts=new Map();
  if(kind==='master')for(const c of s.claims||[]){
   const order=s.allMap.get(String(c.order_id)),key=String(c.master_staff_id||order?.master||'unassigned'),f=s.filters,name=s.staffNames.get(key)||'Без мастера';
   const filterName=s.activeNames.get(key)||(order?.master===key?order.name:'')||'Без мастера';
   if((f.master&&f.master!==key)||(f.selected&&f.selected!==key)||(f.search&&!filterName.toLocaleLowerCase('ru-RU').includes(f.search.toLocaleLowerCase('ru-RU'))))continue;
   add(key,name);claimCounts.set(key,(claimCounts.get(key)||0)+1);
  }
  return [...map.values()].map(g=>({...g,...E.summary(g.expenseRows,g.company),corrections:s.claims===null?null:claimCounts.get(g.key)||0}));
 }
 function* works(s){
  for(const r of s.rows){
   const o=r.order,prefix=[orderNumber(o),r.source,day(o.completed_at),r.name,text(o.address)];
   const items=Array.isArray(o.work_items)?o.work_items:[];
   let legacy=text(o.work);
   // Do not reprice old lines using today's catalogue, or distribute order pay arbitrarily.
   if(items.length){
    for(const w of items)yield [...prefix,text(w.name),'основная',number(w.quantity),text(w.unit),number(w.unit_price),number(w.amount),null,null,null];
    // intakePatch preserves freeform lines before W.text(items). Remove only
    // that generated suffix; export the remaining saved work without invented prices.
    const suffix=W.text(items);if(suffix&&legacy.endsWith(suffix))legacy=text(legacy.slice(0,-suffix.length));
    else if(legacy===items.map(w=>w.name).join('\n'))legacy='';
   }
   for(const line of legacy.split(/\n+/).filter(Boolean)){
    const match=line.match(/^(.*?)\s*[×x]\s*([\d.,]+)(?:\s+(.*))?$/iu);
    const known=r.works.find(w=>w.name===text(match?match[1]:line));
    yield [...prefix,text(match?match[1]:line),'основная',match?number(match[2].replace(',','.')):null,text(match?.[3]||known?.unit),null,null,null,null,null];
   }
   if(number(o.extra_work_amount)>0||text(o.extra_work_description))yield [...prefix,text(o.extra_work_description),'дополнительная',null,null,null,number(o.extra_work_amount),'Допработы отдельно: сохранённая сумма полностью мастеру',r.completed?number(o.extra_work_amount):null,null];
   const deductions=Array.isArray(o.uncompleted_work_items)?o.uncompleted_work_items:[];
   if(deductions.length)for(const w of deductions)yield [...prefix,text(w.name),'невыполненная',number(w.quantity),text(w.unit),number(w.unit_price),number(w.amount),null,null,text(o.uncompleted_work_description)];
   else if(number(o.uncompleted_work_amount)>0||text(o.uncompleted_work_description))yield [...prefix,text(o.uncompleted_work_description),'невыполненная',null,null,null,number(o.uncompleted_work_amount),null,null,null];
  }
 }
 const cols=(names,types={})=>names.map((name,i)=>({name,type:types[i]||'text',width:types[i]==='money'?19:types[i]==='date'?16:Math.min(45,Math.max(18,name.length+3))}));
 function sheets(s,now=new Date()){
  const orderExpenses=new Map();for(const e of s.expenses)if(e.order_id)orderExpenses.set(String(e.order_id),(orderExpenses.get(String(e.order_id))||0)+Math.round(Number(e.amount)*100));
  const masters=grouped(s,'master'),sources=grouped(s,'source');
  const completed=s.rows.filter(r=>r.completed),deduction=rows=>sum(rows.filter(r=>r.completed).map(r=>number(r.order.uncompleted_work_amount)));
  const summary=[
   ['Период выгрузки',s.filters.period.start?`${s.period.start} — ${s.period.end}`:'Всё время (включая заявки без даты)'],
   ['Начало периода',date(s.period.start)],['Окончание периода',date(s.period.end)],
   ['Сформировано (МСК)',{type:'datetime',value:new Date(now.getTime()+3*3600000).toISOString().slice(0,19)}],
   ['Количество заявок',s.total.total],['Завершённых заявок',s.total.completed],
   ['Стоимость основных работ после вычетов',money(sum(completed.map(r=>r.base)))],
   ['Дополнительные работы',money(s.total.extras)],['Невыполненные работы',money(deduction(s.rows))],
   ['Скидки',null],['Другие корректировки',null],['Итоговая выручка',money(s.total.revenue)],
   ['Начисленная зарплата мастеров',money(s.total.pay)],['Расходы',money(s.total.expenses)],
   ['Доля компании до расходов',money(s.total.company)],['Прибыль компании / после расходов',money(s.total.net)],['Средний чек',money(s.total.average)],
   ['Правило зарплаты','Сохранённое начисление + допработы; без удержания 6%.'],
   ['Отсутствующие данные','Пустая ячейка означает, что значение или разбивка не сохранены.'],
   ['Методика','Выручка и начисления — только завершённые заявки. Основная стоимость уже после вычетов; не вычитать невыполненные работы повторно.'],
   ['Период','Завершённые: completed_at, затем report_reviewed_at, затем scheduled_date. Остальные: scheduled_date, затем created_at. МСК.'],
   ['Расходы','По дате операции. Общие расходы не распределяются по заявкам. Расходы по заявкам вне периода учитываются в своих группах.'],
   ['Работы','Основные позиции показывают сохранённый исходный состав; невыполненные позиции показаны отдельно. Не суммировать все типы как выручку.'],
   ['Прибыль','Аналитическая доля компании минус расходы; не остаток денег на счёте.'],
   ['Возвраты или исправления','Количество сохранённых претензий order_claims по выбранным заявкам, открытых в периоде; мастер — назначенный в претензии. Это не число возвратов денег.'],
  ];
  for(const [key,label] of [['master','Мастер'],['selected','Открытая детализация мастера'],['search','Поиск мастера'],['source','Источник'],['city','Город'],['work','Работа']])if(s.filters[key])summary.push([`Фильтр: ${label}`,s.filters[key]==='unknown'?'Без точного соответствия каталогу':s.staffNames.get(s.filters[key])||F.catalog.find(w=>w.id===s.filters[key])?.name||s.filters[key]]);
  for(const [label,groups] of [['Источник',sources],['Мастер',masters]])for(const g of groups)for(const [key,title] of [['total','Заявок'],['completed','Выполнено'],['revenue','Выручка'],['pay','Начислено мастерам'],['expenses','Расходы'],['company','Доля компании'],['net','Прибыль'],['average','Средний чек']])summary.push([`${label}: ${g.name} — ${title}`,['total','completed'].includes(key)?g[key]:money(g[key])]);
  const result=[
   {name:'Сводка',columns:[{name:'Показатель',width:64},{name:'Значение',width:80}],rows:function*(){yield* summary}},
   {name:'Заявки',columns:cols(['Внутренний ID заявки','Номер заявки','Источник','Дата поступления','Дата согласования','Запланированная дата выполнения','Фактическая дата завершения','Статус','Клиент','Телефон клиента','Адрес','Город или район','Назначенный мастер','Стоимость основных работ','Стоимость дополнительных работ','Сумма невыполненных работ','Скидка','Другие корректировки','Итоговая сумма заявки','Начисление мастеру','Расходы по заявке','Доход компании','Прибыль по заявке','Способ оплаты','Статус оплаты','Комментарий','Идентификатор отчёта'],Object.fromEntries([...Array.from({length:4},(_,i)=>[i+3,'date']),...Array.from({length:10},(_,i)=>[i+13,'money'])])),rows:function*(){
    for(const r of s.rows){const o=r.order,expenses=(orderExpenses.get(r.id)||0)/100;yield [r.id,orderNumber(o),r.source,date(o.received_date)||day(o.created_at),day(o.master_agreed_at),date(o.scheduled_date),day(o.completed_at),text(o.status),text(o.client),text(o.phone),text(o.address),text(o.city),r.name,r.base,r.extras,number(o.uncompleted_work_amount),null,null,r.revenue,r.pay,expenses,r.company,r.company===null?null:round(r.company-expenses),null,null,text(o.comment),text(o.report_upload_token)]}
   }},
   {name:'Работы',columns:cols(['Номер заявки','Источник','Дата выполнения','Мастер','Адрес','Название работы','Тип работы','Количество','Единица измерения','Цена за единицу','Общая стоимость позиции','Процент или правило расчёта мастера','Начисление мастеру по позиции','Комментарий'],{2:'date',7:'number',9:'money',10:'money',12:'money'}),rows:()=>works(s)},
   {name:'Мастера',columns:cols(['Мастер','Назначенных заявок','Завершённых заявок','Сумма выполненных работ','Дополнительные работы','Невыполненные работы','Начисленная зарплата','Расходы','Доход компании','Средний чек','Возвраты или исправления'],{1:'number',2:'number',3:'money',4:'money',5:'money',6:'money',7:'money',8:'money',9:'money',10:'number'}),rows:function*(){for(const g of masters)yield [g.name,g.total,g.completed,g.revenue,g.extras,deduction(g.rows),g.pay,g.expenses,g.company,g.average,g.corrections]}},
   {name:'Источники',columns:cols(['Источник','Количество заявок','Завершённых заявок','Общая стоимость','Зарплата мастеров','Расходы','Доход компании','Прибыль','Средний чек'],{1:'number',2:'number',3:'money',4:'money',5:'money',6:'money',7:'money',8:'money'}),rows:function*(){for(const g of sources)yield [g.name,g.total,g.completed,g.revenue,g.pay,g.expenses,g.company,g.net,g.average]}},
  ];
  if(s.expenses.length)result.push({name:'Расходы',columns:cols(['Дата','Категория','Описание','Сумма','Номер связанной заявки','Мастер','Источник','Комментарий','Кто добавил расход'],{0:'date',3:'money'}),rows:function*(){for(const e of s.expenses){const r=s.allMap.get(String(e.order_id));yield [date(e.expense_date),E.label(e.category),text(e.comment),Number(e.amount),r?orderNumber(r.order):e.order_id?String(e.order_id):null,e.employee_id?s.staffNames.get(String(e.employee_id))||null:r?.name||null,r?.source||null,text(e.comment),text(e.created_by_name)]}}});
  return result;
 }
 return Object.freeze({filters,snapshot,sheets});
});
