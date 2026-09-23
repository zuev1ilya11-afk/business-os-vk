(()=>{
  const GATEWAY='https://business-os-api-gateway.netlify.app';
  const EDGE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1';
  const GATEWAY_DEADLINE_MS=3500;
  if(typeof window.fetch!=='function'||window.BOS_NETWORK_DIRECT_V86)return;

  const lowerFetch=window.fetch.bind(window);

  function directUrl(raw){
    let url;
    try{url=new URL(raw,location.href)}catch(_){return ''}
    if(url.origin!==GATEWAY||!url.pathname.startsWith('/api/proxy/'))return '';
    const slug=decodeURIComponent(url.pathname.slice('/api/proxy/'.length)).replace(/^\/+|\/+$/g,'');
    if(!slug||slug.includes('/'))return '';
    return `${EDGE}/${encodeURIComponent(slug)}${url.search}`;
  }

  function outerSignal(input,init){
    return init?.signal||(input instanceof Request?input.signal:null)||null;
  }

  async function gatewayFetch(input,init){
    const controller=new AbortController();
    const outer=outerSignal(input,init);
    const abort=()=>controller.abort();
    let timer=null;
    if(outer){
      if(outer.aborted)controller.abort();
      else outer.addEventListener('abort',abort,{once:true});
    }
    try{
      const options=init?{...init,signal:controller.signal}:{signal:controller.signal};
      const fetchPromise=input instanceof Request
        ? lowerFetch(new Request(input.clone(),{signal:controller.signal}),options)
        : lowerFetch(input,options);
      const timeoutPromise=new Promise((_,reject)=>{
        timer=setTimeout(()=>{
          controller.abort();
          const error=new Error('Gateway timeout');
          error.name='BOSGatewayTimeout';
          reject(error);
        },GATEWAY_DEADLINE_MS);
      });
      return await Promise.race([fetchPromise,timeoutPromise]);
    }finally{
      if(timer)clearTimeout(timer);
      if(outer)outer.removeEventListener('abort',abort);
    }
  }

  async function fetchRequestAt(url,input,init){
    const req=new Request(input,init);
    const method=String(req.method||'GET').toUpperCase();
    const options={
      method,
      headers:new Headers(req.headers),
      mode:req.mode,
      credentials:req.credentials,
      cache:req.cache,
      redirect:req.redirect,
      referrer:req.referrer,
      referrerPolicy:req.referrerPolicy,
      integrity:req.integrity,
      keepalive:req.keepalive,
      signal:req.signal
    };
    if(method!=='GET'&&method!=='HEAD')options.body=await req.clone().arrayBuffer();
    return lowerFetch(url,options);
  }

  function retryable(error){
    if(error?.name==='BOSGatewayTimeout')return true;
    if(error?.name==='TypeError')return true;
    return /load failed|failed to fetch|networkerror|network request failed/i.test(String(error?.message||''));
  }

  async function serviceNotAllowed(response){
    if(!response||response.status!==404)return false;
    try{const body=await response.clone().json();return String(body?.error||'')==='SERVICE_NOT_ALLOWED'}catch(_){return false}
  }

  async function directFallback(next,retryInput,init){
    if(retryInput instanceof Request)return fetchRequestAt(next,retryInput,init);
    return lowerFetch(next,init);
  }

  window.fetch=async function(input,init){
    const raw=typeof input==='string'?input:input instanceof URL?input.href:input?.url||'';
    const next=directUrl(raw);
    if(!next)return lowerFetch(input,init);
    // Avito POSTs can send messages. A timed-out response is not proof that the
    // provider rejected the message, so never replay this service automatically.
    if(new URL(next).pathname.endsWith('/avito-api'))return lowerFetch(input,init);
    const outer=outerSignal(input,init);
    const retryInput=input instanceof Request?input.clone():input;
    try{
      const response=await gatewayFetch(input,init);
      if(await serviceNotAllowed(response))return directFallback(next,retryInput,init);
      return response;
    }catch(error){
      if(outer?.aborted||!retryable(error))throw error;
      return directFallback(next,retryInput,init);
    }
  };

  window.BOS_NETWORK_DIRECT_V86={gateway:GATEWAY,edge:EDGE,directUrl,gatewayDeadlineMs:GATEWAY_DEADLINE_MS};
})();
