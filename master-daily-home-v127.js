(()=>{
'use strict';
if(window.BOS_MASTER_DAILY_HOME_V127)return;
window.BOS_MASTER_DAILY_HOME_V127=true;
let queued=false,selected='days',callbacksOnly=false,identity='';
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const active=o=>o&&!['Выполнена','Отменена'].includes(String(o.status||''))&&o.report_review_status!=='approved';
const timestamp=v=>v&&Number.isFinite(Date.parse(v))?Date.parse(v):0;
const timeOf=o=>window.BOS_SCHEDULE_CONTRACT.timeOf(o);
const stageOf=o=>{const s=String(o?.master_workflow_stage||'assigned');if(s==='completed')return s;if(s==='started'||o?.master_started_at)return 'started';if(s==='departed'||s==='arrived'||o?.master_departed_at||o?.master_arrived_at)return 'departed';return 'assigned'};
const reportRejected=o=>String(o?.report_review_status||'')==='rejected';
const reportUploaded=o=>!!o?.report_uploaded_at||['pending','approved'].includes(String(o?.report_review_status||''));
const progressed=o=>['departed','started','completed'].includes(stageOf(o))||!!(o?.master_departed_at||o?.master_arrived_at||o?.master_started_at||o?.completed_at||o?.report_act_url)||reportUploaded(o)||reportRejected(o);
const workflowKnown=o=>stageOf(o)!=='assigned'||reportUploaded(o)||reportRejected(o);
const calledDone=o=>!!o?.master_called_at||workflowKnown(o);
const agreementDone=o=>!!o?.master_agreed_at||workflowKnown(o);
const workDone=o=>['started','completed'].includes(stageOf(o))||!!o?.master_started_at||reportUploaded(o)||reportRejected(o);
const dateOf=o=>{const d=String(o?.scheduled_date||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d?d:''};
// Contact reminders in the application use Moscow time. Date-only visits are
// calendar dates in the same business zone, never the browser/server zone.
function dayKey(now=Date.now()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now))}
function dayLabel(day,now=Date.now()){
 const today=dayKey(now),tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 const value=new Date(day+'T12:00:00Z'),date=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long'}).format(value);
 const prefix=day===today?'Сегодня':day===tomorrow?'Завтра':new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',weekday:'long'}).format(value);
 return prefix.charAt(0).toUpperCase()+prefix.slice(1)+' · '+date;
}
function scheduleTs(o){const d=dateOf(o);return d?Date.parse(`${d}T${timeOf(o)||'23:59'}:00+03:00`):Infinity}
function scheduleEndTs(o){const start=scheduleTs(o),r=window.BOS_SCHEDULE_CONTRACT.range(o);return Number.isFinite(start)&&r?start+r.duration*60000:Infinity}
const reportOverdue=(o,now=Date.now())=>active(o)&&!reportUploaded(o)&&Number.isFinite(scheduleEndTs(o))&&now>=scheduleEndTs(o)+90*60000;
const currentPending=(o,now)=>active(o)&&!reportUploaded(o)&&scheduleTs(o)<=now;
function orderNo(o){const ext=String(o?.external_id||'');return ext.startsWith('hands:')?ext.slice(6):String(o?.id||'')}
function step(o){
 if(!active(o))return'Заявка завершена';if(reportRejected(o))return'Исправить отчёт';if(reportUploaded(o))return'Отчёт на проверке';
 if(workDone(o))return'Заполнить отчёт';if(agreementDone(o))return stageOf(o)==='departed'?'Начать работу':'Подтвердить выезд';
 return calledDone(o)?'Зафиксировать договорённость':'Позвонить клиенту';
}
function attentionReason(o,now){
 if(!active(o))return'';if(reportRejected(o))return'Отчёт вернули на доработку';if(reportOverdue(o,now))return'Отчёт не отправлен вовремя';
 if(calledDone(o)&&!agreementDone(o))return'Нужно согласовать дату и время';
 if(!calledDone(o)&&!dateOf(o))return'Нужно связаться с клиентом';
 return scheduleTs(o)<now-30*60000&&!workDone(o)&&!reportUploaded(o)?'Время заявки уже наступило':'';
}
function nextOrder(orders,now){
 const pending=orders.filter(active).filter(o=>!reportUploaded(o));
 const current=pending.filter(o=>currentPending(o,now)).sort((a,b)=>scheduleTs(a)-scheduleTs(b))[0];
 if(current)return current;
 return pending.filter(o=>Number.isFinite(scheduleTs(o))).sort((a,b)=>scheduleTs(a)-scheduleTs(b)).find(o=>scheduleTs(o)>=now)||pending.find(o=>!Number.isFinite(scheduleTs(o)))||null;
}
function contact(o){
 const history=Array.isArray(o.master_contact_history)?o.master_contact_history.filter(x=>x&&typeof x==='object'):[],event=history[history.length-1];
 const snapshot=!!o.master_contact_status&&(!event||timestamp(o.master_contact_updated_at)>=timestamp(event.result_at||event.at));
 return {result:String(snapshot?o.master_contact_status:event?.result||o.master_contact_status||''),comment:String(snapshot?o.master_contact_comment||'':event?.comment||o.master_contact_comment||''),callback:snapshot?o.master_contact_callback_at:event?.callback_at||o.master_contact_callback_at,at:timestamp(snapshot?o.master_contact_updated_at:event?.result_at||event?.at),attempt:history.length>0||!!o.master_called_at||!!o.master_contact_updated_at};
}
function classify(order,now=Date.now()){
 const o=order||{},c=contact(o),date=dateOf(o),rescheduled=!!o.reschedule_requested&&!(timestamp(o.master_agreed_at)>timestamp(o.reschedule_requested_at)&&timestamp(o.reschedule_requested_at)>0);
 const handled=progressed(o)||!!o.master_agreed_at||!!o.reschedule_requested||c.attempt||!!c.result||!!c.comment||!!c.callback;
 // An absent journal or missing workflow fields can mean a legacy/partial row.
 // Rows predating the journal's introduction (c5b188e9, 2026-10-04)
 // received SQL defaults too; retain them for clarification, not as new.
 // Missing creation provenance is equally ambiguous.
 const complete=timestamp(o.created_at)>=Date.parse('2026-10-05T00:00:00+03:00')&&['scheduled_date','master_called_at','master_agreed_at','master_contact_status','reschedule_requested'].every(k=>Object.hasOwn(o,k)&&o[k]!==undefined)&&Array.isArray(o.master_contact_history)&&o.master_workflow_stage==='assigned';
 const group=!active(o)?null:rescheduled?'waiting':date?'days':!handled&&complete&&!o.scheduled_date?'new':'waiting';
 const labels={no_answer:'Не дозвонился',thinking:'Клиент думает',waiting_delivery:'Ждут доставку',call_later:'Перезвонить позже',other:'Другой итог связи',agreed:'Договорились',pending:'Нужно указать итог связи'};
 let label=rescheduled?'Перенос без даты':group==='new'?'Новая':labels[c.result]||((c.attempt&&!o.master_agreed_at)?'Нужно указать итог связи':'Уточнить данные');
 if(group==='days'&&!c.result&&!calledDone(o))label='Нужно связаться';
 if(group==='days'&&timestamp(o.master_agreed_at)&&timestamp(o.master_agreed_at)>=c.at)label='Согласовано';
 if(progressed(o))label=reportRejected(o)?'Отчёт на доработке':reportUploaded(o)?'Отчёт на проверке':workDone(o)?'Работа начата':stageOf(o)==='departed'?'Мастер в пути':'Уточнить данные';
 const overdue=group==='days'&&!reportUploaded(o)&&(date<dayKey(now)||reportOverdue(o,now)||scheduleTs(o)<now-30*60000&&!workDone(o)&&!reportUploaded(o));
 return{order:o,group,date:group==='days'?date:'',time:timeOf(o),label,comment:rescheduled?String(o.reschedule_reason||''):c.comment,contact:c,rescheduled,overdue,callbackToday:!!timestamp(c.callback)&&dayKey(timestamp(c.callback))===dayKey(now)};
}
function groupOrders(orders,now=Date.now()){
 const result={days:[],new:[],waiting:[],callbacks:[]};
 for(const o of new Map(orders.filter(Boolean).filter(o=>o.id!=null).map(o=>[String(o.id),o])).values()){
  const item=classify(o,now);if(!item.group)continue;result[item.group].push(item);if(item.callbackToday)result.callbacks.push(item);
 }
 result.days.sort((a,b)=>Number(b.overdue)-Number(a.overdue)||a.date.localeCompare(b.date)||(a.time||'99:99').localeCompare(b.time||'99:99')||String(a.order.id).localeCompare(String(b.order.id)));
 result.waiting.sort((a,b)=>Number(b.callbackToday)-Number(a.callbackToday)||String(a.order.id).localeCompare(String(b.order.id)));
 result.callbacks.sort((a,b)=>timestamp(a.contact.callback)-timestamp(b.contact.callback));return result;
}
function mine(){
 if(typeof ownOrders==='function')return(ownOrders()||[]).filter(Boolean);
 const u=state?.user||{},ids=new Set([u.id,u.staff_id,u.master_id,u.vk_user_id,u.external_id].filter(Boolean).map(String));
 return(state?.orders||[]).filter(o=>[o.master_staff_id,o.master_id,o.master_vk_id].filter(Boolean).some(id=>ids.has(String(id))));
}
const icon=name=>{const paths={clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',work:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12h18"/>',chat:'<path d="M4 3h16v14H9l-5 4V3Z"/><path d="M8 7h8M8 11h6"/>',phone:'<path d="m7 3 3 5-3 3a15 15 0 0 0 6 6l3-3 5 3c-1 5-5 5-10 2S2 8 3 4Z"/>',person:'<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>'};return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`};
const button=(label,action,id,primary=false)=>`<button type="button" class="${primary?'primary':'secondary'}" data-home-action="${action}" data-id="${escv(id)}">${escv(label)}</button>`;
function cardHtml(item,now,nextId,claims=[]){
 const {order:o,group,label,comment,rescheduled}=item,id=String(o.id),writable=String(state?.user?.role)==='master';
 const phones=window.BOS_MASTER_CLIENT_PHONES?.(o.phone||o.client_phone)||[],work=String(o.work||o.services_text||o.description||o.service_name||o.service||'Состав работ не указан');
 const primary=String(nextId)===id&&group==='days',canStage=writable&&group==='days'&&!!item.time&&agreementDone(o);
 const next=label==='Уточнить данные'?'Уточнить данные':workflowKnown(o)?step(o):rescheduled?'Согласовать новую дату':group==='new'?'Позвонить клиенту':label==='Нужно указать итог связи'?'Указать итог связи':agreementDone(o)&&group==='days'?'Подтвердить выезд':item.contact.result==='agreed'?'Согласовать дату и время':group==='waiting'?'Уточнить договорённость':'Связаться с клиентом';
 const call=phones.length===1?`<a class="primary" href="tel:${escv(phones[0].tel)}">${icon('phone')}Позвонить клиенту</a>`:button(phones.length?'Позвонить клиенту':'Телефон не указан','phones',id,true);
 let action='';
 if(writable){
  if(label==='Уточнить данные')action=button('Уточнить данные','open',id,true);
  else if(canStage&&!reportUploaded(o)&&!reportRejected(o)&&!workDone(o))action=button(stageOf(o)==='departed'?'Начать работу':'Подтвердить выезд',stageOf(o)==='departed'?'started':'departed',id,true);
  else if(workDone(o)||reportUploaded(o)||reportRejected(o))action=button(step(o),'open',id,true);
  else if(item.contact.result==='agreed')action=button('Согласовать дату','agree',id,true);
  else action=call;
  action+=button(group==='new'||label==='Нужно указать итог связи'?'Указать итог связи':'Изменить итог связи','result',id);
 }
 const callback=timestamp(item.contact.callback)?`<div class="masterV127Callback">${icon('phone')}<span>${item.callbackToday?'Перезвонить сегодня:':'Связаться:'} ${escv(window.BOS_CONTACT_STATUS?.time(item.contact.callback)||'')}</span></div>`:'';
 const reason=reportRejected(o)?'Отчёт вернули на доработку':item.overdue?attentionReason(o,now):'';
 return `<article class="masterV127Card${primary?' masterV127Next':''}${item.overdue?' reportOverdue':''}" data-order-id="${escv(id)}" data-group="${group}">
 <div class="masterV127CardTop"><button type="button" class="masterV127Number" data-home-action="open" data-id="${escv(id)}" aria-label="Открыть заявку № ${escv(orderNo(o))}">№ ${escv(orderNo(o))} <span aria-hidden="true">›</span></button><span class="masterV127Badge ${label==='Согласовано'?'agreed':group==='new'?'new':'attention'}">${escv(label)}</span></div>
 <div class="masterV127When">${icon('clock')}<div>${group==='days'?`<b>${escv(item.time||'Время уточняется')}</b><span>${escv(dayLabel(item.date,now))}</span>`:`<b>${rescheduled?'Новая дата не назначена':'Визит не назначен'}</b>`}</div></div>
 <div class="masterV127Main"><p class="masterV127Address">${icon('pin')}<span>${escv(o.address||o.client_address||'Адрес не указан')}</span></p><div class="masterV127Work">${icon('work')}<span>${escv(work)}</span></div>
 <div class="masterV127Agreement">${icon('chat')}<div><b>${group==='new'?'Ещё не связывались':label==='Согласовано'||item.contact.result==='agreed'?'Договорённость':'Итог связи'}</b><p>${escv(comment||(group==='new'?'Нужно согласовать дату и время.':label==='Согласовано'?'Дата и время согласованы.':label))}</p></div></div>${callback}
 ${reason?`<p class="masterV127Reason">${escv(reason)}</p>`:''}${claims.map(c=>`<button type="button" class="masterV127Reason" data-claim-id="${escv(c.id)}" data-home-action="claim" data-id="${escv(c.id)}">Рекламация · ${escv(window.BOS_MASTER_UPCOMING_CLAIMS_API.claimText(c))}<small>${escv(window.BOS_MASTER_UPCOMING_CLAIMS_API.claimMeta(c))}</small></button>`).join('')}
 <div class="masterV127Step"><span>Далее:</span><strong>${escv(next)}</strong></div></div>
 <div class="masterV127Actions">${action}</div></article>`;
}
function claimsFor(orders){
 const api=window.BOS_MASTER_UPCOMING_CLAIMS_API,map=new Map(),other=[],activeIds=new Set(orders.filter(active).map(o=>String(o.id)));
 for(const c of api?.openClaims()||[]){const o=api.linkedOrder(c);if(o&&activeIds.has(String(o.id))){const list=map.get(String(o.id))||[];list.push(c);map.set(String(o.id),list)}else other.push(c)}return{map,other};
}
function contentHtml(model,now,claims){
 const items=callbacksOnly?model.callbacks:model[selected],next=nextOrder(model.days.map(x=>x.order),now);
 if(!items.length)return `<div class="masterV127Empty"><b>${callbacksOnly?'На сегодня звонков нет':selected==='days'?'Выезды пока не назначены':selected==='new'?'Новых заявок нет':'Нет заявок в ожидании'}</b><span>Назначения и изменения появятся здесь автоматически.</span></div>`;
 let last='',out='';
 if(selected!=='days'&&!callbacksOnly)out=`<h3>${selected==='new'?'Нужно связаться':'По результату связи'}</h3>${selected==='new'?'<p class="masterV127Intro">Без даты и без отметки о связи.</p>':''}`;
 for(const item of items){if(!callbacksOnly&&selected==='days'){const key=item.overdue?'overdue':item.date;if(key!==last){out+=`<h3 class="masterV127DayHeading">${key==='overdue'?'Просроченные визиты':escv(dayLabel(item.date,now))}</h3>`;last=key;}}
 out+=cardHtml(item,now,next?.id,claims.map.get(String(item.order.id))||[]);}return out;
}
function removeLegacyUpcoming(root){for(const h of root.querySelectorAll('h2,h3'))if(h.textContent.trim()==='Ближайшие заявки')(h.closest('section')||h.parentElement)?.remove()}
function render(){
 queued=false;const root=document.getElementById('content');
 if(!root||!masterMode()||String(state?.page||'')!=='home'){document.getElementById('masterDailyV127')?.remove();return}
 const user=typeof liveMasterUser==='function'?liveMasterUser():state.user,who=JSON.stringify([state.user?.id,state.user?.role,user?.id,user?.external_id]);
 if(who!==identity){identity=who;selected='days';callbacksOnly=false}
 // Keep the existing bootstrap/error UI until an order snapshot is available.
 if(!Array.isArray(state.orders)||root.querySelector('h2')?.textContent==='Не удалось загрузить данные')return;
 removeLegacyUpcoming(root);
 const orders=mine(),now=Date.now(),model=groupOrders(orders,now),claims=claimsFor(orders),error=String(window.BOS_LAST_REFRESH_ERROR||'');
 const sig=JSON.stringify([model,claims.other,Array.from(claims.map),selected,callbacksOnly,dayKey(now),error,who]);
 let box=document.getElementById('masterDailyV127');if(box?.dataset.sig===sig)return;
 if(!box){box=document.createElement('section');box.id='masterDailyV127';box.className='masterV127';root.prepend(box);box.addEventListener('click',handleClick);box.addEventListener('keydown',handleTabs)}
 box.dataset.sig=sig;
 const html=`<div class="masterV127Head"><div><h2>Мой рабочий день</h2><p>${escv(new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',weekday:'long',day:'numeric',month:'long'}).format(new Date(now)))}</p></div><button class="masterV127Profile" type="button" data-home-action="profile" aria-label="Профиль мастера">${icon('person')}</button></div>
 <div class="masterV127Tabs" role="tablist" aria-label="Заявки мастера">${[['days','По дням'],['new','Новые'],['waiting','Ожидание']].map(([key,label])=>`<button type="button" role="tab" id="masterHomeTab-${key}" aria-controls="masterHomePanel" aria-selected="${selected===key}" tabindex="${selected===key?0:-1}" data-home-tab="${key}">${label}<span>${model[key].length}</span></button>`).join('')}</div>
 ${model.callbacks.length?`<button type="button" class="masterV127Callbacks" data-home-action="callbacks">${icon('phone')}<span>Перезвонить сегодня · ${model.callbacks.length}</span><span aria-hidden="true">›</span></button>`:''}
 ${error?'<div class="masterV127Error" role="status">Не удалось обновить данные. Показаны последние загруженные заявки.<button type="button" class="secondary" data-home-action="refresh">Повторить</button></div>':''}
 ${callbacksOnly?'<div class="masterV127Filter"><b>Звонки на сегодня</b><button type="button" class="secondary" data-home-action="all">Показать все заявки</button></div>':''}
 <div id="masterHomePanel" role="tabpanel" aria-labelledby="masterHomeTab-${selected}">${contentHtml(model,now,claims)}</div>
 ${claims.other.length?`<section class="masterV127Claims"><h3>Рекламации</h3>${claims.other.map(c=>`<button type="button" class="secondary" data-claim-id="${escv(c.id)}" data-home-action="claim" data-id="${escv(c.id)}">${escv(window.BOS_MASTER_UPCOMING_CLAIMS_API.claimText(c))}<small>${escv(window.BOS_MASTER_UPCOMING_CLAIMS_API.claimMeta(c))}</small></button>`).join('')}</section>`:''}`;
 const x=window.scrollX,y=window.scrollY;if(window.BOS_PATCH_CONTENT)window.BOS_PATCH_CONTENT(box,html);else box.innerHTML=html;window.scrollTo?.(x,y);
}
function handleTabs(e){const tab=e.target.closest('[data-home-tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const keys=['days','new','waiting'],index=keys.indexOf(tab.dataset.homeTab);selected=keys[e.key==='Home'?0:e.key==='End'?2:(index+(e.key==='ArrowRight'?1:2))%3];callbacksOnly=false;render();document.getElementById('masterHomeTab-'+selected)?.focus()}
function openPhones(id){
 const o=mine().find(o=>String(o.id)===String(id));if(!o)return;
 const phones=window.BOS_MASTER_CLIENT_PHONES?.(o.phone||o.client_phone)||[];
 openModal(`<h2>Позвонить клиенту</h2><div class="masterV127Phones" data-master-order-id="${escv(id)}">${phones.length?phones.map(p=>`<div><a class="primary" href="tel:${escv(p.tel)}">${escv(p.label)}</a><button type="button" class="secondary" data-copy-phone="${escv(p.tel)}">Копировать</button></div>`).join(''):'<p>Телефон не указан. Уточните его у диспетчера.</p>'}</div><button class="secondary wide" type="button" onclick="closeModal()">Закрыть</button>`);
 document.querySelectorAll('[data-copy-phone]').forEach(b=>b.onclick=()=>window.copyMasterPhone72?.(b.dataset.copyPhone,b));
}
function handleClick(e){
 const tab=e.target.closest('[data-home-tab]');if(tab){selected=tab.dataset.homeTab;callbacksOnly=false;render();return}
 const control=e.target.closest('[data-home-action]');if(!control)return;const action=control.dataset.homeAction,id=control.dataset.id;
 if(action==='profile'){document.getElementById('profileBtn')?.click();return}
 if(action==='callbacks'||action==='all'){callbacksOnly=action==='callbacks';render();return}
 if(action==='refresh'){window.BOS_REFRESH_NOW?.();return}
 if(action==='claim'){window.openClaimDetails?.(id);return}
 const o=mine().find(x=>String(x.id)===String(id));if(!o)return;
 if(action==='open'){window.openOrder?.(id);return}
 if(String(state?.user?.role)!=='master'||!active(o))return;
 if(action==='phones'){openPhones(id);return}
 if(action==='result'){window.openMasterContactResultForOrder?.(id);return}
 if(action==='agree'){window.masterOrderAgree179?.(id);return}
 if(action==='departed'||action==='started'){window.openOrder?.(id);window.masterOrderStage179?.(id,action)}
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(render)}
const baseShow=window.show;if(typeof baseShow==='function')window.show=function(){const out=baseShow.apply(this,arguments);setTimeout(schedule,0);return out};
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('bos:employee-data-refreshed',schedule);window.addEventListener('bos:employee-data-refresh-error',schedule);window.addEventListener('resize',schedule);
setInterval(schedule,60000);setTimeout(schedule,0);
window.BOS_MASTER_DAILY_HOME_V127_API={refresh:schedule,step,attentionReason,reportOverdue,scheduleEndTs,nextOrder,classify,groupOrders,dayKey};
const style=document.createElement('style');style.textContent=`
.masterV127{margin:0 0 18px;color:#edf5ff}.masterV127 *{box-sizing:border-box}.masterV127 svg{width:22px;height:22px;flex:0 0 22px;color:#9ecbff}.masterV127Head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:4px 0 16px}.masterV127Head h2{margin:0;font-size:23px;line-height:1.25}.masterV127Head p{margin:5px 0 0;color:#acc5df;font-size:14px}.masterV127Head p:first-letter{text-transform:uppercase}.masterV127Profile{width:44px;height:44px;min-width:44px;border:1px solid #31537d;border-radius:50%;background:#183659;display:grid;place-items:center;cursor:pointer}.masterV127Tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;padding:3px;border-radius:13px;border:1px solid #264966;background:#0c2035;margin-bottom:12px}.masterV127Tabs button{display:flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:7px 4px;font-size:14px;border:0;border-radius:9px;background:transparent;color:#dcecff;white-space:normal;cursor:pointer}.masterV127Tabs button[aria-selected=true]{background:#1376f8;color:#fff;box-shadow:0 3px 10px #0069ee33}.masterV127Tabs button span{padding:2px 6px;border-radius:7px;background:#ffffff15;font-weight:800;font-size:13px}.masterV127Callbacks{display:flex;align-items:center;gap:10px;padding:11px 13px;width:100%;min-height:44px;border:1px solid #ffc04e;border-radius:12px;color:#ffcd66;background:#ffc04e0a;font-size:14px;font-weight:750;cursor:pointer}.masterV127Callbacks svg,.masterV127Callback svg{color:#ffc04e}.masterV127Callbacks span:last-child{margin-left:auto;font-size:23px;line-height:18px}.masterV127 h3{font-size:18px;line-height:1.4;margin:19px 0 10px}.masterV127Intro{font-size:14px;margin:-4px 0 12px;color:#bfd0e1}.masterV127Card{display:block;width:100%;text-align:left;margin:0 0 16px;padding:16px;background:linear-gradient(125deg,#102d49,#0b2035);border:1px solid #315a7c;border-radius:15px;box-shadow:0 4px 12px #0002;min-width:0}.masterV127CardTop{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:9px;font-size:14px;font-weight:700;margin-bottom:13px}.masterV127Badge{display:inline-block;max-width:100%;border-radius:20px;padding:5px 10px;line-height:1.3;font-size:12px;border:1px solid #527ca3;background:#193b5a;color:#cfe3f7}.masterV127Badge.agreed{border-color:#4ce2e3;color:#79f3f2;background:#06525b66}.masterV127Badge.new{background:#1376f8;color:white;border-color:#4599ff}.masterV127Badge.attention{color:#ffda88;border-color:#967234;background:#55422144}.masterV127When{display:flex;align-items:center;gap:10px;margin-bottom:13px}.masterV127When b{font-size:25px;line-height:1.2;display:block}.masterV127When span{display:block;margin-top:4px;font-size:13px;color:#acc5df}.masterV127Card[data-group=new] .masterV127When b,.masterV127Card[data-group=waiting] .masterV127When b{font-size:16px}.masterV127Main{min-width:0;overflow-wrap:anywhere}.masterV127Address,.masterV127Work{display:flex;gap:10px;align-items:flex-start;margin:10px 0;line-height:1.5;font-size:15px}.masterV127Address span{font-weight:700}.masterV127Work span{white-space:pre-line}.masterV127Agreement{display:flex;align-items:flex-start;gap:10px;padding:11px 12px;margin-top:13px;border:1px solid #2b5477;border-radius:11px;background:#163d612f}.masterV127Agreement>div{min-width:0}.masterV127Agreement b{font-size:13px;font-weight:650;color:#9dd4ff}.masterV127Agreement p{font-size:14px;line-height:1.5;margin:4px 0 0;white-space:pre-line;overflow-wrap:anywhere}.masterV127Callback{display:flex;gap:9px;align-items:center;margin-top:10px;padding:9px 10px;border:1px solid #e4b64a;border-radius:10px;color:#ffcd66;background:#6c541d25;font-size:13px;font-weight:650}.masterV127Step{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px;margin-top:12px;font-size:14px;line-height:1.4}.masterV127Step>span{font-size:12px;color:#9cb2c8}.masterV127Step strong{font-weight:650}.masterV127Actions{display:grid;gap:8px;margin-top:13px}.masterV127Actions .primary,.masterV127Actions .secondary,.masterV127Phones a{display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;height:auto;margin:0;padding:10px 12px;width:100%;border-radius:10px;line-height:1.4;font-size:14px;font-weight:700;text-align:center;white-space:normal;overflow-wrap:anywhere;text-decoration:none;cursor:pointer}.masterV127Actions .primary{background:#1376f8;border:1px solid #278aff;color:#fff}.masterV127Actions .secondary{background:transparent;border:1px solid #5c94c1;color:#e7f2ff}.masterV127Actions .primary svg{color:#fff;width:18px;height:18px}.masterV127Number{display:flex;align-items:center;gap:9px;font:inherit;color:inherit;background:none;border:0;padding:6px 0;min-height:44px;cursor:pointer}.masterV127Number>span{font-size:20px;color:#93b9db}.masterV127Card.reportOverdue{border-color:#e78576}.masterV127Reason{display:block;font-size:13px;line-height:1.5;color:#ffb5a9;background:transparent;border:0;padding:0;margin:12px 0 0;overflow-wrap:anywhere;text-align:left}.masterV127Reason small,.masterV127Claims small{display:block;font-size:12px}.masterV127Claims>button{display:block;width:100%;text-align:left;white-space:normal;min-height:44px;margin:8px 0}.masterV127Empty{display:grid;gap:7px;border:1px dashed #315576;padding:23px 16px;border-radius:14px;margin-top:18px;font-size:15px;line-height:1.5}.masterV127Empty span{font-size:14px;color:#adc4db}.masterV127Error,.masterV127Filter{display:grid;gap:9px;padding:13px 0;color:#ffda88;font-size:14px;line-height:1.5}.masterV127Phones{display:grid;gap:12px;margin:18px 0}.masterV127Phones>div{display:grid;grid-template-columns:1fr auto;gap:8px}.masterV127 button:focus-visible,.masterV127 a:focus-visible{outline:3px solid #8fc5ff;outline-offset:3px}
@media(min-width:700px){.masterV127{max-width:760px;margin-left:auto;margin-right:auto}.masterV127Card{padding:20px}.masterV127Actions{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:380px){.masterV127Head h2{font-size:21px}.masterV127Card{padding:13px}.masterV127Tabs button{font-size:13px;gap:4px}.masterV127When b{font-size:23px}}
`;document.head.appendChild(style);
})();
