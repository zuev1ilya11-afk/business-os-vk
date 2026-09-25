(()=>{
  'use strict';
  function canReview(){
    if(typeof isMasterPreview==='function'&&isMasterPreview())return false;
    if(typeof isDispatcherPreview==='function'&&isDispatcherPreview())return true;
    return ['owner','manager','dispatcher'].includes(String(state?.user?.role||''));
  }
  function pending(){return (state?.orders||[]).filter(o=>o.report_uploaded_at&&String(o.report_review_status||'pending')==='pending')}
  function badge(o){
    const a=String(o.drive_archive_status||'')==='archived'?'☁️ Архивирован':'☁️ Ожидает архивации';
    return `<span class="reviewBadge pending">⏳ На проверке</span> <span class="reviewBadge ${String(o.drive_archive_status||'')==='archived'?'approved':'pending'}">${a}</span>`;
  }
  function queue(){
    if(!canReview())return '';
    const list=pending();
    return `<section class="card reportQueue"><div class="row"><div><div class="eyebrow">КОНТРОЛЬ ОТЧЁТОВ</div><h3>Отчёты на проверку</h3></div><span class="softChip">${list.length}</span></div>${list.length?list.slice(0,5).map(o=>`<button class="reportReviewCard" onclick="openReportReview('${esc(o.id)}')"><div><b>${esc(o.id)} · ${esc(o.work||'Заявка')}</b><span>${esc(o.master_name||'Мастер')} · ${esc(o.address||'')}</span></div><div>${badge(o)}</div><span class="dashArrow">›</span></button>`).join(''):'<p class="muted">Новых отчётов на проверку нет.</p>'}${state?.settings?.reports_drive_folder_url?`<a class="secondary wide" target="_blank" rel="noopener" href="${esc(state.settings.reports_drive_folder_url)}">Открыть архив отчётов на Google Диске</a>`:''}</section>`;
  }
  function enrichExtraWork(id){
    const o=(state?.orders||[]).find(x=>String(x.id)===String(id));
    const description=String(o?.extra_work_description||'').trim();
    if(!o||Number(o.extra_work_amount||0)<=0||!description)return;
    const root=document.getElementById('modalRoot');if(!root)return;
    const line=[...root.querySelectorAll('p')].find(p=>String(p.textContent||'').trim().startsWith('Допработы:'));
    if(!line)return;
    line.classList.add('reportExtraWorkDetails');
    line.innerHTML=`<span>Допработы: <b>+${money(o.extra_work_amount)}</b></span><span class="muted"><b>Что указал мастер:</b> ${esc(description)}</span>`;
  }
  const openReview=window.openReportReview;
  if(typeof openReview==='function')window.openReportReview=function(id){openReview(id);enrichExtraWork(id)};
  const home=pages.home;
  pages.home=function(){
    const html=home();
    if(!canReview()||String(html).includes('Отчёты на проверку'))return html;
    return queue()+html;
  };
  const style=document.createElement('style');
  style.textContent='.reportExtraWorkDetails{display:flex;flex-direction:column;gap:6px}.reportExtraWorkDetails .muted{white-space:pre-wrap;overflow-wrap:anywhere}';
  document.head.appendChild(style);
})();