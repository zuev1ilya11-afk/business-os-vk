(()=>{
  // AppDeploy serves static pages and backend APIs on different hosts.
  const GATEWAY='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e';
  const BACKUP_GATEWAY='https://api-v2.appdeploy.ai/app/business-os-api-gateway-ukp6ew';
  const LEGACY_GATEWAY='https://business-os-api-gateway-3y8h7e.v2.appdeploy.ai';
  const ALT_GATEWAY='https://business-os-api-gateway.netlify.app';
  const EDGE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1';
  // Keep the complete failover chain below the outer 15s/20s app timeouts while
  // giving slow cellular connections more room than the previous 2.2s budget.
  const GATEWAY_DEADLINE_MS=2600;
  const BACKUP_GATEWAY_DEADLINE_MS=2600;
  const ALT_GATEWAY_DEADLINE_MS=3000;
  const EDGE_DEADLINE_MS=5000;
  const AUTH_GATEWAY_DEADLINE_MS=3500;
  const AUTH_BACKUP_GATEWAY_DEADLINE_MS=3000;
  const AUTH_FALLBACK_DEADLINE_MS=5000;
  const AUTH_EDGE_DEADLINE_MS=6500;
  const ROUTE_FAILURE_STATUSES=new Set([502,503,504]);
  if(typeof window.fetch!=='function'||window.BOS_NETWORK_DIRECT_V86)return;

  const lowerFetch=window.fetch.bind(window);

  function proxyInfo(raw){
    let url;
    try{url=new URL(raw,location.href)}catch(_){return null}
    const base=[GATEWAY,BACKUP_GATEWAY,LEGACY_GATEWAY,ALT_GATEWAY].find(base=>url.href.startsWith(base+'/api/proxy/'));
    if(!base)return null;
    const prefix=new URL(base).pathname.replace(/\/$/,'')+'/api/proxy/';
    const slug=decodeURIComponent(url.pathname.slice(prefix.length)).replace(/^\/+|\/+$/g,'');
    if(!slug||slug.includes('/'))return null;
    return {origin:url.origin,slug,search:url.search};
  }

  function proxyUrl(base,info){
    return `${base}/api/proxy/${encodeURIComponent(info.slug)}${info.search}`;
  }

  function directUrl(raw){
    const info=proxyInfo(raw);
    return info?`${EDGE}/${encodeURIComponent(info.slug)}${info.search}`:'';
  }

  function outerSignal(input,init){
    return init?.signal||(input instanceof Request?input.signal:null)||null;
  }

  function directPasswordInit(input,init){
    const headers=new Headers(input instanceof Request?input.headers:undefined);
    if(init?.headers)new Headers(init.headers).forEach((value,key)=>headers.set(key,value));
    // Login has no auth headers. Using a CORS-safelisted content type lets the
    // final direct Edge fallback POST without a preflight, which some mobile
    // networks deliver inconsistently even though the Edge Function is healthy.
    const hasAuthHeader=['x-bos-session','authorization','apikey','x-vk-launch-params'].some(name=>headers.has(name));
    if(hasAuthHeader)return init;
    headers.set('Content-Type','text/plain;charset=UTF-8');
    return {...(init||{}),headers};
  }

  function passwordHeaderResponse(response){
    if(!response?.ok)return null;
    const session=String(response.headers.get('x-bos-session')||'').trim();
    if(!/^[A-Za-z0-9_-]{1,128}\.[0-9]+\.[A-Za-z0-9_-]+$/.test(session))return null;
    return new Response(JSON.stringify({ok:true,session_token:session}),{
      status:response.status,
      statusText:response.statusText,
      headers:{'Content-Type':'application/json'}
    });
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

  async function fetchAt(url,input,init,deadlineMs,outer,bufferBody=false){
    const controller=new AbortController();
    const abort=()=>controller.abort();
    let timer=null;
    if(outer){
      if(outer.aborted)controller.abort();
      else outer.addEventListener('abort',abort,{once:true});
    }
    try{
      const requestPromise=input instanceof Request
        ? fetchRequestAt(url,input,init,controller.signal)
        : lowerFetch(url,init?{...init,signal:controller.signal}:{signal:controller.signal});
      // A successful password login can expose the session in a response header.
      // Headers arrive before the body, so Android can finish auth even when a
      // cellular path stalls while delivering the JSON payload itself.
      const fetchPromise=Promise.resolve(requestPromise).then(async response=>{
        if(!bufferBody)return response;
        const headerResponse=passwordHeaderResponse(response);
        if(headerResponse)return headerResponse;
        const body=await response.arrayBuffer();
        return new Response(body,{
          status:response.status,
          statusText:response.statusText,
          headers:new Headers(response.headers)
        });
      });
      const timeoutPromise=new Promise((_,reject)=>{
        timer=setTimeout(()=>{
          const error=new Error('Сервер не ответил. Повторите попытку.');
          error.name='BOSRouteTimeout';
          reject(error);
          controller.abort();
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

  async function shouldFailOver(response){
    if(!response)return true;
    if(ROUTE_FAILURE_STATUSES.has(response.status))return true;
    return await serviceNotAllowed(response);
  }

  window.fetch=async function(input,init){
    const raw=typeof input==='string'?input:input instanceof URL?input.href:input?.url||'';
    const info=proxyInfo(raw);
    if(!info)return lowerFetch(input,init);

    // Sending an Avito message is not idempotent. Never replay this route after
    // a timeout because the first provider may have accepted the message.
    if(info.slug==='avito-api')return lowerFetch(input,init);

    const outer=outerSignal(input,init);
    const passwordAuth=info.slug==='password-session-api';
    let primaryInput=input;
    let backupInput=input;
    let alternateInput=input;
    let edgeInput=input;
    if(input instanceof Request){
      primaryInput=input.clone();
      backupInput=input.clone();
      alternateInput=input.clone();
      edgeInput=input.clone();
    }

    try{
      const response=await fetchAt(
        proxyUrl(GATEWAY,info),
        primaryInput,
        init,
        passwordAuth?AUTH_GATEWAY_DEADLINE_MS:GATEWAY_DEADLINE_MS,
        outer,
        passwordAuth
      );
      if(!await shouldFailOver(response))return response;
    }catch(error){
      if(outer?.aborted||!retryable(error))throw error;
    }

    try{
      const response=await fetchAt(
        proxyUrl(BACKUP_GATEWAY,info),
        backupInput,
        init,
        passwordAuth?AUTH_BACKUP_GATEWAY_DEADLINE_MS:BACKUP_GATEWAY_DEADLINE_MS,
        outer,
        passwordAuth
      );
      if(!await shouldFailOver(response))return response;
    }catch(error){
      if(outer?.aborted||!retryable(error))throw error;
    }

    try{
      const response=await fetchAt(
        proxyUrl(ALT_GATEWAY,info),
        alternateInput,
        init,
        passwordAuth?AUTH_FALLBACK_DEADLINE_MS:ALT_GATEWAY_DEADLINE_MS,
        outer,
        passwordAuth
      );
      if(!await shouldFailOver(response))return response;
    }catch(error){
      if(outer?.aborted||!retryable(error))throw error;
    }

    const edgeInit=passwordAuth?directPasswordInit(edgeInput,init):init;
    return fetchAt(
      `${EDGE}/${encodeURIComponent(info.slug)}${info.search}`,
      edgeInput,
      edgeInit,
      passwordAuth?AUTH_EDGE_DEADLINE_MS:EDGE_DEADLINE_MS,
      outer,
      passwordAuth
    );
  };

  window.BOS_NETWORK_DIRECT_V86={
    gateway:GATEWAY,
    primaryGateway:GATEWAY,
    backupGateway:BACKUP_GATEWAY,
    secondaryGateway:ALT_GATEWAY,
    edge:EDGE,
    directUrl,
    proxyInfo,
    gatewayDeadlineMs:GATEWAY_DEADLINE_MS,
    backupGatewayDeadlineMs:BACKUP_GATEWAY_DEADLINE_MS,
    alternateGatewayDeadlineMs:ALT_GATEWAY_DEADLINE_MS,
    edgeDeadlineMs:EDGE_DEADLINE_MS,
    authGatewayDeadlineMs:AUTH_GATEWAY_DEADLINE_MS,
    authBackupGatewayDeadlineMs:AUTH_BACKUP_GATEWAY_DEADLINE_MS,
    authAlternateGatewayDeadlineMs:AUTH_FALLBACK_DEADLINE_MS,
    authEdgeDeadlineMs:AUTH_EDGE_DEADLINE_MS,
    transientHttpFailover:true,
    passwordDirectSimpleCors:true,
    passwordBufferedResponse:true,
    passwordSessionHeaderFastPath:true
  };
})();
