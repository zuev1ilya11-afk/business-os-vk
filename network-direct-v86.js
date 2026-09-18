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
    let timedOut=false;
    const abort=()=>controller.abort();
    if(outer){
      if(outer.aborted)controller.abort();
      else outer.addEventListener('abort',abort,{once:true});
    }
    const timer=setTimeout(()=>{timedOut=true;controller.abort()},GATEWAY_DEADLINE_MS);
    try{
      if(input instanceof Request)return await lowerFetch(new Request(input.clone(),{signal:controller.signal}),init?{...init,signal:controller.signal}:{signal:controller.signal});
      return await lowerFetch(input,init?{...init,signal:controller.signal}:{signal:controller.signal});
    }catch(error){
      if(timedOut){const e=new Error('Gateway timeout');e.name='BOSGatewayTimeout';throw e}
      throw error;
    }finally{
      clearTimeout(timer);
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

  window.fetch=async function(input,init){
    const raw=typeof input==='string'?input:input instanceof URL?input.href:input?.url||'';
    const next=directUrl(raw);
    if(!next)return lowerFetch(input,init);
    const outer=outerSignal(input,init);
    const retryInput=input instanceof Request?input.clone():input;
    try{return await gatewayFetch(input,init)}catch(error){
      if(outer?.aborted||!retryable(error))throw error;
      if(retryInput instanceof Request)return fetchRequestAt(next,retryInput,init);
      return lowerFetch(next,init);
    }
  };

  window.BOS_NETWORK_DIRECT_V86={gateway:GATEWAY,edge:EDGE,directUrl,gatewayDeadlineMs:GATEWAY_DEADLINE_MS};
})();
