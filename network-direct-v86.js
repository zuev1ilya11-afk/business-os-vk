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
  const REVIEW_DEADLINE_MS=90000;
  // Report finalization is a single business write: give a slow mobile/gateway route time to finish,
  // but keep replay disabled so an ambiguous response cannot submit the report twice.
  const REPORT_FINALIZE_DEADLINE_MS=30000;
  const AUTH_GATEWAY_DEADLINE_MS=1800;
  const AUTH_BACKUP_GATEWAY_DEADLINE_MS=3500;
  const AUTH_FALLBACK_DEADLINE_MS=1800;
  const AUTH_EDGE_DEADLINE_MS=6500;
  const ROUTE_FAILURE_STATUSES=new Set([402,502,503,504]);
  const SAFE_ACTIONS=new Set(['health','bootstrap','get','list','load','read','status','uploadReportFile','finalizeMasterReport','syncHandsOrders','markCalled','confirmAgreement','setAgreementSchedule','setStage']);
  if(typeof window.fetch!=='function'||window.BOS_NETWORK_DIRECT_V86)return;

  const lowerFetch=window.fetch.bind(window);
  const TARGETS=[
    {kind:'gateway',base:GATEWAY},
    {kind:'gateway',base:BACKUP_GATEWAY},
    {kind:'gateway',base:ALT_GATEWAY},
    {kind:'edge',base:EDGE}
  ];
  const preferredTargets=new Map();
  const edgeUrl=new URL(EDGE);
  const edgePrefix=edgeUrl.pathname.replace(/\/$/,'')+'/';

  function proxyInfo(raw){
    let url;
    try{url=new URL(raw,location.href)}catch(_){return null}
    if(url.origin===edgeUrl.origin&&url.pathname.startsWith(edgePrefix)){
      const slug=decodeURIComponent(url.pathname.slice(edgePrefix.length)).replace(/^\/+|\/+$/g,'');
      if(!slug||slug.includes('/'))return null;
      return {origin:url.origin,slug,search:url.search,direct:true,sourceBase:EDGE};
    }
    const base=[GATEWAY,BACKUP_GATEWAY,LEGACY_GATEWAY,ALT_GATEWAY].find(base=>url.href.startsWith(base+'/api/proxy/'));
    if(!base)return null;
    const prefix=new URL(base).pathname.replace(/\/$/,'')+'/api/proxy/';
    const slug=decodeURIComponent(url.pathname.slice(prefix.length)).replace(/^\/+|\/+$/g,'');
    if(!slug||slug.includes('/'))return null;
    return {origin:url.origin,slug,search:url.search,direct:false,sourceBase:base};
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
  function sourceTargetFor(info){
    if(info?.direct)return TARGETS.find(target=>target.kind==='edge')||TARGETS[TARGETS.length-1];
    if(info?.sourceBase===ALT_GATEWAY||info?.sourceBase===LEGACY_GATEWAY)return TARGETS[0];
    return TARGETS.find(target=>target.base===info?.sourceBase)||TARGETS[0];
  }
  function preferredTargetFor(slug,fallback=TARGETS[0]){return preferredTargets.get(slug)||fallback}
  function orderedTargets(info){
    const source=sourceTargetFor(info);
    const preferred=preferredTargetFor(info.slug,source);
    return [preferred,...TARGETS.filter(target=>targetKey(target)!==targetKey(preferred))];
  }
  function rememberTarget(slug,target){preferredTargets.set(slug,target)}
  function clearPreferredTarget(slug){
    if(slug)preferredTargets.delete(String(slug));
    else preferredTargets.clear();
  }
  // A route that worked on Wi-Fi may be unreachable after a VPN/mobile switch.
  window.addEventListener?.('online',()=>clearPreferredTarget());
  globalThis.navigator?.connection?.addEventListener?.('change',()=>clearPreferredTarget());
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
    // The caller will reconcile the order before allowing another business write.
    if(init?.bosReconcileBeforeRetry===true)return false;
    const method=String(init?.method||(input instanceof Request?input.method:'GET')||'GET').toUpperCase();
    if(method==='GET'||method==='HEAD')return true;
    if(info.slug==='password-session-api'||info.slug==='vk-session-api')return true;
    if(info.slug==='push-api')return ['status','subscribe','revoke'].includes(await requestAction(input,init));
    if(info.slug==='staff-admin-api'&&await requestAction(input,init)==='listStaff')return true;
    if(info.slug==='integration-api'&&['listIntegrations','testMapping','listOrders','getOrder'].includes(await requestAction(input,init)))return true;
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

  async function fetchAt(url,input,init,deadlineMs,outer,bufferBody=false,passwordAuth=false,requestEnd=Infinity){
    const controller=new AbortController();
    const abort=()=>controller.abort();
    let timer=null;
    if(outer){if(outer.aborted)controller.abort();else outer.addEventListener('abort',abort,{once:true})}
    try{
      const started=Date.now();
      // The route deadline bounds inactivity, not a response making steady progress.
      // Password auth retains its existing total deadline; other bodies have a 15s cap.
      const totalLimit=Math.min(requestEnd-started,passwordAuth?deadlineMs:Math.max(deadlineMs,15000));
      let rejectTimeout;
      const arm=()=>{
        clearTimeout(timer);
        const remaining=Math.max(0,totalLimit-(Date.now()-started));
        timer=setTimeout(()=>{const error=new Error('Сервер не ответил. Повторите попытку.');error.name='BOSRouteTimeout';rejectTimeout(error);controller.abort()},Math.min(deadlineMs,remaining));
      };
      const timeoutPromise=new Promise((_,reject)=>{rejectTimeout=reject;arm()});
      const requestPromise=input instanceof Request
        ?fetchRequestAt(url,input,init,controller.signal)
        :lowerFetch(url,init?{...init,signal:controller.signal}:{signal:controller.signal});
      const fetchPromise=Promise.resolve(requestPromise).then(async response=>{
        if(!bufferBody)return response;
        const headerResponse=passwordAuth?passwordHeaderResponse(response):null;
        if(headerResponse)return headerResponse;
        let body;
        if(!passwordAuth&&response.body?.getReader){
          arm();
          const reader=response.body.getReader(),chunks=[];
          try{while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);arm()}}
          finally{reader.releaseLock()}
          body=new Uint8Array(chunks.reduce((size,chunk)=>size+chunk.byteLength,0));
          let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength}
        }else body=await response.arrayBuffer();
        return new Response([204,205,304].includes(response.status)?null:body,{status:response.status,statusText:response.statusText,headers:new Headers(response.headers)});
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

  async function rejectedBeforeForward(response,target){
    if(await serviceNotAllowed(response))return true;
    // AppDeploy's availability gate rejects the request before invoking our proxy.
    // A generic 402/5xx is not proof: the business write may already have committed.
    if(![GATEWAY,BACKUP_GATEWAY].includes(target.base)||response.status!==402||response.headers.get('x-appdeploy-app-availability')!=='temporarily-unavailable')return false;
    try{return (await response.clone().json())?.code==='APP_TEMPORARILY_UNAVAILABLE'}catch(_){return false}
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
    const targets=orderedTargets(info);
    const requestEnd=Date.now()+15000;
    let lastError=null;
    let lastResponse=null;
    for(let i=0;i<targets.length;i++){
      if(Date.now()>=requestEnd){const error=new Error('Сервер не ответил. Повторите попытку.');error.name='BOSRouteTimeout';throw error}
      const target=targets[i];
      const currentInput=attemptInput(input);
      try{
        const response=await fetchAt(targetUrl(target,info),currentInput,attemptInit(target,passwordAuth,currentInput,init),deadlineFor(target,passwordAuth),outer,true,passwordAuth,requestEnd);
        lastResponse=response;
        const deterministicMiss=await serviceNotAllowed(response);
        const transient=ROUTE_FAILURE_STATUSES.has(response.status);
        if(!deterministicMiss&&!transient){rememberTarget(info.slug,target);return response}
        if(i===targets.length-1)return response;
      }catch(error){
        lastError=error;
        if(outer?.aborted||Date.now()>=requestEnd||!retryable(error))throw error;
        if(i===targets.length-1)throw error;
      }
    }
    if(lastResponse)return lastResponse;
    throw lastError||new Error('Сервер не ответил. Повторите попытку.');
  }

  async function singleWriteFetch(info,input,init,outer,passwordAuth){
    const action=await requestAction(input,init);
    const review=info.slug==='drive-archive-api'||action==='reviewReport';
    const reportFinalize=action==='finalizeMasterReport'&&init?.bosReconcileBeforeRetry===true;
    const writeDeadline=review?REVIEW_DEADLINE_MS:reportFinalize?REPORT_FINALIZE_DEADLINE_MS:null;
    const targets=orderedTargets(info);
    let target=targets[0];
    let currentInput=attemptInput(input);
    let response=await fetchAt(targetUrl(target,info),currentInput,attemptInit(target,passwordAuth,currentInput,init),writeDeadline??deadlineFor(target,passwordAuth),outer,true,passwordAuth);
    if(!await rejectedBeforeForward(response,target))return response;
    // Only explicit pre-forward denials permit another route for a business write.
    for(let i=1;i<targets.length;i++){
      target=targets[i];
      currentInput=attemptInput(input);
      try{
        response=await fetchAt(targetUrl(target,info),currentInput,attemptInit(target,passwordAuth,currentInput,init),writeDeadline??deadlineFor(target,passwordAuth),outer,true,passwordAuth);
      }catch(error){
        if(outer?.aborted||!retryable(error))throw error;
        throw error;
      }
      if(!await rejectedBeforeForward(response,target)){if(!ROUTE_FAILURE_STATUSES.has(response.status))rememberTarget(info.slug,target);return response}
    }
    return response;
  }

  async function avitoFetch(info,input,init){
    // Preserve Avito's configured route, provider responses and caller's 18s budget.
    // Only a proven pre-forward denial permits moving a send to another route.
    const source=TARGETS.find(target=>target.base===info.sourceBase)||sourceTargetFor(info);
    const targets=[source,...TARGETS.filter(target=>targetKey(target)!==targetKey(source))];
    const signal=outerSignal(input,init);
    let response;
    for(const target of targets){
      if(signal?.aborted)throw Object.assign(new Error('Aborted'),{name:'AbortError'});
      response=input instanceof Request
        ?await fetchRequestAt(targetUrl(target,info),attemptInput(input),init,signal)
        :await lowerFetch(targetUrl(target,info),init);
      if(!await rejectedBeforeForward(response,target))return response;
    }
    return response;
  }

  window.fetch=async function(input,init){
    const raw=typeof input==='string'?input:input instanceof URL?input.href:input?.url||'';
    const info=proxyInfo(raw);
    if(!info)return lowerFetch(input,init);
    if(info.slug==='avito-api')return avitoFetch(info,input,init);

    const outer=outerSignal(input,init);
    const passwordAuth=info.slug==='password-session-api';
    const canReplay=await replayAllowed(info,input,init);
    try{return await (canReplay
      ?safeFetch(info,input,init,outer,passwordAuth)
      :singleWriteFetch(info,input,init,outer,passwordAuth));
    }catch(error){
      if(!canReplay&&!outer?.aborted&&retryable(error))throw new Error('Ответ на сохранение не получен. Обновите заявку и проверьте результат перед повторной отправкой.');
      throw error;
    }
  };

  window.BOS_NETWORK_DIRECT_V86={
    gateway:GATEWAY,primaryGateway:GATEWAY,backupGateway:BACKUP_GATEWAY,secondaryGateway:ALT_GATEWAY,edge:EDGE,
    directUrl,proxyInfo,
    gatewayDeadlineMs:GATEWAY_DEADLINE_MS,backupGatewayDeadlineMs:BACKUP_GATEWAY_DEADLINE_MS,alternateGatewayDeadlineMs:ALT_GATEWAY_DEADLINE_MS,edgeDeadlineMs:EDGE_DEADLINE_MS,
    authGatewayDeadlineMs:AUTH_GATEWAY_DEADLINE_MS,authBackupGatewayDeadlineMs:AUTH_BACKUP_GATEWAY_DEADLINE_MS,authAlternateGatewayDeadlineMs:AUTH_FALLBACK_DEADLINE_MS,authEdgeDeadlineMs:AUTH_EDGE_DEADLINE_MS,reportFinalizeDeadlineMs:REPORT_FINALIZE_DEADLINE_MS,
    preferredTarget:(slug='mini-app-api')=>({...preferredTargetFor(slug,TARGETS[0])}),clearPreferredTarget,
    transientHttpFailover:'safe-actions-only',writeReplay:'idempotent-actions-only',passwordDirectSimpleCors:true,passwordBufferedResponse:true,passwordSessionHeaderFastPath:true,directEdgeFailover:true,sourceRoutePreserved:true,restricted402Failover:true
  };
})();
