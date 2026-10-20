// Main-work snapshots. amount is the LINE total; order.amount remains the agreed order total.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BOS_WORK_ITEMS=api;})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 const round=n=>Math.round((n+Number.EPSILON)*100)/100;
 const fractional=unit=>['км','пог. м','п.м.','м','м²','м2','час'].includes(unit);
 const fail=message=>{throw Object.assign(new Error(message),{field:'work_items'})};
 function numeric(value,label){
  if((typeof value!=='number'&&typeof value!=='string')||String(value).trim()===''||!/^\d+(?:[.,]\d+)?$/.test(String(value).trim()))fail(label+': укажите число');
  const n=Number(String(value).trim().replace(',','.'));if(!Number.isFinite(n)||n>1e9)fail(label+': недопустимое число');return n;
 }
 function normalize(input){
  if(!Array.isArray(input)||input.length>100)fail('Допустимо не более 100 работ');
  return input.map(row=>{
   const name=typeof row?.name==='string'?row.name.trim():'';
   if(!name||name.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(name))fail('Укажите название каждой работы (до 1000 символов)');
   const unit=String(row.unit??'шт.').trim();if(unit.length>30)fail('Некорректная единица измерения');
   const quantity=numeric(row.quantity,'Количество');
   if(quantity<=0||quantity>10000||Math.abs(quantity*1000-Math.round(quantity*1000))>1e-7||(!fractional(unit)&&!Number.isInteger(quantity)))fail('Количество должно быть положительным; для штучных работ — целым');
   const unit_price=row.unit_price==null||row.unit_price===''?null:numeric(row.unit_price,'Цена');
   if(unit_price!==null&&Math.abs(unit_price*100-Math.round(unit_price*100))>1e-7)fail('Цена — с точностью до копеек');
   const amount=unit_price===null?null:round(quantity*unit_price);
   if(amount!==null&&amount>1e9)fail('Сумма позиции слишком велика');
   if(row.amount!==undefined&&row.amount!==amount)fail('Сумма позиции не соответствует количеству и цене');
   return {name,unit,quantity,unit_price,amount,...(typeof row.service_id==='string'&&/^[a-z0-9_]{1,80}$/.test(row.service_id)?{service_id:row.service_id}:{})};
  });
 }
 const text=rows=>rows.map(r=>r.name+' × '+String(r.quantity).replace('.',',')+(r.unit?' '+r.unit:'')).join('\n');
 const total=rows=>rows.length&&rows.every(r=>r.amount!==null)?round(rows.reduce((sum,r)=>sum+r.amount,0)):null;
 return Object.freeze({normalize,numeric,fractional,text,total});
});
