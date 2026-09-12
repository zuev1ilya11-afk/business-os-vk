(()=>{
  if(typeof window.fetch!=='function'||window.BOS_NETWORK_FALLBACK_V50)return;
  window.BOS_NETWORK_FALLBACK_V50=true;
  const nativeFetch=window.fetch.bind(window);
  const GATEWAY='https://business-os-api-gateway.netlify.app/api/proxy/';
  const SUPABASE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/';
  function isNetworkError(err){
    if(err?.name==='AbortError')return false;
    return err?.code==='BOS_FETCH_TIMEOUT'||/load failed|failed to fetch|networkerror|network request failed|network error/i.test(String(err?.message||err||''))||err?.name==='NetworkError';
  }
  function serviceName(raw){
    if(raw.startsWith(GATEWAY))return raw.slice(GATEWAY.length).split(/[?#]/)[0];
    if(raw.startsWith(SUPABASE))return raw.slice(SUPABASE.length).split(/[?#]/)[0];
    return '';
  }
  async function timedFetch(url,options,ms){
    if(!ms)return nativeFetch(url,options);
    const controller=new AbortController(),caller=options.signal;
    let timer;
    const abort=()=>controller.abort(caller.reason);
    if(caller?.aborted)abort();else caller?.addEventListener('abort',abort,{once:true});
    try{
      return await Promise.race([
        nativeFetch(url,{...options,signal:controller.signal}),
        new Promise((_,reject)=>{timer=setTimeout(()=>{
          const error=new Error('API connection timed out');
          error.code='BOS_FETCH_TIMEOUT';
          reject(error);controller.abort();
        },ms)})
      ]);
    }finally{clearTimeout(timer);caller?.removeEventListener('abort',abort)}
  }
  async function canRetryTimeout(raw,options){
    const name=serviceName(raw);
    if(name==='vk-session-api'||name==='password-session-api')return true;
    if(name!=='mini-app-api'||!options.body)return false;
    try{return JSON.parse(await options.body.text()).action==='bootstrap'}catch(_){return false}
  }
  window.BOS_NATIVE_FETCH=nativeFetch;
  window.fetch=async function(input,init){
    const raw=input instanceof Request?input.url:String(input);
    const fromGateway=raw.startsWith(GATEWAY),fromSupabase=raw.startsWith(SUPABASE);
    if(!fromGateway&&!fromSupabase)return nativeFetch(input,init);
    const name=serviceName(raw);
    const directAuthRead=name==='vk-session-api'||name==='password-session-api'||name==='mini-app-api';
    // Supabase-first fallback is limited to authentication/read startup traffic.
    // Other direct Supabase calls keep their original behavior to avoid replaying mutations.
    if(fromSupabase&&!directAuthRead)return nativeFetch(input,init);
    const primary=new Request(input,init);
    const options={method:primary.method,headers:primary.headers,mode:primary.mode,
      credentials:primary.credentials,cache:primary.cache,redirect:primary.redirect,
      referrer:primary.referrer,referrerPolicy:primary.referrerPolicy,
      integrity:primary.integrity,keepalive:primary.keepalive,signal:primary.signal};
    if(primary.body)options.body=await primary.blob();
    const fallback=fromGateway?SUPABASE+raw.slice(GATEWAY.length):GATEWAY+raw.slice(SUPABASE.length);
    const bounded=await canRetryTimeout(raw,options);
    // Give VK/iOS WebView more time than the previous 2.5s/4s watchdog while
    // still completing both attempts before the outer auth deadline.
    const primaryMs=bounded?4500:0,fallbackMs=bounded?6500:0;
    try{return await timedFetch(raw,options,primaryMs)}catch(primaryError){
      if(primary.signal.aborted||!isNetworkError(primaryError))throw primaryError;
      try{return await timedFetch(fallback,options,fallbackMs)}catch(fallbackError){
        if(primary.signal.aborted||!isNetworkError(fallbackError))throw fallbackError;
        window.BOS_NETWORK_LAST_ERROR={primaryError,fallbackError};
        const error=new Error('Не удалось связаться с сервером. Проверьте интернет и повторите попытку.');
        error.code='BOS_NETWORK_UNAVAILABLE';
        error.cause=fallbackError;
        throw error;
      }
    }
  };
})();
