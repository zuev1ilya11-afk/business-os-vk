(()=>{
  if(typeof window.fetch!=='function'||window.BOS_RU_NETWORK)return;
  const native=window.fetch.bind(window);
  const target=window.BOS_RELEASE_ORIGIN||location.origin;
  const source='https://obsropbslfwtanyspjbi.supabase.co';
  const gateways=[
    'https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e',
    'https://api-v2.appdeploy.ai/app/business-os-api-gateway-ukp6ew',
    'https://business-os-api-gateway-3y8h7e.v2.appdeploy.ai',
    'https://business-os-api-gateway.netlify.app',target
  ];
  function rewrite(raw){
    const u=new URL(raw,location.href);
    if(u.origin===source){
      if(!/^\/(functions|storage|auth|rest)\/v1\//.test(u.pathname))throw Error('Неизвестный адрес старого API');
      return target+u.pathname+u.search;
    }
    for(const base of gateways){
      if(u.href.startsWith(base+'/api/proxy/'))return target+'/functions/v1/'+u.href.slice((base+'/api/proxy/').length);
      if(u.href.startsWith(base+'/api/gas-report'))return target+'/api/gas-report'+u.search;
    }
    if(u.origin==='https://script.google.com'&&u.pathname.startsWith('/macros/s/'))return target+'/api/gas-report'+u.search;
    return raw;
  }
  window.fetch=async function(input,init){
    const raw=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    const next=rewrite(raw);
    if(next===raw)return native(input,init);
    if(input instanceof Request)return native(new Request(next,new Request(input,init)));
    return native(next,init);
  };
  window.BOS_RU_NETWORK={origin:target,rewrite};
  window.BOS_NETWORK_DIRECT_V86={gateway:target,primaryGateway:target,edge:target+'/functions/v1',
    clearPreferredTarget:()=>{},preferredTarget:()=>({kind:'edge',base:target+'/functions/v1'}),
    directEdgeFailover:false,writeReplay:'never'};
  window.BOS_NETWORK_GATEWAY_V85={gateway:target,primaryGateway:target,secondaryGateway:target,rewrite};
})();
