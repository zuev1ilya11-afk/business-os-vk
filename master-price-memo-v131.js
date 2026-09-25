(()=>{
'use strict';
const API='https://business-os-api-gateway.netlify.app/api/proxy/master-memo-api';
const previous=window.openMasterMemoItem;
async function headers(){const base=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};const h={'Content-Type':'application/json'};const s=base['X-BOS-Session']||base['x-bos-session'];if(s)h['X-BOS-Session']=s;return h}
async function list(){const r=await fetch(API,{method:'POST',headers:await headers(),body:JSON.stringify({action:'list'})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось загрузить прайс');return d.items||[]}
function priceRows(note=''){return String(note||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{const i=line.lastIndexOf(' — ');if(i<0)return `<div class="bosPriceNote">${esc(line)}</div>`;return `<div class="bosPriceRow"><span>${esc(line.slice(0,i))}</span><b>${esc(line.slice(i+3))}</b></div>`}).join('')}
function fileActions(x){if(!x.file_url)return '';const name=esc(x.file_name||'document');return `<div class="bosPriceFiles"><a class="secondary wide" href="${esc(x.file_url)}" target="_blank" rel="noopener">Открыть файл</a><a class="primary wide" href="${esc(x.file_url)}" download="${name}" target="_blank" rel="noopener">Скачать файл</a></div>`}
function catalogHtml(){
 const items=window.BOS_SERVICE_CATALOG||[];
 return `<section class="card bosSharedCatalog"><h3>Каталог работ и цен</h3><p class="muted">Базовые цены из каталога заявок. Допработы согласуйте и укажите в отчёте отдельно.</p><label for="bosCatalogSearch">Найти работу</label><input id="bosCatalogSearch" type="search" placeholder="Название работы" autocomplete="off"><div id="bosCatalogRows">${items.map(s=>`<div class="bosPriceRow bosCatalogRow"><span>${esc(s.n)}${/доплата|дополнительн/i.test(s.n)?'<small class="bosCatalogExtra">Дополнительная работа / доплата</small>':''}</span><b>${s.p!=null?esc(money(s.p)):'По согласованию'}${s.u?`<small>за ${esc(s.u)}</small>`:''}</b></div>`).join('')}</div><p id="bosCatalogEmpty" class="muted" ${items.length?'hidden':''}>Работы не найдены.</p></section>`;
}
function bindCatalog(){
 const search=document.getElementById('bosCatalogSearch');
 if(!search)return;
 search.addEventListener('input',()=>{
   const q=search.value.trim().toLocaleLowerCase('ru');let count=0;
   document.querySelectorAll('#bosCatalogRows .bosCatalogRow').forEach(row=>{row.hidden=!row.textContent.toLocaleLowerCase('ru').includes(q);if(!row.hidden)count++});
   document.getElementById('bosCatalogEmpty').hidden=count>0;
 });
}
window.openMasterMemoItem=async function(kind){
 if(kind!=='price')return typeof previous==='function'?previous(kind):undefined;
 openModal(`<h2>Прайс услуг</h2><p class="muted bosPriceLead">Выберите вид работы — цена указана справа.</p>${catalogHtml()}<details class="bosPriceMaterials"><summary>Материалы руководителя</summary><div id="bosMasterPrice" aria-live="polite" aria-busy="true"><p class="muted" role="status">Загружаем…</p></div></details><button class="secondary wide" onclick="closeModal()">Закрыть</button>`);
 bindCatalog();const root=document.getElementById('bosMasterPrice');
 try{
   const items=(await list()).filter(x=>x.category==='price').sort((a,b)=>String(a.title||'').localeCompare(String(b.title||''),'ru',{numeric:true}));
   if(!root?.isConnected)return;
   root.innerHTML=items.length?items.map(x=>{const important=/важно/i.test(String(x.title||''));return `<section class="card bosPriceCard${important?' bosPriceImportant':''}"><h3>${esc(x.title||'Раздел')}</h3>${important?`<div class="bosPriceImportantText">${esc(x.note||'')}</div>`:priceRows(x.note)}${fileActions(x)}</section>`}).join(''):'<section class="card"><p class="muted" style="margin:0">Материалы руководителя пока не добавлены.</p></section>';
 }catch(_){
   if(root?.isConnected){
     root.innerHTML=`<section class="card"><p role="alert">Не удалось загрузить прайс из материалов руководителя. Проверьте соединение и попробуйте ещё раз.</p><button type="button" class="secondary wide" id="bosPriceRetry">Повторить загрузку</button></section>`;
     root.closest('details').open=true;
     root.querySelector('#bosPriceRetry').addEventListener('click',()=>window.openMasterMemoItem('price'));
   }
 }finally{if(root?.isConnected)root.setAttribute('aria-busy','false')}
};
const style=document.createElement('style');style.textContent=`.bosSharedCatalog{min-width:0}.bosSharedCatalog input{width:100%;box-sizing:border-box;font-size:16px}.bosCatalogRow[hidden]{display:none}.bosCatalogRow span{overflow-wrap:anywhere}.bosCatalogRow small{display:block;font-size:11px;font-weight:400;margin-top:4px}.bosCatalogExtra{color:var(--muted,#91a3b7)}.bosPriceMaterials summary{cursor:pointer;min-height:44px;padding:12px 0;box-sizing:border-box}.bosPriceLead{margin:-4px 0 12px}.bosPriceCard{padding:14px;margin:10px 0}.bosPriceCard h3{margin:0 0 8px;font-size:17px}.bosPriceRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;padding:10px 0;border-top:1px solid rgba(255,255,255,.08)}.bosPriceRow:first-of-type{border-top:0}.bosPriceRow span{min-width:0;line-height:1.35}.bosPriceRow b{text-align:right;white-space:nowrap;color:#6fb1ff}.bosPriceNote{padding:8px 0;line-height:1.45}.bosPriceImportant{border-color:rgba(245,158,11,.45);background:rgba(245,158,11,.08)}.bosPriceImportantText{white-space:pre-line;line-height:1.5}.bosPriceFiles{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.bosPriceFiles a{text-align:center;text-decoration:none}@media(max-width:520px){.bosPriceRow{grid-template-columns:minmax(0,1fr) minmax(110px,42%);gap:10px}.bosPriceRow b{white-space:normal}.bosPriceFiles{grid-template-columns:1fr}}`;document.head.appendChild(style);
})();