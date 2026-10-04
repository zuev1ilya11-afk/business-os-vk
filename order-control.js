(function(root,factory){
  'use strict';
  const core=factory();
  if(typeof module==='object'&&module.exports){module.exports=core;return;}
  if(root.BOS_ORDER_CONTROL)return;
  const PAGE='order-control',SESSION='bos_vk_session_v2';
  const getState=()=>typeof state==='undefined'?{}:state;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let filter='all',limit=12,queued=false,actor='',midnightTimer,loadState='loading',rows=[],trustedOrders=null,requestRun=0,identityRevision=0,verifyQueued=false,scrollTop=0,restoreScroll=false,modalWasOpen=false,scrollRestoreQueued=false;
  const filters=[['all','Все'],['urgent','Срочно'],['dispatcher','Диспетчеру'],['master','Мастеру'],['reports','Отчёты']];
  const homeFilters=[['unassigned','Без мастера'],['overdue','Просрочено'],['contact','Не связались']];
  const matches=(item,key)=>key==='all'||(key==='urgent'?item.priority===0:key==='reports'?item.issues.some(x=>x.code.startsWith('report_')):key==='contact'?item.issues.some(x=>x.code==='agreement')&&!currentRows().find(o=>String(o.id)===item.id)?.master_called_at:['unassigned','overdue'].includes(key)?item.issues.some(x=>x.code===key):item.issues.some(x=>x.role===key));
  const session=()=>{try{return sessionStorage.getItem(SESSION)||localStorage.getItem(SESSION)||''}catch{return ''}};
  function identity(){
    const u=getState().user,token=session();
    if(!u?.id||!token||!document.body.classList.contains('bos-auth-ok')||!root.BOS_PERMISSIONS?.isDispatcherWorkspaceActive(u))return '';
    try{const shared=localStorage.getItem(SESSION)||'';if(localStorage.getItem('bos_manual_logout_v1')==='1'||(shared&&shared.split('.')[0]!==token.split('.')[0]))return ''}catch{}
    if(u.external_id&&String(u.external_id)!==token.split('.')[0])return '';
    const master=typeof isMasterPreview==='function'&&isMasterPreview(),dispatcher=typeof isDispatcherPreview==='function'&&isDispatcherPreview(),manager=!!root.BOS_IS_MANAGER_PREVIEW?.();
    const preview=master?(typeof previewUser==='undefined'?null:previewUser):dispatcher?(typeof dispatcherPreviewUser==='undefined'?null:dispatcherPreviewUser):manager?root.BOS_MANAGER_PREVIEW_USER?.():null;
    return JSON.stringify([u.id,u.external_id,u.role,token.split('.')[0],master,dispatcher,manager,preview?.id,preview?.external_id]);
  }
  function syncIdentity(){
    const next=identity();if(next===actor)return false;
    actor=next;filter='all';limit=12;scrollTop=0;restoreScroll=false;loadState='loading';rows=[];trustedOrders=null;requestRun++;identityRevision++;
    document.querySelectorAll('#bosOrderControl,#bosOrderControlSummary,#bosOrderControlEntry').forEach(node=>node.remove());
    return true;
  }
  function currentRows(){return loadState==='ready'?(trustedOrders===getState().orders?trustedOrders:rows):[]}
  function accept(data,id,run){
    if(id!==identity()||id!==actor||run!==requestRun)return;
    const u=getState().user;
    if(!data?.ok||!Array.isArray(data.orders)||(data.user&&String(data.user.id)!==String(u.id))){loadState='error';rows=[];trustedOrders=null;refresh();return;}
    rows=data.orders;trustedOrders=null;loadState='ready';refresh();
    // The existing bootstrap caller commits its response after api() resolves.
    setTimeout(()=>{if(id===identity()&&run===requestRun&&JSON.stringify(getState().orders)===JSON.stringify(data.orders)){trustedOrders=getState().orders;refresh()}},0);
  }
  const baseApi=root.api;
  if(typeof baseApi==='function')root.api=async function(action){
    if(action!=='bootstrap')return baseApi.apply(this,arguments);
    syncIdentity();const id=actor,run=++requestRun;
    if(id){rememberScroll();if(getState().page===PAGE)restoreScroll=true;loadState='loading';refresh();}
    try{const data=await baseApi.apply(this,arguments);if(id)accept(data,id,run);return data}
    catch(error){if(id&&id===identity()&&run===requestRun){loadState='error';rows=[];trustedOrders=null;refresh()}throw error}
  };
  function verify(){
    if(!actor||verifyQueued||typeof root.api!=='function')return;
    verifyQueued=true;const revision=identityRevision;
    (typeof root.reloadData==='function'?root.reloadData(true):root.api('bootstrap')).catch(()=>{}).finally(()=>{verifyQueued=false;if(actor&&revision!==identityRevision&&loadState==='loading')verify()});
  }
  function authReady(){
    syncIdentity();if(!actor)return;
    // This event is emitted only after authenticated reloadData and role loading succeed.
    if(Array.isArray(getState().orders)){rows=getState().orders;trustedOrders=rows;loadState='ready';refresh()}
  }
  function card(item){
    const review=item.issues.some(x=>x.code==='report_review'),order=currentRows().find(x=>String(x.id)===item.id);
    const contact=root.BOS_CONTACT_STATUS?.html(order,{details:false})||'';
    return `<article class="ocItem" data-oc-order="${escape(item.id)}"><div class="ocItemTop"><b>№ ${escape(item.number)}</b><span>${escape(item.visit)}</span></div><div class="ocClient">${escape(item.client||'Клиент не указан')}</div><div class="ocWork">${escape(item.work||'Работы не указаны')}</div>${contact}${item.issues.map(issue=>`<div class="ocIssue" data-oc-reason="${issue.code}"><strong>${escape(issue.title)}</strong><span>Кто действует: ${escape(issue.role==='master'?item.master||'Назначенный мастер':'Диспетчер')}</span><span>${escape(issue.next)}</span></div>`).join('')}<button type="button" class="secondary" data-oc-open="${escape(item.id)}" data-oc-action="${review?'review':'order'}">${review?'Проверить отчёт':'Открыть заявку'}</button></article>`;
  }
  const summary=count=>loadState==='loading'?'Загрузка…':loadState==='error'?'Не удалось загрузить':count?`${count} требуют внимания`:'Всё в порядке';
  function render(){
    queued=false;const changed=syncIdentity(),s=getState(),content=document.getElementById('content');
    if(!content||!actor){document.querySelectorAll('#bosOrderControl,#bosOrderControlSummary,#bosOrderControlEntry').forEach(n=>n.remove());return;}
    if(changed)verify();
    const all=core.collect(currentRows()),visible=all.filter(item=>matches(item,filter));
    if(s.page==='home'||s.page==='orders'){
      document.getElementById('bosOrderControl')?.remove();
      const id=s.page==='home'?'bosOrderControlSummary':'bosOrderControlEntry';
      let entry=document.getElementById(id);
      const management=s.page==='home'&&!!content.querySelector('#ownerDashboard');
      if(management)root.BOS_OWNER_DASHBOARD?.setLoadState(loadState);
      if(entry&&entry.tagName!==(management?'DIV':'BUTTON')){entry.remove();entry=null;}
      if(!entry){entry=document.createElement(management?'div':'button');entry.id=id;if(!management)entry.type='button';entry.className='secondary ocSummary'+(management?' odAttention':'');entry.dataset.ocEnter='';content.prepend(entry)}
      const text=`${s.page==='home'?'Контроль заявок':'Контроль'} · ${summary(all.length)}`;
      const counts=homeFilters.map(([key])=>loadState==='ready'?all.filter(item=>matches(item,key)).length:'—');
      const label=JSON.stringify([text,management,counts]);
      if(entry.dataset.label!==label){entry.dataset.label=label;entry.innerHTML=management?`<div class="odAttentionTitle"><b>${escape(text)}</b><small>Проверьте заявки, чтобы не потерять клиентов</small></div><div class="odAttentionFilters">${homeFilters.map(([key,title],i)=>`<button type="button" class="secondary" data-oc-home-filter="${key}">${title} <b>${counts[i]}</b></button>`).join('')}</div><button type="button" class="linkBtn" data-oc-enter>Перейти к заявкам →</button>`:`<span>${escape(text)}</span><span aria-hidden="true">→</span>`;}
      // Remove the old large problem list; it is replaced by the compact entry.
      if(s.page==='home')content.querySelectorAll('.ownerProblemsCompact').forEach(n=>n.remove());
      return;
    }
    document.getElementById('bosOrderControlSummary')?.remove();document.getElementById('bosOrderControlEntry')?.remove();
    if(s.page!==PAGE){document.getElementById('bosOrderControl')?.remove();return;}
    document.querySelectorAll('nav [data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page==='orders'));
    let panel=document.getElementById('bosOrderControl');
    const signature=JSON.stringify([actor,loadState,filter,limit,all,currentRows().map(o=>[o.id,o.master_called_at,o.master_called_by_staff_id,o.master_called_by_name])]);
    if(!panel){panel=document.createElement('section');panel.id='bosOrderControl';panel.className='card ocPanel';panel.setAttribute('aria-labelledby','ocTitle');content.replaceChildren(panel);restoreScroll=true;}
    if(panel.dataset.signature!==signature){
      const focused=document.activeElement,restore=panel.contains(focused)?focused?.getAttribute('data-oc-filter'):null;
      panel.dataset.signature=signature;
      panel.innerHTML=`<button type="button" class="secondary ocBack" data-oc-back>← Заявки</button><div class="ocHeading"><div><div class="eyebrow">ЗАЯВКИ · КОНТРОЛЬ</div><h2 id="ocTitle">Требует внимания</h2></div><span class="softChip" data-oc-total>${loadState==='ready'?all.length:'—'}</span></div><p class="muted ocNote">По загруженным заявкам. Даты визитов — по Москве. Автонапоминания не включены.</p><div class="ocFilters" aria-label="Фильтры контроля заявок">${filters.concat(homeFilters.filter(([key])=>key===filter)).map(([key,title])=>`<button type="button" class="${filter===key?'primary':'secondary'}" data-oc-filter="${key}" aria-pressed="${filter===key}">${title} <b>${loadState==='ready'?all.filter(item=>matches(item,key)).length:'—'}</b></button>`).join('')}</div><div class="ocList">${loadState!=='ready'?`<p class="muted" role="status">${loadState==='error'?'Не удалось загрузить заявки. Повторите загрузку.':'Загружаем заявки…'}</p>${loadState==='error'?'<button type="button" class="secondary" data-oc-retry>Повторить</button>':''}`:visible.length?visible.slice(0,limit).map(card).join(''):'<p class="muted ocEmpty">'+(all.length?'По этому фильтру задач нет.':'По проверяемым условиям проблем не найдено.')+'</p>'}</div>${visible.length>limit?`<button type="button" class="secondary wide" data-oc-more>Показать ещё (${visible.length-limit})</button>`:''}`;
      if(restore)panel.querySelector(`[data-oc-filter="${restore}"]`)?.focus({preventScroll:true});
    }
    root.BOS_CONTROL_TASKS?.refresh();
    // Task metadata is inserted on the next frame. Restore after it has its final height.
    if(restoreScroll&&loadState==='ready'&&!scrollRestoreQueued&&!document.querySelector('#modalRoot .modal')){
      const id=actor;scrollRestoreQueued=true;
      requestAnimationFrame(()=>requestAnimationFrame(()=>{scrollRestoreQueued=false;if(id===identity()&&getState().page===PAGE&&!document.querySelector('#modalRoot .modal')){root.scrollTo(0,scrollTop);restoreScroll=false}}));
    }
  }
  function refresh(){if(queued)return;queued=true;requestAnimationFrame(render)}
  function rememberScroll(){if(loadState==='ready'&&document.getElementById('bosOrderControl')&&getState().page===PAGE&&identity()===actor&&!document.querySelector('#modalRoot .modal')&&!restoreScroll)scrollTop=root.scrollY}
  function enter(){if(!identity())return;restoreScroll=true;root.show?.(PAGE);refresh()}
  if(typeof pages==='object')pages[PAGE]=()=>identity()?'<div data-oc-host></div>':'';
  document.addEventListener('click',event=>{
    if(!identity())return;
    const homeFilter=event.target.closest?.('[data-oc-home-filter]');
    if(homeFilter){filter=homeFilter.dataset.ocHomeFilter;limit=12;scrollTop=0;enter();return;}
    if(event.target.closest?.('[data-oc-enter]')){enter();return;}
    const panel=event.target.closest?.('#bosOrderControl');if(!panel)return;
    if(event.target.closest('[data-oc-back]')){rememberScroll();root.show?.('orders');refresh();return;}
    if(event.target.closest('[data-oc-retry]')){verify();return;}
    const selected=event.target.closest('[data-oc-filter]');
    if(selected){filter=selected.dataset.ocFilter;limit=12;refresh();return;}
    if(event.target.closest('[data-oc-more]')){limit+=12;refresh();return;}
    const button=event.target.closest('[data-oc-open]');if(!button)return;
    const order=(getState().orders||[]).find(x=>String(x.id)===button.dataset.ocOpen);
    if(!order){refresh();return;}
    rememberScroll();
    const pending=core.collect([order]).some(x=>x.issues.some(y=>y.code==='report_review'));
    if(button.dataset.ocAction==='review'&&pending&&typeof root.openReportReview==='function')root.openReportReview(String(order.id));
    else if(typeof root.openOrder==='function')root.openOrder(String(order.id));
  });
  function resetClock(){clearTimeout(midnightTimer);const now=new Date(),next=core.nextDay(core.businessDay(now));midnightTimer=setTimeout(()=>{refresh();resetClock()},Math.max(1000,Date.parse(next+'T00:00:00+03:00')-now.getTime()+50))}
  function start(){
    const content=document.getElementById('content');if(content)new MutationObserver(refresh).observe(content,{childList:true,subtree:true});
    new MutationObserver(refresh).observe(document.body,{attributes:true,attributeFilter:['class']});
    const modal=document.getElementById('modalRoot');if(modal)new MutationObserver(()=>{const open=!!modal.querySelector('.modal');if(modalWasOpen&&!open&&getState().page===PAGE){restoreScroll=true;refresh()}modalWasOpen=open}).observe(modal,{childList:true,subtree:true});
    if(syncIdentity())verify();refresh();resetClock();
  }
  root.addEventListener('scroll',rememberScroll,{passive:true});
  document.addEventListener('click',event=>{if(event.target.closest?.('nav [data-page]'))rememberScroll()},true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();resetClock()}});
  document.addEventListener('bos:data-refreshed',refresh);
  root.addEventListener('bos:auth-ready',authReady);
  root.addEventListener('storage',refresh);root.addEventListener('pageshow',refresh);
  root.addEventListener('bos:employee-data-refreshed',refresh);
  root.BOS_ORDER_CONTROL=Object.freeze({...core,refresh,open:enter,isActive:()=>getState().page===PAGE&&!!identity(),identity});
  const style=document.createElement('style');
  style.textContent=`#content:has(>#bosOrderControlSummary){display:flex;flex-direction:column}#content:has(>#bosOrderControlSummary)>.dashMetrics{order:-3}#content:has(>#bosOrderControlSummary)>.loadCard{order:-1}#content>.ocSummary{grid-column:1/-1;grid-row:1;order:-4;width:100%;display:flex;justify-content:space-between;align-items:center;gap:10px;text-align:left;min-height:44px;padding:11px 13px;font-size:13px;line-height:1.4;white-space:normal;overflow-wrap:anywhere;margin:0 0 10px}#content:has(>#bosOrderControlSummary)>.dashMetrics{grid-row:2}#content:has(>#bosOrderControlSummary)>.loadCard{grid-row:3}#content>#bosOrderControl{grid-column:1/-1}.ocPanel{margin-bottom:16px;min-width:0}.ocBack{margin-bottom:16px;min-height:44px}.ocHeading,.ocItemTop{display:flex;justify-content:space-between;align-items:center;gap:10px}.ocHeading h2{margin:4px 0}.ocNote{font-size:12px;line-height:1.5}.ocFilters{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.ocFilters button{min-height:44px;white-space:normal}.ocFilters b{margin-left:5px}.ocList{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px}.ocItem{border:1px solid var(--line,rgba(255,255,255,.12));border-radius:12px;padding:12px;min-width:0;display:flex;flex-direction:column;gap:8px;overflow-wrap:anywhere}.ocItemTop{align-items:flex-start;font-size:12px}.ocItemTop span{color:var(--muted,#91a3b7);text-align:right}.ocClient{font-weight:700}.ocWork,.ocIssue span{font-size:12px;line-height:1.45}.ocIssue{display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--line,rgba(255,255,255,.12));padding-top:8px}.ocIssue strong{font-size:13px}.ocIssue span{color:var(--muted,#91a3b7)}.ocItem>button{margin-top:auto;min-height:44px}.ocEmpty{grid-column:1/-1}.ocPanel button:focus-visible,.ocSummary:focus-visible{outline:2px solid currentColor;outline-offset:2px}@media(min-width:1024px){#content:has(>#bosOrderControlSummary){display:grid}#content:has(>#bosOrderControlSummary)>.reportQueue{grid-column:1;grid-row:3;margin:0}}@media(max-width:760px){.ocList{grid-template-columns:minmax(0,1fr)}.ocFilters{gap:6px}.ocFilters button{flex:1 1 125px;font-size:12px;padding:8px;white-space:nowrap}.ocItemTop{flex-wrap:wrap}.ocItemTop span{text-align:left}.ocPanel{padding:12px}}`;
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
