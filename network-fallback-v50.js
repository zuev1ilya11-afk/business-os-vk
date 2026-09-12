(()=>{
  if(typeof window.fetch!=='function'||window.BOS_NETWORK_FALLBACK_V50)return;
  window.BOS_NETWORK_FALLBACK_V50=true;
  const nativeFetch=window.fetch.bind(window);
  const GATEWAY='https://business-os-api-gateway.netlify.app/api/proxy/';
  const SUPABASE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/';
  function isNetworkError(err){
    if(err?.name==='AbortError')return false;
    return /load failed|failed to fetch|networkerror|network request failed|network error/i.test(String(err?.message||err||''))||err?.name==='NetworkError';
  }
  window.BOS_NATIVE_FETCH=nativeFetch;
  window.fetch=async function(input,init){
    const raw=input instanceof Request?input.url:String(input);
    if(!raw.startsWith(GATEWAY))return nativeFetch(input,init);
    // Validate before sending; keep a replayable body for Request/stream inputs.
    const primary=new Request(input,init);
    const options={method:primary.method,headers:primary.headers,mode:primary.mode,
      credentials:primary.credentials,cache:primary.cache,redirect:primary.redirect,
      referrer:primary.referrer,referrerPolicy:primary.referrerPolicy,
      integrity:primary.integrity,keepalive:primary.keepalive,signal:primary.signal};
    if(primary.body)options.body=await primary.blob();
    const fallback=SUPABASE+raw.slice(GATEWAY.length);
    try{return await nativeFetch(raw,options)}catch(primaryError){
      if(primary.signal.aborted||!isNetworkError(primaryError))throw primaryError;
      try{return await nativeFetch(fallback,options)}catch(fallbackError){
        if(primary.signal.aborted||!isNetworkError(fallbackError))throw fallbackError;
        // Retain technical causes without copying session headers or request bodies.
        window.BOS_NETWORK_LAST_ERROR={primaryError,fallbackError};
        const error=new Error('Не удалось связаться с сервером. Проверьте интернет и повторите попытку.');
        error.code='BOS_NETWORK_UNAVAILABLE';
        error.cause=fallbackError;
        throw error;
      }
    }
  };
})();
