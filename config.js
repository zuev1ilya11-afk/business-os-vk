(()=>{
  const LEGACY_PRIMARY_GATEWAY='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e';
  const LEGACY_SECONDARY_GATEWAY='https://business-os-api-gateway.netlify.app';
  const SUPABASE='https://obsropbslfwtanyspjbi.supabase.co';
  const GAS='https://script.google.com';

  function cleanBase(value){
    const raw=String(value||'').trim().replace(/\/+$/,'');
    if(!raw)return '';
    try{
      const url=new URL(raw);
      if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)return '';
      return raw;
    }catch(_){return ''}
  }

  // Migration switch: production remains unchanged while this is empty.
  // A Russian production host can inject window.BOS_RU_API_BASE before config.js
  // and become primary without changing feature/business modules.
  const RU_GATEWAY=cleanBase(window.BOS_RU_API_BASE);
  const PRIMARY_GATEWAY=RU_GATEWAY||LEGACY_PRIMARY_GATEWAY;
  const SECONDARY_GATEWAY=LEGACY_SECONDARY_GATEWAY;

  window.BOS_INFRA_ENDPOINTS={
    mode:RU_GATEWAY?'ru-primary':'legacy',
    primaryGateway:PRIMARY_GATEWAY,
    secondaryGateway:SECONDARY_GATEWAY,
    legacyPrimaryGateway:LEGACY_PRIMARY_GATEWAY,
    legacySecondaryGateway:LEGACY_SECONDARY_GATEWAY,
    edge:SUPABASE+'/functions/v1',
    ruGateway:RU_GATEWAY
  };

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
