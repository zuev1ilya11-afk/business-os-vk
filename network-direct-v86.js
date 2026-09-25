(()=>{
  const GATEWAY='https://business-os-api-gateway-3y8h7e.v2.appdeploy.ai';
  const ALT_GATEWAY='https://business-os-api-gateway.netlify.app';
  const EDGE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1';
  const GATEWAY_DEADLINE_MS=2200;
  const ALT_GATEWAY_DEADLINE_MS=2200;
  const EDGE_DEADLINE_MS=3500;
  const AUTH_DEADLINE_MS=12000;
  if(typeof window.fetch!=='function'||window.BOS_NETWORK_DIRECT_V86)return;

  const lowerFetch=window.fetch.bind(window);

  function proxyInfo(raw){
    let url;
    try{url=new URL(raw,location.href)}catch(_){return null}
    if(url.origin!==GATEWAY&&url.origin!==ALT_GATEWAY)return null;
    if(!url.pathname.startsWith('/api/proxy/'))return null;
    const slug=decodeURIComponent(url.pathname.slice('/api/proxy/'.length)).replace(/^\/+|\/+$/g,'');
    if(!slug||slug.includes('/'))return null;
    return {origin:url.origin,slug,search:url.search};
  }

  function proxyUrl(origin,info){
    return `${origin}/api/proxy/${encodeURIComponent(info.slug)}${info.search}`;
  }

  function directUrl(raw){
    const info=proxyInfo(raw);
    return info?`${EDGE}/${encodeURIComponent(info.slug)}${info.search}`:'';
  }

  function outerSignal(input,init){
    return init?.signal||(input instanceof Request?input.signal:null)||null;
  }

  function requestAction(input,init){
    try{
      const raw=init?.body;
      if(typeof raw!=='string')return '';
      const data=JSON.parse(raw);
      return String(data?.action||'');
    }catch(_){return ''}
  }

  function resilientAuthRequest(info,input,init){
    if(['password-session-api','vk-session-api','staff-invite-api'].includes(info.slug))return true;
    return info.slug==='mini-app-api'&&requestAction(input,init)==='bootstrap';
  }

  async function fetchRequestAt(url,input,init,signal){
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
      signal
    };
    if(method!=='GET'&&method!=='HEAD')options.body=await req.clone().arrayBuffer();
    return lowerFetch(url,options);
  }

  async function fetchAt(url,input,init,deadlineMs,outer){
    const controller=new AbortController();
    const abort=()=>controller.abort();
    let timer=null;
    if(outer){
      if(outer.aborted)controller.abort();
      else outer.addEventListener('abort',abort,{once:true});
    }
    try{
      const fetchPromise=input instanceof Request
        ? fetchRequestAt(url,input,init,controller.signal)
        : lowerFetch(url,init?{...init,signal:controller.signal}:{signal:controller.signal});
      const timeoutPromise=new Promise((_,reject)=>{
        timer=setTimeout(()=>{
          controller.abort();
          const error=new Error('Сервер не ответил. Повторите попытку.');
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

  async function authRace(info,input,init,outer){
    const makeInput=()=>input instanceof Request?input.clone():input;
    const candidates=[
      [proxyUrl(GATEWAY,info),makeInput()],
      [proxyUrl(ALT_GATEWAY,info),makeInput()],
      [`${EDGE}/${encodeURIComponent(info.slug)}${info.search}`,makeInput()]
    ];
    const attempts=candidates.map(async([url,nextInput])=>{
      const response=await fetchAt(url,nextInput,init,AUTH_DEADLINE_MS,outer);
      if(await serviceNotAllowed(response)){
        const error=new Error('Маршрут сервиса недоступен');
        error.name='BOSServiceUnavailable';
        throw error;
      }
      return response;
    });
    try{return await Promise.any(attempts)}catch(error){
      if(error instanceof AggregateError){
        const retry=error.errors?.find(retryable);
        if(retry)throw retry;
        if(error.errors?.[0])throw error.errors[0];
      }
      throw error;
    }
  }

  window.fetch=async function(input,init){
    const raw=typeof input==='string'?input:input instanceof URL?input.href:input?.url||'';
    const info=proxyInfo(raw);
    if(!info)return lowerFetch(input,init);

    // Sending an Avito message is not idempotent. Never replay this route after
    // a timeout because the first provider may have accepted the message.
    if(info.slug==='avito-api')return lowerFetch(input,init);

    const outer=outerSignal(input,init);

    // Login/session validation is safe to retry and is especially sensitive to
    // slow mobile-carrier routing. Race all independent routes and accept the
    // first real HTTP response instead of failing after short sequential limits.
    if(resilientAuthRequest(info,input,init))return authRace(info,input,init,outer);

    let primaryInput=input;
    let alternateInput=input;
    let edgeInput=input;
    if(input instanceof Request){
      primaryInput=input.clone();
      alternateInput=input.clone();
      edgeInput=input.clone();
    }

    try{
      const response=await fetchAt(proxyUrl(GATEWAY,info),primaryInput,init,GATEWAY_DEADLINE_MS,outer);
      if(!await serviceNotAllowed(response))return response;
    }catch(error){
      if(outer?.aborted||!retryable(error))throw error;
    }

    try{
      const response=await fetchAt(proxyUrl(ALT_GATEWAY,info),alternateInput,init,ALT_GATEWAY_DEADLINE_MS,outer);
      if(!await serviceNotAllowed(response))return response;
    }catch(error){
      if(outer?.aborted||!retryable(error))throw error;
    }

    return fetchAt(`${EDGE}/${encodeURIComponent(info.slug)}${info.search}`,edgeInput,init,EDGE_DEADLINE_MS,outer);
  };

  window.BOS_NETWORK_DIRECT_V86={
    gateway:GATEWAY,
    primaryGateway:GATEWAY,
    secondaryGateway:ALT_GATEWAY,
    edge:EDGE,
    directUrl,
    proxyInfo,
    gatewayDeadlineMs:GATEWAY_DEADLINE_MS,
    alternateGatewayDeadlineMs:ALT_GATEWAY_DEADLINE_MS,
    edgeDeadlineMs:EDGE_DEADLINE_MS,
    authDeadlineMs:AUTH_DEADLINE_MS
  };
})();
