(()=>{
'use strict';
// Only the self-hosted deployment uses a same-origin API. Preview/cloud builds retain their routes.
const hosts=['homemaster.qd.je','139.100.237.167','136.234.17.113'];
const active=window.BOS_RU_NETWORK?.origin||(hosts.includes(location.hostname)?location.origin:'');
const storageHosts=['obsropbslfwtanyspjbi.supabase.co',...hosts];
window.BOS_REPORT_URL=value=>{
 try{if(!value)return '';const u=new URL(String(value),active||location.href);if(!['https:','http:'].includes(u.protocol))return '';
  return active&&storageHosts.includes(u.hostname)&&u.pathname.startsWith('/storage/v1/')?active+u.pathname+u.search+u.hash:u.href;
 }catch{return ''}
};
if(!active||window.BOS_RU_NETWORK||typeof window.fetch!=='function')return;
const base=window.fetch.bind(window);
const gateways=['api-v2.appdeploy.ai','business-os-api-gateway.netlify.app','business-os-api-gateway-3y8h7e.v2.appdeploy.ai'];
function rewrite(raw){
 try{const u=new URL(raw,location.href);
  if(storageHosts.includes(u.hostname)&&/^\/(functions|storage|auth|rest|realtime)\/v1\//.test(u.pathname))return active+u.pathname+u.search;
  if(gateways.includes(u.hostname)){const m=u.pathname.match(/\/api\/proxy\/([a-z0-9-]+)$/);if(m)return active+'/functions/v1/'+m[1]+u.search}
 }catch{}return raw;
}
window.fetch=(input,init)=>{const raw=typeof input==='string'?input:input instanceof URL?input.href:input.url,next=rewrite(raw);return base(next===raw?input:input instanceof Request?new Request(next,input):next,init)};
window.BOS_RU_NETWORK={origin:active,rewrite};
window.BOS_NETWORK_GATEWAY_V85=true;
})();
