(()=>{
'use strict';
const DESKTOP_MIN=1050;
let ddFilter='active';
let ddSearch='';
let ddMaster='';
let ddSelected='';
let ddLastDesktop=window.innerWidth>=DESKTOP_MIN;

function ddMode(){return (typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state.user?.role||'')==='dispatcher'}
function ddDesktop(){return window.innerWidth>=DESKTOP_MIN}
function ddOrders(){return Array.isArray(state.orders)?state.orders:[]}
function ddStatus(o){return String(o?.status||'')}
function ddDone(o){return ddStatus(o)==='Выполнена'}
function ddCancelled(o){return ddStatus(o)==='Отменена'}
function ddActive(o){return !ddDone(o)&&!ddCancelled(o)}
function ddToday(){return new Date().toISOString().slice(0,10)}
function ddDate(o){return String(o?.scheduled_date||'').slice(0,10)}
function ddTime(o){return String(o?.scheduled_time||o?.time_slot||'').slice(0,5)}
function ddUnassigned(o){return ddActive(o)&&!o.master_name&&!o.master_vk_id&&!o.master_id&&!o.master_staff_id}
function ddOverdue(o){return ddActive(o)&&!!ddDate(o)&&ddDate(o)<ddToday()}
function ddReschedule(o){return !!o?.reschedule_requested}
function ddSource(o){return String(o?.source||o?.lead_source||'').trim()}
function ddNo(o){const ext=String(o?.external_id||'');return ext.startsWith('hands:')?ext.slice(6):String(o?.id||'')}
function ddEsc(v){return typeof esc==='function'?esc(v):String(v??'')}
function ddMoney(v){return typeof money==='function'?money(v):Number(v||0).toLocaleString('ru-RU')+' ₽'}
function ddPhoneHref(phone){let p=String(phone||'').trim().replace(/[^\d+]/g,'');if(/^8\d{10}$/.test(p))p='+7'+p.slice(1);else if(/^\d{10}$/.test(p))p='+7'+p;return p}
function ddMasterKey(m){return String(m?.vk_user_id||m?.id||m?.staff_id||m?.master_staff_id||'')}
function ddOrderMasterKey(o){return String(o?.master_vk_id||o?.master_id||o?.master_staff_id||'')}
function ddMasterMatches(m,o){const mk=ddMasterKey(m),ok=ddOrderMasterKey(o);return (mk&&ok&&mk===ok)||String(m?.full_name||'')===String(o?.master_name||'')}

function ddMatchFilter(o){
  if(ddFilter==='all')return true;
  if(ddFilter==='active')return ddActive(o);
  if(ddFilter==='today')return ddActive(o)&&ddDate(o)===ddToday();
  if(ddFilter==='unassigned')return ddUnassigned(o);
  if(ddFilter==='overdue')return ddOverdue(o);
  if(ddFilter==='reschedule')return ddReschedule(o);
  if(ddFilter==='done')return ddDone(o);
  return true;
}
function ddFiltered(){
  const q=ddSearch.trim().toLowerCase();
  return ddOrders().filter(ddMatchFilter).filter(o=>!ddMaster||String(o.master_name||'')===ddMaster).filter(o=>{
    if(!q)return true;
    return [o.id,o.external_id,o.client,o.phone,o.address,o.work,o.master_name,o.status,ddSource(o),o.reschedule_reason].join(' ').toLowerCase().includes(q);
  }).sort((a,b)=>{
    const ar=ddReschedule(a)?0:1,br=ddReschedule(b)?0:1;if(ar!==br)return ar-br;
    const ao=ddOverdue(a)?0:1,bo=ddOverdue(b)?0:1;if(ao!==bo)return ao-bo;
    const ad=ddDate(a)||'9999-99-99',bd=ddDate(b)||'9999-99-99';if(ad!==bd)return ad.localeCompare(bd);
    return (ddTime(a)||'99:99').localeCompare(ddTime(b)||'99:99');
  });
}
function ddCount(type){const old=ddFilter;ddFilter=type;const n=ddOrders().filter(ddMatchFilter).length;ddFilter=old;return n}
function ddEnsureSelected(list){
  if(list.some(o=>String(o.id)===String(ddSelected)))return;
  ddSelected=list[0]?String(list[0].id):'';
}
function ddGetSelected(){return ddOrders().find(o=>String(o.id)===String(ddSelected))||null}

function ddFlagHtml(o){
  const flags=[];
  if(ddReschedule(o))flags.push('<span class="ddFlag ddFlagWarn">Нужно перенести</span>');
  if(ddOverdue(o))flags.push('<span class="ddFlag ddFlagDanger">Просрочено</span>');
  if(ddUnassigned(o))flags.push('<span class="ddFlag">Без мастера</span>');
  return flags.join('');
}
function ddQueueCard(o){
  const selected=String(o.id)===String(ddSelected)?' isSelected':'';
  const when=ddDate(o)?`${ddEsc(ddDate(o))}${ddTime(o)?` · ${ddEsc(ddTime(o))}`:''}`:'Без даты';
  return `<button class="ddQueueCard${selected}" onclick="selectDispatcherDesktopOrder('${ddEsc(o.id)}')"><div class="ddQueueTop"><b>№ ${ddEsc(ddNo(o))}</b><span>${when}</span></div><div class="ddQueueClient"><strong>${ddEsc(o.client||'Клиент не указан')}</strong><b>${ddMoney(o.amount||0)}</b></div><div class="ddQueueWork">${ddEsc(o.work||'Работа не указана')}</div><div class="ddQueueAddress">${ddEsc(o.address||'Адрес не указан')}</div><div class="ddQueueBottom"><span>${ddEsc(o.master_name||'Мастер не назначен')}</span><div>${ddFlagHtml(o)}</div></div></button>`;
}
function ddMasterOptions(o){return `<option value="">Не назначен</option>${(state.masters||[]).map(m=>{const v=ddMasterKey(m);const selected=(v&&v===ddOrderMasterKey(o))||(!ddOrderMasterKey(o)&&String(o.master_name||'')===String(m.full_name||''));return `<option value="${ddEsc(v)}" ${selected?'selected':''}>${ddEsc(m.full_name||'Мастер')}</option>`}).join('')}`}
function ddStatusOptions(o){const items=['В работе','Выполнена','Отменена'];return items.map(s=>`<option ${ddStatus(o)===s?'selected':''}>${s}</option>`).join('')}
function ddDetail(o){
  if(!o)return `<section class="ddEmpty"><div><strong>Выберите заявку</strong><span>Слева находится очередь заявок диспетчера.</span></div></section>`;
  const phone=String(o.phone||'').trim(),href=ddPhoneHref(phone),reason=String(o.reschedule_reason||'').trim();
  const scheduled=ddDate(o)?`${ddEsc(ddDate(o))}${ddTime(o)?` · ${ddEsc(ddTime(o))}`:''}`:'Дата не назначена';
  const source=ddSource(o);
  return `<section class="ddDetail"><div class="ddDetailHead"><div><div class="ddEyebrow">ЗАЯВКА № ${ddEsc(ddNo(o))}</div><h2>${ddEsc(o.client||'Клиент')}</h2><div class="ddFlags">${ddFlagHtml(o)}</div></div><div class="ddAmount">${ddMoney(o.amount||0)}</div></div>${ddReschedule(o)?`<div class="ddAlert"><b>Мастер просит перенести заявку</b><span>${ddEsc(reason||'Причина не указана')}</span></div>`:''}<div class="ddInfoGrid"><div><span>Телефон</span><b>${ddEsc(phone||'Не указан')}</b>${href?`<a class="ddInlineAction" href="tel:${ddEsc(href)}">Позвонить</a>`:''}</div><div><span>Дата и время</span><b>${scheduled}</b></div><div class="ddWide"><span>Адрес</span><b>${ddEsc(o.address||'Не указан')}</b></div><div class="ddWide"><span>Работа</span><b>${ddEsc(o.work||'Не указана')}</b></div>${source?`<div><span>Источник</span><b>${ddEsc(source)}</b></div>`:''}<div><span>Текущий мастер</span><b>${ddEsc(o.master_name||'Не назначен')}</b></div></div><div class="ddQuickEdit"><label><span>Статус</span><select id="quickStatus">${ddStatusOptions(o)}</select></label><label><span>Мастер</span><select id="quickMaster">${ddMasterOptions(o)}</select></label><button class="primary" onclick="saveDispatcherDesktopQuick('${ddEsc(o.id)}')">Сохранить</button></div><div class="ddDetailActions"><button class="secondary" onclick="openOrderForm('${ddEsc(o.id)}')">Редактировать заявку</button>${href?`<a class="secondary ddButtonLink" href="tel:${ddEsc(href)}">Позвонить клиенту</a>`:''}</div><p id="ddQuickMsg" class="muted"></p></section>`;
}
function ddMasterLoad(){
  const active=ddOrders().filter(ddActive),today=ddToday();
  const masters=(state.masters||[]).map(m=>{
    const assigned=active.filter(o=>ddMasterMatches(m,o));
    const todayCount=assigned.filter(o=>ddDate(o)===today).length;
    return {m,count:assigned.length,todayCount};
  }).sort((a,b)=>b.todayCount-a.todayCount||b.count-a.count||String(a.m.full_name||'').localeCompare(String(b.m.full_name||''),'ru'));
  return `<aside class="ddMasters"><div class="ddPanelTitle"><div><b>Мастера сегодня</b><span>${masters.length} в списке</span></div><button class="secondary ddTiny" onclick="show('dispatch')">График</button></div><div class="ddMasterList">${masters.map(x=>`<button onclick="setDispatcherDesktopMaster('${ddEsc(String(x.m.full_name||''))}')"><span><b>${ddEsc(x.m.full_name||'Мастер')}</b><small>Активных: ${x.count}</small></span><strong>${x.todayCount}</strong></button>`).join('')||'<p class="muted">Мастеров пока нет.</p>'}</div></aside>`;
}
function ddMetric(v,label,n,accent='') {return `<button class="ddMetric ${ddFilter===v?'isActive':''} ${accent}" onclick="setDispatcherDesktopFilter('${v}')"><span>${label}</span><strong>${n}</strong></button>`}
function ddRender(){
  const list=ddFiltered();ddEnsureSelected(list);const selected=ddGetSelected();
  return `<div class="ddDesktop"><div class="ddTop"><div><div class="ddEyebrow">ДИСПЕТЧЕРСКАЯ</div><h2>Рабочий стол</h2><span>Все заявки и мастера на одном экране</span></div><button class="primary" onclick="openOrderForm()">+ Новая заявка</button></div><div class="ddMetrics">${ddMetric('active','Активные',ddCount('active'))}${ddMetric('today','Сегодня',ddCount('today'))}${ddMetric('unassigned','Без мастера',ddCount('unassigned'),'ddMetricWarn')}${ddMetric('overdue','Просрочено',ddCount('overdue'),'ddMetricDanger')}${ddMetric('reschedule','Нужно перенести',ddCount('reschedule'),'ddMetricWarn')}${ddMetric('all','Все',ddCount('all'))}</div><div class="ddToolbar"><div class="ddSearchWrap"><span>⌕</span><input id="ddSearch" value="${ddEsc(ddSearch)}" placeholder="Поиск по номеру, клиенту, телефону, адресу, работе" oninput="setDispatcherDesktopSearch(this.value)"></div><select id="ddMasterFilter" onchange="setDispatcherDesktopMaster(this.value)"><option value="">Все мастера</option>${(state.masters||[]).map(m=>`<option value="${ddEsc(m.full_name||'')}" ${ddMaster===String(m.full_name||'')?'selected':''}>${ddEsc(m.full_name||'Мастер')}</option>`).join('')}</select><button class="secondary" onclick="reloadDispatcherDesktop()">Обновить</button></div><div class="ddWorkspace"><section class="ddQueue"><div class="ddPanelTitle"><div><b>Очередь заявок</b><span>Найдено: ${list.length}</span></div></div><div id="ddQueueList" class="ddQueueList">${list.map(ddQueueCard).join('')||'<div class="ddNothing">По выбранному фильтру заявок нет.</div>'}</div></section><div id="ddDetailRoot">${ddDetail(selected)}</div>${ddMasterLoad()}</div></div>`;
}

const previousOrders=pages.orders;
pages.orders=function(){if(!ddMode()||!ddDesktop())return previousOrders();return ddRender()};

window.selectDispatcherDesktopOrder=function(id){ddSelected=String(id||'');const list=ddFiltered();ddEnsureSelected(list);const root=document.getElementById('ddDetailRoot');if(root)root.innerHTML=ddDetail(ddGetSelected());document.querySelectorAll('.ddQueueCard').forEach(el=>el.classList.toggle('isSelected',String(el.getAttribute('onclick')||'').includes(`'${ddSelected}'`)))};
window.setDispatcherDesktopFilter=function(v){ddFilter=String(v||'active');ddSelected='';show('orders')};
window.setDispatcherDesktopSearch=function(v){ddSearch=String(v||'');ddSelected='';if(ddMode()&&ddDesktop())show('orders')};
window.setDispatcherDesktopMaster=function(v){ddMaster=String(v||'');ddSelected='';if(ddMode()&&ddDesktop())show('orders')};
window.reloadDispatcherDesktop=async function(){try{await reloadData(true)}catch(e){const msg=document.getElementById('ddQuickMsg');if(msg)msg.textContent=e.message||String(e)}};
window.saveDispatcherDesktopQuick=async function(id){
  const msg=document.getElementById('ddQuickMsg');if(state.busy)return;
  const status=document.getElementById('quickStatus')?.value||'',master=document.getElementById('quickMaster')?.value||'';
  state.busy=true;if(msg)msg.textContent='Сохраняем…';
  try{
    const d=await api('updateOrder',{id,status,master_vk_id:master});if(!d.ok)throw new Error(d.error||'Не удалось сохранить');
    const i=state.orders.findIndex(x=>String(x.id)===String(id));if(i>=0)state.orders[i]=d.order;
    state.busy=false;show('orders');
  }catch(e){if(msg)msg.textContent=e.message||String(e)}finally{state.busy=false}
};

window.addEventListener('resize',()=>{const now=ddDesktop();if(now===ddLastDesktop)return;ddLastDesktop=now;if(ddMode()&&state.page==='orders')show('orders')});
document.addEventListener('keydown',e=>{if(!ddMode()||!ddDesktop()||state.page!=='orders')return;if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==='k'){e.preventDefault();document.getElementById('ddSearch')?.focus()}if(e.key==='Escape'&&document.activeElement?.id==='ddSearch'){document.activeElement.blur()}});

const style=document.createElement('style');style.textContent=`
@media(min-width:${DESKTOP_MIN}px){
body .ddDesktop{max-width:1680px;margin:0 auto;padding:2px 0 24px}.ddTop{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin:0 0 14px}.ddTop h2{font-size:28px;margin:2px 0 2px}.ddTop>div>span{color:var(--muted,#91a3b7);font-size:13px}.ddEyebrow{font-size:11px;letter-spacing:.12em;font-weight:800;color:#7f9fbd}.ddMetrics{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:8px;margin-bottom:10px}.ddMetric{min-height:68px;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:#0f1927;color:inherit;text-align:left;display:flex;flex-direction:column;justify-content:space-between}.ddMetric span{font-size:11px;color:var(--muted,#91a3b7)}.ddMetric strong{font-size:22px}.ddMetric:hover,.ddMetric.isActive{border-color:#4d8fc9;background:#14263a}.ddMetricWarn.isActive,.ddMetricWarn:hover{border-color:#b18a39}.ddMetricDanger.isActive,.ddMetricDanger:hover{border-color:#b94e55}.ddToolbar{display:grid;grid-template-columns:minmax(320px,1fr) 220px auto;gap:8px;margin-bottom:10px}.ddSearchWrap{display:flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.09);border-radius:12px;background:#0e1825;padding:0 12px}.ddSearchWrap span{font-size:18px;color:#86a1b9}.ddSearchWrap input{border:0!important;background:transparent!important;box-shadow:none!important;padding-left:0!important;width:100%;min-height:42px}.ddToolbar select{min-height:44px}.ddWorkspace{display:grid;grid-template-columns:minmax(330px,390px) minmax(460px,1fr) minmax(230px,280px);gap:10px;min-height:calc(100vh - 315px)}.ddQueue,.ddDetail,.ddMasters,.ddEmpty{background:#0d1723;border:1px solid rgba(255,255,255,.08);border-radius:14px;min-height:0}.ddQueue,.ddMasters{display:flex;flex-direction:column;overflow:hidden}.ddPanelTitle{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 13px;border-bottom:1px solid rgba(255,255,255,.07)}.ddPanelTitle>div{display:flex;flex-direction:column;gap:2px}.ddPanelTitle b{font-size:13px}.ddPanelTitle span{font-size:11px;color:var(--muted,#91a3b7)}.ddTiny{padding:6px 9px;min-height:auto}.ddQueueList,.ddMasterList{overflow:auto;padding:7px;min-height:0}.ddQueueCard{width:100%;border:1px solid transparent;border-radius:10px;background:#101c2a;color:inherit;padding:10px;margin:0 0 6px;text-align:left;cursor:pointer}.ddQueueCard:hover{background:#142337}.ddQueueCard.isSelected{border-color:#4a8ccf;background:#14283d}.ddQueueTop,.ddQueueClient,.ddQueueBottom{display:flex;align-items:center;justify-content:space-between;gap:8px}.ddQueueTop span{font-size:10px;color:var(--muted,#91a3b7)}.ddQueueClient{margin-top:5px}.ddQueueClient strong{font-size:13px}.ddQueueClient b{font-size:12px}.ddQueueWork{font-size:12px;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ddQueueAddress{font-size:11px;color:var(--muted,#91a3b7);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ddQueueBottom{align-items:flex-end;margin-top:7px;font-size:10px;color:var(--muted,#91a3b7)}.ddQueueBottom>div{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}.ddFlag{display:inline-flex;align-items:center;border-radius:999px;padding:3px 6px;background:#233246;color:#c9d5e5;font-size:9px;font-weight:800}.ddFlagWarn{background:#4b3a14;color:#ffd95c}.ddFlagDanger{background:#492028;color:#ffafb6}.ddDetail{padding:17px 18px;overflow:auto}.ddDetailHead{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,.07)}.ddDetailHead h2{margin:3px 0 7px;font-size:24px}.ddFlags{display:flex;gap:5px;flex-wrap:wrap}.ddAmount{font-size:23px;font-weight:900;white-space:nowrap}.ddAlert{display:flex;flex-direction:column;gap:4px;margin:14px 0;padding:11px 12px;border:1px solid rgba(238,185,73,.28);border-radius:10px;background:rgba(108,77,18,.18)}.ddAlert b{font-size:12px;color:#ffd66d}.ddAlert span{font-size:12px}.ddInfoGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.ddInfoGrid>div{padding:10px 11px;border-radius:10px;background:#101c2a;display:flex;flex-direction:column;gap:4px}.ddInfoGrid span{font-size:10px;color:var(--muted,#91a3b7);text-transform:uppercase;letter-spacing:.04em}.ddInfoGrid b{font-size:13px;line-height:1.35}.ddInfoGrid .ddWide{grid-column:1/-1}.ddInlineAction{font-size:11px;color:#7dbaf1;font-weight:700;margin-top:2px}.ddQuickEdit{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end;margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.07)}.ddQuickEdit label{display:flex;flex-direction:column;gap:5px}.ddQuickEdit label span{font-size:10px;color:var(--muted,#91a3b7);text-transform:uppercase}.ddQuickEdit select{min-height:42px}.ddQuickEdit button{min-height:42px}.ddDetailActions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.ddButtonLink{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}.ddMasters{max-height:calc(100vh - 315px)}.ddMasterList button{width:100%;border:0;border-bottom:1px solid rgba(255,255,255,.06);background:transparent;color:inherit;padding:10px 8px;display:flex;justify-content:space-between;gap:10px;text-align:left;cursor:pointer}.ddMasterList button:hover{background:#122134}.ddMasterList button span{display:flex;flex-direction:column;gap:2px;min-width:0}.ddMasterList button b{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ddMasterList button small{font-size:10px;color:var(--muted,#91a3b7)}.ddMasterList button strong{display:grid;place-items:center;min-width:27px;height:27px;border-radius:9px;background:#1b3149;font-size:12px}.ddEmpty{display:grid;place-items:center;text-align:center;padding:30px}.ddEmpty>div{display:flex;flex-direction:column;gap:5px}.ddEmpty span,.ddNothing{font-size:12px;color:var(--muted,#91a3b7)}.ddNothing{padding:24px 12px;text-align:center}
#content:has(.ddDesktop){max-width:none;width:100%;padding-left:18px;padding-right:18px}
}
@media(min-width:1050px) and (max-width:1250px){.ddWorkspace{grid-template-columns:330px minmax(430px,1fr)}.ddMasters{display:none}.ddMetrics{grid-template-columns:repeat(3,1fr)}}
`;
document.head.appendChild(style);
})();
