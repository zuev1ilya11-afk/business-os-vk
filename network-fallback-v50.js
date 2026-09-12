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
    // Validate and retain an unread body before the first fetch consumes it.
    const primary=new Request(input,init),backup=primary.clone();
    const fallback=SUPABASE+raw.slice(GATEWAY.length);
    try{return await nativeFetch(primary)}catch(primaryError){
      if(primary.signal.aborted||!isNetworkError(primaryError))throw primaryError;
      try{return await nativeFetch(new Request(fallback,backup))}catch(fallbackError){
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
