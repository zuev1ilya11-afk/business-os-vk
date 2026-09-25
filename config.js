(()=>{
  const PRIMARY_GATEWAY='https://business-os-api-gateway-3y8h7e.v2.appdeploy.ai';
  const SECONDARY_GATEWAY='https://business-os-api-gateway.netlify.app';
  const SUPABASE='https://obsropbslfwtanyspjbi.supabase.co';
  const GAS='https://script.google.com';

  window.BUSINESS_OS_CONFIG={
    VK_APP_ID:54758847,
    API_URL:PRIMARY_GATEWAY+'/api/proxy/mini-app-api',
    GAS_WEB_APP_URL:PRIMARY_GATEWAY+'/api/proxy/mini-app-api',
    REPORT_GAS_WEB_APP_URL:PRIMARY_GATEWAY+'/api/gas-report'
  };

  if(typeof window.fetch!=='function'||window.BOS_NETWORK_GATEWAY_V85)return;
  const nativeFetch=window.fetch.bind(window);

  function gatewayBase(){
    return location.origin===PRIMARY_GATEWAY?location.origin:PRIMARY_GATEWAY;
  }

  function rewrite(raw){
    let url;
    try{url=new URL(raw,location.href)}catch(_){return raw}
    if(url.origin===SUPABASE&&url.pathname.startsWith('/functions/v1/')){
      const slug=url.pathname.slice('/functions/v1/'.length).replace(/^\/+|\/+$/g,'');
      if(slug&&!slug.includes('/'))return gatewayBase()+'/api/proxy/'+encodeURIComponent(slug)+url.search;
    }
    if(url.origin===GAS&&url.pathname.startsWith('/macros/s/'))return gatewayBase()+'/api/gas-report'+url.search;
    return raw;
  }

  window.fetch=function(input,init){
    const raw=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    const next=rewrite(raw);
    if(next===raw)return nativeFetch(input,init);
    if(input instanceof Request)return nativeFetch(new Request(next,input),init);
    return nativeFetch(next,init);
  };

  window.BOS_NETWORK_GATEWAY_V85={
    rewrite,
    gateway:PRIMARY_GATEWAY,
    primaryGateway:PRIMARY_GATEWAY,
    secondaryGateway:SECONDARY_GATEWAY
  };
})();
