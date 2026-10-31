// The browser receives a ready server workbook; it never builds spreadsheet rows/ZIP data.
(()=>{
 'use strict';
 if(globalThis.BOS_FINANCE_EXPORT_UI)return;
 const failure='Не удалось сформировать финансовую детализацию. Повторите попытку.';
 const messages={STALE_VIEW:'Данные изменились. Обновите раздел «Финансы» и повторите скачивание.',STALE_EXPORT:'Данные изменились. Повторите подготовку детализации.',EMPTY_EXPORT:'За выбранный период данных для выгрузки нет',EXPORT_LIMIT:'Слишком большой объём данных. Выберите меньший период.',CLAIM_HISTORY_REQUIRED:'По рекламациям не восстановлено исходное начисление. Для корректной детализации сначала нужно восстановить историю.'};
 const date=s=>String(s).split('-').reverse().join('.');
 let current=null;
 function cancel(){const job=current;if(!job)return;current=null;job.controller.abort();if(job.node?.isConnected)closeModal();job.refresh()}
 function valid(job){return current===job&&job.allowed()&&job.identity()===job.who&&job.node?.isConnected}
 async function request(job,action,extra={}){
  const headers=await globalThis.BOS_AUTH_HEADERS();
  if(!valid(job))throw Error('CANCELLED');
  const config=globalThis.BUSINESS_OS_CONFIG||{},url=config.API_URL||config.GAS_WEB_APP_URL;
  const timeout=setTimeout(()=>job.controller.abort(),120000);
  try{
   const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({action,filters:job.filters,...extra}),signal:job.controller.signal,cache:'no-store'});
   if(!valid(job))throw Error('CANCELLED');
   if(!response.ok){const error=await response.json().catch(()=>({}));throw Object.assign(Error(failure),{code:error.code})}
   if(action==='downloadFinanceExport'){
    if(!response.headers.get('content-type')?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))throw Error('INVALID_FILE');
    const blob=await response.blob();if(!blob.size)throw Error('EMPTY_FILE');return blob;
   }
   const data=await response.json();if(!data?.ok)throw Error('INVALID_PREVIEW');return data;
  }finally{clearTimeout(timeout)}
 }
 function error(job,e){
  if(!valid(job))return;
  console.error('finance-export',{code:Object.hasOwn(messages,e?.code||'')?e.code:'EXPORT_FAILED'});
  job.node.querySelector('[data-fin-export-body]').innerHTML=`<p role="status">${esc(messages[e?.code]||failure)}</p><button type="button" class="secondary" data-fin-export-close>Закрыть</button>`;
  job.node.querySelector('[data-fin-export-close]').onclick=cancel;
 }
 async function open(options){
  if(current||!options.allowed())return;
  const job={...options,filters:structuredClone(options.filters),who:options.identity(),controller:new AbortController(),node:null};
  current=job;job.refresh();
  const master=job.filters.format==='master';
  openModal(`<section data-fin-export-dialog><h2>${master?'Детализация для мастера':'Скачать детализацию'}</h2><div data-fin-export-body><p role="status">Подготавливаем детализацию…</p><button type="button" class="secondary" data-fin-export-close>Отмена</button></div></section>`);
  job.node=document.querySelector('[data-fin-export-dialog]');job.node.querySelector('[data-fin-export-close]').onclick=cancel;
  try{
   const preview=await request(job,'previewFinanceExport',{expected:job.expected});if(!valid(job))return;
   const body=job.node.querySelector('[data-fin-export-body]');
   if(preview.empty){body.innerHTML='<p role="status">За выбранный период данных для выгрузки нет</p>';return}
   const validName=master?/^business-os-master-[\p{L}\p{N} _-]{1,60}-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/u:/^business-os-finance-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/;
   if(!validName.test(preview.filename))throw Error('INVALID_FILENAME');
   const pay=preview.total.pay===null?'Есть заявки без сохранённого начисления':Number(preview.total.pay).toLocaleString('ru-RU',{style:'currency',currency:'RUB'});
   body.innerHTML=`<p>Выгружается период: <strong>${preview.allTime?'Всё время':`${esc(date(preview.period.start))}–${esc(date(preview.period.end))}`}</strong></p><p>Заявок: <strong>${Number(preview.count)}</strong></p>${master?`<p>Начислено: <strong>${esc(pay)}</strong></p>`:`<p>Расходных операций: ${Number(preview.expenseCount)}</p>`}${job.labels.length?`<p class="muted">${job.labels.map(esc).join(' · ')}</p>`:''}<p class="muted">${master?'Один лист: выполненные заявки, адреса, работы и начисления. Можно отправить мастеру.':`Сводка, заявки, работы, мастера, источники${preview.expenseCount?', расходы':''} — отдельные листы Excel.`}</p><p role="status" data-fin-export-status></p><button type="button" class="primary wide" data-fin-export-confirm>Скачать Excel</button>`;
   const button=body.querySelector('[data-fin-export-confirm]');let downloading=false;
   button.onclick=async()=>{
    if(downloading||!valid(job))return;downloading=true;button.disabled=true;
    const status=body.querySelector('[data-fin-export-status]');status.textContent='Формируем файл…';
    try{
     const blob=await request(job,'downloadFinanceExport',{revision:preview.revision});if(!valid(job))return;
     const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=preview.filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
     status.textContent='Файл сформирован. Скачивание началось.';button.textContent='Скачать ещё раз';
    }catch(e){error(job,e)}finally{downloading=false;button.disabled=false}
   };
  }catch(e){error(job,e)}finally{if(current===job&&!valid(job))cancel()}
 }
 new MutationObserver(()=>{if(current&&!current.node?.isConnected)cancel()}).observe(document.getElementById('modalRoot')||document.body,{childList:true,subtree:true});
 globalThis.BOS_FINANCE_EXPORT_UI=Object.freeze({open,cancel,busy:()=>!!current});
})();
