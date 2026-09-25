(()=>{
  // AppDeploy serves static pages and backend APIs on different hosts.
  const GATEWAY='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e';
  const LEGACY_GATEWAY='https://business-os-api-gateway-3y8h7e.v2.appdeploy.ai';
  const ALT_GATEWAY='https://business-os-api-gateway.netlify.app';
  const EDGE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1';
  const GATEWAY_DEADLINE_MS=2200;
  const ALT_GATEWAY_DEADLINE_MS=2200;
  const EDGE_DEADLINE_MS=3500;
  const AUTH_FALLBACK_DEADLINE_MS=6000;
  if(typeof window.fetch!=='function'||window.BOS_NETWORK_DIRECT_V86)return;

  const lowerFetch=window.fetch.bind(window);

  function proxyInfo(raw){
    let url;
    try{url=new URL(raw,location.href)}catch(_){return null}
    const base=[GATEWAY,LEGACY_GATEWAY,ALT_GATEWAY].find(base=>url.href.startsWith(base+'/api/proxy/'));
    if(!base)return null;
    const prefix=new URL(base).pathname.replace(/\/$/,'')+'/api/proxy/';
    const slug=decodeURIComponent(url.pathname.slice(prefix.length)).replace(/^\/+|\/+$/g,'');
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
      // Password auth must finish reading the small JSON payload before this
      // route is considered healthy. Read it once and rebuild the response;
      // response.clone() creates a tee that can stall on Android mobile links.
      const fetchPromise=Promise.resolve(requestPromise).then(async response=>{
        if(!bufferBody)return response;
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

  window.fetch=async function(input,init){
    const raw=typeof input==='string'?input:input instanceof URL?input.href:input?.url||'';
    const info=proxyInfo(raw);
    if(!info)return lowerFetch(input,init);

    // Sending an Avito message is not idempotent. Never replay this route after
    // a timeout because the first provider may have accepted the message.
    if(info.slug==='avito-api')return lowerFetch(input,init);

    const outer=outerSignal(input,init);
    const passwordAuth=info.slug==='password-session-api';
    const fallbackResponse=async response=>
      (passwordAuth&&[502,503,504].includes(response.status))||await serviceNotAllowed(response);
    let primaryInput=input;
    let alternateInput=input;
    let edgeInput=input;
    if(input instanceof Request){
      primaryInput=input.clone();
      alternateInput=input.clone();
      edgeInput=input.clone();
    }

    // Even legacy modules that still point at Netlify are sent through the
    // independent gateway first. This keeps old cached/auth code VPN-independent.
    try{
      const response=await fetchAt(proxyUrl(GATEWAY,info),primaryInput,init,GATEWAY_DEADLINE_MS,outer,passwordAuth);
      if(!await fallbackResponse(response))return response;
    }catch(error){
      if(outer?.aborted||!retryable(error))throw error;
    }

    try{
      const response=await fetchAt(proxyUrl(ALT_GATEWAY,info),alternateInput,init,passwordAuth?AUTH_FALLBACK_DEADLINE_MS:ALT_GATEWAY_DEADLINE_MS,outer,passwordAuth);
      if(!await fallbackResponse(response))return response;
    }catch(error){
      if(outer?.aborted||!retryable(error))throw error;
    }

    const edgeInit=passwordAuth?directPasswordInit(edgeInput,init):init;
    return fetchAt(`${EDGE}/${encodeURIComponent(info.slug)}${info.search}`,edgeInput,edgeInit,passwordAuth?AUTH_FALLBACK_DEADLINE_MS:EDGE_DEADLINE_MS,outer,passwordAuth);
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
    passwordDirectSimpleCors:true,
    passwordBufferedResponse:true
  };
})();
