const rawBusinessApi=api;
let businessBackendVersion='';
let businessBackendChecked=false;
async function checkBusinessBackend(force=false){
  if(businessBackendChecked&&!force)return businessBackendVersion;
  try{
    const d=await rawBusinessApi('health');
    businessBackendVersion=String(d?.version||'');
    businessBackendChecked=true;
    return businessBackendVersion;
  }catch(e){
    businessBackendChecked=true;
    businessBackendVersion='';
    return '';
  }
}
api=async function(action,payload={}){return rawBusinessApi(action,payload)};
// Health is diagnostic only. Do not block or cover the Mini App when the
// health endpoint is unavailable: bootstrap and normal API calls are the
// source of truth for whether the application backend is working.
setTimeout(()=>{checkBusinessBackend().catch(()=>{})},1800);
