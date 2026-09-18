(()=>{
  const GATEWAY='https://business-os-api-gateway.netlify.app';
  const EDGE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1';
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

  window.fetch=function(input,init){
    const raw=typeof input==='string'?input:input instanceof URL?input.href:input?.url||'';
    const next=directUrl(raw);
    if(!next)return lowerFetch(input,init);
    if(input instanceof Request)return fetchRequestAt(next,input,init);
    return lowerFetch(next,init);
  };

  window.BOS_NETWORK_DIRECT_V86={gateway:GATEWAY,edge:EDGE,directUrl};
})();
