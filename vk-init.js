(function(){
  const SESSION_KEY='bos_vk_session_v2';
  const MINI_MARK='/functions/v1/mini-app-api';

  function getSession(){
    try{return sessionStorage.getItem(SESSION_KEY)||localStorage.getItem(SESSION_KEY)||''}catch(_){return ''}
  }
  function isLocalDev(){
    try{
      const forced=new URLSearchParams(location.search).has('force_vk_auth');
      return /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname)&&!forced;
    }catch(_){return false}
  }
  function signed(raw){
    try{
      raw=String(raw||'').replace(/^\?/,'');
      const p=new URLSearchParams(raw);
      return p.has('vk_app_id')&&p.has('vk_user_id')&&p.has('sign');
    }catch(_){return false}
  }
  function likelyVkLaunch(){
    try{
      if(new URLSearchParams(location.search).has('force_vk_auth'))return true;
      if(signed(location.search))return true;
      const hash=String(location.hash||'');
      const q=hash.includes('?')?hash.slice(hash.indexOf('?')+1):hash.replace(/^#/,'');
      if(signed(q))return true;
      if(document.referrer){try{const ref=new URL(document.referrer);if(signed(ref.search))return true}catch(_){}}
      return false;
    }catch(_){return false}
  }
  function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}

  // app-public.js starts bootstrap immediately, before vk-auth-patch.js is loaded.
  // Guard only actual VK launches. Normal web opens must fall through quickly so
  // mandatory-auth can show the web login screen instead of hanging on "Проверяем вход".
  if(typeof window.fetch==='function'&&!window.BOS_EARLY_BOOTSTRAP_GUARD){
    const nativeFetch=window.fetch.bind(window);
    let authPromise=null;
    window.BOS_EARLY_BOOTSTRAP_GUARD=true;
    window.fetch=async function(input,init){
      const url=typeof input==='string'?input:String(input&&input.url||'');
      let action='';
      try{
        if(init&&typeof init.body==='string')action=JSON.parse(init.body||'{}').action||'';
      }catch(_){ }
      const headers=new Headers((init&&init.headers)||(input&&input.headers)||{});
      const protectedBootstrap=url.includes(MINI_MARK)&&String(action)==='bootstrap'&&!isLocalDev()&&likelyVkLaunch()&&!headers.get('X-BOS-Session');
      if(!protectedBootstrap)return nativeFetch(input,init);

      let session=getSession();
      if(!session){
        if(!authPromise){
          authPromise=(async()=>{
            for(let i=0;i<80;i++){
              const s=getSession();
              if(s)return s;
              if(typeof window.BOS_ENSURE_VK_SESSION==='function'){
                try{await window.BOS_ENSURE_VK_SESSION()}catch(_){ }
                const after=getSession();
                if(after)return after;
              }
              await sleep(50);
            }
            return '';
          })().finally(()=>{authPromise=null});
        }
        session=await authPromise;
      }
      if(!session)throw new Error('AUTH_REQUIRED');
      headers.set('X-BOS-Session',session);
      return nativeFetch(input,{...(init||{}),headers});
    };
  }

  function sendInit(){
    try{
      if(window.vkBridge&&typeof window.vkBridge.send==='function'){
        window.vkBridge.send('VKWebAppInit',{}).catch(function(){});
        return;
      }
      if(window.AndroidBridge&&typeof window.AndroidBridge.VKWebAppInit==='function'){
        window.AndroidBridge.VKWebAppInit(JSON.stringify({}));
        return;
      }
      if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.VKWebAppInit&&typeof window.webkit.messageHandlers.VKWebAppInit.postMessage==='function'){
        window.webkit.messageHandlers.VKWebAppInit.postMessage({});
        return;
      }
      if(window.ReactNativeWebView&&typeof window.ReactNativeWebView.postMessage==='function'){
        window.ReactNativeWebView.postMessage(JSON.stringify({handler:'VKWebAppInit',params:{}}));
        return;
      }
      if(window.parent&&window.parent!==window&&typeof window.parent.postMessage==='function'){
        window.parent.postMessage({handler:'VKWebAppInit',params:{},type:'vk-connect',connectVersion:'2.14.0'},'*');
      }
    }catch(_){ }
  }
  sendInit();
  document.addEventListener('DOMContentLoaded',sendInit,{once:true});
  setTimeout(sendInit,300);
  setTimeout(sendInit,1200);
})();
