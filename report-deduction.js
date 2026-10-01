// Catalogue snapshots and validation shared by every report submission route.
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./service-catalog.js'):root.BOS_PRICE_CATALOG);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BOS_REPORT_DEDUCTION=api;
})(typeof window==='undefined'?globalThis:window,function(prices){
  'use strict';
  const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
  const fractional=unit=>['км','пог. м','п.м.','м','м²','м2','час'].includes(unit);
  const catalog=[...prices.standard.map(s=>({id:s.id,name:s.n,unit:s.u,price:s.p,mode:s.p==null?'agreed':'fixed',group:'Основной прайс'})),
    ...prices.avito.services.map(s=>({id:'avito_'+s.id,name:s.name,unit:s.unit||'',price:s.fromPrice,mode:'from',group:'Прайс Авито',note:s.note||''}))];
  const fail=message=>{throw new Error(message)};
  function number(v,label,max=1e9){
    if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max)fail(label+': укажите конечное неотрицательное число');
    return v;
  }
  function items(input){
    if(!Array.isArray(input)||!input.length||input.length>100)fail('Добавьте от 1 до 100 невыполненных работ из прайса');
    const seen=new Set();
    return input.map(row=>{
      const s=catalog.find(s=>s.id===row?.service_id);
      if(!s||seen.has(s.id))fail('Неизвестная или повторяющаяся работа в вычете');
      seen.add(s.id);
      const qty=number(row.quantity,'Количество',10000);
      if(qty<=0||Math.abs(qty*1000-Math.round(qty*1000))>1e-7||(!fractional(s.unit)&&!Number.isInteger(qty)))fail('Количество должно быть положительным и соответствовать единице прайса');
      const price=number(row.unit_price,'Цена');
      if(Math.abs(price*100-Math.round(price*100))>1e-7)fail('Цена должна быть указана с точностью до копеек');
      if(s.mode==='fixed'&&price!==s.price)fail('Цена в прайсе изменилась. Откройте выбор работ заново');
      if(s.mode!=='fixed'&&row.price_confirmed!==true)fail('Подтвердите согласованную цену и объём работы');
      const amount=round(price*qty);
      if(!Number.isSafeInteger(Math.round(amount*100))||amount>1e9)fail('Сумма позиции слишком велика');
      if(row.amount!==undefined&&row.amount!==amount)fail('Сумма позиции не соответствует цене и количеству');
      return {service_id:s.id,name:s.name,unit:s.unit,quantity:qty,unit_price:price,amount,price_mode:s.mode,price_confirmed:s.mode==='fixed'?false:true,catalog_version:prices.version};
    });
  }
  function original(order){
    // Preserve a recovered base for legacy rows without original_amount on first submission.
    return round(order.original_amount??(Number(order.amount||0)+Number(order.uncompleted_work_amount||0)));
  }
  function normalize(body,order){
    const base=original(order);
    if(!Number.isFinite(base)||base<0)fail('Некорректная исходная сумма заявки');
    const detailed=Object.prototype.hasOwnProperty.call(body,'uncompleted_work_items');
    const enabled=body.uncompleted_work_done===true||body.uncompleted_work_done==='true'||(body.uncompleted_work_done==null&&!detailed&&Number(body.uncompleted_work_amount)>0);
    if(!enabled)return {original_amount:base,uncompleted_work_done:false,uncompleted_work_items:[],uncompleted_work_amount:0,uncompleted_work_description:''};
    const comment=String(body.uncompleted_work_description||'').trim();
    if(comment.length>4000)fail('Комментарий: не более 4000 символов');
    const rows=detailed?items(body.uncompleted_work_items):[];
    const total=detailed?round(rows.reduce((sum,s)=>sum+s.amount,0)):round(Number(body.uncompleted_work_amount||0));
    if(!Number.isFinite(total)||total<0||total>base)fail('Невыполненные работы не могут превышать исходную сумму заявки');
    if(detailed&&body.uncompleted_work_amount!==undefined&&body.uncompleted_work_amount!==total)fail('Сумма вычета не соответствует выбранным работам');
    return {original_amount:base,uncompleted_work_done:true,uncompleted_work_items:rows,uncompleted_work_amount:total,uncompleted_work_description:comment};
  }
  return {catalog,fractional,items,normalize,original,round};
});
