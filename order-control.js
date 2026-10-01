(function(root,factory){
  'use strict';
  const core=factory();
  if(typeof module==='object'&&module.exports){module.exports=core;return;}
  if(root.BOS_ORDER_CONTROL)return;
  const getState=()=>typeof state==='undefined'?{}:state;
  const allowed=()=>document.body.classList.contains('bos-auth-ok')&&root.BOS_PERMISSIONS?.isDispatcherWorkspaceActive(getState().user);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let filter='all',limit=12,queued=false,actor='',midnightTimer;
  const filters=[['all','Все'],['urgent','Срочно'],['dispatcher','Диспетчеру'],['master','Мастеру'],['reports','Отчёты']];
  const matches=(item,key)=>key==='all'||(key==='urgent'?item.priority===0:key==='reports'?item.issues.some(x=>x.code.startsWith('report_')):item.issues.some(x=>x.role===key));
  function card(item){
    const review=item.issues.some(x=>x.code==='report_review');
    return `<article class="ocItem" data-oc-order="${escape(item.id)}"><div class="ocItemTop"><b>№ ${escape(item.number)}</b><span>${escape(item.visit)}</span></div><div class="ocClient">${escape(item.client||'Клиент не указан')}</div><div class="ocWork">${escape(item.work||'Работы не указаны')}</div>${item.issues.map(issue=>`<div class="ocIssue" data-oc-reason="${issue.code}"><strong>${escape(issue.title)}</strong><span>Кто действует: ${escape(issue.role==='master'?item.master||'Назначенный мастер':'Диспетчер')}</span><span>${escape(issue.next)}</span></div>`).join('')}<button type="button" class="secondary" data-oc-open="${escape(item.id)}" data-oc-action="${review?'review':'order'}">${review?'Проверить отчёт':'Открыть заявку'}</button></article>`;
  }
  function render(){
    queued=false;
    const s=getState(),content=document.getElementById('content');
    let panel=document.getElementById('bosOrderControl');
    if(!content||!allowed()||s.page!=='home'){panel?.remove();return;}
    const identity=JSON.stringify([s.user?.id,s.user?.external_id,s.user?.role]);
    if(actor!==identity){actor=identity;filter='all';limit=12;}
    const loaded=Array.isArray(s.orders);
    const all=loaded?core.collect(s.orders):[];
    const visible=all.filter(item=>matches(item,filter));
    const signature=JSON.stringify([identity,loaded,filter,limit,all]);
    if(!panel){panel=document.createElement('section');panel.id='bosOrderControl';panel.className='card ocPanel';panel.setAttribute('aria-labelledby','ocTitle');content.prepend(panel);}
    if(panel.dataset.signature===signature)return;
    const focused=document.activeElement;
    const restore=panel.contains(focused)?focused?.getAttribute('data-oc-filter'):null;
    panel.dataset.signature=signature;
    panel.innerHTML=`<div class="ocHeading"><div><div class="eyebrow">КОНТРОЛЬ ЗАЯВОК</div><h2 id="ocTitle">Требует внимания</h2></div><span class="softChip" data-oc-total>${all.length}</span></div><p class="muted ocNote">По загруженным заявкам. Даты визитов — по Москве. Автонапоминания не включены.</p><div class="ocFilters" aria-label="Фильтры контроля заявок">${filters.map(([key,title])=>`<button type="button" class="${filter===key?'primary':'secondary'}" data-oc-filter="${key}" aria-pressed="${filter===key}">${title} <b>${all.filter(item=>matches(item,key)).length}</b></button>`).join('')}</div><div class="ocList">${!loaded?'<p class="muted">Заявки ещё не загружены.</p>':visible.length?visible.slice(0,limit).map(card).join(''):'<p class="muted ocEmpty">'+(all.length?'По этому фильтру задач нет.':'По проверяемым условиям проблем не найдено.')+'</p>'}</div>${visible.length>limit?`<button type="button" class="secondary wide" data-oc-more>Показать ещё (${visible.length-limit})</button>`:''}`;
    if(restore)panel.querySelector(`[data-oc-filter="${restore}"]`)?.focus({preventScroll:true});
  }
  function refresh(){if(queued)return;queued=true;requestAnimationFrame(render);}
  function resetClock(){
    clearTimeout(midnightTimer);
    const now=new Date(),next=core.nextDay(core.businessDay(now));
    const delay=Math.max(1000,Date.parse(next+'T00:00:00+03:00')-now.getTime()+50);
    midnightTimer=setTimeout(()=>{refresh();resetClock();},delay);
  }
  document.addEventListener('click',event=>{
    const panel=event.target.closest?.('#bosOrderControl');
    if(!panel||!allowed())return;
    const selected=event.target.closest('[data-oc-filter]');
    if(selected){filter=selected.dataset.ocFilter;limit=12;refresh();return;}
    if(event.target.closest('[data-oc-more]')){limit+=12;refresh();return;}
    const button=event.target.closest('[data-oc-open]');
    if(!button)return;
    const order=(getState().orders||[]).find(x=>String(x.id)===button.dataset.ocOpen);
    if(!order){refresh();return;}
    // Re-evaluate after refresh: a stale button must not open an already reviewed report.
    const pending=core.collect([order]).some(x=>x.issues.some(y=>y.code==='report_review'));
    if(button.dataset.ocAction==='review'&&pending&&typeof root.openReportReview==='function')root.openReportReview(String(order.id));
    else if(typeof root.openOrder==='function')root.openOrder(String(order.id));
  });
  function start(){
    const content=document.getElementById('content');
    if(content)new MutationObserver(refresh).observe(content,{childList:true,subtree:true});
    new MutationObserver(refresh).observe(document.body,{attributes:true,attributeFilter:['class']});
    refresh();resetClock();
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();resetClock();}});
  document.addEventListener('bos:data-refreshed',refresh);
  root.addEventListener('pageshow',refresh);
  root.BOS_ORDER_CONTROL=Object.freeze({...core,refresh});
  const style=document.createElement('style');
  style.textContent=`#content:has(> #bosOrderControl)>.ownerProblemsCompact{display:none!important}#content>#bosOrderControl{grid-column:1/-1;grid-row:1;order:-4}#content:has(> #bosOrderControl)>.dashMetrics{grid-row:2}#content:has(> #bosOrderControl)>.loadCard{grid-row:3}.ocPanel{margin-bottom:16px;min-width:0}.ocHeading,.ocItemTop{display:flex;justify-content:space-between;align-items:center;gap:10px}.ocHeading h2{margin:4px 0}.ocNote{font-size:12px;line-height:1.5}.ocFilters{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.ocFilters button{min-height:44px;white-space:normal}.ocFilters b{margin-left:5px}.ocList{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px}.ocItem{border:1px solid var(--line,rgba(255,255,255,.12));border-radius:12px;padding:12px;min-width:0;display:flex;flex-direction:column;gap:8px;overflow-wrap:anywhere}.ocItemTop{align-items:flex-start;font-size:12px}.ocItemTop span{color:var(--muted,#91a3b7);text-align:right}.ocClient{font-weight:700}.ocWork,.ocIssue span{font-size:12px;line-height:1.45}.ocIssue{display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--line,rgba(255,255,255,.12));padding-top:8px}.ocIssue strong{font-size:13px}.ocIssue span{color:var(--muted,#91a3b7)}.ocItem>button{margin-top:auto;min-height:44px}.ocEmpty{grid-column:1/-1}.ocPanel button:focus-visible{outline:2px solid currentColor;outline-offset:2px}@media(max-width:760px){.ocList{grid-template-columns:minmax(0,1fr)}.ocFilters{gap:6px}.ocFilters button{flex:1 1 125px;font-size:12px;padding:8px;white-space:nowrap}.ocItemTop{flex-wrap:wrap}.ocItemTop span{text-align:left}.ocPanel{padding:12px}}`;
  document.head.appendChild(style);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const text=value=>String(value??'').trim();
  const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'});
  function businessDay(now=new Date()){
    const parts=Object.fromEntries(dateFormat.formatToParts(now).map(x=>[x.type,x.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function dateOnly(value){
    const s=text(value).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return '';
    const d=new Date(s+'T00:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s?s:'';
  }
  function nextDay(day){return new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);}
  function visitTime(order){
    const raw=text(order.scheduled_time)||text(order.time_slot);
    const match=raw.match(/^(\d{1,2}):(\d{2})(?:$|\b)/);
    return match&&Number(match[1])<24&&Number(match[2])<60?`${match[1].padStart(2,'0')}:${match[2]}`:'';
  }
  function collect(orders,now=new Date()){
    const today=businessDay(now),tomorrow=nextDay(today),seen=new Set(),result=[];
    for(const order of Array.isArray(orders)?orders:[]){
      if(!order||typeof order!=='object')continue;
      const id=text(order.id),status=text(order.status);
      if(!id||seen.has(id)||['Выполнена','Отменена'].includes(status))continue;
      seen.add(id);
      const date=dateOnly(order.scheduled_date),time=visitTime(order);
      const assigned=[order.master_staff_id,order.master_vk_id,order.master_id,order.master_name].some(x=>!!text(x));
      const near=!!date&&date<=tomorrow,late=!!date&&date<today;
      const review=text(order.report_review_status),issues=[];
      const add=(code,title,role,next,priority)=>issues.push({code,title,role,next,priority});
      const transfer=order.reschedule_requested===true||order.reschedule_requested==='true';
      if(transfer)add('reschedule','Запрошен перенос','dispatcher',text(order.reschedule_reason)||'Уточнить причину и согласовать новое время.',0);
      if(review==='rejected'){
        add('report_rejected','Отчёт возвращён на исправление',assigned?'master':'dispatcher',text(order.report_review_comment)||'Открыть заявку и проверить причину возврата.',0);
      }else if(order.report_uploaded_at&&(!review||review==='pending')){
        add('report_review','Отчёт ожидает проверки','dispatcher','Проверить работы и вложения; принять либо вернуть с причиной.',1);
      }else if(review!=='approved'){
        if(late)add('overdue','Прошёл день визита','dispatcher','Уточнить результат работы и состояние отчёта.',0);
        if(!assigned)add('unassigned','Мастер не назначен','dispatcher','Выбрать мастера в карточке заявки.',near?0:2);
        if(!date)add('undated',text(order.scheduled_date)?'Проверить дату визита':'Дата визита не указана','dispatcher','Согласовать дату с клиентом и мастером.',2);
        else if(!time)add('untimed','Время визита не указано','dispatcher','Уточнить и сохранить время визита.',near?1:2);
        const beforeWork=!['departed','arrived','started'].includes(text(order.master_workflow_stage))&&!order.master_started_at&&!order.master_departed_at;
        if(assigned&&date>=today&&near&&beforeWork&&!order.master_agreed_at&&!transfer){
          add('agreement',order.master_called_at?'Договорённость не отмечена':'Звонок клиенту не отмечен','master',order.master_called_at?'Уточнить, согласованы ли дата и время с клиентом.':'Связаться с клиентом и отметить результат в заявке.',date===today?0:1);
        }
      }
      if(Number(order.uncompleted_work_amount)>0)add('unfinished_work','Есть невыполненные работы','dispatcher',text(order.uncompleted_work_description)||'Уточнить оставшиеся работы и согласовать дальнейшие действия.',1);
      if(!issues.length)continue;
      issues.sort((a,b)=>a.priority-b.priority||a.code.localeCompare(b.code));
      const external=text(order.external_id);
      const number=(text(order.external_source).toLowerCase()==='hands'||external.startsWith('hands:'))?external.replace(/^hands:/,'')||id:id;
      result.push({id,number,client:text(order.client),work:text(order.work),master:text(order.master_name),date,visit:date?`Визит ${date}${time?' · '+time:''}`:'Дата визита не указана',priority:Math.min(...issues.map(x=>x.priority)),issues});
    }
    return result.sort((a,b)=>a.priority-b.priority||(a.date||'9999').localeCompare(b.date||'9999')||a.id.localeCompare(b.id,undefined,{numeric:true}));
  }
  return Object.freeze({collect,businessDay,nextDay,dateOnly});
});
