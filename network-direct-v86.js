(()=>{
  const PRIMARY_GATEWAY='https://business-os-api-gateway.netlify.app';
  const SECONDARY_GATEWAY='https://business-os-api-gateway-ukp6ew.v2.appdeploy.ai';
  const EDGE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1';
  const GATEWAY_DEADLINE_MS=2200;
  const EDGE_DEADLINE_MS=3500;
  const ROUTE_COOLDOWN_MS=30000;
  if(typeof window.fetch!=='function'||window.BOS_NETWORK_DIRECT_V86)return;

  const lowerFetch=window.fetch.bind(window);
  const routeHealth={
    [PRIMARY_GATEWAY]:{fails:0,downUntil:0},
    [SECONDARY_GATEWAY]:{fails:0,downUntil:0}
  };

  function proxyInfo(raw){
    let url;
    try{url=new URL(raw,location.href)}catch(_){return null}
    if(url.origin!==PRIMARY_GATEWAY&&url.origin!==SECONDARY_GATEWAY)return null;
    if(!url.pathname.startsWith('/api/proxy/'))return null;
    const slug=decodeURIComponent(url.pathname.slice('/api/proxy/'.length)).replace(/^\/+|\/+$/g,'');
    if(!slug||slug.includes('/'))return null;
    return {origin:url.origin,slug,search:url.search};
  }

  function directUrl(raw){
    const info=proxyInfo(raw);
    return info?`${EDGE}/${encodeURIComponent(info.slug)}${info.search}`:'';
  }

  function outerSignal(input,init){
    return init?.signal||(input instanceof Request?input.signal:null)||null;
  }

  function healthy(origin){
    const state=routeHealth[origin];
    return !state||Date.now()>=state.downUntil;
  }

  function markSuccess(origin){
    const state=routeHealth[origin];
    if(!state)return;
    state.fails=0;
    state.downUntil=0;
  }

  function markFailure(origin){
    const state=routeHealth[origin];
    if(!state)return;
    state.fails+=1;
    state.downUntil=Date.now()+ROUTE_COOLDOWN_MS;
  }

  async function timedFetch(fetcher,deadlineMs,outer){
    const controller=new AbortController();
    const abort=()=>controller.abort();
    let timer=null;
    if(outer){
      if(outer.aborted)controller.abort();
      else outer.addEventListener('abort',abort,{once:true});
    }
    try{
      const fetchPromise=fetcher(controller.signal);
      const timeoutPromise=new Promise((_,reject)=>{
        timer=setTimeout(()=>{
          controller.abort();
          const error=new Error('Network route timeout');
          error.name='BOSRouteTimeout';
          reject(error);
        },deadlineMs);
      });
      return await Promise.race([fetchPromise,timeoutPromise]);
    }finally{
      if(timer)clearTimeout(timer);
      if(outer)outer.removeEventListener('abort',abort);
    }
  }

  async function requestAt(url,input,init,signal){
    if(!(input instanceof Request))return lowerFetch(url,{...(init||{}),signal});
    const req=new Request(input.clone(),init);
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
      signal
    };
    if(method!=='GET'&&method!=='HEAD')options.body=await req.clone().arrayBuffer();
    return lowerFetch(url,options);
  }

  function retryable(error){
    if(error?.name==='BOSRouteTimeout'||error?.name==='BOSGatewayTimeout')return true;
    if(error?.name==='TypeError')return true;
    return /load failed|failed to fetch|networkerror|network request failed/i.test(String(error?.message||''));
  }

  async function serviceNotAllowed(response){
    if(!response||response.status!==404)return false;
    try{
      const body=await response.clone().json();
      const code=String(body?.error||'');
      return code==='SERVICE_NOT_ALLOWED'||code==='UNKNOWN_SERVICE';
    }catch(_){return false}
  }

  function proxyUrl(origin,info){
    return `${origin}/api/proxy/${encodeURIComponent(info.slug)}${info.search}`;
  }

  async function gatewayAttempt(origin,info,input,init,outer){
    const response=await timedFetch(
      signal=>requestAt(proxyUrl(origin,info),input,init,signal),
      GATEWAY_DEADLINE_MS,
      outer
    );
    markSuccess(origin);
    return response;
  }

  async function edgeAttempt(info,input,init,outer){
    return timedFetch(
      signal=>requestAt(`${EDGE}/${encodeURIComponent(info.slug)}${info.search}`,input,init,signal),
      EDGE_DEADLINE_MS,
      outer
    );
  }

  window.fetch=async function(input,init){
    const raw=typeof input==='string'?input:input instanceof URL?input.href:input?.url||'';
    const info=proxyInfo(raw);
    if(!info)return lowerFetch(input,init);

    // Avito POSTs can send messages. A timeout is not proof that the provider
    // rejected the message, so never replay this service automatically.
    if(info.slug==='avito-api')return lowerFetch(input,init);

    const outer=outerSignal(input,init);
    const first=info.origin;
    const second=first===PRIMARY_GATEWAY?SECONDARY_GATEWAY:PRIMARY_GATEWAY;
    const gateways=[first,second];

    for(const origin of gateways){
      if(!healthy(origin))continue;
      try{
        const response=await gatewayAttempt(origin,info,input,init,outer);
        if(await serviceNotAllowed(response))continue;
        return response;
      }catch(error){
        markFailure(origin);
        if(outer?.aborted||!retryable(error))throw error;
      }
    }

    return edgeAttempt(info,input,init,outer);
  };

  window.BOS_NETWORK_DIRECT_V86={
    gateway:PRIMARY_GATEWAY,
    primaryGateway:PRIMARY_GATEWAY,
    secondaryGateway:SECONDARY_GATEWAY,
    edge:EDGE,
    directUrl,
    proxyInfo,
    gatewayDeadlineMs:GATEWAY_DEADLINE_MS,
    edgeDeadlineMs:EDGE_DEADLINE_MS,
    routeHealth
  };
})();
