(()=>{
'use strict';
const DEFAULT_API='https://business-os-api-gateway.netlify.app/api/proxy/avito-api';
const contract={status:'status',connect:'connect',disconnect:'disconnect',sync:'sync',chats:'chats',messages:'messages',sendMessage:'sendMessage',read:'read'};
window.BOS_AVITO_CONTRACT=Object.freeze({...contract});
function apiEnabled(){return window.BUSINESS_OS_CONFIG?.AVITO_API_ENABLED===true}
function apiUrl(){return window.BUSINESS_OS_CONFIG?.AVITO_API_URL||DEFAULT_API}
let retryUntil=0;
async function avitoCall(action,data={}){
  if(!apiEnabled())throw new Error('Авито API пока не подключён');
  if(Date.now()<retryUntil)throw Object.assign(new Error('Авито ограничил частоту запросов. Подождите перед повтором.'),{status:429,retryAfter:Math.ceil((retryUntil-Date.now())/1000)});
  const h=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};h['Content-Type']='application/json';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
  try{
    const r=await fetch(apiUrl(),{method:'POST',headers:h,body:JSON.stringify({action,...data}),signal:controller.signal});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok){
      const fallback=r.status===401?'Войдите в Business OS повторно':r.status===403?'Недостаточно прав для работы с Авито':r.status===429?'Слишком много запросов. Подождите перед повтором.':'Авито временно недоступен. Повторите позже.';
      if(r.status===429)retryUntil=Date.now()+Math.min(3600,Math.max(30,Number(d.retry_after)||30))*1000;
      const message=typeof d.error==='string'&&/[а-яА-Я]/.test(d.error)?d.error:fallback;
      throw Object.assign(new Error(message),{status:r.status,retryAfter:Math.max(0,Number(d.retry_after)||0)});
    }
    return d;
  }catch(e){
    if(e.name==='AbortError'||e instanceof TypeError)throw new Error('Нет ответа от Авито. Перед повторной отправкой обновите историю.');
    throw e;
  }finally{clearTimeout(timer)}
}
function pollView(root,refresh){
  let timer,stopped=false,delay=30000;
  const observer=new MutationObserver(()=>{if(!root.isConnected){stopped=true;clearTimeout(timer);observer.disconnect()}});
  observer.observe(document.getElementById('app'),{childList:true,subtree:true});
  const tick=async()=>{
    if(stopped||!root.isConnected)return;
    if(!document.hidden&&!document.querySelector('#modalRoot .modal')){try{await refresh();delay=30000}catch(e){delay=Math.max(Math.min(300000,delay*2),Math.min(3600000,(e.retryAfter||0)*1000));if(e.status===401||e.status===403){observer.disconnect();return}}}
    if(!stopped&&root.isConnected)timer=setTimeout(tick,delay);
  };
  timer=setTimeout(tick,delay);
}
const avitoOrder=o=>String(o?.external_source||'').toLowerCase()==='avito'||['авито','avito'].includes(String(o?.source||'').toLowerCase());
const avitoOrders=()=>Array.from(state.orders||[]).filter(avitoOrder);
function time(v){if(!v)return'';try{return new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}catch(_){return''}}
function imageUrl(value){
  if(typeof value!=='string'||value.length>4096||/[\s\x00-\x1f]/.test(value))return '';
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/(^|\.)avito\.(ru|st)$/.test(u.hostname)?u.href:''}catch{return ''}
}
function messageImage(message){
  const url=message.type==='image'&&imageUrl(message.image?.url);
  return url?{url,preview:imageUrl(message.image.preview_url)||url}:null;
}
function messageHTML(message){
  const photo=messageImage(message),content=message.text||(!photo?(message.type==='image'?'Фото недоступно':'['+(message.type||'Вложение')+']'):'');
  return `<div class="avitoBubble ${message.direction==='out'?'out':'in'}">${photo?`<button class="avitoImageButton" type="button" aria-label="Открыть фото из Авито" data-image-url="${esc(photo.url)}"><img src="${esc(photo.preview)}" alt="Фото из переписки Авито" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="avitoPhotoLabel">Открыть фото ↗</span></button>`:''}${content?`<div>${esc(content)}</div>`:''}<small>${esc(time(message.created_at))}</small></div>`;
}
function openMessageImage(url,trigger){
  url=imageUrl(url);if(!url)return;
  openModal(`<h2 id="avitoImageTitle">Фото из Авито</h2><div class="avitoFullImage"><img src="${esc(url)}" alt="Фото из переписки Авито в полном размере" referrerpolicy="no-referrer"></div><p class="avitoImageStatus muted" role="status"></p><a class="avitoImageOriginal" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Открыть оригинал ↗</a>`);
  const modal=document.querySelector('#modalRoot .modal');if(!modal)return;
  modal.classList.add('avitoImageModal');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','avitoImageTitle');
  const img=modal.querySelector('img'),status=modal.querySelector('.avitoImageStatus');
  img.onerror=()=>{img.hidden=true;status.textContent='Фото не удалось загрузить. Попробуйте открыть оригинал.'};
  const close=modal.querySelector('.modalClose');close.setAttribute('aria-label','Закрыть фото');close.focus();
  modal.onkeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeModal()}
    if(event.key==='Tab'){const last=modal.querySelector('.avitoImageOriginal');if(event.shiftKey&&document.activeElement===close){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();close.focus()}}
  };
  const cleanup=new MutationObserver(()=>{if(!modal.isConnected){cleanup.disconnect();if(trigger.isConnected&&!document.querySelector('#modalRoot .modal'))trigger.focus()}});cleanup.observe(document.getElementById('modalRoot'),{childList:true,subtree:true});
}
function bindMessageImages(messages){
  messages.querySelectorAll('.avitoImageButton').forEach(button=>{
    button.onclick=()=>openMessageImage(button.dataset.imageUrl,button);
    const img=button.querySelector('img');img.onerror=()=>{img.hidden=true;button.classList.add('avitoImageFailed');button.querySelector('.avitoPhotoLabel').textContent='Фото не загрузилось — открыть'};
    if(img.complete&&img.naturalWidth===0)img.onerror();
  });
}
function apiOffCard(){return `<section class="card avitoSetupCard"><div class="row"><div><div class="eyebrow">АВИТО</div><h3 style="margin:4px 0 0">Подготовительный режим</h3></div><span class="apiState off">API позже</span></div><p class="muted">Интерфейс уже готов для работы с обращениями. Сейчас можно вручную перенести обращение Авито в обычную заявку Business OS. После подключения API здесь появятся входящие чаты, ответы и синхронизация.</p></section>`}
function renderExistingOrders(){const rows=avitoOrders();return `<section class="card avitoExisting"><div class="row"><div><h3 style="margin:0">Заявки из Авито</h3><div class="muted">${rows.length} шт.</div></div></div>${rows.map(o=>`<button class="secondary wide avitoOrderRow" onclick="closeModal();openOrder('${esc(o.id)}')"><span><b>${esc(o.client||'Клиент')}</b><small>${esc(o.work||'Заявка')} · №${esc(o.id)}</small></span><b>Открыть ›</b></button>`).join('')||'<p class="muted">Пока нет заявок с источником «Авито».</p>'}</section>`}
function setupScreen(){return `<button class="modalClose" onclick="closeModal()">×</button><h2>Авито</h2>${apiOffCard()}<button class="primary wide" onclick="openAvitoInbox()">Входящие Авито</button><button class="secondary wide" style="margin-top:8px" onclick="openAvitoManualLead()">+ Добавить обращение вручную</button><section class="card avitoRoadmap"><h3 style="margin-top:0">Готово к подключению API</h3><div class="ownerProfileLine"><span>Входящие чаты</span><b>Интерфейс готов</b></div><div class="ownerProfileLine"><span>Ответ клиенту</span><b>Интерфейс готов</b></div><div class="ownerProfileLine"><span>Чат → заявка</span><b>Готово</b></div><div class="ownerProfileLine"><span>Client ID / Secret</span><b class="muted">Подключим позже</b></div></section>`}
window.openAvitoSettings=async function(){
  if(!apiEnabled()){openModal(setupScreen());return}
  openModal('<h2>Авито</h2><p class="muted">Проверяем подключение…</p>');
  const m=document.querySelector('.modal');
  try{
    const d=await avitoCall(contract.status),c=d.connection||{};if(!m.isConnected)return;
    m.innerHTML=`<button class="modalClose" onclick="closeModal()">×</button><h2>Авито</h2><section class="card"><b>${d.connected?'Подключено':'Не подключено'}</b><p>${esc(c.account_name||'')}</p><p class="muted">${d.connected?'ID аккаунта: '+esc(c.avito_user_id):'Подключение использует ключи, настроенные владельцем в Supabase Secrets. Ключи в приложении не вводятся.'}</p>${!d.configured?'<p>Настройте AVITO_CLIENT_ID и AVITO_CLIENT_SECRET на сервере.</p>':''}</section>${d.connected?'<button class="primary wide" onclick="openAvitoInbox()">Открыть входящие</button><button id="avitoSyncBtn" class="secondary wide">Синхронизировать</button><button id="avitoDisconnectBtn" class="secondary wide">Отключить Авито</button>':'<button id="avitoConnectBtn" class="primary wide" '+(!d.configured?'disabled':'')+'>Подключить Авито</button>'}<p id="avitoMsg" role="status" class="muted"></p>`;
    for(const [id,action] of [['avitoConnectBtn','connect'],['avitoDisconnectBtn','disconnect'],['avitoSyncBtn','sync']]){
      const button=m.querySelector('#'+id);if(!button)continue;
      button.onclick=async()=>{
        if(button.disabled)return;
        if(action==='disconnect'&&!confirm('Отключить Авито от Business OS?'))return;
        const msg=m.querySelector('#avitoMsg');button.disabled=true;msg.textContent='Выполняем…';
        try{const result=await avitoCall(action);if(!m.isConnected)return;if(action==='sync'){msg.textContent=`Обновлено заявок: ${result.updated||0}.`;await reloadData(true)}else{workspace=null;window.__BOS_AVITO_CHATS__=[];if(state.page==='avito')show('avito');openAvitoSettings()}}
        catch(e){if(m.isConnected)msg.textContent=e.message}finally{button.disabled=false}
      };
    }
  }catch(e){if(m.isConnected)m.innerHTML=`<button class="modalClose" onclick="closeModal()">×</button><h2>Авито</h2><p>${esc(e.message)}</p><button class="secondary wide" onclick="openAvitoSettings()">Повторить</button>`}
};
let workspace=null;
const uncertainSends=new Map();
function workingState(){
  const actor=String(state.user?.id||state.user?.external_id||'')+':'+String(state.user?.role||'');
  if(!workspace||workspace.actor!==actor){workspace={actor,rows:[],selected:'',query:'',filter:'all',pane:'list',drafts:new Map(),next:null,maxOffset:0};uncertainSends.clear()}
  return workspace;
}
function linkedOrder(id){return (state.orders||[]).find(o=>String(o.avito_chat_id)===String(id))}
function draftFor(ws,chat){
  const id=String(chat.id||chat.chat_id);
  if(!ws.drafts.has(id))ws.drafts.set(id,{text:'',client:chat.client||chat.name||'',phone:chat.phone||'',work:chat.work||chat.item_title||'',address:chat.address||'',city:chat.city||'Санкт-Петербург',desired_time:'',comment:'',amount:'',sending:false,saving:false});
  return ws.drafts.get(id);
}
function workspaceHTML(){
  if(!canUseAvitoNavigation()||!apiEnabled())return '<section class="card"><h2>Авито</h2><p>Раздел недоступен для текущего аккаунта.</p></section>';
  return `<section class="avitoWorkspace" data-pane="list" aria-label="Рабочая область Авито">
    <header class="avitoPageHead"><div><h2>Авито</h2><p class="muted">Диалоги и заявки в одной рабочей области</p></div><div class="avitoHeadActions"><span id="avitoConnection" role="status">Подключаемся…</span><button class="secondary" id="avitoRefresh" aria-label="Обновить Авито">↻</button><button class="secondary" id="avitoSettings">Настройки</button></div></header>
    <div class="avitoFilters" role="group" aria-label="Фильтры диалогов"><button data-avito-filter="all">Все <span></span></button><button data-avito-filter="unread">Непрочитанные <span id="avitoUnreadTotal"></span></button><button data-avito-filter="unlinked">Без заявки <span></span></button></div>
    <div class="avitoDesk"><aside class="avitoQueue" aria-label="Диалоги"><p id="avitoInboxStatus" role="status" class="muted"></p><label class="avitoSearch"><span class="sr-only">Поиск по имени или сообщению</span><input id="avitoSearch" type="search" placeholder="Имя или сообщение"></label><div class="avitoInbox">Загружаем диалоги…</div><div class="avitoQueueFoot"><small id="avitoLoadedHint" class="muted"></small><button id="avitoMoreChats" class="secondary wide" hidden>Ещё диалоги</button></div></aside><div class="avitoConversation"><div class="avitoEmpty"><b>Выберите диалог</b><p>Переписка и данные обращения появятся здесь.</p></div></div><aside class="avitoLeadPane" aria-label="Обращение"><div class="avitoEmpty"><b>Обращение</b><p>Откройте диалог, чтобы подготовить заявку.</p></div></aside></div>
  </section>`;
}
pages.avito=function(){queueMicrotask(()=>{syncAvitoNavigation();mountWorkspace()});return workspaceHTML()};
function renderChats(rows,selected){
  return rows.map(c=>{const id=String(c.id||c.chat_id),order=linkedOrder(id);return `<button class="avitoChatRow ${id===selected?'selected':''}" data-chat-id="${esc(id)}" aria-pressed="${id===selected}"><i class="avitoAvatar" aria-hidden="true">${esc((c.client||c.name||'К').slice(0,1))}</i><span class="avitoChatBody"><b class="avitoChatName">${esc(c.client||c.name||'Клиент')}</b><small class="avitoChatService">${esc(c.item_title||c.work||'Авито')}</small><small class="avitoChatPreview">${esc(c.last_message||'Нет текстовых сообщений')}</small>${order?`<em>Заявка №${esc(order.id)}</em>`:''}</span><span class="avitoRowMeta"><small>${esc(time(c.last_message_at))}</small>${Number(c.unread_count||0)>0?`<i class="avitoUnread">${Number(c.unread_count)}</i>`:''}</span></button>`}).join('')||'<p class="avitoNoResults muted">Диалоги не найдены.</p>';
}
function mountWorkspace(){
  const root=document.querySelector('#content .avitoWorkspace');
  if(!root||root.dataset.ready||!canUseAvitoNavigation())return root;
  root.dataset.ready='1';const ws=workingState();root.dataset.pane=ws.pane;
  const mobile=()=>window.innerWidth<768;
  const nav=document.querySelector('#app > nav');
  const fit=()=>{
    if(!root.isConnected)return;
    const viewport=window.visualViewport,visibleBottom=viewport?viewport.height+viewport.offsetTop:window.innerHeight;
    if(mobile()){
      root.style.setProperty('--avito-nav-height',(nav?.getBoundingClientRect().height||80)+'px');
      if(root.dataset.pane==='list'){root.style.removeProperty('height');return}
    }
    const bottom=window.innerWidth<1024&&nav?Math.min(visibleBottom,nav.getBoundingClientRect().top):visibleBottom-12;
    root.style.height=Math.max(mobile()?0:350,bottom-root.getBoundingClientRect().top-10)+'px';
  };
  root.avitoSetPane=pane=>{
    if(mobile()&&root.dataset.pane==='list'&&pane!=='list')ws.listScrollY=window.scrollY;
    ws.pane=pane;root.dataset.pane=pane;
    if(mobile()){
      if(pane==='list'){
        const selected=[...root.querySelectorAll('[data-chat-id]')].find(button=>button.dataset.chatId===ws.selected);
        (selected||root.querySelector('#avitoSearch'))?.focus({preventScroll:true});
        requestAnimationFrame(()=>{if(root.isConnected&&root.dataset.pane==='list')window.scrollTo(0,ws.listScrollY||0)});
      }else window.scrollTo(0,0);
    }
    fit();
  };
  fit();const sizing=new ResizeObserver(fit);const header=document.querySelector('#app > header');
  if(header)sizing.observe(header);if(nav)sizing.observe(nav);
  window.addEventListener('resize',fit);window.visualViewport?.addEventListener('resize',fit);
  const cleanup=new MutationObserver(()=>{if(!root.isConnected){sizing.disconnect();window.removeEventListener('resize',fit);window.visualViewport?.removeEventListener('resize',fit);cleanup.disconnect()}});
  cleanup.observe(document.getElementById('content'),{childList:true});
  const list=root.querySelector('.avitoInbox'),status=root.querySelector('#avitoInboxStatus'),more=root.querySelector('#avitoMoreChats'),search=root.querySelector('#avitoSearch');
  let busy=false;
  const alive=()=>root.isConnected&&state.page==='avito'&&canUseAvitoNavigation()&&workingState()===ws;
  function render(){
    if(!alive())return;
    const query=ws.query.trim().toLocaleLowerCase('ru');
    const rows=ws.rows.filter(c=>(ws.filter!=='unread'||Number(c.unread_count)>0)&&(ws.filter!=='unlinked'||!linkedOrder(c.id))&&(!query||[c.client,c.name,c.item_title,c.last_message].some(v=>String(v||'').toLocaleLowerCase('ru').includes(query))));
    list.innerHTML=renderChats(rows,ws.selected);
    list.querySelectorAll('[data-chat-id]').forEach(button=>button.onclick=()=>root.avitoSelect(button.dataset.chatId));
    for(const button of root.querySelectorAll('[data-avito-filter]')){
      const key=button.dataset.avitoFilter;button.classList.toggle('active',ws.filter===key);button.setAttribute('aria-pressed',String(ws.filter===key));
      button.querySelector('span').textContent=key==='all'?ws.rows.length:key==='unread'?ws.rows.reduce((n,c)=>n+Number(c.unread_count||0),0):ws.rows.filter(c=>!linkedOrder(c.id)).length;
    }
    root.querySelector('#avitoLoadedHint').textContent=ws.next!=null?'Поиск и счётчики — по загруженным диалогам':'';
    more.hidden=ws.next==null;
  }
  async function refresh(append=false){
    if(busy||!alive())return;busy=true;more.disabled=true;
    try{
      const offset=append?ws.next||0:0,d=await avitoCall(contract.chats,{offset});if(!alive())return;
      const incoming=d.chats||[],map=new Map(ws.rows.map(c=>[String(c.id),c]));for(const c of incoming)map.set(String(c.id),{...map.get(String(c.id)),...c});
      const ids=append?[...ws.rows.map(c=>String(c.id)),...incoming.map(c=>String(c.id))]:[...incoming.map(c=>String(c.id)),...ws.rows.map(c=>String(c.id))];
      ws.rows=[...new Set(ids)].map(id=>map.get(id));
      if(append)ws.maxOffset=offset;if(append||ws.maxOffset===0)ws.next=d.next_offset??null;
      window.__BOS_AVITO_CHATS__=ws.rows;status.textContent='';root.querySelector('#avitoConnection').textContent='● Подключено';root.querySelector('#avitoConnection').className='connected';render();
    }catch(e){if(alive()){status.textContent=e.message;root.querySelector('#avitoConnection').textContent=e.status===409?'Не подключено':'Нет связи';root.querySelector('#avitoConnection').className='';if(!ws.rows.length)list.innerHTML='<p class="avitoNoResults muted">Не удалось загрузить диалоги. Нажмите «Обновить».</p>'}throw e}
    finally{busy=false;more.disabled=false}
  }
  root.avitoSelect=id=>selectWorkspaceChat(root,ws,String(id),render);
  root.avitoRenderList=render;
  root.querySelector('#avitoRefresh').onclick=()=>{refresh().catch(()=>{});root.avitoRefreshChat?.().catch(()=>{})};
  root.querySelector('#avitoSettings').onclick=()=>openAvitoSettings();
  more.onclick=()=>refresh(true).catch(()=>{});
  search.value=ws.query;search.oninput=()=>{ws.query=search.value;render()};
  root.querySelectorAll('[data-avito-filter]').forEach(button=>button.onclick=()=>{ws.filter=button.dataset.avitoFilter;render()});
  if(ws.rows.length)render();
  if(ws.selected&&ws.rows.some(c=>String(c.id)===ws.selected)){const pane=ws.pane;root.avitoSelect(ws.selected);root.avitoSetPane(pane)}
  root.avitoReady=refresh().catch(()=>{});pollView(root,()=>refresh());return root;
}
function selectWorkspaceChat(root,ws,id,renderList){
  const chat=ws.rows.find(c=>String(c.id)===id);if(!chat)return;
  ws.selected=id;root.avitoSetPane('chat');renderList();
  const draft=draftFor(ws,chat),conversation=root.querySelector('.avitoConversation'),lead=root.querySelector('.avitoLeadPane');
  const safeItem=/^https:\/\/([a-z0-9-]+\.)?avito\.ru\//i.test(chat.item_url||'')?chat.item_url:'';
  conversation.innerHTML=`<section class="avitoChatView"><div class="avitoChatHead"><button class="secondary avitoBackList" type="button">‹ Диалоги</button><i class="avitoAvatar" aria-hidden="true">${esc((chat.client||'К').slice(0,1))}</i><div><h3>${esc(chat.client||chat.name||'Клиент Авито')}</h3><small class="muted">${esc(chat.item_title||'')}</small></div>${safeItem?`<a href="${esc(safeItem)}" target="_blank" rel="noopener noreferrer">Объявление ↗</a>`:''}<button class="secondary avitoShowLead" type="button">Обращение</button></div><div class="avitoHistory"><button class="secondary" id="avitoOlder" hidden>Ранее</button><div id="avitoMessages" aria-live="polite">Загружаем сообщения…</div></div><p id="avitoHistoryStatus" role="status" class="muted"></p><form id="avitoSendForm"><div class="avitoComposer"><textarea name="text" maxlength="1000" rows="2" aria-label="Сообщение клиенту" placeholder="Написать сообщение…" required></textarea><button class="primary" type="submit" aria-label="Отправить в Авито">➤</button></div><small class="muted avitoKeyboardHint">Enter — отправить · Shift+Enter — новая строка</small><p id="avitoSendMsg" role="status" class="muted"></p></form></section>`;
  const view=conversation.firstElementChild,messages=view.querySelector('#avitoMessages'),status=view.querySelector('#avitoHistoryStatus'),older=view.querySelector('#avitoOlder'),scroller=view.querySelector('.avitoHistory');
  const alive=()=>view.isConnected&&root.isConnected&&state.page==='avito'&&canUseAvitoNavigation()&&workingState()===ws;
  const visibleChat=()=>window.innerWidth>=1260||root.dataset.pane==='chat';
  let loading=false,next=null,history=[],olderLoaded=false,renderedHistory='';
  view.querySelector('.avitoBackList').onclick=()=>{root.avitoSetPane('list')};
  view.querySelector('.avitoShowLead').onclick=()=>{root.avitoSetPane('details');lead.querySelector('input')?.focus({preventScroll:true})};
  function renderLead(){
    const order=linkedOrder(id);
    const field=(name,label,required=false,placeholder='')=>`<label><span>${label}</span><input name="${name}" ${required?'required':''} value="${esc(draft[name]||'')}" placeholder="${placeholder}"></label>`;
    lead.innerHTML=`<button class="secondary avitoBackChat" type="button">‹ К переписке</button><div class="avitoLeadHead"><h3>Обращение</h3><span class="softChip">${order?'Заявка №'+esc(order.id):'Заявка ещё не создана'}</span></div>${order?`<section class="avitoLinked"><b>${esc(order.client)}</b><p>${esc(order.work)}</p><p class="muted">${esc(order.address)}</p><span>${esc(order.status||'В работе')}</span></section><button id="avitoToOrder" type="button" class="primary wide">Открыть заявку</button>`:`<form id="avitoLeadForm"><div class="avitoLeadFields">${field('client','Клиент',true)}${field('phone','Телефон',true,'+7…')}${field('work','Услуги',true)}${field('address','Адрес',true,'Улица, дом, квартира')}${field('desired_time','Пожелание по времени',false,'Например: завтра после 15:00')}<label><span>Комментарий</span><textarea name="comment" rows="2" placeholder="Детали работы">${esc(draft.comment)}</textarea></label><details class="avitoExtraFields"><summary>Город и стоимость</summary>${field('city','Город / населённый пункт',true)}<label><span>Согласованная сумма, ₽</span><input name="amount" type="number" min="0" step="0.01" value="${esc(draft.amount)}" placeholder="Пока не согласована"></label></details></div><button id="avitoToOrder" type="submit" class="primary wide">Создать заявку</button><small class="muted">Проверьте данные перед созданием. Пожелание по времени сохранится в комментарии.</small><p id="avitoOrderMsg" role="status" class="muted"></p></form>`}`;
    lead.querySelector('.avitoBackChat').onclick=()=>{root.avitoSetPane('chat');form.elements.text.focus({preventScroll:true})};
    if(order){lead.querySelector('#avitoToOrder').onclick=()=>{show('orders');openOrder(order.id)};return}
    const fields=lead.querySelector('#avitoLeadForm'),msg=fields.querySelector('#avitoOrderMsg');fields.elements.phone.type='tel';fields.elements.phone.autocomplete='tel';
    fields.oninput=()=>{for(const [key,value] of new FormData(fields))draft[key]=value};
    fields.querySelector('button[type=submit]').disabled=draft.saving;
    fields.onsubmit=async event=>{
      event.preventDefault();if(draft.saving)return;
      let phone=String(fields.elements.phone.value).replace(/\D/g,'');if(phone.length===10)phone='7'+phone;if(phone.length===11&&phone[0]==='8')phone='7'+phone.slice(1);
      if(!/^7\d{10}$/.test(phone)){msg.textContent='Укажите российский номер телефона: +7 и 10 цифр.';fields.elements.phone.focus();return}
      for(const key of ['client','address','work'])if(!fields.elements[key].value.trim()){msg.textContent='Заполните имя, адрес и услуги.';fields.elements[key].focus();return}
      const amount=Number(fields.elements.amount.value||0);if(!Number.isFinite(amount)||amount<0){msg.textContent='Укажите неотрицательную сумму.';return}
      const values=Object.fromEntries(new FormData(fields));Object.assign(draft,values);draft.saving=true;fields.querySelector('button[type=submit]').disabled=true;msg.textContent='Создаём заявку…';
      const notes=['Источник: Авито','Диалог Авито: '+id,chat.client_id?'ID клиента Авито: '+chat.client_id:'',safeItem?'Объявление: '+safeItem:'',values.desired_time?'Пожелание по времени: '+values.desired_time:'',values.comment,history.length?'Переписка клиента:\n'+history.filter(m=>m.direction==='in'&&m.text).map(m=>m.text).join('\n'):chat.last_message||''].filter(Boolean).join('\n');
      try{
        const result=await api('createOrder',{client:values.client.trim(),phone:'+'+phone,address:values.address.trim(),work:values.work.trim(),city:values.city.trim()||'Санкт-Петербург',comment:notes,amount,original_amount:amount,status:'В работе',source:'Авито',avito_chat_id:id,avito_item_id:chat.item_id||'',avito_item_url:safeItem});
        if(!result.ok||!result.order)throw new Error(result.error||'Не удалось создать заявку');
        // The server's chat key deduplicates retries; retain its authoritative order.
        if(workingState()===ws){const index=state.orders.findIndex(o=>String(o.id)===String(result.order.id));if(index>=0)state.orders[index]=result.order;else state.orders.unshift(result.order)}
        if(alive()){renderLead();renderList()}
      }catch(error){if(alive())msg.textContent=error.message}
      finally{draft.saving=false;if(fields.isConnected)fields.querySelector('button[type=submit]').disabled=false;else if(workingState()===ws&&ws.selected===id)document.querySelector('.avitoWorkspace')?.avitoRenderLead?.()}
    };
  }
  async function refresh(append=false){
    if(loading||!alive()||!visibleChat())return false;loading=true;older.disabled=true;
    try{
      const d=await avitoCall(contract.messages,{chat_id:id,offset:append?next||0:0});if(!alive())return false;
      const height=scroller.scrollHeight,top=scroller.scrollTop,follow=history.length===0||height-top-scroller.clientHeight<90;
      history=[...new Map([...history,...(d.messages||[])].map(m=>[m.id,m])).values()].sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')));
      const html=history.map(messageHTML).join('')||'<p class="muted">Сообщений пока нет.</p>';
      if(renderedHistory!==html){messages.innerHTML=html;renderedHistory=html;bindMessageImages(messages)}
      if(append||!olderLoaded)next=d.next_offset;if(append)olderLoaded=true;older.hidden=next==null;status.textContent='';
      if(append)scroller.scrollTop=top+scroller.scrollHeight-height;else if(follow)scroller.scrollTop=scroller.scrollHeight;
      if(visibleChat())try{await avitoCall(contract.read,{chat_id:id});if(alive()){chat.unread_count=0;const current=ws.rows.find(c=>String(c.id)===id);if(current)current.unread_count=0;renderList()}}catch(error){if(alive())status.textContent='История загружена. '+error.message;if([401,403,429].includes(error.status))throw error}
      return true;
    }catch(error){if(alive()){status.textContent=error.message;if(!history.length)messages.textContent='Не удалось загрузить переписку.'}throw error}
    finally{loading=false;older.disabled=false}
  }
  root.avitoRefreshChat=refresh;older.onclick=()=>refresh(true).catch(()=>{});
  const form=view.querySelector('#avitoSendForm'),msg=view.querySelector('#avitoSendMsg'),send=form.querySelector('button');
  form.elements.text.value=draft.text;form.elements.text.oninput=()=>draft.text=form.elements.text.value;send.disabled=draft.sending;
  form.elements.text.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&window.matchMedia('(pointer:fine)').matches){event.preventDefault();form.requestSubmit()}};
  form.onsubmit=async event=>{
    event.preventDefault();if(draft.sending)return;const value=form.elements.text.value.trim();if(!value)return;
    draft.sending=true;send.disabled=true;
    try{
      if(uncertainSends.get(id)===value){const checked=await refresh().catch(()=>false);if(!checked||!alive())return;if(!confirm('Проверьте историю: прошлое сообщение могло быть доставлено. Всё равно отправить ещё раз?'))return}
      msg.textContent='Отправляем…';await avitoCall(contract.sendMessage,{chat_id:id,text:value});uncertainSends.delete(id);
      if(draft.text.trim()===value)draft.text='';if(!alive())return;
      if(form.elements.text.value.trim()===value)form.elements.text.value='';msg.textContent='Отправлено';await refresh().catch(()=>{});
    }catch(error){uncertainSends.set(id,value);if(alive())msg.textContent=error.message+' Перед повторной отправкой проверьте историю.'}
    finally{draft.sending=false;if(alive())send.disabled=false;else if(workingState()===ws&&ws.selected===id){const current=document.querySelector('.avitoWorkspace');current?.querySelector('#avitoSendForm button')?.removeAttribute('disabled');const input=current?.querySelector('#avitoSendForm textarea');if(input)input.value=draft.text;current?.avitoRefreshChat?.().catch(()=>{})}}
  };
  root.avitoRenderLead=renderLead;renderLead();refresh().catch(()=>{});pollView(view,()=>draft.sending?Promise.resolve():refresh());
}
window.openAvitoInbox=async function(){
  if(!canUseAvitoNavigation())return;
  if(!apiEnabled()){openModal(`<button class="modalClose" onclick="closeModal()">×</button><h2>Входящие Авито</h2>${apiOffCard()}<button class="primary wide" onclick="openAvitoManualLead()">+ Добавить обращение вручную</button>${renderExistingOrders()}`);return}
  // An inbox is a normal page; opening it from an order/settings closes that overlay.
  closeModal();if(state.page!=='avito'||!document.querySelector('.avitoWorkspace'))show('avito');
  const root=mountWorkspace();return root?.avitoReady;
};
window.openAvitoLead=async function(id){
  if(!canUseAvitoNavigation())return;
  if(!apiEnabled()){openAvitoSettings();return}
  await openAvitoInbox();const root=mountWorkspace();return root?.avitoSelect(String(id));
};
window.openAvitoChat=async function(id){
  const o=linkedOrder((state.orders||[]).find(x=>String(x.id)===String(id))?.avito_chat_id);
  if(!o||!o.avito_chat_id||!canUseAvitoNavigation())return;
  const ws=workingState(),chat={id:String(o.avito_chat_id),client:o.client,phone:o.phone,address:o.address,work:o.work,item_title:o.work,item_url:o.avito_item_url,city:o.city};
  if(!ws.rows.some(c=>String(c.id)===chat.id))ws.rows.push(chat);
  return openAvitoLead(chat.id);
};
window.openAvitoManualLead=function(){openModal(`<button class="modalClose" onclick="closeModal()">×</button><h2>Обращение из Авито</h2><p class="muted">Пока API не подключён, перенесите данные клиента вручную. После подключения этот шаг будет заполняться автоматически из чата.</p><form id="avitoManualForm" class="form"><input name="client" placeholder="Клиент" required><input name="phone" placeholder="Телефон"><input name="address" placeholder="Адрес" required><input name="work" placeholder="Работа / услуга" required><input name="item_url" placeholder="Ссылка на объявление"><textarea name="message" rows="4" placeholder="Сообщение клиента / комментарий"></textarea><button class="primary wide" type="submit">Перенести в заявку</button></form>`);document.getElementById('avitoManualForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget,d=Object.fromEntries(new FormData(f));prefillOrder(d)}};
function prefillOrder(d={}){const existing=d.chat_id&&(state.orders||[]).find(o=>String(o.avito_chat_id)===String(d.chat_id));if(existing){openOrder(existing.id);return}openOrderForm();const f=document.getElementById('orderForm');if(!f)return;for(const k of ['client','address'])if(f.elements[k]&&d[k]!=null)f.elements[k].value=d[k];if(d.phone){const p=f.elements.phone||document.getElementById('bosPhone');if(p){if(p.id==='bosPhone'){let digits=String(d.phone).replace(/\D/g,'');if(digits[0]==='7'||digits[0]==='8')digits=digits.slice(1);p.value=digits.slice(0,10);p.dispatchEvent(new Event('input',{bubbles:true}))}else p.value=d.phone}}let workMatched=false;const work=f.elements.work||document.getElementById('bosService');if(work&&d.work!=null){if(work.tagName==='SELECT'){const wanted=String(d.work).trim().toLowerCase(),option=[...work.options].find(x=>{const label=String(x.textContent||'').split(' — ')[0].trim().toLowerCase();return String(x.value).trim().toLowerCase()===wanted||label===wanted});if(option){work.value=option.value;work.dispatchEvent(new Event('change',{bubbles:true}));workMatched=true}}else{work.value=d.work;workMatched=true}}let source=f.elements.source;if(!source){source=document.createElement('input');source.type='hidden';source.name='source';f.appendChild(source)}if(source.tagName==='SELECT'){let o=[...source.options].find(x=>String(x.value).toLowerCase()==='авито');if(!o){o=new Option('Авито','Авито');source.add(o)}source.value='Авито'}else source.value='Авито';for(const [name,value] of Object.entries({avito_chat_id:d.chat_id,avito_item_id:d.item_id,avito_item_url:d.item_url,city:d.city})){if(!value)continue;let input=f.elements[name];if(!input){input=document.createElement('input');input.type='hidden';input.name=name;f.appendChild(input)}input.value=value}const notes=['Источник: Авито'];if(d.chat_id)notes.push('Диалог Авито: '+d.chat_id);if(d.client_id)notes.push('ID клиента Авито: '+d.client_id);if(d.work)notes.push(`Работа из Авито: ${d.work}${workMatched?'':' (выберите услугу из каталога)'}`);if(d.item_url)notes.push(`Объявление: ${d.item_url}`);if(d.message)notes.push(`Сообщение клиента: ${d.message}`);if(f.elements.comment)f.elements.comment.value=notes.join('\n');const notice=document.createElement('section');notice.className='card avitoDraftNotice';notice.innerHTML='<div class="eyebrow">АВИТО</div><b>Заявка подготовлена из обращения</b><p class="muted">Проверьте данные и сохраните обычной кнопкой. До сохранения ничего не меняется в базе.</p>';f.parentNode.insertBefore(notice,f)}
function addOrderChat(id){
  const o=(state.orders||[]).find(x=>String(x.id)===String(id));
  if(!o||!avitoOrder(o)||!['owner','manager','dispatcher'].includes(state.user?.role))return;
  const modal=document.querySelector('.modal');if(!modal||modal.querySelector('.avitoOrderBlock'))return;
  const block=document.createElement('section');block.className='card avitoOrderBlock';
  block.innerHTML='<div class="eyebrow">АВИТО</div>';
  if(o.avito_chat_id&&apiEnabled()){
    const button=document.createElement('button');button.className='primary wide';button.textContent='Открыть чат';button.onclick=()=>openAvitoChat(o.id);block.appendChild(button);
  }else{const note=document.createElement('p');note.className='muted';note.textContent='Чат будет доступен после подключения Авито API.';block.appendChild(note)}
  modal.appendChild(block);
}
// Bind after the existing management card and navigation wrappers have loaded.
window.addEventListener('load',()=>{
  const previous=window.openOrder;
  window.openOrder=function(id){const result=previous.apply(this,arguments);addOrderChat(id);return result};
  const notifications=window.openBosNotifications;
  if(typeof notifications==='function')window.openBosNotifications=function(){
    const result=notifications.apply(this,arguments),panel=document.querySelector('.bosNotifyPanel');
    if(apiEnabled()&&panel&&['owner','manager','dispatcher'].includes(state.user?.role)){
      const b=document.createElement('button');b.type='button';b.className='bosNotifyItem';b.textContent='Входящие Авито';b.onclick=()=>{panel.querySelector('.bosNotifyClose')?.click();openAvitoInbox()};panel.appendChild(b);
    }
    return result;
  };
});

function canUseAvitoNavigation(){
  if(typeof state==='undefined'||!state?.user)return false;
  if(typeof isMasterPreview==='function'&&isMasterPreview())return false;
  return ['owner','manager','dispatcher'].includes(String(state.user.role||''));
}
function syncAvitoNavigation(){
  const nav=document.querySelector('#app > nav');
  if(!nav)return;
  const existing=nav.querySelector('#bosAvitoNav');
  if(!apiEnabled()||!canUseAvitoNavigation()){existing?.remove();return}
  if(existing){existing.classList.toggle('active',state.page==='avito');if(state.page==='avito')existing.setAttribute('aria-current','page');else existing.removeAttribute('aria-current');return;}
  const orders=nav.querySelector('button[data-page="orders"]');
  if(!orders)return;
  // Existing role renderers index buttons; use a page link to preserve their labels.
  const entry=document.createElement('a');
  entry.id='bosAvitoNav';entry.href='#avito';entry.role='button';
  entry.textContent='Авито';entry.dataset.page='avito';
  entry.setAttribute('aria-controls','content');entry.classList.toggle('active',state.page==='avito');if(state.page==='avito')entry.setAttribute('aria-current','page');
  entry.addEventListener('click',event=>{
    event.preventDefault();
    if(apiEnabled()&&canUseAvitoNavigation())window.openAvitoInbox();
  });
  entry.addEventListener('keydown',event=>{
    if(event.key===' '){event.preventDefault();if(!event.repeat)entry.click()}
  });
  orders.insertAdjacentElement('afterend',entry);
}
let navigationQueued=false;
function queueAvitoNavigation(){
  if(navigationQueued)return;navigationQueued=true;
  queueMicrotask(()=>{navigationQueued=false;syncAvitoNavigation()});
}
const previousNavigationShow=window.show;
if(typeof previousNavigationShow==='function')window.show=function(){
  const result=previousNavigationShow.apply(this,arguments);queueAvitoNavigation();return result;
};
const navigationContent=document.getElementById('content');
if(navigationContent)new MutationObserver(queueAvitoNavigation).observe(navigationContent,{childList:true});
const navigationRoot=document.querySelector('#app > nav');
if(navigationRoot)new MutationObserver(queueAvitoNavigation).observe(navigationRoot,{childList:true});
queueAvitoNavigation();

const oldTools=window.openOwnerTools;window.openOwnerTools=function(){oldTools();setTimeout(()=>{const b=[...document.querySelectorAll('.ownerToolAction')].find(x=>x.textContent.includes('Авито'));if(!b)return;const right=b.querySelector('b');if(right&&!apiEnabled())right.textContent='Подготовка ›'},0)};
const st=document.createElement('style');st.textContent=`.avitoOrderBlock,.avitoSetupCard{border-color:rgba(36,145,255,.35)}.avitoOrderActions{display:flex;gap:8px;flex-wrap:wrap}.avitoUnread{background:#ff3b30;color:white;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:800;font-style:normal}.avitoLast{white-space:pre-wrap}.avitoBubble{max-width:86%;padding:10px 12px;border-radius:14px;margin:8px 0;background:rgba(255,255,255,.07)}.avitoBubble.out{margin-left:auto;background:rgba(36,145,255,.22)}.avitoBubble>div{white-space:pre-wrap;overflow-wrap:anywhere}.avitoBubble small{display:block;opacity:.6;margin-top:5px;font-size:11px}.avitoChatRow,.avitoOrderRow{display:flex!important;align-items:center;justify-content:space-between;text-align:left;margin:8px 0}.avitoChatRow span,.avitoOrderRow span{display:flex;flex-direction:column;min-width:0;gap:3px}.avitoChatRow small,.avitoOrderRow small{color:var(--muted,#9badc0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:min(65vw,520px)}.avitoDraftNotice{border-color:rgba(36,145,255,.35);margin-bottom:12px}.avitoRoadmap{margin-top:12px}
/* Avito is a full page; preserve the role-specific button indexing. */
#app > nav #bosAvitoNav{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:44px;min-height:48px;padding:7px 2px;border:1px solid rgba(22,131,255,.7);border-radius:10px;background:rgba(22,131,255,.06);color:var(--bos-text,#f5f8fc);font:inherit;font-size:11px;font-weight:650;line-height:1.25;text-decoration:none;white-space:nowrap;cursor:pointer;touch-action:manipulation}
#app > nav #bosAvitoNav::before{content:"";display:block;flex:none;width:22px;height:22px;background:radial-gradient(circle at 5px 5px,#a88958 0 4px,transparent 4.5px),radial-gradient(circle at 17px 5px,#00aaff 0 4px,transparent 4.5px),radial-gradient(circle at 5px 17px,#00d5b5 0 4px,transparent 4.5px),radial-gradient(circle at 17px 17px,#ff4053 0 4px,transparent 4.5px)}
#app > nav #bosAvitoNav:hover{background:rgba(22,131,255,.16)}
#app > nav #bosAvitoNav:focus-visible{outline:2px solid #8fc6ff;outline-offset:2px}
@media(max-width:1023px){
 #app > nav:has(> #bosAvitoNav){grid-template-columns:repeat(5,minmax(0,1fr))!important}
 #app > nav:has(> #bosAvitoNav) > button[data-action="profile"]{display:none!important}
 #app > nav #bosAvitoNav{min-height:58px}
}
@media(min-width:1024px){
 #app > nav #bosAvitoNav{flex:0 0 auto;flex-direction:row;justify-content:flex-start;gap:12px;width:100%;padding:12px;font-size:14px;font-weight:550;text-align:left}
}
#app > nav #bosAvitoNav.active{background:rgba(22,131,255,.2);border-color:#1683ff;color:#fff}
.avitoWorkspace{display:flex;flex-direction:column;gap:14px;min-width:0;height:calc(100dvh - 145px);min-height:600px;color:var(--bos-text,#f5f8fc)}
.avitoWorkspace *{box-sizing:border-box}
.avitoWorkspace [hidden]{display:none!important}
.avitoWorkspace .avitoPageHead{position:static;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:0;margin:0;border:0;background:none;box-shadow:none;min-height:0;width:auto}
.avitoPageHead h2{font-size:28px;margin:0 0 3px;line-height:1.2}.avitoPageHead p{font-size:14px;margin:0}
.avitoHeadActions{display:flex;align-items:center;gap:8px;flex-shrink:0}.avitoHeadActions button{margin:0;min-height:44px;padding:9px 12px}.avitoHeadActions [role=status]{font-size:13px}.avitoHeadActions .connected{color:#18c985}
.avitoFilters{display:flex;flex-wrap:wrap;gap:8px}.avitoFilters button{margin:0;padding:9px 13px;min-height:44px;border:1px solid #2b4055;background:#0d1a29;color:#a2b2c6;border-radius:10px;font-size:14px}.avitoFilters button.active{background:#0964d4;color:#fff;border-color:#1683ff}.avitoFilters span{margin-left:6px;font-variant-numeric:tabular-nums}
.avitoDesk{display:grid;grid-template-columns:260px minmax(260px,1fr) 270px;flex:1;min-height:0;border:1px solid #25384d;border-radius:14px;overflow:hidden;background:#0d1a29}
.avitoQueue{display:flex;flex-direction:column;min-height:0;min-width:0;border-right:1px solid #25384d}.avitoSearch{display:block;margin:12px}.avitoWorkspace input,.avitoWorkspace textarea{width:100%;min-width:0;border:1px solid #2b4055;border-radius:10px;background:#112235;color:#f5f8fc;font:inherit;font-size:15px;padding:11px 12px;line-height:1.4}.avitoWorkspace input::placeholder,.avitoWorkspace textarea::placeholder{color:#8da1b8}.avitoWorkspace input:focus,.avitoWorkspace textarea:focus{outline:2px solid #1683ff;outline-offset:1px}.avitoSearch input{font-size:14px;min-height:44px}
.avitoInbox{flex:1;min-height:0;overflow:auto}.avitoWorkspace .avitoChatRow{width:100%;display:flex!important;gap:10px;align-items:flex-start;justify-content:flex-start;margin:0;padding:14px 12px;border:0;border-bottom:1px solid #203246;border-radius:0;background:transparent;color:#f5f8fc;font:inherit;min-width:0;min-height:92px;text-align:left}.avitoWorkspace .avitoChatRow:hover{background:#14283c}.avitoWorkspace .avitoChatRow.selected{background:#12395f;box-shadow:inset 3px 0 #1683ff}.avitoAvatar{display:grid;place-items:center;width:38px;height:38px;flex-shrink:0;border-radius:50%;background:#275c89;color:#e2f1ff;font-size:19px;font-style:normal}.avitoWorkspace .avitoChatRow>span:first-of-type{flex:1;overflow:hidden}.avitoWorkspace .avitoChatRow b{font-size:15px;font-weight:650}.avitoWorkspace .avitoChatRow small{max-width:100%;font-size:12px}.avitoWorkspace .avitoRowMeta{flex:0 0 26px;align-items:flex-end;overflow:hidden}.avitoWorkspace .avitoRowMeta>small{display:none}.avitoChatRow em{font-size:11px;font-style:normal;color:#b9dcff;align-self:flex-start;padding:2px 5px;background:#1b354e;border-radius:5px}.avitoWorkspace .avitoUnread{padding:3px 7px;line-height:1.4;background:#1683ff}.avitoQueueFoot{padding:8px 12px}.avitoQueueFoot p{font-size:13px;margin:0 0 5px}.avitoQueueFoot small{display:block;font-size:11px}.avitoNoResults{padding:16px}.avitoEmpty{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;height:100%;padding:24px;color:#a2b2c6}.avitoEmpty b{color:#e2f1ff;font-size:18px}.avitoEmpty p{font-size:14px}
.avitoConversation{min-width:0;min-height:0}.avitoChatView{height:100%;display:flex;flex-direction:column;min-height:0}.avitoChatHead{display:flex;align-items:center;gap:10px;border-bottom:1px solid #25384d;padding:14px;min-width:0}.avitoChatHead>div{flex:1;min-width:0}.avitoChatHead h3{margin:0;font-size:17px;overflow-wrap:anywhere}.avitoChatHead small{display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.avitoChatHead>a{font-size:12px;color:#70b7ff}.avitoChatHead .avitoAvatar{width:36px;height:36px}.avitoHistory{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:14px}.avitoWorkspace .avitoBubble{max-width:88%;font-size:15px;line-height:1.5;padding:12px 14px;margin:10px 0;border-radius:12px;background:#203347}.avitoWorkspace .avitoBubble.out{background:#123f6c;margin-left:auto}.avitoWorkspace .avitoBubble small{font-size:11px}.avitoWorkspace #avitoHistoryStatus{padding:0 14px;margin:0;font-size:12px}.avitoWorkspace #avitoSendForm{padding:12px 14px;margin:0;border-top:1px solid #25384d}.avitoComposer{display:flex;align-items:flex-end;gap:8px}.avitoComposer textarea{resize:vertical;min-height:48px;max-height:120px}.avitoComposer button{flex:0 0 48px;min-height:48px;padding:10px;margin:0;font-size:21px}.avitoKeyboardHint{font-size:11px;display:block;margin-top:5px}.avitoWorkspace #avitoSendMsg{margin:5px 0 0;font-size:12px;overflow-wrap:anywhere}
.avitoLeadPane{min-width:0;min-height:0;border-left:1px solid #25384d;padding:16px;overflow:auto;overscroll-behavior:contain}.avitoLeadHead{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:15px}.avitoLeadHead h3{margin:0;font-size:18px}.avitoLeadHead .softChip{font-size:11px;padding:4px 7px}.avitoLeadPane form{display:grid;gap:12px}.avitoLeadPane label{display:grid;gap:5px;margin:0;font-size:13px;color:#a2b2c6;font-weight:400}.avitoLeadPane label>span{font-size:13px}.avitoLeadPane textarea{min-height:64px;resize:vertical}.avitoLeadPane .primary{min-height:46px;margin:3px 0 0;padding:10px}.avitoLeadPane form>small{font-size:11px;line-height:1.45}.avitoLeadPane [role=status]{font-size:13px;margin:0}.avitoExtraFields summary{cursor:pointer;font-size:13px;color:#a2b2c6;padding:6px 0;min-height:32px}.avitoExtraFields label{margin-top:8px}.avitoLinked{font-size:15px;overflow-wrap:anywhere;margin-bottom:20px}.avitoWorkspace .avitoBackList,.avitoWorkspace .avitoBackChat,.avitoWorkspace .avitoShowLead{display:none}
@media(min-width:1600px){.avitoDesk{grid-template-columns:300px minmax(300px,1fr) 300px}.avitoWorkspace .avitoRowMeta{flex-basis:52px}.avitoWorkspace .avitoRowMeta>small{display:block;font-size:10px}}
@media(min-width:768px) and (max-width:1259px){.avitoDesk{grid-template-columns:240px minmax(0,1fr)}.avitoLeadPane{display:none;border-left:0}.avitoWorkspace[data-pane=details] .avitoLeadPane{display:block}.avitoWorkspace[data-pane=details] .avitoConversation{display:none}.avitoWorkspace .avitoShowLead,.avitoWorkspace .avitoBackChat{display:inline-flex;min-height:44px}.avitoBackChat{margin-bottom:12px}.avitoChatHead{flex-wrap:wrap}.avitoChatHead>a{margin-left:auto}}
@media(max-width:1023px){.avitoWorkspace{height:calc(100dvh - 205px);min-height:550px}.avitoPageHead h2{font-size:24px}.avitoPageHead p{display:none}.avitoHeadActions [role=status]{font-size:11px}}
/* Mobile Avito: compact shell, a page-scrolling inbox, separate inline chat/details. */
@media(max-width:767px){
  #app:has(#content > .avitoWorkspace)>header{flex-wrap:nowrap;gap:6px;padding:10px 0;min-height:0;align-items:center}
  #app:has(#content > .avitoWorkspace)>header .brandWrap{flex:1 1 auto;gap:8px;min-width:0}
  #app:has(#content > .avitoWorkspace)>header .brandLogo{width:32px!important;height:32px!important;min-width:32px!important;border-radius:10px}
  #app:has(#content > .avitoWorkspace)>header .brandLogo img{width:32px!important;height:32px!important}
  #app:has(#content > .avitoWorkspace)>header .brandText h1{font-size:16px;line-height:1.2;letter-spacing:-.025em;overflow-wrap:normal}
  #app:has(#content > .avitoWorkspace)>header .brandSub{font-size:10px;line-height:1.35;margin-top:3px}
  #app:has(#content > .avitoWorkspace)>header .roleBadge{align-self:flex-start;width:auto;max-width:100%;font-size:10px;line-height:1.4;padding:2px 6px;margin-top:4px}
  #app:has(#content > .avitoWorkspace)>header button{flex:0 0 44px;width:44px;height:44px;min-width:44px;min-height:44px;padding:0;margin:0;border-radius:10px;font-size:18px}
  /* Installation stays on the login/other app tabs; don't squeeze four actions into this inbox header. */
  #app:has(#content > .avitoWorkspace)>header .bosInstallAppBtn--header{display:none}
  #app:has(#content > .avitoWorkspace)>header .brandText h1{white-space:normal;text-overflow:clip;overflow:visible}
  /* The conversation has its own back/client/actions header; avoid two headers above the keyboard. */
  #app:has(#content > .avitoWorkspace:not([data-pane=list]))>header{display:none}
  .avitoWorkspace:not([data-pane=list]) .avitoPageHead{display:none}
  .avitoWorkspace:not([data-pane=list]){padding-top:8px}
  #app:has(#content > .avitoWorkspace)>header #bosNotificationBell .bosNB{right:-2px;top:-4px}
  .avitoWorkspace{min-height:0!important;gap:12px;padding-top:12px}
  .avitoWorkspace .avitoPageHead{flex:0 0 auto;gap:8px}
  .avitoPageHead h2{font-size:26px;line-height:1.2;margin:0}
  .avitoHeadActions{gap:6px}
  .avitoHeadActions button{font-size:13px;padding:8px 12px;min-height:44px;border-radius:12px}
  .avitoHeadActions #avitoRefresh{width:44px;min-width:44px;padding:0;font-size:22px}
  .avitoHeadActions [role=status]{display:none}
  .avitoFilters{flex:0 0 auto;display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.4fr) minmax(0,1.1fr);gap:6px}
  .avitoFilters button{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:2px 5px;min-width:0;min-height:44px;padding:8px 5px;margin:0;font-size:12px;font-weight:500;white-space:normal;overflow-wrap:normal;word-break:normal;border-radius:12px}
  .avitoFilters span{margin:0;white-space:nowrap}
  .avitoDesk{display:flex;flex-direction:column;min-width:0}
  .avitoQueue{flex:1;border:0}
  .avitoConversation,.avitoLeadPane{display:none;flex:1;border:0;min-height:0}
  .avitoWorkspace[data-pane=chat] .avitoQueue,.avitoWorkspace[data-pane=details] .avitoQueue{display:none}
  .avitoWorkspace[data-pane=chat] .avitoConversation{display:block}
  .avitoWorkspace[data-pane=details] .avitoLeadPane{display:flex}
  .avitoWorkspace:not([data-pane=list]) .avitoFilters{display:none}
  .avitoWorkspace[data-pane=list]{height:auto!important;padding-bottom:calc(var(--avito-nav-height,80px) + 12px)}
  .avitoWorkspace[data-pane=list] .avitoDesk{flex:none;overflow:visible;border:0;background:none;border-radius:0}
  .avitoWorkspace[data-pane=list] .avitoQueue{flex:none;overflow:visible;background:none}
  .avitoWorkspace[data-pane=list] .avitoInbox{flex:none;display:flex;flex-direction:column;gap:8px;overflow:visible}
  .avitoSearch{position:relative;margin:0 0 12px}
  .avitoSearch::before{content:'';position:absolute;top:14px;left:14px;width:12px;height:12px;border:2px solid #8da1b8;border-radius:50%;pointer-events:none}
  .avitoSearch::after{content:'';position:absolute;top:29px;left:27px;width:7px;height:2px;transform:rotate(45deg);background:#8da1b8;pointer-events:none}
  .avitoSearch input{min-height:48px;padding-left:40px;border-radius:12px}
  .avitoWorkspace .avitoChatRow{display:grid!important;grid-template-columns:40px minmax(0,1fr) auto;align-items:start;column-gap:10px;row-gap:4px;min-height:96px;margin:0;padding:12px;border:1px solid #25384d;border-radius:12px;background:#0d1a29;overflow:hidden}
  .avitoWorkspace .avitoChatRow.selected{background:#18395b;border-color:#397fc8;box-shadow:inset 3px 0 #1683ff}
  .avitoChatRow>.avitoAvatar{grid-column:1;grid-row:1/4;align-self:start;width:40px;height:40px;margin-top:1px}
  .avitoWorkspace .avitoChatRow>span.avitoChatBody{display:contents;overflow:visible}
  .avitoChatName{grid-column:2;grid-row:1;min-width:0;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;line-height:1.4}
  .avitoChatService{grid-column:2/-1;grid-row:2;line-height:1.45}
  .avitoChatPreview{grid-column:2/-1;grid-row:3;line-height:1.45;padding-right:14px}
  .avitoChatRow em{grid-column:2/-1;grid-row:4;justify-self:start;max-width:100%;overflow-wrap:anywhere;margin-top:2px}
  .avitoWorkspace .avitoChatRow>.avitoRowMeta{grid-column:3;grid-row:1;display:flex;flex-direction:row;align-items:center;gap:4px;overflow:visible;max-width:none}
  .avitoWorkspace .avitoRowMeta>small{display:block;overflow:visible;text-overflow:clip;max-width:none;font-size:10px;line-height:2;white-space:nowrap;font-variant-numeric:tabular-nums;letter-spacing:0}
  .avitoWorkspace .avitoUnread{font-size:10px;padding:2px 5px;min-width:18px;text-align:center}
  .avitoWorkspace .avitoChatRow::after{content:'›';grid-column:3;grid-row:3;justify-self:end;align-self:center;font-size:20px;line-height:16px;color:#8da1b8}
  .avitoWorkspace .avitoChatRow:focus-visible{outline:2px solid #8fc6ff;outline-offset:2px}
  .avitoQueueFoot{padding:12px 0 0;flex:none}
  .avitoQueueFoot small{font-size:11px;line-height:1.5}
  .avitoQueueFoot #avitoMoreChats{min-height:46px;margin-top:8px;border-radius:12px;font-size:14px;font-weight:600}
  .avitoWorkspace .avitoBackList,.avitoWorkspace .avitoBackChat,.avitoWorkspace .avitoShowLead{display:inline-flex;align-items:center;min-height:44px;font-size:12px;padding:8px;margin:0}
  .avitoWorkspace .avitoBackChat{margin-bottom:12px}
  .avitoChatHead{padding:8px;gap:8px;flex-wrap:wrap;flex-shrink:0}
  .avitoChatHead .avitoAvatar{display:none}
  .avitoChatHead>div{flex:1 1 90px}
  .avitoChatHead>a{margin-left:auto}
  .avitoChatHead h3{font-size:16px}
  .avitoHistory{padding:10px}
  .avitoWorkspace .avitoBubble{font-size:15px;padding:10px 12px;max-width:93%}
  .avitoWorkspace #avitoSendForm{padding:9px;flex-shrink:0}
  .avitoKeyboardHint{display:none}
  .avitoLeadPane{padding:12px}
  .avitoWorkspace input,.avitoWorkspace textarea{font-size:16px}
}
@media(max-width:359px){
  #app:has(#content > .avitoWorkspace)>header .brandLogo{display:none}
  #app:has(#content > .avitoWorkspace)>header .brandText h1{font-size:15px}
}
.avitoQueue>#avitoInboxStatus{margin:8px 12px;font-size:13px;line-height:1.4;overflow-wrap:anywhere}
.avitoQueue>#avitoInboxStatus:empty{display:none}

@media(min-width:768px){.avitoWorkspace{min-height:350px!important}}.avitoWorkspace .sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.avitoLeadPane{display:flex;flex-direction:column;overflow:hidden}.avitoLeadPane form{display:flex;flex-direction:column;flex:1;min-height:0;gap:10px}.avitoLeadFields{display:grid;gap:12px;flex:1;min-height:0;overflow:auto;align-content:start;padding:3px 3px 10px}.avitoLeadHead{flex-shrink:0}.avitoLeadPane #avitoToOrder{flex-shrink:0}.avitoLeadPane form>small,.avitoLeadPane [role=status]{flex-shrink:0}
#app:has(#content > .avitoWorkspace){padding-bottom:12px!important}
@media(max-width:1259px){.avitoLeadPane{display:none}.avitoWorkspace[data-pane=details] .avitoLeadPane{display:flex}}
.avitoWorkspace .avitoImageButton{display:block;width:min(320px,100%);max-width:100%;padding:0;margin:0 0 6px;border:1px solid #45627d;border-radius:10px;overflow:hidden;background:#0b1927;color:#d5e9ff;text-align:left;cursor:zoom-in}.avitoImageButton img{display:block;width:100%;height:200px;object-fit:contain;background:#08131f}.avitoImageButton img[hidden]{display:none}.avitoPhotoLabel{display:block;padding:8px 10px;font-size:12px}.avitoImageButton:focus-visible{outline:2px solid #8fc6ff;outline-offset:2px}.avitoImageFailed{min-height:100px}
#modalRoot .modal.avitoImageModal{width:min(1100px,96vw);max-width:96vw;max-height:calc(100dvh - 24px);overflow:auto;padding:20px;border-radius:14px}.avitoImageModal h2{padding-right:36px;margin:0 0 14px;font-size:20px}.avitoFullImage{display:flex;justify-content:center;align-items:center;min-height:100px;background:#08131f;border-radius:8px;overflow:hidden}.avitoFullImage img{display:block;max-width:100%;max-height:calc(100dvh - 190px);object-fit:contain}.avitoFullImage img[hidden]{display:none}.avitoImageOriginal{display:inline-flex;align-items:center;min-height:44px;color:#8fc6ff}.avitoImageStatus{margin:8px 0;font-size:14px}.avitoImageStatus:empty{display:none}
`;document.head.appendChild(st);
})();
