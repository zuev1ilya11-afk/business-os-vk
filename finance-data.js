// Read-only financial projections. No persistence or new payroll formula.
(function(root,factory){
 const common=typeof module==='object'&&module.exports;
 const api=factory(common?require('./salary-periods.js'):root.BOS_SALARY_PERIODS,common?require('./order-payroll.js'):root.BOS_ORDER_PAYROLL,common?require('./report-deduction.js').catalog:root.BOS_REPORT_DEDUCTION.catalog);
 if(common)module.exports=api;else root.BOS_FINANCE_DATA=api;
})(typeof window==='undefined'?globalThis:window,function(D,P,catalog){
 'use strict';
 const text=v=>String(v??'').trim(),number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
 const round=n=>Math.round((n+Number.EPSILON)*100)/100;
 const cents=n=>Math.round(n*100);
 const shiftMonth=(s,n)=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,10)};
 function period(kind='month',now=new Date(),from='',to=''){
  const today=D.day(now),year=today.slice(0,4);
  if(kind==='all')return {start:'',end:''};
  if(kind==='custom'){if(!D.valid(from)||!D.valid(to)||from>to)throw Error('Укажите корректные даты: начало не позже окончания.');return {start:from,end:to}}
  if(kind==='today')return D.bounds('day',today);
  if(kind==='yesterday')return D.bounds('day',D.addDays(today,-1));
  if(kind==='week'||kind==='month')return D.bounds(kind,today);
  if(kind==='year')return {start:year+'-01-01',end:year+'-12-31'};
  if(kind==='quarter'){const m=Math.floor((Number(today.slice(5,7))-1)/3)*3+1,start=`${year}-${String(m).padStart(2,'0')}-01`;return {start,end:D.addDays(shiftMonth(start,3),-1)}}
  throw Error('Неизвестный период');
 }
 function previous(p,kind){
  if(!p.start||!p.end)return null;
  if(['month','quarter','year'].includes(kind)){const count={month:1,quarter:3,year:12}[kind];return {start:shiftMonth(p.start,-count),end:D.addDays(p.start,-1)}}
  const days=Math.round((Date.parse(p.end)-Date.parse(p.start))/86400000)+1;
  return {start:D.addDays(p.start,-days),end:D.addDays(p.start,-1)};
 }
 const ids=m=>[m?.id,m?.staff_id,m?.external_id,m?.vk_user_id].filter(v=>v!==null&&v!==undefined&&v!=='').map(String);
 const orderIds=o=>[o.master_staff_id,o.master_id,o.master_vk_id,o.master_external_id].filter(v=>v!==null&&v!==undefined&&v!=='').map(String);
 const exactName=s=>text(s).replace(/\s+/g,' ').toLocaleLowerCase('ru-RU');
 const byName=new Map(catalog.map(x=>[exactName(x.name),x]));
 function works(o){
  // `work` is the persisted catalogue name / Hands serialized name × quantity.
  // Do not use comments, category guesses or today's catalogue prices.
  const result=[];
  for(const line of text(o.work).split(/\n+/).filter(Boolean)){
   const match=line.match(/^(.*?)\s*[×x]\s*([\d.,]+)(?:\s+.*)?$/iu),name=text(match?match[1]:line),item=byName.get(exactName(name));
   if(!item)continue;
   const quantity=match?Number(match[2].replace(',','.')):1;
   if(!Number.isFinite(quantity)||quantity<=0)continue;
   result.push({key:item.id,name:item.name,quantity,unit:item.unit});
  }
  return result;
 }
 function records(orders,masters){
  const aliases=new Map(),names=new Map();
  for(const m of masters||[]){for(const id of ids(m))aliases.set(id,m);const name=exactName(m.full_name||m.name);if(name)names.set(name,names.has(name)?null:m)}
  const seen=new Set();
  return (orders||[]).filter(o=>o&&text(o.id)&&!seen.has(text(o.id))&&seen.add(text(o.id))).map(o=>{
   const oi=orderIds(o),master=oi.length?oi.map(id=>aliases.get(id)).find(Boolean):names.get(exactName(o.master_name));
   const masterKey=master?ids(master)[0]:oi[0]||(text(o.master_name)?'legacy:'+text(o.master_name):'unassigned');
   const completed=o.status==='Выполнена',cancelled=o.status==='Отменена';
   const base=number(o.amount),extra=number(o.extra_work_amount)??0,storedPay=number(o.master_payout);
   const revenue=completed&&base!==null?round(base+extra):completed?null:0;
   const pay=completed&&storedPay!==null?round(storedPay+extra):completed?null:0;
   // The existing reader supports non-Hands residuals only. Require stored pay
   // before calling it, otherwise it would estimate historical pay at current rates.
   const company=completed?(storedPay!==null?P.directCompany(o):null):0;
   const ws=works(o),allLines=text(o.work).split(/\n+/).filter(Boolean);
   const date=completed?D.completedDay(o):D.valid(text(o.scheduled_date).slice(0,10))?text(o.scheduled_date).slice(0,10):o.created_at?D.day(o.created_at):'';
   return {order:o,id:text(o.id),date,master:masterKey,name:text(master?.full_name||master?.name||o.master_name)||'Без мастера',inactive:!master||master.is_active===false,source:P.isHands(o)?'Hands':text(o.source||o.external_source)||'Источник не указан',city:text(o.city)||'Город не указан',works:ws,workKnown:ws.length===allLines.length&&ws.length>0,completed,cancelled,base:completed?base:0,revenue,pay,company,extras:completed?extra:0};
  });
 }
 function select(rows,f={}){return rows.filter(r=>(!f.period?.start||(r.date&&r.date>=f.period.start&&r.date<=f.period.end))&&(!f.master||r.master===f.master)&&(!f.source||r.source===f.source)&&(!f.city||r.city===f.city)&&(!f.work||(f.work==='unknown'?!r.workKnown:r.works.some(w=>w.key===f.work))))}
 function aggregate(rows){
  const out={total:rows.length,completed:0,cancelled:0,revenue:0,extras:0,pay:0,company:0,average:0,missing:{revenue:0,pay:0,company:0},known:{revenue:0,pay:0,company:0}};
  for(const r of rows){if(r.cancelled)out.cancelled++;if(!r.completed)continue;out.completed++;out.extras+=cents(r.extras);for(const k of ['revenue','pay','company']){if(r[k]===null)out.missing[k]++;else out.known[k]+=cents(r[k])}}
  out.extras/=100;
  for(const k of ['revenue','pay','company']){out.known[k]/=100;out[k]=out.missing[k]?null:out.known[k]}
  out.average=out.revenue===null?null:out.completed?round(out.revenue/out.completed):0;
  return out;
 }
 function groups(rows,kind){const map=new Map();for(const r of rows){const key=r[kind];if(!map.has(key))map.set(key,[]);map.get(key).push(r)}return [...map].map(([key,list])=>({key,name:kind==='master'?list[0].name:key,inactive:kind==='master'&&list[0].inactive,rows:list,...aggregate(list)}))}
 function workGroups(rows){
  const map=new Map();
  for(const r of rows.filter(r=>r.completed)){
   // A report stores one deduction per service, even if the imported work list
   // has several lines for that service. Combine quantities before deducting it.
   const byService=new Map();
   for(const w of r.works){const item=byService.get(w.key);if(item)item.quantity+=w.quantity;else byService.set(w.key,{...w})}
   const ws=byService.size?[...byService.values()]:[{key:'unknown',name:'Без точного соответствия каталогу',quantity:1,unit:''}];
   for(const w of ws){if(!map.has(w.key))map.set(w.key,{key:w.key,name:w.name,unit:w.unit,quantity:0,rows:[],revenue:0,extras:0,missing:false,missingQuantity:false,missingExtras:false});const g=map.get(w.key);
    const deductions=Array.isArray(r.order.uncompleted_work_items)?r.order.uncompleted_work_items:[];
    const removed=deductions.filter(x=>x.service_id===w.key).reduce((n,x)=>n+(number(x.quantity)??0),0);
    g.quantity+=Math.max(0,w.quantity-removed);
    if(w.key==='unknown'||(Number(r.order.uncompleted_work_amount)>0&&!deductions.length))g.missingQuantity=true;
    if(!g.rows.includes(r))g.rows.push(r);
    const attributable=r.workKnown&&r.works.length===1;
    if(!attributable||r.base===null)g.missing=true;else g.revenue+=cents(r.base);
    if(r.extras)g.missingExtras=true;
   }
  }
  return [...map.values()].map(g=>({...g,quantity:g.missingQuantity?null:Math.round(g.quantity*1000)/1000,total:g.rows.length,revenue:g.missing?null:g.revenue/100,extras:g.missingExtras?null:0,average:g.missing?null:round(g.revenue/100/g.rows.length)}));
 }
 function periodGroups(rows,kind='month'){
  const map=new Map();
  for(const r of rows){let key='Без даты';if(r.date)key=kind==='day'?r.date:kind==='week'?D.bounds('week',r.date).start:kind==='month'?r.date.slice(0,7):kind==='quarter'?r.date.slice(0,4)+'-Q'+Math.ceil(Number(r.date.slice(5,7))/3):r.date.slice(0,4);if(!map.has(key))map.set(key,[]);map.get(key).push(r)}
  const result=[...map].sort(([a],[b])=>a.localeCompare(b)).map(([key,list])=>({key,name:key,rows:list,...aggregate(list)}));
  const indexed=new Map(result.map(x=>[x.key,x]));
  function prior(key){
   if(key==='Без даты')return '';
   if(kind==='day'||kind==='week')return D.addDays(key,kind==='day'?-1:-7);
   if(kind==='month')return shiftMonth(key+'-01',-1).slice(0,7);
   if(kind==='quarter'){const [year,q]=key.split('-Q');return Number(q)>1?`${year}-Q${Number(q)-1}`:`${Number(year)-1}-Q4`}
   return String(Number(key)-1);
  }
  return result.map(g=>({...g,delta:change(g.revenue,indexed.get(prior(g.key))?.revenue??null)}));
 }
 function change(value,before){return value!==null&&before!==null&&before>0?round((value-before)/before*100):null}
 return Object.freeze({period,previous,records,select,aggregate,groups,workGroups,periodGroups,change,catalog});
});
