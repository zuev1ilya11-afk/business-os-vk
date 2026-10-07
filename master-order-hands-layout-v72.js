(()=>{
'use strict';
if(window.BOS_MASTER_HANDS_LAYOUT_V73)return;window.BOS_MASTER_HANDS_LAYOUT_V73=true;
if(!window.__bosMasterOrderDay)window.__bosMasterOrderDay='all';
const selectedDay=()=>String(window.__bosMasterOrderDay||'all');
const setSelectedDay=day=>{window.__bosMasterOrderDay=String(day||'all')};
const masterMode=()=>String(state.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const no=o=>{const x=String(o?.external_id||'');return x.startsWith('hands:')?x.slice(6):String(o?.id||'')};
const dateTime=o=>{const d=String(o?.scheduled_date||'').slice(0,10);const t=String(o?.scheduled_time||o?.time_slot||'').slice(0,5);return [d||'Дата не назначена',t||'Время не назначено'].join(' · ')};
const unit=u=>({PIECE:'шт.',PCS:'шт.',FIX:'шт.',METER:'м',METERS:'м',KM:'км'}[String(u||'').toUpperCase()]||String(u||''));
const works=o=>String(o?.work||'Работа не указана').split(/\n+/).map(x=>x.trim()).filter(Boolean);
const pay=o=>{const direct=window.BOS_ORDER_PAYROLL?.directMaster(o);if(direct!=null)return direct;const raw=o?.amount;if(raw!==null&&raw!==undefined&&raw!==''){const amount=Number(raw);if(Number.isFinite(amount))return amount*0.85*0.65}const stored=Number(o?.master_payout||0);return Number.isFinite(stored)?stored:0};
const breakdown=o=>window.BOS_ORDER_PAYROLL?.masterBreakdown(o);
const totalPay=o=>{const d=breakdown(o);return d?d.masterTotal:pay(o)};
function costHtml(o){
  if(!window.BOS_ORDER_PAYROLL?.isDirect(o))return '';
  const d=breakdown(o);
  if(!d)return '<section class="masterCostBreakdown" data-master-cost><h3>Расчёт стоимости</h3><p class="muted">Стоимость пока не загружена. Обновите заявку.</p></section>';
  const row=(key,title,value)=>`<div class="masterCostRow" data-cost-row="${key}"><dt>${title}</dt><dd>${money(value)}</dd></div>`;
  return `<section class="masterCostBreakdown" data-master-cost aria-label="Стоимость заявки и расчёт выплаты"><div class="masterCostTotal"><span>Полная стоимость заявки</span><strong data-cost-total>${money(d.total)}</strong></div><h3>Расчёт стоимости</h3><dl>${d.original!==null?row('original','Первоначальная стоимость',d.original):''}${d.deduction?row('deduction','Невыполненные работы (уже вычтены)',-d.deduction):''}${row('base','Основные работы после вычетов',d.amount)}${row('extras','Допработы',d.extras)}${row('total','Итого стоимость',d.total)}</dl>${d.cancelled?'<p class="muted">Заявка отменена. Начислений нет.</p>':`<h3>Распределение суммы</h3><dl>${row('master-base',d.standard?'Мастеру — 60% основных работ':(o.manual_completion_history?.length&&!o.report_uploaded_at?'Сохранённая выплата':'Выплата по сохранённому отчёту'),d.master)}${row('master-extras','Мастеру за допработы — 100%',d.extras)}${row('company',d.standard?'Компании — 40% основных работ':'Остаток компании',d.company)}${row('master-total','Итого мастеру',d.masterTotal)}</dl><p class="muted">${d.saved?(o.manual_completion_history?.length&&!o.report_uploaded_at?'Сохранённые суммы заявки.':'Суммы из сохранённого отчёта.'):'Предварительный расчёт по текущим данным заявки.'} Допработы добавлены мастеру отдельно, один раз.</p>`}</section>`;
}
const routeAddress=o=>{let address=String(o?.address||'').replace(/\s+/g,' ').trim();if(!address)return'';address=address.replace(/\s*(?:,|;)?\s*(?:кв(?:артира)?\.?|подъезд|этаж|офис|апарт(?:аменты?)?|домофон)\s*[:№#-]?\s*[^,;]*(?:[,;].*)?$/iu,'').replace(/[,\s]+$/g,'').trim();const city=String(o?.city||'').trim();return city&&!address.toLowerCase().includes(city.toLowerCase())?`${address}, ${city}`:address};
const yandexRouteHref=o=>{const destination=routeAddress(o);return destination?`https://yandex.ru/maps/?mode=search&text=${encodeURIComponent(destination)}`:''};
const addressHtml=o=>{const address=String(o?.address||'').trim();if(!address)return '<b>Адрес не указан</b>';const href=yandexRouteHref(o);return `<b><a class="bosHandsAddressLink" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="Открыть адрес в Яндекс Картах: ${esc(routeAddress(o))}">${esc(address)}</a></b>`};
function parseWork(x){const clean=String(x||'').trim();const m=clean.match(/^(.*?)\s*[×x]\s*([\d.,]+)\s*(.*?)\s*$/i);if(!m)return{title:clean,qty:''};return{title:m[1].trim(),qty:`${m[2]}${m[3]?' '+unit(m[3]):''}`}}
const workRow=x=>{const w=parseWork(x);return `<div class="bosHandsWorkRow"><span>${esc(w.title)}</span>${w.qty?`<b>${esc(w.qty)}</b>`:''}</div>`};
const workCount=n=>n%10===1&&n%100!==11?'работа':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'работы':'работ';
const rows=o=>{const all=works(o);return all.slice(0,2).map(workRow).join('')+(all.length>2?`<details class="bosMoreWorks"><summary><span class="bosExpand">Ещё ${all.length-2} ${workCount(all.length-2)}</span><span class="bosCollapse">Свернуть работы</span></summary>${all.slice(2).map(workRow).join('')}</details>`:'')};
const apartmentHtml=o=>{const flat=String(o.apartment||'').trim().replace(/^(?:квартира|кв\.?)\s*/iu,'');const bits=[flat?'кв. '+flat:'',o.floor?'этаж '+o.floor:'',o.entrance?'подъезд '+o.entrance:''].filter(Boolean);return bits.length?`<div class="bosApartment">${bits.map(esc).join(' · ')}</div>`:''};
const handsOrder=o=>String(o?.external_source||o?.source||'').trim().toLowerCase()==='hands'||String(o?.external_id||'').toLowerCase().startsWith('hands:');
const visibleComment=o=>{
 const raw=String(o?.comment||'').trim();if(!handsOrder(o))return raw;
 const manual=!!o?.hands_detail_overrides?.comment,source=o?.hands_comment_source;
 if(!manual&&source&&Object.prototype.hasOwnProperty.call(source,'comment'))return String(source.comment||'').trim();
 // Legacy imported comments may still contain provider metadata. Keep only the
 // customer's actual comment; apartment is rendered separately above.
 return raw.split(/\n+/).map(x=>x.trim()).filter(x=>x&&!/^(?:Как добраться|Магазин|Оплата)\s*:/iu.test(x)).join('\n').trim();
};
const commentHtml=o=>{const text=visibleComment(o);if(!text)return '';const long=text.length>180||text.split('\n').length>3;return `<section class="bosOrderComment"><b>Комментарий</b>${long?`<details><summary><span class="bosCommentPreview">${esc(text.slice(0,180))}…</span><span class="bosExpand">Показать полностью</span><span class="bosCollapse">Свернуть комментарий</span></summary><p>${esc(text)}</p></details>`:`<p>${esc(text)}</p>`}</section>`};
function phoneList72(v){
 const raw=String(v||'').trim();if(!raw)return[];
 const hits=raw.match(/(?:\+?7|8)?[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g)||[];
 const source=hits.length?hits:[raw],seen=new Set(),out=[];
 source.forEach(label=>{
  const clean=String(label||'').trim().replace(/^[,;|/\s]+|[,;|/\s]+$/g,'');
  const digits=clean.replace(/\D/g,'');if(digits.length<10)return;
  const tel=digits.length===10?'+7'+digits:(digits.length===11&&(digits[0]==='7'||digits[0]==='8')?'+7'+digits.slice(1):'+'+digits);
  if(seen.has(tel))return;seen.add(tel);out.push({label:clean||tel,tel});
 });
 return out;
}
window.copyMasterPhone72=async function(phone,button){
 const value=String(phone||'').trim();if(!value)return;
 try{
  if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);
  else{
   const area=document.createElement('textarea');area.value=value;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();
  }
  if(button){const old=button.textContent;button.textContent='Скопировано';button.disabled=true;setTimeout(()=>{button.textContent=old;button.disabled=false},900)}
 }catch(_){if(button)button.textContent='Не скопировано'}
};
const phoneHtml=o=>{
 const phones=phoneList72(o.phone||o.client_phone);
 if(!phones.length)return'<small>Телефон не указан</small>';
 return `<div class="bosCompactPhone masterV126PhoneList">${phones.map((item,index)=>`<div class="masterV126PhoneRow"><a class="masterV126Phone" href="tel:${esc(item.tel)}">${esc(item.label)}</a><div class="masterV126PhoneActions"><button type="button" class="secondary masterV126CopyPhone" onclick="copyMasterPhone72('${esc(item.tel)}',this)" aria-label="Скопировать номер ${index+1}">Копировать</button><a class="secondary bosClientCallAction" href="tel:${esc(item.tel)}" aria-label="${index===0?'Позвонить клиенту':'Позвонить клиенту '+(index+1)}">Позвонить</a></div></div>`).join('')}</div>`;
};
const contactSummaryHtml=o=>{
 const event=window.BOS_CONTACT_STATUS?.latest?.(o);if(!event)return'';
 const summary=window.BOS_CONTACT_STATUS?.html?.(o)||'';
 const comment=String(event.comment||'').trim();
 const pending=String(event.result||'')==='pending';
 return `<div class="bosMasterContactSummary">${summary}${comment?`<small>${esc(comment)}</small>`:''}${pending?`<button type="button" class="secondary" onclick="openMasterContactResultForOrder('${esc(o.id)}')">Указать итог звонка</button>`:''}</div>`;
};
const received=o=>{const raw=String(o.created_at||'').slice(0,10),m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}.${m[2]}.${m[1]}`:'—'};

const shortRows=o=>works(o).slice(0,3).map(x=>{const w=parseWork(x);return `<div class="bosHandsMiniWork"><span>${esc(w.title)}</span>${w.qty?`<b>${esc(w.qty)}</b>`:''}</div>`}).join('')+(works(o).length>3?`<div class="bosHandsMore">+ ещё ${works(o).length-3}</div>`:'');
const card=o=>`<button class="bosHandsMiniCard" onclick="openOrder('${esc(o.id)}')"><div class="bosHandsMiniHead"><b>№ ${esc(no(o))}</b><span>${esc(dateTime(o))}</span></div><div class="bosHandsMiniClient"><b>${esc(o.client||'Клиент не указан')}</b><strong>Выплата: ${money(pay(o))}</strong></div><div class="bosHandsMiniAddress">${esc(o.address||'Адрес не указан')}</div><div class="bosHandsMiniWorks">${shortRows(o)}</div></button>`;
function dateLabel(date){if(!date)return 'Без даты';const d=new Date(`${date}T12:00:00`);if(Number.isNaN(d.getTime()))return date;return d.toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'short'}).replace(/^./,c=>c.toUpperCase())}
function filters(all){const dates=[...new Set(all.map(o=>String(o.scheduled_date||'').slice(0,10)).filter(Boolean))].slice(0,10);let day=selectedDay();if(day!=='all'&&!dates.includes(day)){setSelectedDay('all');day='all'}return `<div class="masterDayFilters"><button type="button" class="${day==='all'?'primary':'secondary'}" data-master-day-filter="all" aria-pressed="${day==='all'}">Все</button>${dates.map(date=>`<button type="button" class="${day===date?'primary':'secondary'}" data-master-day-filter="${esc(date)}" aria-pressed="${day===date}">${esc(dateLabel(date))}</button>`).join('')}</div>`}
function grouped(all){const day=selectedDay();const source=day==='all'?all:all.filter(o=>String(o.scheduled_date||'').slice(0,10)===day);const groups=[];source.forEach(o=>{const date=String(o.scheduled_date||'').slice(0,10);let g=groups.find(x=>x.date===date);if(!g){g={date,orders:[]};groups.push(g)}g.orders.push(o)});return groups.map(g=>`<section class="masterDayGroup" data-master-day="${esc(g.date||'none')}"><div class="masterDayHeading"><strong>${esc(dateLabel(g.date))}</strong><span>${g.orders.length} заяв.</span></div>${g.orders.map(card).join('')}</section>`).join('')}
function rerenderMasterOrders(){const root=document.getElementById('content');if(root&&masterMode()&&pages&&typeof pages.orders==='function'){root.innerHTML=pages.orders();return true}return false}
window.setMasterOrderDay=function(day){setSelectedDay(day);if(!rerenderMasterOrders()&&typeof window.show==='function')window.show('orders')};
document.addEventListener('click',event=>{const btn=event.target?.closest?.('[data-master-day-filter]');if(!btn)return;event.preventDefault();window.setMasterOrderDay(btn.dataset.masterDayFilter||'all')},true);
const baseOrders=pages.orders;
pages.orders=function(){if(!masterMode())return baseOrders();const all=(typeof ownOrders==='function'?ownOrders():(state.orders||[])).slice().sort((a,b)=>String((a.scheduled_date||'9999')+(a.scheduled_time||'')).localeCompare(String((b.scheduled_date||'9999')+(b.scheduled_time||''))));return `<div class="masterSimple masterOrdersDense"><div class="masterSectionTitle"><div><h2>Мои заявки</h2><div class="muted">${all.length} шт.</div></div></div>${filters(all)}${all.length?grouped(all):'<div class="masterEmpty">Заявок пока нет</div>'}</div>`};
const baseOpen=window.openOrder;
window.openOrder=function(id){if(!masterMode())return baseOpen.apply(this,arguments);const o=(state.orders||[]).find(x=>String(x.id)===String(id));if(!o)return;const d=breakdown(o);openModal(`<div class="bosHandsOrder bosCompactMasterCard"><div class="bosHandsHead"><div class="bosMasterTitle"><b>№ ${esc(no(o))}</b><small class="bosReceivedInline bosCompactReceived">Поступила ${esc(received(o))}</small></div><div class="bosCompactMoney">${d?`<strong>Стоимость: ${money(d.total)}</strong>`:''}<span>Выплата: ${money(totalPay(o))}</span></div></div>${window.BOS_MANUAL_COMPLETION?.history(o)||''}${costHtml(o)?`<details class="bosCompactCost"><summary>Расчёт стоимости</summary>${costHtml(o)}</details>`:''}<div class="bosHandsBlock bosCompactAddress"><span class="bosHandsIcon">⌖</span><div>${addressHtml(o)}${apartmentHtml(o)}</div></div><div class="bosHandsBlock bosCompactDate"><span class="bosHandsIcon">◷</span><div>${esc(dateTime(o))}</div></div><div class="bosHandsBlock bosCompactClient"><span class="bosHandsIcon">◉</span><div><b>${esc(o.client||'Клиент не указан')}</b>${phoneHtml(o)}${contactSummaryHtml(o)}<div class="bosMasterClientActions"></div></div></div>${commentHtml(o)}<section class="bosHandsWorks"><b class="bosWorksLabel">Состав работ</b><div class="bosHandsWorkList">${rows(o)}</div></section></div>`);const modal=document.querySelector('#modalRoot .modal');modal?.classList.add('bosCompactOrderModal');const close=modal?.querySelector('.modalClose');if(close){close.setAttribute('aria-label','Закрыть заявку');modal.querySelector('.bosHandsHead').appendChild(close)}};

function stripStaffManagement(){if(!masterMode())return;document.querySelectorAll('button,a,[role="button"],section,.card').forEach(el=>{const txt=(el.textContent||'').trim().toLowerCase();if(txt==='управление сотрудниками'||txt==='сотрудники'||txt==='команда сотрудников')el.style.display='none'})}
const baseShow=window.show;window.show=function(){const r=baseShow.apply(this,arguments);setTimeout(stripStaffManagement,0);return r};
const observer=new MutationObserver(()=>stripStaffManagement());observer.observe(document.documentElement,{childList:true,subtree:true});
const s=document.createElement('style');s.textContent=`.masterCostBreakdown{border:1px solid var(--line,rgba(255,255,255,.10));border-radius:14px;padding:14px;margin:4px 0 12px;min-width:0}.masterCostTotal{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:baseline;justify-content:space-between}.masterCostTotal span{font-size:13px;color:var(--muted,#91a3b7)}.masterCostTotal strong{font-size:24px;line-height:1.2;white-space:nowrap}.masterCostBreakdown h3{font-size:14px;margin:16px 0 8px}.masterCostBreakdown dl{margin:0}.masterCostRow{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:6px 0;font-size:13px}.masterCostRow dt{min-width:0;overflow-wrap:anywhere}.masterCostRow dd{margin:0;font-weight:700;white-space:nowrap}.masterCostRow[data-cost-row="total"],.masterCostRow[data-cost-row="master-total"]{border-top:1px solid var(--line,rgba(255,255,255,.1));margin-top:5px;padding-top:10px;font-weight:700}.masterCostBreakdown>p{font-size:12px;line-height:1.5;margin-bottom:0}@media(max-width:350px){.masterCostBreakdown{padding:10px}.masterCostTotal strong{font-size:21px}.masterCostRow{font-size:12px}.bosHandsHead{flex-wrap:wrap}}.masterOrdersDense .masterDayFilters{display:flex;gap:6px;overflow-x:auto;padding:4px 0 7px}.masterOrdersDense .masterDayFilters button{flex:0 0 auto}.masterDayGroup{margin:8px 0}.masterDayHeading{display:flex;justify-content:space-between;gap:8px;align-items:center;margin:4px 1px 5px}.masterDayHeading span{font-size:11px;color:var(--muted,#91a3b7)}.bosHandsMiniCard{width:100%;display:block;text-align:left;padding:10px 11px;margin:6px 0;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:var(--card,#111d2b);color:inherit}.bosHandsMiniHead,.bosHandsMiniClient,.bosHandsMiniWork{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.bosHandsMiniHead b{font-size:15px}.bosHandsMiniHead span{font-size:11px;color:var(--muted,#91a3b7);text-align:right}.bosHandsMiniClient{margin-top:5px}.bosHandsMiniClient b{font-size:13px}.bosHandsMiniClient strong{font-size:14px;white-space:nowrap}.bosHandsMiniAddress{font-size:12px;color:var(--muted,#91a3b7);margin-top:2px}.bosHandsMiniWorks{margin-top:6px;padding-top:5px;border-top:1px solid rgba(255,255,255,.06)}.bosHandsMiniWork{font-size:12px;line-height:1.25;padding:2px 0}.bosHandsMiniWork span{min-width:0;overflow-wrap:anywhere}.bosHandsMiniWork b{flex:0 0 auto;white-space:nowrap;color:var(--muted,#91a3b7)}.bosHandsMore{font-size:11px;color:var(--muted,#91a3b7);margin-top:3px}.bosHandsOrder{padding:0 2px;max-width:100%;overflow:hidden}.bosHandsHead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:4px 0 10px}.bosHandsHead b{font-size:18px}.bosHandsHead strong{font-size:16px;white-space:nowrap}.bosHandsBlock{display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px;padding:9px 0;border-top:1px solid rgba(255,255,255,.06);font-size:14px;line-height:1.35;min-width:0}.bosHandsIcon{color:var(--muted,#91a3b7);font-size:17px}.bosHandsBlock>div{min-width:0;overflow-wrap:anywhere}.bosHandsBlock small{display:block;color:var(--muted,#91a3b7);font-size:13px;margin-top:2px}.bosHandsAddressLink{color:inherit;text-decoration:underline;text-decoration-color:rgba(96,165,250,.58);text-decoration-thickness:1px;text-underline-offset:3px;cursor:pointer}.bosHandsAddressLink:hover{color:#8fc2ff}.masterV149Route{display:none!important}.bosHandsWorks{padding-bottom:2px}.bosHandsWorkList{min-width:0;width:100%}.bosHandsWorkRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start;padding:7px 0}.bosHandsWorkRow span{min-width:0;overflow-wrap:anywhere}.bosHandsWorkRow b{color:var(--muted,#91a3b7);font-weight:600;white-space:nowrap}.modal{overflow-x:hidden!important}`;document.head.appendChild(s);
const compact=document.createElement('style');compact.textContent=`
.modal.bosCompactOrderModal{padding:16px!important;max-width:560px!important}
.bosCompactMasterCard{font-size:14px;line-height:1.45;min-width:0}
.bosCompactMasterCard .bosHandsHead{display:grid;grid-template-columns:auto minmax(0,1fr) 44px;gap:10px;align-items:center;padding:0 0 12px;margin:0}
.bosCompactMasterCard .bosMasterTitle{display:flex;align-items:baseline;gap:8px;min-width:0;flex-wrap:wrap}.bosCompactMasterCard .bosMasterTitle>b{font-size:18px;overflow-wrap:anywhere}.bosCompactMasterCard .bosReceivedInline{font-size:12px;color:var(--muted,#91a3b7);white-space:nowrap}
.bosCompactMasterCard .bosCompactMoney{text-align:right;display:grid;gap:2px;font-size:13px;min-width:0}
.bosCompactMasterCard .bosCompactMoney strong,.bosCompactMasterCard .bosCompactMoney span{white-space:nowrap}
.bosCompactMasterCard .bosCompactMoney strong{font-size:14px}
.bosCompactOrderModal .bosHandsHead .modalClose{position:static!important;float:none!important;margin:0!important;width:44px;height:44px;min-width:44px;min-height:44px;font-size:26px;padding:0}
.bosCompactMasterCard .bosHandsBlock{padding:10px 0;gap:10px;font-size:14px;min-width:0}
.bosCompactMasterCard .bosHandsBlock>div{min-width:0;overflow-wrap:anywhere}
.bosCompactMasterCard .bosHandsBlock b{font-size:15px;line-height:1.4}
.bosCompactMasterCard .bosHandsIcon{font-size:18px;width:20px;flex:0 0 20px}
.bosCompactMasterCard .bosApartment{color:var(--muted,#91a3b7);font-size:13px;margin-top:4px}
.bosCompactPhone{display:grid;gap:7px;margin-top:4px;width:100%}
.masterV126PhoneRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;min-width:0}
.masterV126PhoneActions{display:flex;gap:6px;align-items:center}
.bosCompactPhone .masterV126PhoneActions .secondary{font-size:12px;min-height:38px;padding:7px 9px;text-decoration:none}
.masterV126CopyPhone{white-space:nowrap}
.bosMasterContactSummary{display:grid;gap:5px;margin-top:9px;padding:9px 10px;border-radius:11px;background:rgba(37,99,235,.07);border:1px solid rgba(96,165,250,.15)}
.bosMasterContactSummary small{font-size:11px;line-height:1.4;color:var(--muted,#91a3b7);overflow-wrap:anywhere}.bosMasterContactSummary button{min-height:40px!important;margin-top:2px}
@media(max-width:520px){.masterV126PhoneRow{grid-template-columns:1fr}.masterV126PhoneActions{justify-content:flex-start;flex-wrap:wrap}.masterV126PhoneActions .secondary{flex:1 1 110px}}
.bosMasterClientActions{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.bosMasterClientActions:empty{display:none}
.bosMasterClientActions button{font-size:13px;min-height:44px;white-space:normal;text-align:left;padding:8px 10px}
.bosMasterClientActions small{color:var(--muted,#91a3b7);font-size:12px}
.bosOrderComment{padding:10px 12px;margin:4px 0 12px;background:var(--card,#111d2b);border:1px solid var(--line,rgba(255,255,255,.1));border-radius:12px;overflow-wrap:anywhere}
.bosOrderComment>b,.bosWorksLabel{display:block;font-size:13px;color:var(--muted,#91a3b7);margin-bottom:4px}
.bosOrderComment p{white-space:pre-wrap;margin:4px 0 0;font-size:14px;line-height:1.5}
.bosOrderComment summary{list-style:none}.bosOrderComment summary::marker{content:''}
.bosCommentPreview{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;line-height:1.5;color:var(--text,#f5f8fc)}
.bosOrderComment details[open] .bosCommentPreview{display:none}
.bosCompactMasterCard .bosHandsWorks{padding:0;margin:0}
.bosCompactMasterCard .bosHandsWorkRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:8px 0;font-size:14px;line-height:1.45}
.bosCompactMasterCard .bosHandsWorkRow span{overflow-wrap:anywhere}.bosCompactMasterCard .bosHandsWorkRow b{font-size:14px;white-space:nowrap;color:var(--muted,#91a3b7)}
.bosCompactMasterCard summary{cursor:pointer;min-height:44px;box-sizing:border-box;padding:10px 0;color:#7eb9ff;font-size:14px}
.bosCompactMasterCard .bosCollapse{display:none}.bosCompactMasterCard details[open]>summary .bosExpand{display:none}.bosCompactMasterCard details[open]>summary .bosCollapse{display:inline}
.bosCompactMasterCard .masterCostBreakdown{padding:10px;margin-bottom:8px}.bosCompactMasterCard .masterCostTotal strong{font-size:20px}
.bosCompactOrderModal .bosMasterWorkflow[data-bos-v179="1"]{padding:0!important;margin:0!important;border:0!important;background:transparent!important}
.bosCompactOrderModal .moa179StageCard{padding:12px}.bosCompactOrderModal .moa179StageCard h3{font-size:15px;margin:0 0 8px}
.bosCompactOrderModal .moa179ProgressLabel{margin:0 0 8px;font-size:13px}.bosCompactOrderModal .moa179Steps{margin-top:10px;gap:2px}
.bosCompactOrderModal .moa179Step{padding:7px 8px;gap:8px}.bosCompactOrderModal .moa179Step b{font-size:14px;line-height:1.4}
.bosCompactOrderModal .moa179Step small{font-size:12px;margin:2px 0 0}.bosCompactOrderModal .moa179Step.current{padding:10px 8px}
.bosCompactOrderModal .moa179Action{min-height:44px;margin-top:8px}.bosCompactOrderModal .moa179Msg:empty{display:none}
@media(max-width:520px){.bosCompactMasterCard .bosHandsHead{grid-template-columns:minmax(0,1fr) 44px;align-items:center}.bosCompactMasterCard .bosMasterTitle{grid-column:1;grid-row:1}.bosCompactOrderModal .bosHandsHead .modalClose{grid-column:2;grid-row:1}.bosCompactMasterCard .bosCompactMoney{grid-column:1/-1;grid-row:2;display:flex;justify-content:flex-end;align-items:baseline;gap:10px;text-align:right;width:100%;font-size:13px}.bosCompactMasterCard .bosCompactMoney strong,.bosCompactMasterCard .bosCompactMoney span{white-space:nowrap}}
@media(max-width:380px){.modal.bosCompactOrderModal{padding:12px!important}.bosCompactMasterCard .bosHandsHead{gap:8px}.bosCompactMasterCard .bosMasterTitle>b{font-size:16px}.bosCompactMasterCard .bosCompactMoney{font-size:12px}}
`;document.head.appendChild(compact);
setTimeout(stripStaffManagement,0);
})();
