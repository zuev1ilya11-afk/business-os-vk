(()=>{
  'use strict';
  const KEY='bos_vk_session_v2';
  const URL='https://business-os-api-gateway.netlify.app/api/proxy/password-session-api';
  let pending=null;
  let lastRefresh=0;

  function getSession(){
    try{return localStorage.getItem(KEY)||sessionStorage.getItem(KEY)||''}catch(_){return ''}
  }
  function storeSession(token){
    if(!token)return;
    try{localStorage.setItem(KEY,token);sessionStorage.setItem(KEY,token)}catch(_){}
    try{if(typeof window.BOS_STORE_SESSION==='function')window.BOS_STORE_SESSION(token)}catch(_){}
  }
  async function refreshSession(){
    const token=getSession();
    if(!token)return false;
    if(pending)return pending;
    if(Date.now()-lastRefresh<6*60*60*1000)return true;
    pending=(async()=>{
      try{
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),12000);
        try{
          const response=await fetch(URL,{method:'POST',headers:{'Content-Type':'application/json','X-BOS-Session':token},body:JSON.stringify({action:'refresh'}),signal:controller.signal});
          const data=await response.json().catch(()=>({}));
          if(response.ok&&data?.ok&&data?.session_token){
            storeSession(data.session_token);
            lastRefresh=Date.now();
            return true;
          }
          return false;
        }finally{clearTimeout(timer)}
      }catch(_){
        return false;
      }finally{
        pending=null;
      }
    })();
    return pending;
  }

  window.BOS_REFRESH_SESSION=refreshSession;
  refreshSession();
  window.addEventListener('focus',refreshSession,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshSession()});
})();
