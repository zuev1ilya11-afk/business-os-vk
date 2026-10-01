(()=>{
  'use strict';
  function safeHref(value){try{const u=new URL(String(value||''));return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}}
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
    return `<section class="card reportQueue"><div class="row"><div><div class="eyebrow">КОНТРОЛЬ ОТЧЁТОВ</div><h3>Отчёты на проверку</h3></div><span class="softChip">${list.length}</span></div>${list.length?list.slice(0,5).map(o=>`<button class="reportReviewCard" onclick="openReportReview('${esc(o.id)}')"><div><b>${esc(o.id)} · ${esc(o.work||'Заявка')}</b><span>${esc(o.master_name||'Мастер')} · ${esc(o.address||'')}</span></div><div>${badge(o)}</div><span class="dashArrow">›</span></button>`).join(''):'<p class="muted">Новых отчётов на проверку нет.</p>'}${safeHref(state?.settings?.reports_drive_folder_url)?`<a class="secondary wide" target="_blank" rel="noopener" href="${esc(safeHref(state.settings.reports_drive_folder_url))}">Открыть архив отчётов на Google Диске</a>`:''}</section>`;
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
  function enrichUncompletedWork(id){
    if(!canReview())return;
    const o=(state?.orders||[]).find(x=>String(x.id)===String(id));
    const root=document.getElementById('modalRoot');if(!o||!root)return;
    const items=Array.isArray(o.uncompleted_work_items)?o.uncompleted_work_items:[];
    const description=String(o.uncompleted_work_description||'').trim();
    if(!items.length&&!description)return;
    const line=[...root.querySelectorAll('p')].find(p=>String(p.textContent||'').trim().startsWith('Невыполненные работы:'));
    const detail=document.createElement('section');detail.className='card reportUncompletedDetails';
    detail.innerHTML=`<h3>Что не было сделано</h3>${items.length?items.map(r=>`<div class="reportDeductionReviewRow"><b>${esc(r.name)}</b><span>${esc(r.quantity)} ${esc(r.unit||'(ед. не указана)')} × ${money(r.unit_price)} = <b>${money(r.amount)}</b></span>${r.price_confirmed?'<small class="muted">Мастер подтвердил согласование цены и объёма</small>':''}</div>`).join(''):'<p class="muted">Старый отчёт без детализации по прайсу</p>'}<p>Сумма вычета: <b>${money(o.uncompleted_work_amount)}</b></p>${o.original_amount!=null?`<p>После вычета: <b>${money(Number(o.original_amount)-Number(o.uncompleted_work_amount||0))}</b> <span class="muted">без допработ</span></p>`:''}${description?`<p class="reportDeductionComment">${esc(description)}</p>`:''}`;
    if(line)line.after(detail);else root.querySelector('.card')?.append(detail);
  }
  const openReview=window.openReportReview;
  if(typeof openReview==='function')window.openReportReview=function(id){openReview(id);enrichExtraWork(id);enrichUncompletedWork(id)};
  const home=pages.home;
  pages.home=function(){
    const html=home();
    if(!canReview()||String(html).includes('Отчёты на проверку'))return html;
    return queue()+html;
  };
  const style=document.createElement('style');
  style.textContent='.reportUncompletedDetails{min-width:0}.reportDeductionReviewRow{display:grid;gap:6px;padding:10px 0;border-bottom:1px solid #34455c;overflow-wrap:anywhere}.reportDeductionComment{white-space:pre-wrap;overflow-wrap:anywhere}.reportExtraWorkDetails{display:flex;flex-direction:column;gap:6px}.reportExtraWorkDetails .muted{white-space:pre-wrap;overflow-wrap:anywhere}';
  document.head.appendChild(style);
})();