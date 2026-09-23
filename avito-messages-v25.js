(()=>{
'use strict';
const DEFAULT_API='https://business-os-api-gateway.netlify.app/api/proxy/avito-api';
const contract={status:'status',connect:'connect',disconnect:'disconnect',sync:'sync',chats:'chats',messages:'messages',sendMessage:'sendMessage',read:'read'};
window.BOS_AVITO_CONTRACT=Object.freeze({...contract});
function apiEnabled(){return window.BUSINESS_OS_CONFIG?.AVITO_API_ENABLED===true}
function apiUrl(){return window.BUSINESS_OS_CONFIG?.AVITO_API_URL||DEFAULT_API}
async function avitoCall(action,data={}){
  if(!apiEnabled())throw new Error('Авито API пока не подключён');
  const h=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};h['Content-Type']='application/json';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
  try{
    const r=await fetch(apiUrl(),{method:'POST',headers:h,body:JSON.stringify({action,...data}),signal:controller.signal});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok){
      const fallback=r.status===401?'Войдите в Business OS повторно':r.status===403?'Недостаточно прав для работы с Авито':r.status===429?'Слишком много запросов. Подождите перед повтором.':'Авито временно недоступен. Повторите позже.';
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
  observer.observe(document.getElementById('modalRoot'),{childList:true,subtree:true});
  const tick=async()=>{
    if(stopped||!root.isConnected)return;
    if(!document.hidden){try{await refresh();delay=30000}catch(e){delay=Math.min(300000,Math.max(delay*2,(e.retryAfter||0)*1000));if(e.status===401||e.status===403){observer.disconnect();return}}}
    if(!stopped&&root.isConnected)timer=setTimeout(tick,delay);
  };
  timer=setTimeout(tick,delay);
}
const avitoOrder=o=>String(o?.external_source||'').toLowerCase()==='avito'||['авито','avito'].includes(String(o?.source||'').toLowerCase());
const avitoOrders=()=>Array.from(state.orders||[]).filter(avitoOrder);
function time(v){if(!v)return'';try{return new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}catch(_){return''}}
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
        try{const result=await avitoCall(action);if(!m.isConnected)return;if(action==='sync'){msg.textContent=`Обновлено заявок: ${result.updated||0}.`;await reloadData(true)}else openAvitoSettings()}
        catch(e){if(m.isConnected)msg.textContent=e.message}finally{button.disabled=false}
      };
    }
  }catch(e){if(m.isConnected)m.innerHTML=`<button class="modalClose" onclick="closeModal()">×</button><h2>Авито</h2><p>${esc(e.message)}</p><button class="secondary wide" onclick="openAvitoSettings()">Повторить</button>`}
};
function renderChats(chats){
  return (chats||[]).map(c=>`<button class="secondary wide avitoChatRow" data-chat-id="${esc(c.id||c.chat_id)}"><span><b>${esc(c.client||c.name||'Клиент')}</b><small>${esc(c.item_title||'Авито')} · ${esc(time(c.last_message_at))}</small><small>${esc(c.last_message||'Нет текстовых сообщений')}</small></span>${Number(c.unread_count||0)>0?`<i class="avitoUnread">${Number(c.unread_count)}</i>`:'<b>›</b>'}</button>`).join('')||'<p class="muted">Диалогов пока нет.</p>';
}
window.openAvitoInbox=async function(){
  if(!apiEnabled()){openModal(`<button class="modalClose" onclick="closeModal()">×</button><h2>Входящие Авито</h2>${apiOffCard()}<button class="primary wide" onclick="openAvitoManualLead()">+ Добавить обращение вручную</button>${renderExistingOrders()}`);return}
  openModal('<button class="modalClose" onclick="closeModal()">×</button><h2>Входящие Авито <span id="avitoUnreadTotal"></span></h2><section class="card avitoInbox">Загружаем чаты…</section><p id="avitoInboxStatus" role="status" class="muted"></p><button id="avitoRefresh" class="secondary wide">Обновить</button><button id="avitoMoreChats" class="secondary wide" hidden>Ещё диалоги</button><button class="secondary wide" onclick="openAvitoManualLead()">+ Добавить вручную</button>');
  const root=document.querySelector('.modal'),list=root.querySelector('.avitoInbox'),status=root.querySelector('#avitoInboxStatus'),more=root.querySelector('#avitoMoreChats');
  let busy=false,next=null,rows=[];
  async function refresh(append=false){
    if(busy)return;busy=true;more.disabled=true;
    try{
      const d=await avitoCall(contract.chats,{offset:append?next||0:0});if(!root.isConnected)return;
      rows=append?[...rows,...d.chats]:d.chats||[];rows=[...new Map(rows.map(c=>[String(c.id),c])).values()];next=d.next_offset;
      window.__BOS_AVITO_CHATS__=rows;list.innerHTML=renderChats(rows);status.textContent='';
      root.querySelector('#avitoUnreadTotal').textContent=rows.some(c=>c.unread_count)?`(${rows.reduce((n,c)=>n+Number(c.unread_count||0),0)} непрочитанных в загруженных диалогах)`:'';
      list.querySelectorAll('[data-chat-id]').forEach(button=>button.onclick=()=>openAvitoLead(button.dataset.chatId));more.hidden=next==null;
    }catch(e){if(root.isConnected){status.textContent=e.message;if(!rows.length)list.textContent='Не удалось загрузить диалоги.'}throw e}
    finally{busy=false;more.disabled=false}
  }
  root.querySelector('#avitoRefresh').onclick=()=>refresh().catch(()=>{});more.onclick=()=>refresh(true).catch(()=>{});
  await refresh().catch(()=>{});if(root.isConnected)pollView(root,()=>refresh());
};
window.openAvitoManualLead=function(){openModal(`<button class="modalClose" onclick="closeModal()">×</button><h2>Обращение из Авито</h2><p class="muted">Пока API не подключён, перенесите данные клиента вручную. После подключения этот шаг будет заполняться автоматически из чата.</p><form id="avitoManualForm" class="form"><input name="client" placeholder="Клиент" required><input name="phone" placeholder="Телефон"><input name="address" placeholder="Адрес" required><input name="work" placeholder="Работа / услуга" required><input name="item_url" placeholder="Ссылка на объявление"><textarea name="message" rows="4" placeholder="Сообщение клиента / комментарий"></textarea><button class="primary wide" type="submit">Перенести в заявку</button></form>`);document.getElementById('avitoManualForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget,d=Object.fromEntries(new FormData(f));prefillOrder(d)}};
function prefillOrder(d={}){const existing=d.chat_id&&(state.orders||[]).find(o=>String(o.avito_chat_id)===String(d.chat_id));if(existing){openOrder(existing.id);return}openOrderForm();const f=document.getElementById('orderForm');if(!f)return;for(const k of ['client','address'])if(f.elements[k]&&d[k]!=null)f.elements[k].value=d[k];if(d.phone){const p=f.elements.phone||document.getElementById('bosPhone');if(p){if(p.id==='bosPhone'){let digits=String(d.phone).replace(/\D/g,'');if(digits[0]==='7'||digits[0]==='8')digits=digits.slice(1);p.value=digits.slice(0,10);p.dispatchEvent(new Event('input',{bubbles:true}))}else p.value=d.phone}}let workMatched=false;const work=f.elements.work||document.getElementById('bosService');if(work&&d.work!=null){if(work.tagName==='SELECT'){const wanted=String(d.work).trim().toLowerCase(),option=[...work.options].find(x=>{const label=String(x.textContent||'').split(' — ')[0].trim().toLowerCase();return String(x.value).trim().toLowerCase()===wanted||label===wanted});if(option){work.value=option.value;work.dispatchEvent(new Event('change',{bubbles:true}));workMatched=true}}else{work.value=d.work;workMatched=true}}let source=f.elements.source;if(!source){source=document.createElement('input');source.type='hidden';source.name='source';f.appendChild(source)}if(source.tagName==='SELECT'){let o=[...source.options].find(x=>String(x.value).toLowerCase()==='авито');if(!o){o=new Option('Авито','Авито');source.add(o)}source.value='Авито'}else source.value='Авито';for(const [name,value] of Object.entries({avito_chat_id:d.chat_id,avito_item_id:d.item_id,avito_item_url:d.item_url,city:d.city})){if(!value)continue;let input=f.elements[name];if(!input){input=document.createElement('input');input.type='hidden';input.name=name;f.appendChild(input)}input.value=value}const notes=['Источник: Авито'];if(d.chat_id)notes.push('Диалог Авито: '+d.chat_id);if(d.client_id)notes.push('ID клиента Авито: '+d.client_id);if(d.work)notes.push(`Работа из Авито: ${d.work}${workMatched?'':' (выберите услугу из каталога)'}`);if(d.item_url)notes.push(`Объявление: ${d.item_url}`);if(d.message)notes.push(`Сообщение клиента: ${d.message}`);if(f.elements.comment)f.elements.comment.value=notes.join('\n');const notice=document.createElement('section');notice.className='card avitoDraftNotice';notice.innerHTML='<div class="eyebrow">АВИТО</div><b>Заявка подготовлена из обращения</b><p class="muted">Проверьте данные и сохраните обычной кнопкой. До сохранения ничего не меняется в базе.</p>';f.parentNode.insertBefore(notice,f)}
window.openAvitoLead=async function(id){
  if(!apiEnabled()){openAvitoSettings();return}
  const chat=(window.__BOS_AVITO_CHATS__||[]).find(x=>String(x.id||x.chat_id)===String(id))||{};
  openModal(`<button class="modalClose" onclick="closeModal()">×</button><h2>${esc(chat.client||chat.name||'Чат Авито')}</h2><p class="muted">${esc(chat.item_title||'')} · ${esc(chat.client_id||'')}</p><button class="secondary" onclick="openAvitoInbox()">К диалогам</button><button id="avitoRefresh" class="secondary">Обновить</button><button id="avitoOlder" class="secondary" hidden>Ранее</button><div id="avitoMessages" aria-live="polite">Загружаем сообщения…</div><p id="avitoHistoryStatus" role="status" class="muted"></p><button class="primary wide" id="avitoToOrder">Создать заявку</button><form id="avitoSendForm" class="form"><textarea name="text" maxlength="1000" rows="3" placeholder="Сообщение клиенту" required></textarea><button class="secondary wide" type="submit">Отправить в Авито</button><p id="avitoSendMsg" role="status" class="muted"></p></form>`);
  const root=document.querySelector('.modal'),messages=root.querySelector('#avitoMessages'),status=root.querySelector('#avitoHistoryStatus'),older=root.querySelector('#avitoOlder');
  let loading=false,sending=false,next=null,history=[],olderLoaded=false;
  const linked=(state.orders||[]).find(o=>String(o.avito_chat_id)===String(id));
  root.querySelector('#avitoToOrder').textContent=linked?'Открыть заявку':'Создать заявку';
  root.querySelector('#avitoToOrder').onclick=()=>prefillOrder({chat_id:id,client_id:chat.client_id,client:chat.client||chat.name||'',phone:chat.phone||'',address:chat.address||'',work:chat.work||chat.item_title||'',item_id:chat.item_id,item_url:chat.item_url||'',city:chat.city,message:history.filter(x=>x.direction==='in'&&x.text).map(x=>x.text).join('\n')||chat.last_message||''});
  async function refresh(append=false){
    if(loading)return false;loading=true;older.disabled=true;
    try{
      const d=await avitoCall(contract.messages,{chat_id:id,offset:append?next||0:0});if(!root.isConnected)return false;
      history=[...history,...(d.messages||[])];
      history=[...new Map(history.map(x=>[x.id,x])).values()].sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')));
      messages.innerHTML=history.map(x=>`<div class="avitoBubble ${x.direction==='out'?'out':'in'}"><div>${esc(x.text||'['+(x.type||'Вложение')+']')}</div><small>${esc(time(x.created_at))}</small></div>`).join('')||'<p class="muted">Сообщений пока нет.</p>';
      if(append||!olderLoaded)next=d.next_offset;if(append)olderLoaded=true;older.hidden=next==null;status.textContent='';
      try{await avitoCall(contract.read,{chat_id:id});chat.unread_count=0}catch(e){if(root.isConnected)status.textContent='История загружена. '+e.message;if(e.status===429||e.status===401||e.status===403)throw e}
      return true;
    }catch(e){if(root.isConnected)status.textContent=e.message;throw e}finally{loading=false;older.disabled=false}
  }
  root.querySelector('#avitoRefresh').onclick=()=>refresh().catch(()=>{});older.onclick=()=>refresh(true).catch(()=>{});
  const form=root.querySelector('#avitoSendForm'),msg=root.querySelector('#avitoSendMsg'),button=form.querySelector('button');
  form.onsubmit=async e=>{
    e.preventDefault();if(sending)return;
    const value=form.elements.text.value.trim();if(!value)return;
    sending=true;button.disabled=true;
    try{
    const uncertain=uncertainSends.get(String(id));
    if(uncertain===value){
      const checked=await refresh().catch(()=>false);if(!checked||!root.isConnected)return;
      if(!confirm('Проверьте историю: прошлое сообщение могло быть доставлено. Всё равно отправить ещё раз?'))return;
    }
    msg.textContent='Отправляем…';
      await avitoCall(contract.sendMessage,{chat_id:id,text:value});uncertainSends.delete(String(id));
      if(!root.isConnected)return;
      if(form.elements.text.value.trim()===value)form.reset();msg.textContent='Отправлено';
      await refresh().catch(()=>{});
    }catch(err){uncertainSends.set(String(id),value);if(root.isConnected)msg.textContent=err.message+' Перед повторной отправкой проверьте историю.'}
    finally{sending=false;button.disabled=false}
  };
  await refresh().catch(()=>{});if(root.isConnected)pollView(root,()=>sending?Promise.resolve():refresh());
};
const uncertainSends=new Map();
window.openAvitoChat=async function(id){const o=(state.orders||[]).find(x=>String(x.id)===String(id));if(!o||!o.avito_chat_id)return;if(!apiEnabled()){openModal(`<h2>Чат Авито</h2>${apiOffCard()}<button class="secondary wide" onclick="openAvitoSettings()">К настройкам Авито</button>`);return}window.__BOS_AVITO_CHATS__=[{id:o.avito_chat_id,client:o.client,phone:o.phone,address:o.address,work:o.work,item_url:o.avito_item_url}];return openAvitoLead(o.avito_chat_id)};
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
const oldTools=window.openOwnerTools;window.openOwnerTools=function(){oldTools();setTimeout(()=>{const b=[...document.querySelectorAll('.ownerToolAction')].find(x=>x.textContent.includes('Авито'));if(!b)return;const right=b.querySelector('b');if(right&&!apiEnabled())right.textContent='Подготовка ›'},0)};
const st=document.createElement('style');st.textContent=`.avitoOrderBlock,.avitoSetupCard{border-color:rgba(36,145,255,.35)}.avitoOrderActions{display:flex;gap:8px;flex-wrap:wrap}.avitoUnread{background:#ff3b30;color:white;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:800;font-style:normal}.avitoLast{white-space:pre-wrap}.avitoBubble{max-width:86%;padding:10px 12px;border-radius:14px;margin:8px 0;background:rgba(255,255,255,.07)}.avitoBubble.out{margin-left:auto;background:rgba(36,145,255,.22)}.avitoBubble>div{white-space:pre-wrap;overflow-wrap:anywhere}.avitoBubble small{display:block;opacity:.6;margin-top:5px;font-size:11px}.avitoChatRow,.avitoOrderRow{display:flex!important;align-items:center;justify-content:space-between;text-align:left;margin:8px 0}.avitoChatRow span,.avitoOrderRow span{display:flex;flex-direction:column;min-width:0;gap:3px}.avitoChatRow small,.avitoOrderRow small{color:var(--muted,#9badc0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:min(65vw,520px)}.avitoDraftNotice{border-color:rgba(36,145,255,.35);margin-bottom:12px}.avitoRoadmap{margin-top:12px}`;document.head.appendChild(st);
})();