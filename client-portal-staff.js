/* Client messages extend the existing staff app; disabled until the separate API is configured. */
(()=>{
  'use strict';
  if(window.BOS_CLIENT_PORTAL_CONFIG?.enabled!==true||window.BOS_CLIENT_PORTAL_STAFF)return;
  const config=window.BOS_CLIENT_PORTAL_CONFIG;
  let base;try{base=new URL(config.apiBase||'/client-api/',location.origin)}catch{return}
  // Never send an employee credential to a configurable third-party host.
  if(base.origin!==location.origin||!base.pathname.startsWith('/client-api/'))return;
  const role=()=>String(typeof state==='undefined'?'':state.user?.role||'');
  const allowed=()=>['owner','manager','dispatcher'].includes(role());
  const leadership=()=>['owner','manager'].includes(role());
  const e=(tag,props={},children=[])=>{
    const node=document.createElement(tag);
    for(const [key,value] of Object.entries(props)){
      if(key==='text')node.textContent=String(value??'');
      else if(key==='class')node.className=value;
      else if(key.startsWith('on'))node.addEventListener(key.slice(2),value);
      else if(key==='checked'||key==='disabled'||key==='hidden')node[key]=!!value;
      else if(value!==undefined&&value!==null)node.setAttribute(key,String(value));
    }
    for(const child of [].concat(children))if(child!=null)node.append(child?.nodeType?child:document.createTextNode(String(child)));
    return node;
  };
  const button=(text,action,kind='secondary')=>e('button',{type:'button',class:kind,text,onclick:action});
  const notice=text=>e('p',{class:'muted cpStaffNote',text});
  const date=value=>value?new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
  const rub=value=>value==null?'После уточнения':new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(Number(value));
  const id=value=>encodeURIComponent(String(value));
  const newKey=()=>{
    if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
    const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  };
  async function call(path,method='GET',body){
    if(!allowed())throw Error('Доступ разрешён руководителю или диспетчеру.');
    const headers={'Accept':'application/json'};
    // Use only the employee credential. The customer cookie cannot authorize a staff operation.
    let token='';try{token=sessionStorage.getItem('bos_vk_session_v2')||localStorage.getItem('bos_vk_session_v2')||''}catch{}
    if(!token)throw Error('Войдите в приложение сотрудников повторно.');
    headers['X-BOS-Session']=token;
    if(body!==undefined)headers['Content-Type']='application/json';
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(new URL('staff/'+path.replace(/^\//,''),base),{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',signal:controller.signal});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.ok===false)throw Object.assign(Error(typeof data.error==='string'?data.error:'Не удалось получить ответ. Повторите позже.'),{status:response.status});
      return data;
    }catch(error){if(error.name==='AbortError')throw Error('Сервер не ответил. Обновите данные перед повтором.');throw error}
    finally{clearTimeout(timeout)}
  }
  function modal(title){
    openModal('<div id="cpStaffRoot" class="cpStaffRoot"></div>');
    const root=document.getElementById('cpStaffRoot');
    root.append(e('h2',{text:title}));
    return root;
  }
  function busy(root,text='Загружаем…'){
    const message=e('p',{role:'status',class:'cpStaffStatus',text});root.append(message);
    return message;
  }
  async function run(form,message,action){
    if(form.dataset.busy==='1')return;
    // Keep form fields successful controls while FormData is being read below.
    form.dataset.busy='1';const controls=[...form.querySelectorAll('button')];controls.forEach(x=>x.disabled=true);message.textContent='Сохраняем…';
    try{await action();if(message.isConnected)message.textContent='Сохранено.'}
    catch(error){if(message.isConnected)message.textContent=error.message}
    finally{delete form.dataset.busy;controls.forEach(x=>x.disabled=false)}
  }
  function field(label,name,value='',props={}){
    const input=e(props.tag||'input',{name,value,...props});
    if(props.tag==='textarea')input.value=value;
    return e('label',{class:'cpStaffField'},[e('span',{text:label}),input]);
  }
  function select(label,name,choices,value){
    const input=e('select',{name},choices.map(([key,text])=>e('option',{value:key,text})));
    input.value=String(value??'');return e('label',{class:'cpStaffField'},[e('span',{text:label}),input]);
  }
  function section(title,children=[]){return e('section',{class:'card cpStaffSection'},[e('h3',{text:title}),...children])}
  async function refreshStaff(){
    // Portal status is public vocabulary. Refresh the original bootstrap instead of
    // merging its DTO into a financial/internal staff row.
    if(typeof reloadData==='function')await reloadData(true);
  }
  window.openClientPortalInbox=async function(offset=0){
    if(!allowed())return;
    const root=modal('Кабинет клиента'),status=busy(root);
    const actions=e('div',{class:'cpStaffActions'},[
      button('Обновить',()=>window.openClientPortalInbox(offset)),
      button('Обращения',()=>openRequests()),
      button('Сообщения компании',()=>openThreads())
    ]);
    if(leadership())actions.append(button('Каталог услуг',()=>openCatalog()),button('Карточки мастеров',()=>openMasters()));
    actions.append(button('Привязать заявку',()=>openLink()));root.append(actions);
    try{
      const data=await call('orders?limit=20&offset='+Math.max(0,Number(offset)||0));if(!root.isConnected)return;
      status.textContent=`Заявок: ${data.total||0}. Назначение и выполнение доступны в обычной карточке заявки.`;
      const list=e('div',{class:'cpStaffList'});root.append(list);
      for(const order of data.orders||[]){
        const card=e('article',{class:'card cpStaffOrder'},[
          e('strong',{text:'№ '+(order.number||order.id)+' · '+(order.status_label||order.internal_status||'')}),
          e('p',{text:order.address}),notice((order.client?.name||'Клиент')+' · '+date(order.created_at)),
          notice((order.unread_count?`Новых сообщений: ${order.unread_count}. `:'')+(order.visit?`Визит: ${order.visit.date} ${order.visit.interval||order.visit.time}`:'Визит ещё не подтверждён')),
          button('Открыть переписку и согласование',()=>openDetail(order.id),'primary')
        ]);list.append(card);
      }
      if(!data.orders?.length)list.append(notice('Клиентских заявок пока нет. Новые появятся здесь и в общем списке заявок.'));
      const pager=e('div',{class:'cpStaffActions'});
      if(offset>0)pager.append(button('Назад',()=>window.openClientPortalInbox(Math.max(0,offset-20))));
      if(offset+(data.orders?.length||0)<Number(data.total))pager.append(button('Следующие',()=>window.openClientPortalInbox(offset+20)));
      root.append(pager);
    }catch(error){status.textContent=error.message}
  };
  async function openDetail(orderId){
    if(!allowed())return;
    const root=modal('Заявка клиента'),status=busy(root);
    try{
      const [{order},masterData]=await Promise.all([call('orders/'+id(orderId)),call('masters')]);
      if(!root.isConnected)return;status.remove();root.querySelector('h2').textContent='Клиент · заявка № '+(order.number||order.id);
      root.append(e('div',{class:'cpStaffActions'},[
        button('Все клиентские заявки',()=>window.openClientPortalInbox()),
        button('Обычная карточка заявки',async()=>{try{await refreshStaff();closeModal();window.openOrder(String(order.id))}catch(error){alert(error.message)}})
      ]));
      root.append(section('Заявка',[
        e('p',{text:(order.client?.name||'Клиент')+' · '+(order.client?.phone||'')}),e('p',{text:order.address}),
        e('p',{text:order.description||''}),notice('Пожелание по времени: '+(order.desired_date||'дата не указана')+' '+(order.desired_interval||'')),
        notice('Предварительная стоимость: '+rub(order.preliminary?.total))
      ]));
      const visit=e('form',{class:'cpStaffForm'},[
        select('Назначенный мастер','master_staff_id',[['','Не назначен'],...(masterData.masters||[]).map(m=>[m.id,m.name])],order.master_staff_id),
        field('Согласованная дата (МСК)','date',order.visit?.date||'',{type:'date'}),
        field('Начало визита (МСК)','time',(order.visit?.time||'').slice(0,5),{type:'time'}),
        field('Согласованный интервал','interval',order.visit?.interval||'',{placeholder:'Например, 12:00–14:00',maxlength:100}),
        notice('Заполняйте дату и время только после договорённости с клиентом. Пожелание клиента само по себе не бронирует визит.'),
        e('button',{type:'submit',class:'primary',text:'Сохранить назначение и визит'})
      ]),visitMessage=busy(visit,'');
      visit.onsubmit=event=>{event.preventDefault();run(visit,visitMessage,async()=>{
        const values=Object.fromEntries(new FormData(visit)),payload={version:order.version,master_staff_id:values.master_staff_id||null};
        if(values.date||values.time||values.interval){if(!values.date||!values.time)throw Error('Для подтверждения визита укажите дату и время.');payload.visit={date:values.date,time:values.time,interval:values.interval}}
        await call('orders/'+id(order.id),'PATCH',payload);await refreshStaff();await openDetail(order.id);
      })};root.append(section('Мастер и согласованный визит',[visit]));
      root.append(estimateEditor(order));
      const files=section('Фотографии клиента');
      if(!order.attachments?.length)files.append(notice('Фотографий пока нет.'));
      for(const file of order.attachments||[])files.append(button(file.name||'Открыть фото',()=>openAttachment(file.id,file.name)));
      root.append(files);
      const requests=section('Запросы клиента');
      for(const request of order.requests||[])requests.append(requestCard(request,()=>openDetail(order.id)));
      if(!order.requests?.length)requests.append(notice('Запросов переноса, отмены или гарантии нет.'));root.append(requests);
      const messages=section('Переписка с клиентом');root.append(messages);await mountMessages(messages,{order_id:String(order.id)});
    }catch(error){if(root.isConnected){status.textContent=error.message;if(!status.isConnected)root.append(status)}}
  }
  function estimateEditor(order){
    const current=order.estimate,host=section('Согласование стоимости');
    if(current)host.append(notice(`Версия ${current.version} · ${rub(current.total)} · ${current.accepted_at?'принята клиентом '+date(current.accepted_at):'ожидает подтверждения клиента'}`));
    if(order.price_review_required||current?.current===false)host.append(notice('Стоимость заявки изменилась. Подготовьте новую смету для подтверждения клиентом.'));
    const form=e('form',{class:'cpStaffForm'}),rows=e('div',{class:'cpStaffEstimateRows'});
    function row(item={}){
      const box=e('div',{class:'cpStaffEstimateRow'},[
        field('Работа','name',item.name||'',{required:true,maxlength:300}),
        field('Ед.','unit',item.unit||'шт.',{required:true,maxlength:30}),
        field('Кол-во','quantity',item.quantity||1,{required:true,type:'number',min:'0.001',step:'0.001'}),
        field('Цена за единицу, ₽','unit_price',item.unit_price??'',{required:true,type:'number',min:'0',step:'0.01'})
      ]);box.append(button('Убрать',()=>box.remove()));rows.append(box);
    }
    const initial=current?.items?.length?current.items:order.work_items?.length?order.work_items:[];initial.forEach(row);if(!initial.length)row();
    form.append(rows,button('Добавить работу',()=>row()),field('Условия сметы','conditions',current?.conditions||'',{tag:'textarea',maxlength:3000,rows:3}),notice('Это предложение клиенту. Итог пересчитает сервер, клиент подтвердит именно эту версию.'),e('button',{type:'submit',class:'primary',text:'Отправить смету на согласование'}));
    const message=busy(form,'');form.onsubmit=event=>{event.preventDefault();run(form,message,async()=>{
      const items=[...rows.children].map(box=>Object.fromEntries(['name','unit','quantity','unit_price'].map(key=>[key,box.querySelector('[name="'+key+'"]').value]))).map(item=>({...item,quantity:Number(item.quantity),unit_price:Number(item.unit_price)}));
      if(!items.length)throw Error('Добавьте хотя бы одну работу.');
      await call('orders/'+id(order.id)+'/estimates','POST',{version:order.version,items,conditions:form.elements.conditions.value});await openDetail(order.id);
    })};host.append(form);return host;
  }
  async function mountMessages(host,thread){
    const query=new URLSearchParams(thread),history=e('div',{class:'cpStaffMessages'}),status=busy(host,'Загружаем сообщения…');host.append(history);
    let after='0';
    async function readMore(){
      const data=await call('messages?'+query+'&after='+id(after));if(!host.isConnected)return;
      for(const message of data.messages||[]){
        const bubble=e('article',{class:'cpStaffBubble '+(message.sender==='company'?'company':'client')},[e('strong',{text:message.sender==='company'?'Компания':'Клиент'}),e('p',{text:message.body}),e('small',{text:date(message.created_at)})]);
        for(const file of message.attachments||[])bubble.append(button('Фото · '+(file.name||'Открыть'),()=>openAttachment(file.id,file.name)));
        history.append(bubble);
      }
      if(data.messages?.length){after=String(data.messages.at(-1).id);await call('messages/read','POST',{...thread,through_id:after})}
      status.textContent=data.messages?.length?'':'Сообщений пока нет.';
      more.hidden=(data.messages?.length||0)<100;
    }
    const more=button('Загрузить следующие сообщения',()=>readMore().catch(error=>status.textContent=error.message));more.hidden=true;host.append(more);
    const fileField=field('Фотографии к сообщению','photos','',{type:'file',accept:'image/jpeg,image/png,image/webp',multiple:true}),uploads=e('div',{class:'cpStaffUploadList'});
    const form=e('form',{class:'cpStaffForm'},[field('Ответ клиенту','body','',{tag:'textarea',rows:3,maxlength:4000,placeholder:'Это сообщение увидит клиент.'}),fileField,notice('JPEG, PNG или WebP · до 5 МБ каждый. Фото загрузятся после нажатия «Отправить клиенту».'),uploads,e('button',{type:'submit',class:'primary',text:'Отправить клиенту'})]);
    const sending=busy(form,'');let requestKey=newKey(),pendingPayload='',photos=[],composing=false;
    function renderUploads(){
      uploads.replaceChildren();for(const photo of photos){
        const remove=button('Убрать',()=>{if(composing)return;photos=photos.filter(x=>x!==photo);renderUploads()});remove.disabled=composing;
        uploads.append(e('div',{class:'cpStaffUpload'},[e('span',{text:photo.file.name}),notice(photo.error||photo.status||(photo.attachment?'Загружено; сообщение ещё не отправлено':'Готово к загрузке')),remove]));
      }
    }
    form.elements.photos.onchange=()=>{
      if(composing)return;
      for(const file of form.elements.photos.files||[]){
        if(photos.length>=10){sending.textContent='Можно выбрать до 10 фотографий. Лишние файлы не добавлены.';break}
        const error=!['image/jpeg','image/png','image/webp'].includes(file.type)?'Нужна фотография JPEG, PNG или WebP.':!file.size||file.size>5*1024*1024?'Размер фотографии должен быть от 1 байта до 5 МБ.':'';
        photos.push({file,error,invalid:!!error,uploadKey:newKey(),attachment:null,status:''});
      }
      form.elements.photos.value='';renderUploads();
    };
    async function dataBase64(file){const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary)}
    form.onsubmit=event=>{event.preventDefault();run(form,sending,async()=>{
      const body=form.elements.body.value.trim();if(!body&&!photos.length)throw Error('Введите сообщение или добавьте фотографию.');
      if(photos.some(photo=>photo.invalid))throw Error('Уберите неподходящие файлы перед отправкой.');
      composing=true;form.elements.photos.disabled=true;form.elements.body.readOnly=true;renderUploads();
      try{
        for(const photo of photos){
          if(photo.attachment)continue;photo.error='';photo.status='Загружаем…';renderUploads();
          try{const data=await call('attachments','POST',{...thread,name:photo.file.name,mime:photo.file.type,data_base64:await dataBase64(photo.file),request_id:photo.uploadKey});if(!data.attachment?.id)throw Error('Сервер не подтвердил загрузку.');photo.attachment=data.attachment;photo.status='Загружено; сообщение ещё не отправлено';renderUploads()}
          catch(error){photo.error=error.message;photo.status='';renderUploads();throw Error('Фото «'+photo.file.name+'»: '+error.message+' Сообщение пока не отправлено.')}
        }
        const attachment_ids=photos.map(photo=>photo.attachment.id),payload=JSON.stringify({body,attachment_ids});
        if(pendingPayload&&pendingPayload!==payload)requestKey=newKey();pendingPayload=payload;
        await call('messages','POST',{...thread,body,attachment_ids,request_id:requestKey});requestKey=newKey();pendingPayload='';form.elements.body.value='';photos=[];renderUploads();await readMore();
      }finally{composing=false;form.elements.photos.disabled=false;form.elements.body.readOnly=false;renderUploads()}
    })};host.append(form,button('Обновить переписку',()=>readMore().catch(error=>status.textContent=error.message)));
    await readMore();
  }
  async function openAttachment(attachmentId,name){
    if(!allowed())return;
    try{
      let token='';try{token=sessionStorage.getItem('bos_vk_session_v2')||localStorage.getItem('bos_vk_session_v2')||''}catch{}
      if(!token)throw Error('Войдите повторно.');
      const response=await fetch(new URL('staff/attachments/'+id(attachmentId),base),{headers:{'X-BOS-Session':token},credentials:'omit',cache:'no-store'});
      if(!response.ok)throw Error('Фото недоступно. Обновите заявку.');
      const blob=await response.blob();if(!['image/png','image/jpeg','image/webp'].includes(blob.type))throw Error('Неподдерживаемый формат фотографии.');
      const url=URL.createObjectURL(blob),dialog=e('dialog',{class:'cpStaffAttachmentDialog','aria-label':name||'Фотография'});
      const close=()=>{dialog.remove();URL.revokeObjectURL(url)};
      dialog.append(button('Закрыть фотографию',close),e('img',{src:url,alt:name||'Фотография',class:'cpStaffPhoto'}));
      dialog.addEventListener('cancel',event=>{event.preventDefault();close()});dialog.addEventListener('click',event=>{if(event.target===dialog)close()});
      document.body.append(dialog);if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
    }catch(error){alert(error.message)}
  }
  function requestCard(request,refresh){
    const types={reschedule:'Перенос',cancel:'Отмена',warranty:'Гарантийное обращение',privacy_access:'Доступ к персональным данным',privacy_delete:'Удаление персональных данных',privacy_correction:'Исправление персональных данных',access:'Доступ к персональным данным',delete:'Удаление персональных данных',correction:'Исправление персональных данных'};
    const box=e('article',{class:'card cpStaffRequest'},[e('strong',{text:types[request.type||request.kind]||'Обращение'}),e('p',{text:request.text||''}),notice('Статус: '+(request.status||'pending')+' · '+date(request.created_at))]);
    if(request.client)box.append(notice((request.client.name||'Клиент')+' · '+(request.client.phone||'')));
    if(request.order_id)box.append(button('Открыть заявку № '+request.order_id,()=>openDetail(request.order_id)));
    if(request.desired_date||request.desired_interval)box.append(notice('Пожелание: '+(request.desired_date||'')+' '+(request.desired_interval||'')));
    if(request.response)box.append(e('p',{text:'Ответ: '+request.response}));
    if(!['accepted','declined','resolved'].includes(request.status)){
      const form=e('form',{class:'cpStaffForm'},[
        field('Ответ клиенту','response','',{tag:'textarea',rows:2,required:true,maxlength:3000}),
        select('Решение','status',[['accepted','Принять'],['declined','Отклонить']],'accepted'),
        notice(request.type==='reschedule'?'После принятия переноса отдельно подтвердите новую дату и время.':request.type==='warranty'?'Гарантийное обращение не создаёт новый заказ и не начисляет зарплату повторно.':request.type==='cancel'?'Принятие отмены отменяет активную заявку.':'Сохранится решение и ответ клиенту.'),
        e('button',{type:'submit',class:'primary',text:'Сохранить решение'})
      ]),status=busy(form,'');form.onsubmit=event=>{event.preventDefault();run(form,status,async()=>{await call('requests/'+id(request.id)+'/resolve','POST',{version:request.version,status:form.elements.status.value,response:form.elements.response.value.trim()});await refreshStaff();await refresh()})};box.append(form);
    }
    return box;
  }
  async function openRequests(){
    const root=modal('Обращения клиентов'),status=busy(root);root.append(button('К заявкам',()=>window.openClientPortalInbox()));
    try{const data=await call('requests');if(!root.isConnected)return;status.remove();for(const request of data.requests||[])root.append(requestCard(request,openRequests));if(!data.requests?.length)root.append(notice('Открытых обращений нет.'))}catch(error){status.textContent=error.message}
  }
  async function openThreads(){
    const root=modal('Сообщения компании'),status=busy(root);root.append(button('К заявкам',()=>window.openClientPortalInbox()));
    try{
      const data=await call('threads');if(!root.isConnected)return;status.remove();
      for(const thread of data.threads||[])root.append(button((thread.client_name||'Клиент')+(thread.unread_count?' · новых: '+thread.unread_count:''),async()=>{
        const messages=modal('Переписка · '+(thread.client_name||'Клиент'));messages.append(button('Все сообщения',openThreads));try{await mountMessages(messages,thread.order_id?{order_id:String(thread.order_id)}:{client_id:String(thread.client_id)})}catch(error){messages.append(notice(error.message))}
      }));
      if(!data.threads?.length)root.append(notice('Общих обращений пока нет. Переписка по работам находится в карточках заявок.'));
    }catch(error){status.textContent=error.message}
  }
  async function openCatalog(){
    if(!leadership())return;
    const root=modal('Каталог услуг'),status=busy(root);root.append(e('div',{class:'cpStaffActions'},[button('К заявкам',()=>window.openClientPortalInbox()),button('Добавить услугу',()=>editService(), 'primary')]));
    try{
      const data=await call('catalog');if(!root.isConnected)return;status.remove();
      for(const service of data.services||[])root.append(section(service.name,[notice(service.category+' · '+(service.published?'Опубликовано':'Черновик')),e('p',{text:service.description||''}),notice((service.price_type==='clarify'?'После уточнения':(service.price_type==='from'?'От ':'')+rub(service.price))+' / '+service.unit),button('Изменить',()=>editService(service))]));
      if(!data.services?.length)root.append(notice('Добавьте услугу. Неподтверждённые цены сохраняйте черновиками или выбирайте «После уточнения».'));
    }catch(error){status.textContent=error.message}
  }
  function editService(service={}){
    if(!leadership())return;
    const root=modal(service.id?'Изменить услугу':'Новая услуга'),form=e('form',{class:'cpStaffForm'},[
      field('Название','name',service.name||'',{required:true,maxlength:200}),field('Категория','category',service.category||'',{required:true,maxlength:100}),
      field('Описание','description',service.description||'',{tag:'textarea',rows:3,maxlength:3000}),field('Единица','unit',service.unit||'шт.',{required:true,maxlength:30}),
      select('Тип цены','price_type',[['clarify','После уточнения'],['fixed','Фиксированная'],['from','От указанной суммы'],['unit','За единицу']],service.price_type||'clarify'),
      field('Цена, ₽','price',service.price??'',{type:'number',min:'0',step:'.01'}),field('Условия','conditions',service.conditions||'',{tag:'textarea',rows:3,maxlength:3000}),
      field('Город','city',service.city||'Санкт-Петербург',{required:true,maxlength:120}),
      e('label',{class:'cpStaffCheck'},[e('input',{name:'available',type:'checkbox',checked:service.available!==false}),e('span',{text:'Услуга доступна'})]),
      e('label',{class:'cpStaffCheck'},[e('input',{name:'confirmed',type:'checkbox',checked:service.confirmed===true}),e('span',{text:'Цена сверена и подтверждена'})]),
      e('label',{class:'cpStaffCheck'},[e('input',{name:'published',type:'checkbox',checked:service.published===true}),e('span',{text:'Опубликовать в клиентском каталоге'})]),
      notice('Изменение цены не пересчитывает ранее созданные заявки.'),e('button',{type:'submit',class:'primary',text:'Сохранить услугу'}),button('Назад',openCatalog)
    ]),status=busy(form,'');root.append(form);
    form.onsubmit=event=>{event.preventDefault();run(form,status,async()=>{
      const fields=Object.fromEntries(new FormData(form));for(const key of ['available','confirmed','published'])fields[key]=form.elements[key].checked;
      fields.price=fields.price_type==='clarify'?null:Number(fields.price);if(fields.price_type!=='clarify'&&form.elements.price.value==='')throw Error('Укажите цену или выберите «После уточнения».');
      if(service.id)fields.version=service.version;await call('catalog'+(service.id?'/'+id(service.id):''),service.id?'PATCH':'POST',fields);await openCatalog();
    })};
  }
  async function openMasters(){
    if(!leadership())return;
    const root=modal('Публичные карточки мастеров'),status=busy(root);root.append(notice('Клиент увидит только выбранные имя, специализацию и фотографию. Личные телефоны не публикуются.'),button('К заявкам',()=>window.openClientPortalInbox()));
    try{const data=await call('masters');if(!root.isConnected)return;status.remove();for(const master of data.masters||[]){
      const form=e('form',{class:'cpStaffForm'},[field('Имя для клиента','name',master.name||'',{required:true,maxlength:120}),field('Специализация','specialization',master.specialization||'',{maxlength:300}),field('Фото: защищённый HTTPS-адрес','photo_url',master.photo_url||'',{type:'url',maxlength:2000}),e('button',{type:'submit',class:'primary',text:'Сохранить карточку'})]),message=busy(form,'');form.onsubmit=event=>{event.preventDefault();run(form,message,()=>call('masters/'+id(master.id)+'/public-profile','POST',Object.fromEntries(new FormData(form))))};root.append(section(master.name||'Мастер',[form]));
    }}catch(error){status.textContent=error.message}
  }
  function openLink(){
    if(!allowed())return;
    const root=modal('Привязать существующую заявку'),search=e('form',{class:'cpStaffForm'},[field('Поиск клиента по телефону или имени','query','',{required:true,minlength:3,maxlength:100}),e('button',{type:'submit',class:'secondary',text:'Найти клиента'})]),results=e('div',{class:'cpStaffList'}),status=busy(search,'');
    root.append(notice('Привязывайте конкретную заявку только после проверки принадлежности. Совпадения телефона недостаточно. Источник, выплаты и финансовые снимки заявки сохраняются.'),search,results,button('Назад',()=>window.openClientPortalInbox()));
    search.onsubmit=event=>{event.preventDefault();run(search,status,async()=>{
      const data=await call('clients?q='+id(search.elements.query.value.trim()));results.replaceChildren();
      for(const client of data.clients||[])results.append(button((client.name||'Клиент')+' · '+client.phone,()=>{
        const form=e('form',{class:'cpStaffForm'},[e('strong',{text:(client.name||'Клиент')+' · '+client.phone}),field('Внутренний ID заявки','order_id','',{required:true,maxlength:80}),field('Как проверена принадлежность заявки','verification_note','',{tag:'textarea',required:true,minlength:10,maxlength:2000,rows:3}),e('label',{class:'cpStaffCheck'},[e('input',{name:'verified',type:'checkbox',required:true}),e('span',{text:'Принадлежность этой заявки проверена вручную'})]),e('button',{type:'submit',class:'primary',text:'Привязать эту заявку'})]),message=busy(form,'');results.replaceChildren(form);
        form.onsubmit=event=>{event.preventDefault();run(form,message,async()=>{
          if(!form.elements.verified.checked)throw Error('Подтвердите ручную проверку.');
          const orderId=form.elements.order_id.value.trim(),{order}=await call('orders/'+id(orderId));
          await call('orders/'+id(orderId)+'/link','POST',{client_id:client.id,version:order.version,verification_note:form.elements.verification_note.value.trim()});await refreshStaff();await openDetail(orderId);
        })};
      }));if(!data.clients?.length)results.append(notice('Клиент не найден. Сначала он должен подтвердить телефон в кабинете.'));
    })};
  }
  const priorOpen=window.openOrder;
  if(typeof priorOpen==='function')window.openOrder=function(orderId){
    const result=priorOpen.apply(this,arguments);
    if(!allowed())return result;
    const order=(state.orders||[]).find(x=>String(x.id)===String(orderId));
    if(!order||!(order.client_account_id||order.client_id||order.external_source==='client_portal'))return result;
    const host=document.querySelector('#modalRoot .modal');
    if(host&&!host.querySelector('.cpStaffEntry'))host.append(e('section',{class:'card cpStaffEntry'},[e('h3',{text:'Кабинет клиента'}),notice('Переписка, фотографии, согласование цены и времени.'),button('Открыть кабинет заявки',()=>openDetail(order.id),'primary')]));
    return result;
  };
  function toolbar(){
    const host=document.getElementById('content');if(!host)return;
    const existing=host.querySelector('[data-client-portal-toolbar]');
    if(!allowed()||!['orders','home','dispatch'].includes(state.page)){existing?.remove();return}
    if(existing)return;
    const bar=e('div',{'data-client-portal-toolbar':'',class:'cpStaffToolbar'},[button('Кабинет клиента · сообщения и заявки',()=>window.openClientPortalInbox())]);
    host.prepend(bar);
  }
  let queued=false;
  const observer=new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;toolbar()})});
  const app=document.getElementById('app');if(app)observer.observe(app,{childList:true,subtree:true});toolbar();
  const style=e('style',{text:'.cpStaffRoot{display:grid;gap:14px;min-width:0}.cpStaffRoot h2,.cpStaffRoot h3,.cpStaffRoot p{margin:0}.cpStaffRoot p{white-space:pre-wrap;overflow-wrap:anywhere}.cpStaffSection{display:grid;gap:12px}.cpStaffActions{display:flex;flex-wrap:wrap;gap:8px}.cpStaffForm,.cpStaffList,.cpStaffField{display:grid;gap:9px}.cpStaffField span{font-size:13px;font-weight:600}.cpStaffField input,.cpStaffField textarea,.cpStaffField select{width:100%;min-width:0;box-sizing:border-box}.cpStaffStatus{font-size:13px;overflow-wrap:anywhere}.cpStaffOrder,.cpStaffRequest{display:grid;gap:9px}.cpStaffEstimateRows{display:grid;gap:12px}.cpStaffEstimateRow{display:grid;grid-template-columns:minmax(120px,1fr) 70px 80px minmax(100px,1fr);gap:8px;align-items:end;padding-bottom:12px;border-bottom:1px solid var(--line,#344157)}.cpStaffEstimateRow>button{grid-column:1/-1;justify-self:end}.cpStaffMessages{display:grid;gap:8px;max-height:400px;overflow:auto}.cpStaffBubble{border-radius:12px;background:rgba(128,145,165,.13);padding:12px;display:grid;gap:5px;max-width:92%}.cpStaffBubble.company{justify-self:end;background:rgba(44,130,220,.18)}.cpStaffBubble p{white-space:pre-wrap;overflow-wrap:anywhere}.cpStaffBubble small{opacity:.65}.cpStaffPhoto{display:block;max-width:100%;max-height:75vh;object-fit:contain}.cpStaffCheck{display:flex;align-items:flex-start;gap:10px}.cpStaffCheck input{width:20px;height:20px;flex:none}.cpStaffToolbar{margin-bottom:12px;display:flex;justify-content:flex-end}.cpStaffToolbar button{max-width:100%;white-space:normal}.cpStaffNote{font-size:13px}@media(max-width:600px){.cpStaffEstimateRow{grid-template-columns:1fr 1fr}.cpStaffEstimateRow>.cpStaffField:first-child{grid-column:1/-1}.cpStaffActions>button{flex:1 1 130px}.cpStaffToolbar{justify-content:stretch}.cpStaffToolbar>button{width:100%}.cpStaffBubble{max-width:100%}}'});document.head.append(style);
  style.textContent+='.cpStaffUploadList{display:grid;gap:8px}.cpStaffUpload{padding:10px;border:1px solid var(--line,#344157);border-radius:10px;display:grid;gap:5px;overflow-wrap:anywhere}.cpStaffUpload button{justify-self:end}.cpStaffAttachmentDialog{width:min(850px,calc(100vw - 32px));max-height:90vh;box-sizing:border-box;background:var(--card,#101b2a);color:inherit;border:1px solid var(--line,#344157);padding:16px;border-radius:16px;overflow:auto}.cpStaffAttachmentDialog::backdrop{background:rgba(0,0,0,.7)}.cpStaffAttachmentDialog .cpStaffPhoto{margin-top:12px;width:100%}';
  window.BOS_CLIENT_PORTAL_STAFF=Object.freeze({call,enabled:true});
})();
