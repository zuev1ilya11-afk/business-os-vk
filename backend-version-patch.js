const rawBusinessApi=api;
let businessBackendVersion='';
let businessBackendChecked=false;
async function checkBusinessBackend(force=false){
  if(businessBackendChecked&&!force)return businessBackendVersion;
  try{const d=await rawBusinessApi('health');businessBackendVersion=String(d?.version||'');businessBackendChecked=true;return businessBackendVersion}catch(e){businessBackendChecked=true;businessBackendVersion='';return ''}
}
api=async function(action,payload={}){return rawBusinessApi(action,payload)};
setTimeout(async()=>{
  const v=await checkBusinessBackend();
  if(!v.includes('sb-ui')){
    const box=document.createElement('div');box.id='backendWarning';box.className='card';box.style.cssText='position:fixed;left:12px;right:12px;bottom:76px;z-index:50;border:1px solid #ffb020';box.innerHTML=`<b>⚠️ Сервер приложения недоступен</b><div class="muted">Текущая версия: ${esc(v||'не определена')}. Попробуйте перезапустить приложение.</div><button class="secondary" style="margin-top:8px" onclick="this.parentElement.remove()">Понятно</button>`;document.body.appendChild(box);
  }
},1800);