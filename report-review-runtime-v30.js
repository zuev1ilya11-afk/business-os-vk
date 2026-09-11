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
  const home=pages.home;
  pages.home=function(){
    const html=home();
    if(!canReview()||String(html).includes('Отчёты на проверку'))return html;
    return queue()+html;
  };
})();