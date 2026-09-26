(()=>{
  const GATEWAY='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e';
  const BACKUP_GATEWAY='https://api-v2.appdeploy.ai/app/business-os-api-gateway-ukp6ew';
  const LEGACY_GATEWAY='https://business-os-api-gateway-3y8h7e.v2.appdeploy.ai';
  const ALT_GATEWAY='https://business-os-api-gateway.netlify.app';
  const EDGE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1';
  const GATEWAY_DEADLINE_MS=1800;
  const BACKUP_GATEWAY_DEADLINE_MS=2200;
  const ALT_GATEWAY_DEADLINE_MS=2200;
  const EDGE_DEADLINE_MS=5000;
  const AUTH_GATEWAY_DEADLINE_MS=1800;
  const AUTH_BACKUP_GATEWAY_DEADLINE_MS=3500;
  const AUTH_FALLBACK_DEADLINE_MS=1800;
  const AUTH_EDGE_DEADLINE_MS=6500;
  const ROUTE_FAILURE_STATUSES=new Set([502,503,504]);
  const SAFE_ACTIONS=new Set(['health','bootstrap','get','list','load','read','status']);
  if(typeof window.fetch!=='function'||window.BOS_NETWORK_DIRECT_V86)return;

  const lowerFetch=window.fetch.bind(window);
  const TARGETS=[
    {kind:'gateway',base:GATEWAY},
    {kind:'gateway',base:BACKUP_GATEWAY},
    {kind:'gateway',base:ALT_GATEWAY},
    {kind:'edge',base:EDGE}
  ];
  const preferredTargets=new Map();

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

  function targetUrl(target,info){
    return target.kind==='edge'
      ?`${EDGE}/${encodeURIComponent(info.slug)}${info.search}`
      :`${target.base}/api/proxy/${encodeURIComponent(info.slug)}${info.search}`;
  }

  function directUrl(raw){
    const info=proxyInfo(raw);
    return info?`${EDGE}/${encodeURIComponent(info.slug)}${info.search}`:'';
  }

  function targetKey(target){return `${target.kind}:${target.base}`}
  function preferredTargetFor(slug){return preferredTargets.get(slug)||TARGETS[0]}
  function orderedTargets(slug){
    const preferred=preferredTargetFor(slug);
    return [preferred,...TARGETS.filter(target=>targetKey(target)!==targetKey(preferred))];
  }
  function rememberTarget(slug,target){preferredTargets.set(slug,target)}
  function outerSignal(input,init){return init?.signal||(input instanceof Request?input.signal:null)||null}

  async function requestAction(input,init){
    let body=init?.body;
    if(body==null&&input instanceof Request){
      try{body=await input.clone().text()}catch(_){return ''}
    }
    if(typeof body!=='string')return '';
    try{return String(JSON.parse(body)?.action||'')}
    catch(_){return ''}
  }

  async function replayAllowed(info,input,init){
    const method=String(init?.method||(input instanceof Request?input.method:'GET')||'GET').toUpperCase();
    if(method==='GET'||method==='HEAD')return true;
    if(info.slug==='password-session-api'||info.slug==='vk-session-api')return true;
    return SAFE_ACTIONS.has(await requestAction(input,init));
  }

  function directPasswordInit(input,init){
    const headers=new Headers(input instanceof Request?input.headers:undefined);
    if(init?.headers)new Headers(init.headers).forEach((value,key)=>headers.set(key,value));
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
    const options={method,headers:new Headers(req.headers),mode:req.mode,credentials:req.credentials,cache:req.cache,redirect:req.redirect,referrer:req.referrer,referrerPolicy:req.referrerPolicy,integrity:req.integrity,keepalive:req.keepalive,signal};
    if(method!=='GET'&&method!=='HEAD')options.body=await req.clone().arrayBuffer();
    return lowerFetch(url,options);
  }

  async function fetchAt(url,input,init,deadlineMs,outer,bufferBody=false){
    const controller=new AbortController();
    const abort=()=>controller.abort();
    let timer=null;
    if(outer){if(outer.aborted)controller.abort();else outer.addEventListener('abort',abort,{once:true})}
    try{
      const requestPromise=input instanceof Request
        ?fetchRequestAt(url,input,init,controller.signal)
        :lowerFetch(url,init?{...init,signal:controller.signal}:{signal:controller.signal});
      const fetchPromise=Promise.resolve(requestPromise).then(async response=>{
        if(!bufferBody)return response;
        const headerResponse=passwordHeaderResponse(response);
        if(headerResponse)return headerResponse;
        const body=await response.arrayBuffer();
        return new Response(body,{status:response.status,statusText:response.statusText,headers:new Headers(response.headers)});
      });
      const timeoutPromise=new Promise((_,reject)=>{
        timer=setTimeout(()=>{const error=new Error('Сервер не ответил. Повторите попытку.');error.name='BOSRouteTimeout';reject(error);controller.abort()},deadlineMs);
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
    try{const body=await response.clone().json();const code=String(body?.error||'');return code==='SERVICE_NOT_ALLOWED'||code==='UNKNOWN_SERVICE'}catch(_){return false}
  }

  function deadlineFor(target,passwordAuth){
    if(target.kind==='edge')return passwordAuth?AUTH_EDGE_DEADLINE_MS:EDGE_DEADLINE_MS;
    if(target.base===GATEWAY)return passwordAuth?AUTH_GATEWAY_DEADLINE_MS:GATEWAY_DEADLINE_MS;
    if(target.base===BACKUP_GATEWAY)return passwordAuth?AUTH_BACKUP_GATEWAY_DEADLINE_MS:BACKUP_GATEWAY_DEADLINE_MS;
    return passwordAuth?AUTH_FALLBACK_DEADLINE_MS:ALT_GATEWAY_DEADLINE_MS;
  }

  function attemptInput(input){return input instanceof Request?input.clone():input}
  function attemptInit(target,passwordAuth,input,init){return target.kind==='edge'&&passwordAuth?directPasswordInit(input,init):init}

  async function safeFetch(info,input,init,outer,passwordAuth){
    const targets=orderedTargets(info.slug);
    let lastError=null;
    let lastResponse=null;
    for(let i=0;i<targets.length;i++){
      const target=targets[i];
      const currentInput=attemptInput(input);
      try{
        const response=await fetchAt(targetUrl(target,info),currentInput,attemptInit(target,passwordAuth,currentInput,init),deadlineFor(target,passwordAuth),outer,passwordAuth);
        lastResponse=response;
        const deterministicMiss=await serviceNotAllowed(response);
        const transient=ROUTE_FAILURE_STATUSES.has(response.status);
        if(!deterministicMiss&&!transient){rememberTarget(info.slug,target);return response}
        if(i===targets.length-1)return response;
      }catch(error){
        lastError=error;
        if(outer?.aborted||!retryable(error))throw error;
        if(i===targets.length-1)throw error;
      }
    }
    if(lastResponse)return lastResponse;
    throw lastError||new Error('Сервер не ответил. Повторите попытку.');
  }

  async function singleWriteFetch(info,input,init,outer,passwordAuth){
    const targets=orderedTargets(info.slug);
    let target=targets[0];
    let currentInput=attemptInput(input);
    let response=await fetchAt(targetUrl(target,info),currentInput,attemptInit(target,passwordAuth,currentInput,init),deadlineFor(target,passwordAuth),outer,passwordAuth);
    if(!await serviceNotAllowed(response))return response;
    // SERVICE_NOT_ALLOWED is generated by the gateway before forwarding upstream,
    // so trying the next route cannot duplicate the business operation.
    for(let i=1;i<targets.length;i++){
      target=targets[i];
      currentInput=attemptInput(input);
      try{
        response=await fetchAt(targetUrl(target,info),currentInput,attemptInit(target,passwordAuth,currentInput,init),deadlineFor(target,passwordAuth),outer,passwordAuth);
      }catch(error){
        if(outer?.aborted||!retryable(error))throw error;
        throw error;
      }
      if(!await serviceNotAllowed(response)){if(!ROUTE_FAILURE_STATUSES.has(response.status))rememberTarget(info.slug,target);return response}
    }
    return response;
  }

  window.fetch=async function(input,init){
    const raw=typeof input==='string'?input:input instanceof URL?input.href:input?.url||'';
    const info=proxyInfo(raw);
    if(!info)return lowerFetch(input,init);
    if(info.slug==='avito-api')return lowerFetch(input,init);

    const outer=outerSignal(input,init);
    const passwordAuth=info.slug==='password-session-api';
    const canReplay=await replayAllowed(info,input,init);
    return canReplay
      ?safeFetch(info,input,init,outer,passwordAuth)
      :singleWriteFetch(info,input,init,outer,passwordAuth);
  };

  window.BOS_NETWORK_DIRECT_V86={
    gateway:GATEWAY,primaryGateway:GATEWAY,backupGateway:BACKUP_GATEWAY,secondaryGateway:ALT_GATEWAY,edge:EDGE,
    directUrl,proxyInfo,
    gatewayDeadlineMs:GATEWAY_DEADLINE_MS,backupGatewayDeadlineMs:BACKUP_GATEWAY_DEADLINE_MS,alternateGatewayDeadlineMs:ALT_GATEWAY_DEADLINE_MS,edgeDeadlineMs:EDGE_DEADLINE_MS,
    authGatewayDeadlineMs:AUTH_GATEWAY_DEADLINE_MS,authBackupGatewayDeadlineMs:AUTH_BACKUP_GATEWAY_DEADLINE_MS,authAlternateGatewayDeadlineMs:AUTH_FALLBACK_DEADLINE_MS,authEdgeDeadlineMs:AUTH_EDGE_DEADLINE_MS,
    preferredTarget:(slug='mini-app-api')=>({...preferredTargetFor(slug)}),
    transientHttpFailover:'safe-actions-only',writeReplay:'disabled-after-ambiguous-failure',passwordDirectSimpleCors:true,passwordBufferedResponse:true,passwordSessionHeaderFastPath:true
  };
})();
