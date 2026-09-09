const rawBusinessApi=api;
let businessBackendVersion='';
let businessBackendChecked=false;
function backendRevision(v){const m=String(v||'').match(/-(\d+)$/);return m?Number(m[1]):0}
async function checkBusinessBackend(force=false){
  if(businessBackendChecked&&!force)return businessBackendVersion;
  try{const d=await rawBusinessApi('health');businessBackendVersion=String(d?.version||'');businessBackendChecked=true;return businessBackendVersion}catch(e){businessBackendChecked=true;businessBackendVersion='';return ''}
}
function needsModernBackend(action,payload){return action==='saveMasterSchedule'||action==='uploadMasterReport'||(action==='updateOrder'&&payload&&['extra_work_done','extra_work_amount','uncompleted_work_done','uncompleted_work_amount'].some(k=>Object.prototype.hasOwnProperty.call(payload,k)))}
api=async function(action,payload={}){
  if(needsModernBackend(action,payload)){
    const v=await checkBusinessBackend();
    if(backendRevision(v)<9)throw new Error(`Сервер приложения не обновлён${v?' ('+v+')':''}. Нужен Apps Script версии 2026-09-09-9 или новее.`);
  }
  return rawBusinessApi(action,payload);
};
setTimeout(async()=>{
  const v=await checkBusinessBackend();
  if(backendRevision(v)<9){
    const box=document.createElement('div');box.id='backendWarning';box.className='card';box.style.cssText='position:fixed;left:12px;right:12px;bottom:76px;z-index:50;border:1px solid #ffb020';box.innerHTML=`<b>Нужно обновить сервер приложения</b><div class="muted">Текущий Apps Script: ${esc(v||'старая версия')}. График мастеров и допработы не сохранятся, пока не опубликована версия 2026-09-09-9.</div><button class="secondary" style="margin-top:8px" onclick="this.parentElement.remove()">Понятно</button>`;document.body.appendChild(box);
  }
},1800);