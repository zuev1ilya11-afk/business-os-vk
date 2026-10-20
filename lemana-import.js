(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BOS_LEMANA_IMPORT=api;})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 const value=c=>String(c?.value??'').trim();
 const nameKey=s=>String(s||'').trim().toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ');
 const numberKey=s=>String(s??'').trim();
 const statuses={'подтвержден':'Новая','подтверждён':'Новая','новый':'Новая','новая':'Новая','назначена дата':'Назначена','назначен':'Назначена','в работе':'В работе','отменен':'Отменена','отменён':'Отменена','отменена':'Отменена'};
 const safeStatuses=['Новая','Назначена','В работе','Отменена'];
 const timezones=['Europe/Moscow','Europe/Kaliningrad','Europe/Samara','Asia/Yekaterinburg','Asia/Omsk','Asia/Novosibirsk','Asia/Krasnoyarsk','Asia/Irkutsk','Asia/Yakutsk','Asia/Vladivostok','Asia/Magadan','Asia/Kamchatka','UTC'];
 function identifier(c){
  let s=value(c);if(c?.kind==='number'){
   const n=Number(s);if(!Number.isSafeInteger(n)||n<0||n>=1e15)throw Error('Номер должен быть сохранён в Excel как текст (до 15 цифр для числовой ячейки)');
   s=String(n);if(/^0+$/.test(c.format||''))s=s.padStart(c.format.length,'0');
  }
  if(!s||s.length>80||/[\x00-\x1f\x7f]/.test(s))throw Error('Отсутствует или некорректен номер заказа');return s;
 }
 function localDate(c,date1904=false){
  if(!value(c))return null;let str=value(c);
  if(c.kind==='number'){
   const n=Number(str);if(!Number.isFinite(n)||n<0||n>2958465||(!date1904&&Math.floor(n)===60))throw Error('Некорректная дата Excel');
   const base=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,n<60?31:30);
   str=new Date(base+Math.round(n*86400)*1000).toISOString().slice(0,19).replace('T',' ');
  }
  let m=/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(str);
  if(m)str=`${m[3]}-${m[2]}-${m[1]} ${m[4]||'00'}:${m[5]||'00'}:${m[6]||'00'}`;
  m=/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(str);
  if(!m)throw Error('Дата должна быть ДД.ММ.ГГГГ или ГГГГ-ММ-ДД с необязательным временем');
  const date=`${m[1]}-${m[2]}-${m[3]}`,time=`${(m[4]||'00').padStart(2,'0')}:${m[5]||'00'}:${m[6]||'00'}`,iso=date+'T'+time;
  if(Number(m[1])<1900||!Number.isFinite(Date.parse(iso+'Z'))||new Date(iso+'Z').toISOString().slice(0,19)!==iso)throw Error('Некорректная календарная дата');
  return {date,time,local:date+' '+time};
 }
 function instant(local,zone){
  const want=local.date+'T'+local.time,ms=Date.parse(want+'Z');
  const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  let candidate=ms;for(let i=0;i<3;i++){const shown=fmt.format(new Date(candidate)).replace(' ','T');candidate+=ms-Date.parse(shown+'Z')}
  if(fmt.format(new Date(candidate)).replace(' ','T')!==want)throw Error('Время не существует в выбранном часовом поясе');
  if([-3600000,3600000].some(d=>fmt.format(new Date(candidate+d)).replace(' ','T')===want))throw Error('Неоднозначное время при переводе часов');
  return new Date(candidate).toISOString();
 }
 function orderNumbers(o){const external=o.external_source==='lemana_pro'?o.external_id:String(o.external_id||'').startsWith('hands:')?String(o.external_id).slice(6):null;return [...new Set([o.order_number,external,!o.order_number&&!external?o.id:null].filter(x=>x!==undefined&&x!==null&&x!=='').map(numberKey))]}
 function isLemana(o){return ['лемана про','lemana_pro'].includes(nameKey(o.source))||o.external_source==='lemana_pro'}
 function classify(number,orders){const matches=orders.filter(o=>orderNumbers(o).includes(numberKey(number)));return matches.length?{kind:matches.some(isLemana)?'existing':'possible',reason:matches.some(isLemana)?'Уже существует в Лемана Про':'Номер совпадает с заявкой другого источника. Проверьте вручную; импорт заблокирован'}:{kind:'new',reason:''}}
 function preview(parsed,orders,staff,timezone,overrides={}){
  if(!timezones.includes(timezone))throw Error('Выберите часовой пояс выгрузки');
  if(!Array.isArray(parsed?.rows)||parsed.rows.length>1000)throw Error('Не более 1000 строк');
  const numbers=new Map();for(const r of parsed.rows){try{const key=identifier(r['Номер заказа']);numbers.set(key,(numbers.get(key)||0)+1)}catch(_){}}
  const rows=parsed.rows.map(r=>{
   const out={row:r._row,number:value(r['Номер заказа']),client:value(r['ФИО клиента']),phone:value(r['Телефон клиента']),address:value(r['Адрес клиента']),category:value(r['Категория заказа']),rawStatus:value(r['Статус']),rawMaster:value(r['ФИ мастера']),kind:'error',reason:'',order:null};
   try{
    out.number=identifier(r['Номер заказа']);if(numbers.get(out.number)>1)throw Error('Номер повторяется в файле');
    const collision=classify(out.number,orders);if(collision.kind!=='new')return {...out,...collision};
    if(!out.client||!out.phone||!out.address)throw Error('Заполните ФИО, телефон и адрес клиента');
    if(out.client.length>300||out.address.length>2000||out.category.length>1000||out.phone.length>60)throw Error('Слишком длинное значение');
    let phone=out.phone.replace(/[\s()+.\-]/g,'');if(phone.length===10)phone='7'+phone;if(phone.length===11&&phone[0]==='8')phone='7'+phone.slice(1);if(!/^7\d{10}$/.test(phone))throw Error('Некорректный телефон клиента');
    const price=value(r['Стоимость заказа']).replace(/[\s\u00a0]/g,'').replace(',','.');if(!/^\d+(?:\.\d{1,2})?$/.test(price)||Number(price)>1e9)throw Error('Некорректная стоимость заказа');
    const created=localDate(r['Дата создания заказа'],parsed.date1904);if(!created)throw Error('Нет даты создания заказа');
    const scheduled=localDate(r['Назначенная дата'],parsed.date1904),completed=localDate(r['Дата выполнения'],parsed.date1904);
    const override=overrides[String(r._row)]||{};const status=override.status||statuses[nameKey(out.rawStatus)];
    if(!safeStatuses.includes(status))throw Error('Статус требует проверки и явного выбора');
    if(status==='Назначена'&&!scheduled)throw Error('Для назначенной заявки нужна дата визита');
    let master=null;const active=staff.filter(s=>s.role==='master'&&s.is_active);
    if(Object.hasOwn(override,'master_id')){if(override.master_id){master=active.find(s=>String(s.id)===String(override.master_id));if(!master)throw Error('Выбранный мастер недоступен')}}
    else if(out.rawMaster){const key=nameKey(out.rawMaster),matches=active.filter(s=>nameKey(s.full_name)===key||nameKey(s.full_name).split(' ').slice(0,2).join(' ')===key);if(matches.length!==1)throw Error(matches.length?'Неоднозначное совпадение мастера: выберите сотрудника':'Мастер не найден: выберите сотрудника или «Без мастера»');master=matches[0]}
    out.order={order_number:out.number,source:'Лемана Про',external_source:'lemana_pro',external_id:out.number,client:out.client,phone:'+'+phone,address:out.address,work:'',amount:Number(price),original_amount:Number(price),amount_confirmed:true,created_at:instant(created,timezone),received_date:created.date,scheduled_date:scheduled?.date||null,scheduled_time:scheduled?.time||null,status,master_staff_id:master?.id||null,master_name:master?.full_name||'',city:master?.city||'',lemana_import_meta:{timezone,category:out.category,shop:value(r['Магазин']).slice(0,500),reported_status:out.rawStatus.slice(0,200),reported_master:out.rawMaster.slice(0,300),reported_completed_at:completed?instant(completed,timezone):null}};
    out.dates={created:created.local,scheduled:scheduled?.local||'',completed:completed?.local||'',timezone};out.kind='new';out.reason='';return out;
   }catch(e){out.reason=e.message;return out}
  });
  return {timezone,rows,counts:{total:rows.length,new:rows.filter(r=>r.kind==='new').length,existing:rows.filter(r=>r.kind==='existing').length,possible:rows.filter(r=>r.kind==='possible').length,error:rows.filter(r=>r.kind==='error').length}};
 }
 return Object.freeze({preview,classify,identifier,localDate,instant,orderNumbers,safeStatuses,timezones});
});
