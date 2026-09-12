(()=>{
  if(typeof window.fetch!=='function'||window.BOS_NETWORK_FALLBACK_V50)return;
  window.BOS_NETWORK_FALLBACK_V50=true;
  const nativeFetch=window.fetch.bind(window);
  const GATEWAY='https://business-os-api-gateway.netlify.app/api/proxy/';
  const SUPABASE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/';
  function urlOf(input){return typeof input==='string'?input:String(input&&input.url||'')}
  function isNetworkError(err){
    const msg=String(err&&err.message||err||'').toLowerCase();
    return err instanceof TypeError||msg.includes('load failed')||msg.includes('failed to fetch')||msg.includes('networkerror')||msg.includes('network request failed');
  }
  function directUrl(raw){return raw.startsWith(GATEWAY)?SUPABASE+raw.slice(GATEWAY.length):''}
  async function directRetry(input,init,raw){
    const fallback=directUrl(raw);if(!fallback)throw new TypeError('Network request failed');
    if(typeof input==='string')return nativeFetch(fallback,init);
    try{return nativeFetch(new Request(fallback,input),init)}catch(_){return nativeFetch(fallback,init)}
  }
  window.BOS_NATIVE_FETCH=nativeFetch;
  window.fetch=async function(input,init){
    const raw=urlOf(input);
    try{return await nativeFetch(input,init)}catch(err){
      if(!raw.startsWith(GATEWAY)||!isNetworkError(err))throw err;
      return directRetry(input,init,raw);
    }
  };
})();
