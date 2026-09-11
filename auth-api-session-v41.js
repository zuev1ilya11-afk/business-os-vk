(()=>{
  const SESSION_KEY='bos_vk_session_v2';
  const baseApi=window.api||api;
  function getSession(){
    try{return sessionStorage.getItem(SESSION_KEY)||localStorage.getItem(SESSION_KEY)||''}catch(_){return ''}
  }
  async function sessionApi(action,payload={}){
    const cfg=window.BUSINESS_OS_CONFIG||{};
    const url=cfg.API_URL||cfg.GAS_WEB_APP_URL;
    if(!url)return Promise.reject(new Error('Не настроен API'));
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    const headers={'Content-Type':'application/json'};
    const session=getSession();
    if(session)headers['X-BOS-Session']=session;
    try{
      const r=await fetch(url,{method:'POST',headers,body:JSON.stringify({action,...payload}),signal:controller.signal});
      let d;
      try{d=await r.json()}catch(_){throw new Error('Сервер вернул неверный ответ')}
      if(!r.ok&&!d?.error)throw new Error('Ошибка сервера '+r.status);
      return d;
    }catch(e){
      if(e&&e.name==='AbortError')throw new Error('Сервер не ответил');
      throw e;
    }finally{clearTimeout(timer)}
  }
  window.api=sessionApi;
  try{api=sessionApi}catch(_){ }
  window.BOS_SESSION_API_READY=true;
})();
