(()=>{
  const SESSION_KEY='bos_vk_session_v2';
  const MANUAL_KEY='bos_manual_logout_v1';

  function safeRead(storage,key){try{return storage.getItem(key)||''}catch(_){return ''}}
  function safeWrite(storage,key,value){try{if(value)storage.setItem(key,value);else storage.removeItem(key)}catch(_){}}

  function getSession(){return safeRead(sessionStorage,SESSION_KEY)||safeRead(localStorage,SESSION_KEY)}
  function setSession(value){if(!value)return '';safeWrite(sessionStorage,SESSION_KEY,String(value));safeWrite(localStorage,SESSION_KEY,String(value));return String(value)}
  function clearSession(){safeWrite(sessionStorage,SESSION_KEY,'');safeWrite(localStorage,SESSION_KEY,'')}
  function isManualLogout(){return safeRead(localStorage,MANUAL_KEY)==='1'}
  function setManualLogout(value){safeWrite(localStorage,MANUAL_KEY,value?'1':'')}

  async function fetchJson(url,payload,headers={},timeoutMs=15000){
    if(!url)throw new Error('Не настроен API');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(payload),signal:controller.signal});
      let data;
      try{data=await response.json()}catch(_){throw new Error('Сервер вернул неверный ответ')}
      return {response,data};
    }catch(error){
      if(error?.name==='AbortError')throw new Error('Сервер не ответил');
      throw error;
    }finally{clearTimeout(timer)}
  }

  function sessionHeaders(extra={}){
    const headers={'Content-Type':'application/json',...extra};
    const session=getSession();
    if(session)headers['X-BOS-Session']=session;
    return headers;
  }

  async function api(action,payload={}){
    const cfg=window.BUSINESS_OS_CONFIG||{};
    const url=cfg.API_URL||cfg.GAS_WEB_APP_URL;
    const {response,data}=await fetchJson(url,{action,...payload},sessionHeaders(),15000);
    if(data?.session_token)setSession(data.session_token);
    if(!response.ok&&!data?.error)throw new Error('Ошибка сервера '+response.status);
    if(data?.ok===false)throw new Error(data.error||'Ошибка сервера');
    return data;
  }

  window.BOS_AUTH_CORE=Object.freeze({
    SESSION_KEY,MANUAL_KEY,getSession,setSession,clearSession,isManualLogout,setManualLogout,fetchJson,sessionHeaders,api
  });
  window.BOS_AUTH_CORE_READY=true;
})();