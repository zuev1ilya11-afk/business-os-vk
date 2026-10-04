(function(root,factory){
'use strict';
const calendar=factory();
if(typeof module==='object'&&module.exports){module.exports=calendar;return;}
function isDispatcherNow(){return (typeof isDispatcherPreview==='function'&&isDispatcherPreview())||state.user?.role==='dispatcher'}
function isOwnerNow(){return ['owner','manager'].includes(state.user?.role)&&!isDispatcherNow()&&!(typeof isMasterPreview==='function'&&isMasterPreview())}
const number=v=>Number.isFinite(Number(v))?Number(v):0;
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const done=o=>o.status==='Выполнена';
const alive=o=>o.status!=='Отменена';
const orderNo=o=>String(o.external_id||'').startsWith('hands:')?String(o.external_id).slice(6):String(o.id||'—');
const orderButton=(o,review=false)=>`data-owner-${review?'review':'order'}="${esc(o.id)}"`;
function corrections(){return (state.orders||[]).filter(o=>done(o)&&(o.report_review_status==='rejected'||number(o.uncompleted_work_amount)>0)).sort((a,b)=>String(b.report_uploaded_at||b.updated_at||'').localeCompare(String(a.report_uploaded_at||a.updated_at||'')))}
function pending(){return (state.orders||[]).filter(o=>o.report_uploaded_at&&String(o.report_review_status||'pending')==='pending')}
function dateLabel(date){return new Date(date+'T12:00:00Z').toLocaleDateString('ru-RU',{timeZone:'UTC',day:'numeric',month:'short'}).replace(/\.$/,'')}
function statusLabel(o){
 if(done(o)||o.status==='Отменена')return o.status;
 if(o.report_review_status==='rejected')return 'Отчёт отклонён';
 if(o.report_uploaded_at&&String(o.report_review_status||'pending')==='pending')return 'Отчёт на проверке';
 if(o.master_workflow_stage==='started')return 'В работе';
 if(['departed','arrived'].includes(o.master_workflow_stage))return 'В пути';
 return 'Запланировано';
}
function snapshot(){
 const days=calendar.days(),today=days[0].date,orders=(state.orders||[]).filter(Boolean),masters=(state.masters||[]).filter(Boolean);
 const contract=root.BOS_SCHEDULE_CONTRACT,aliases=new Map(),names=new Map(),buckets=new Map();
 masters.forEach((m,i)=>{contract.masterIds(m).forEach(id=>aliases.set(id,i));const name=String(m.full_name||m.name||'').trim();if(name)names.set(name,names.has(name)?null:i)});
 function masterIndex(o){const ids=contract.orderIds(o);if(ids.length){for(const id of ids)if(aliases.has(id))return aliases.get(id);return null}return names.get(String(o.master_name||'').trim())}
 const cell=(i,date)=>{const key=i+'|'+date;if(!buckets.has(key))buckets.set(key,{orders:[],working:false});return buckets.get(key)};
 const validDays=new Set(days.map(d=>d.date));
 for(const o of orders){const date=String(o.scheduled_date||'').slice(0,10),i=masterIndex(o);if(i!=null&&alive(o)&&validDays.has(date))cell(i,date).orders.push(o)}
 for(const s of state.masterSchedule||[]){
  const date=String(s.work_date||s.date||'').slice(0,10);if(!validDays.has(date))continue;
  const ids=[s.staff_id,s.master_staff_id,s.master_id,s.master_vk_id,s.vk_user_id,s.user_id,s.external_id].filter(Boolean).map(String);
  const id=ids.find(id=>aliases.has(id));if(id===undefined)continue;
  cell(aliases.get(id),date).working=s.is_working===true||s.is_working===1||String(s.is_working).toLowerCase()==='true';
 }
 const conflicts=new Set(root.BOS_DISPATCHER_CONFLICTS?.ids()||[]);
 const rows=masters.map((master,i)=>({master,cells:days.map(d=>{const c=cell(i,d.date);return {...c,date:d.date,kind:c.orders.some(o=>conflicts.has(String(o.id)))?'conflict':c.orders.length?'busy':c.working?'free':'off'}})}));
 const todayOrders=orders.filter(o=>alive(o)&&String(o.scheduled_date||'').slice(0,10)===today).sort((a,b)=>(contract.range(a)?.start??1441)-(contract.range(b)?.start??1441));
 // Reuse the salary calendar's established completion-day precedence, never the scheduled day when an actual completion is available.
 const completed=orders.filter(o=>done(o)&&(root.BOS_SALARY_PERIODS?.completedDay(o)||'')===today);
 const revenue=completed.every(o=>finite(o.amount))?completed.reduce((n,o)=>n+number(o.amount),0):null;
 const payments=completed.map(o=>root.BOS_ORDER_PAYROLL?.directMaster(o)??(finite(o.master_payout)?Number(o.master_payout):typeof payout==='function'?payout(o.amount):null));
 const pay=payments.every(finite)?payments.reduce((a,b)=>a+b,0):null;
 const shares=completed.map(o=>root.BOS_ORDER_PAYROLL?.directCompany(o));
 const company=completed.length&&shares.every(finite)?shares.reduce((a,b)=>a+b,0):null;
 return {days,today,rows,todayOrders,completed,revenue,pay,company,active:rows.filter(r=>r.cells[0].working||r.cells[0].orders.length).length,free:rows.filter(r=>r.cells[0].kind==='free').length};
}
function metric(key,icon,title,value,hint){return `<section class="card dashMetric" data-owner-kpi="${key}"><span class="dashIcon" aria-hidden="true">${icon}</span><span class="muted">${title}</span><strong>${value}</strong><small>${hint}</small></section>`}
function metrics(s){return `<div class="dashMetrics odMetrics">${metric('today','▤','Заявок сегодня',s.todayOrders.length,'Назначены на сегодня')}${metric('masters','♟','Активных мастеров',s.active+`<em> / ${s.rows.length}</em>`,'По графику или с заявками')}${metric('corrections','↩','Корректировки',corrections().length,'По выполненным заявкам')}${metric('revenue','₽','Выручка сегодня',s.revenue===null?'—':money(s.revenue),'По выполненным · без допработ')}${s.company!==null?metric('company','▥','Доля компании',money(s.company),'Действующий расчёт источника'):''}${s.revenue!==null&&s.completed.length?metric('average','◇','Средний чек',money(s.revenue/s.completed.length),'По выполненным сегодня'):''}</div>`}
function loadTable(s){return `<section class="card odLoad" aria-labelledby="odLoadTitle"><div class="odHeading"><div><h2 id="odLoadTitle">Загруженность мастеров</h2><p class="muted">7 дней · первый день — сегодня · МСК</p></div><span class="softChip">${s.rows.length} маст.</span></div><div class="odLegend"><span><i class="busy"></i>Есть заявки</span><span><i class="free"></i>Работает без заявок</span><span><i class="off"></i>Нет рабочего графика</span><span><i class="conflict"></i>Конфликт</span></div>${s.rows.length?`<div class="odTableScroll" tabindex="0" role="region" aria-label="Загрузка мастеров на семь дней"><table class="odTable"><thead><tr><th scope="col">Мастер</th>${s.days.map(d=>`<th scope="col" data-date="${d.date}" class="${d.date===s.today?'odToday':''}"><b>${d.label}</b><span>${dateLabel(d.date)}</span></th>`).join('')}</tr></thead><tbody>${s.rows.map(r=>`<tr><th scope="row"><span class="odAvatar" aria-hidden="true">${esc(String(r.master.full_name||r.master.name||'М').split(/\s+/).map(w=>w[0]).slice(0,2).join(''))}</span><span title="${esc(r.master.full_name||r.master.name||'Мастер')}">${esc(r.master.full_name||r.master.name||'Мастер')}</span></th>${r.cells.map(c=>{const label=c.kind==='conflict'?'Конфликт':c.orders.length?`${c.orders.length} заяв.`:c.working?'Свободен':'—';return `<td class="${c.date===s.today?'odToday':''}"><button type="button" class="odDay ${c.kind}" data-owner-day="${c.date}" data-owner-master="${esc(root.BOS_SCHEDULE_CONTRACT.masterIds(r.master)[0]||'')}" aria-label="${esc(r.master.full_name||'Мастер')}, ${dateLabel(c.date)}, ${label}" title="${label}">${label}</button></td>`}).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="odEmpty muted">Мастеров пока нет.</p>'}<button type="button" class="secondary odScheduleLink" data-owner-page="dispatch"><span>${s.free?`Работают без заявок сегодня: ${s.free}`:'Расписание и доступность мастеров'}</span><span>Открыть расписание →</span></button></section>`}
function todayBlock(s){const list=s.todayOrders.filter(o=>!done(o)).concat(s.todayOrders.filter(done)).slice(0,6);return `<section class="card odTodayList"><div class="odHeading"><h2>Сегодня в работе <span class="softChip">${s.todayOrders.length}</span></h2><button class="linkBtn" data-owner-page="orders">Все заявки →</button></div>${list.length?`<div class="odOrders">${list.map(o=>`<button type="button" class="odOrder" ${orderButton(o)}><time>${esc(root.BOS_SCHEDULE_CONTRACT.timeOf(o)||'—')}</time><span class="odOrderText"><b>${esc(o.client||o.work||'Заявка')} <small>№ ${esc(orderNo(o))}</small></b><span>${esc(o.address||'Адрес не указан')}</span><small>${esc(o.master_name||'Без мастера')}</small></span><span class="odStatus ${done(o)?'complete':''}">${statusLabel(o)}</span></button>`).join('')}</div>`:'<p class="odEmpty muted">На сегодня заявок нет.</p>'}</section>`}
function archiveLink(){try{const u=new URL(String(state.settings?.reports_drive_folder_url||''));return ['https:','http:'].includes(u.protocol)?`<a class="secondary wide odArchive" target="_blank" rel="noopener" href="${esc(u.href)}">Архив отчётов ↗</a>`:''}catch{return ''}}
function reports(s){const list=pending(),today=list.filter(o=>calendar.day(new Date(o.report_uploaded_at))===s.today).length;return `<section class="card reportQueue odReports"><button class="odHeading odHeadingButton" data-owner-list="reports"><h3>Отчёты на проверку</h3><span>→</span></button><strong class="odBig">${list.length}</strong><p class="muted">Ожидают решения</p><dl class="odNumbers"><div><dt>Получены сегодня</dt><dd>${today}</dd></div><div><dt>Ранее</dt><dd>${list.length-today}</dd></div></dl>${list.length?list.slice(0,2).map(o=>`<button class="reportReviewCard odReportShortcut" ${orderButton(o,true)}><b>${esc(o.id)} · ${esc(o.work||'Заявка')}</b><small>${esc(o.master_name||'Мастер')} · ${esc(o.address||'')}</small><span>Проверить отчёт →</span></button>`).join(''):'<p class="muted">Новых отчётов на проверку нет.</p>'}${archiveLink()}</section>`}
function correctionRows(list){return list.map(o=>`<button class="odCorrection" ${orderButton(o,!!o.report_uploaded_at)}><span><b>№ ${esc(orderNo(o))}</b> · ${esc(o.master_name||'Мастер')}<small>${esc(o.uncompleted_work_description||o.report_review_comment||(o.report_review_status==='rejected'?'Отчёт отклонён — нужна корректировка':'Есть невыполненные работы'))}</small></span><span class="odStatus">${o.report_review_status==='rejected'?'Отклонён':'Невыполненные работы'}</span></button>`).join('')}
function correctionsBlock(){const list=corrections();return `<section class="card odCorrections"><div class="odHeading"><h3>Корректировки по выполненным заявкам</h3><button class="linkBtn" data-owner-list="corrections">Все (${list.length}) →</button></div>${list.length?correctionRows(list.slice(0,3)):'<p class="odEmpty muted">Корректировок нет.</p>'}</section>`}
function finances(s){return `<section class="card odFinance"><div class="odHeading"><h3>Финансы</h3><span class="softChip">Сегодня</span></div><dl class="odNumbers"><div><dt>Выручка</dt><dd>${s.revenue===null?'—':money(s.revenue)}</dd></div><div><dt>Начислено мастерам</dt><dd data-owner-finance="pay">${s.pay===null?'—':money(s.pay)}</dd></div>${s.company!==null?`<div><dt>Доля компании</dt><dd data-owner-finance="company">${money(s.company)}</dd></div>`:''}</dl><p class="muted odNote">Основные работы по выполненным сегодня заявкам, без допработ.${s.completed.length&&s.company===null?' Доля компании для этого состава источников не показана.':''}</p></section>`}
function actions(s){const count=s.todayOrders.filter(done).length,percent=s.todayOrders.length?Math.round(count/s.todayOrders.length*100):0;return `<section class="card odActions"><h3>Быстрые действия</h3><div class="odQuick"><button class="primary" data-owner-new>+ Новая заявка</button><button class="secondary" data-owner-page="dispatch">Открыть расписание</button><button class="secondary" data-owner-page="team">Мастера</button><button class="secondary" data-owner-page="orders">Все заявки</button></div><div class="odDayResult"><h3>Итоги дня</h3><p>Выполнено ${count} из ${s.todayOrders.length} заявок${s.todayOrders.length?` (${percent}%)`:''}</p><progress value="${count}" max="${s.todayOrders.length||1}" aria-label="Выполненные заявки сегодня"></progress></div></section>`}
function widget(title,render){try{return render()}catch{return `<section class="card"><h3>${title}</h3><p class="muted">Не удалось показать блок. Обновите данные.</p></section>`}}
function dashboard(){const s=snapshot();return `<div id="ownerDashboard" data-day="${s.today}"><p class="odRefreshState" role="status" ${root.BOS_LAST_REFRESH_ERROR?'':'hidden'}>${root.BOS_LAST_REFRESH_ERROR?'Не удалось обновить данные. Показаны ранее загруженные значения.':''}</p>${widget('Показатели',()=>metrics(s))}<div class="odMain">${widget('Загруженность мастеров',()=>loadTable(s))}${widget('Сегодня в работе',()=>todayBlock(s))}</div><div class="odBottom">${widget('Отчёты на проверку',()=>reports(s))}${widget('Корректировки',correctionsBlock)}${widget('Финансы',()=>finances(s))}${widget('Быстрые действия',()=>actions(s))}</div></div>`}
const previousHome=pages.home;
pages.home=function(){
 if(isDispatcherNow()){const html=previousHome();return String(html).includes('Загруженность мастеров')?html:(typeof loadChart==='function'?loadChart():'')+html}
 if(!isOwnerNow())return previousHome();
 return dashboard();
};
// Delegate to existing order, review, creation and navigation handlers; never write from the dashboard.
document.addEventListener('click',event=>{
 if(!isOwnerNow())return;
 const b=event.target.closest?.('[data-owner-page],[data-owner-new],[data-owner-order],[data-owner-review],[data-owner-list],[data-owner-day]');if(!b)return;
 if(b.dataset.ownerPage){show(b.dataset.ownerPage);return}
 if(b.hasAttribute('data-owner-new')){openOrderForm();return}
 if(b.dataset.ownerOrder||b.dataset.ownerReview){const id=b.dataset.ownerOrder||b.dataset.ownerReview;closeModal();if(b.dataset.ownerReview)openReportReview(id);else openOrder(id);return}
 if(b.dataset.ownerList){const review=b.dataset.ownerList==='reports',list=review?pending():corrections();openModal(`<h2>${review?'Отчёты на проверку':'Корректировки'}</h2><div class="odModalList">${review?list.map(o=>`<button class="secondary wide" ${orderButton(o,true)}>№ ${esc(orderNo(o))} · ${esc(o.master_name||'Мастер')} →</button>`).join(''):correctionRows(list)}</div>${list.length?'':'<p class="muted">Записей нет.</p>'}`);return}
 if(b.dataset.ownerDay){const s=snapshot(),row=s.rows.find(r=>root.BOS_SCHEDULE_CONTRACT.masterIds(r.master).includes(b.dataset.ownerMaster)),cell=row?.cells.find(c=>c.date===b.dataset.ownerDay);if(!cell)return;
  openModal(`<h2>${esc(row.master.full_name||'Мастер')} · ${dateLabel(cell.date)}</h2><p class="muted">${cell.working?'Рабочий день':'Рабочий график не указан'}${cell.kind==='conflict'?' · Есть пересечение заявок':''}</p><div class="odModalList">${cell.orders.map(o=>`<button class="secondary wide" ${orderButton(o)}>${esc(root.BOS_SCHEDULE_CONTRACT.timeOf(o)||'Без времени')} · № ${esc(orderNo(o))} · ${esc(o.work||'Заявка')}</button>`).join('')||'<p>Заявок нет.</p>'}</div><button class="secondary wide" onclick="closeModal();show('dispatch')">Открыть расписание →</button>`);
 }
});
function refreshDay(){const node=document.getElementById('ownerDashboard');if(isOwnerNow()&&state.page==='home'&&node&&node.dataset.day!==calendar.day(new Date())){node.outerHTML=dashboard();root.BOS_ORDER_CONTROL?.refresh()}}
let midnight;
function clock(){clearTimeout(midnight);const next=calendar.days()[1].date;midnight=setTimeout(()=>{refreshDay();clock()},Math.max(1000,Date.parse(next+'T00:00:00+03:00')-Date.now()+50))}
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshDay();clock()}});
function refreshNotice(error){const node=document.querySelector('#ownerDashboard .odRefreshState');if(node){node.hidden=!error;node.textContent=error?'Не удалось обновить данные. Показаны ранее загруженные значения.':''}}
root.addEventListener('bos:employee-data-refresh-error',()=>refreshNotice(true));
root.addEventListener('bos:employee-data-refreshed',()=>{refreshDay();refreshNotice(false)});
function setLoadState(value){
 const node=document.getElementById('ownerDashboard');if(!node)return;
 const busy=String(value==='loading');if(node.getAttribute('aria-busy')!==busy)node.setAttribute('aria-busy',busy);
 const notice=node.querySelector('.odRefreshState'),text=value==='error'?'Не удалось обновить данные. Показаны ранее загруженные значения.':'';
 if(notice){if(notice.hidden!==!text)notice.hidden=!text;if(notice.textContent!==text)notice.textContent=text}
}
function refreshView(){
 const node=document.getElementById('ownerDashboard');
 if(!node||!isOwnerNow()||state.page!=='home'||!root.BOS_PATCH_CONTENT)return false;
 const template=document.createElement('template');template.innerHTML=dashboard();const fresh=template.content.firstElementChild;
 root.BOS_PATCH_CONTENT(node,fresh.innerHTML);node.dataset.day=fresh.dataset.day;root.BOS_ORDER_CONTROL?.refresh();return true;
}
root.BOS_OWNER_DASHBOARD=Object.freeze({days:calendar.days,active:isOwnerNow,setLoadState,refresh:refreshView});
clock();
})(typeof window==='undefined'?globalThis:window,function(){
'use strict';
const format=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'});
function day(now){if(!Number.isFinite(now.getTime()))return '';const p=Object.fromEntries(format.formatToParts(now).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`}
function days(now=new Date()){
 const today=day(now);if(!today)return [];
 return Array.from({length:7},(_,i)=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);const label=i?d.toLocaleDateString('ru-RU',{timeZone:'UTC',weekday:'short'}):'Сегодня';return {date:d.toISOString().slice(0,10),label:label[0].toUpperCase()+label.slice(1)}});
}
return {days,day};
});
