// Shared expense input rules and read-only projections. Never changes order payroll.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BOS_FINANCE_EXPENSES=api})(typeof window==='undefined'?globalThis:window,()=>{
 'use strict';
 const categories=Object.freeze([['advertising','Реклама'],['avito','Авито'],['office_salary','Зарплата офиса'],['rent','Аренда'],['transport','Транспорт'],['tools','Инструменты'],['materials','Материалы'],['communication','Связь / интернет'],['subscriptions','Сервисы / подписки'],['taxes','Налоги'],['refunds','Возвраты клиентам'],['compensation','Компенсации'],['other','Прочее']].map(([key,label])=>Object.freeze({key,label})));
 const text=v=>String(v??'').trim(),cents=n=>Math.round(Number(n)*100);
 const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number(v.slice(0,4))>=1900&&Number(v.slice(0,4))<=9999&&!Number.isNaN(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 const validId=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(v));
 function validate(input){
  const raw=text(input.amount).replace(',','.');
  if(!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(raw)||Number(raw)<=0||Number(raw)>999999999.99)throw Error('Сумма должна быть больше нуля, до 999 999 999,99 ₽, с точностью до копеек.');
  const expense_date=text(input.expense_date),category=text(input.category),comment=text(input.comment),city=text(input.city),order_id=text(input.order_id),employee_id=text(input.employee_id);
  if(!validDate(expense_date))throw Error('Укажите корректную дату расхода.');
  if(category.length>40||!categories.some(c=>c.key===category))throw Error('Выберите статью расхода.');
  if(comment.length>500)throw Error('Комментарий — не более 500 символов.');
  if(category==='other'&&!comment)throw Error('Для статьи «Прочее» добавьте описание.');
  if(city.length>100)throw Error('Название города — не более 100 символов.');
  if(order_id&&!/^[1-9][0-9]{0,18}$/.test(order_id))throw Error('Некорректная заявка.');
  if(employee_id&&!validId(employee_id))throw Error('Некорректный сотрудник.');
  return {expense_date,amount:cents(Number(raw))/100,category,comment,city:city||null,order_id:order_id||null,employee_id:employee_id||null};
 }
 const label=key=>categories.find(c=>c.key===key)?.label||text(key)||'Прочее';
 function select(expenses,filter={},orders=[]){
  const map=new Map(orders.map(o=>[String(o.id),o]));
  return expenses.filter(e=>{
   const o=map.get(String(e.order_id)),p=filter.period;
   return (!p?.start||(e.expense_date>=p.start&&e.expense_date<=p.end))&&(!filter.city||(e.city||o?.city)===filter.city)&&(!filter.master||String(e.employee_id||o?.master||'')===filter.master)&&(!filter.source||o?.source===filter.source)&&(!filter.work||(!!o&&(filter.work==='unknown'?!o.workKnown:o.works.some(w=>w.key===filter.work))));
  });
 }
 function summary(rows,company){
  const map=new Map();let sum=0;
  for(const e of rows){const n=cents(e.amount);sum+=n;map.set(e.category,(map.get(e.category)||0)+n)}
  return {expenses:sum/100,net:company===null?null:(cents(company)-sum)/100,categories:[...map].map(([key,n])=>({key,name:label(key),amount:n/100})).sort((a,b)=>b.amount-a.amount)};
 }
 function periodKey(day,kind){
  if(kind==='day')return day;
  if(kind==='week'){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10)}
  if(kind==='month')return day.slice(0,7);
  if(kind==='quarter')return day.slice(0,4)+'-Q'+Math.ceil(Number(day.slice(5,7))/3);
  return day.slice(0,4);
 }
 function periodGroups(rows,expenses,kind,F){
  const groups=new Map(F.periodGroups(rows,kind).map(g=>[g.key,{...g,expenseRows:[]} ]));
  for(const e of expenses){const key=periodKey(e.expense_date,kind);if(!groups.has(key))groups.set(key,{key,name:key,rows:[],...F.aggregate([]),delta:null,expenseRows:[]});groups.get(key).expenseRows.push(e)}
  return [...groups.values()].sort((a,b)=>a.key.localeCompare(b.key)).map(g=>({...g,...summary(g.expenseRows,g.company)}));
 }
 return Object.freeze({categories,label,validate,validDate,validId,select,summary,periodGroups});
});
