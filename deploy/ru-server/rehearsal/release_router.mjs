import {handle} from './edge_router.mjs';
const blocked=new Set(['archive-order-2-once','e2e-create-staff-order-once','test-pin-session']);
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
 'access-control-allow-headers':'authorization,apikey,content-type,x-bos-session,x-vk-launch-params,x-client-info,x-upsert,range',
 'access-control-expose-headers':'x-bos-session,content-range,content-length','access-control-max-age':'86400'};
const gas='https://script.google.com/macros/s/AKfycbx6l6V_jjZdbWQGljODcR4Uf4wvMc8hA24Dulzdmi-Ek76QH1mQS0tm3Q_ErI1sWEumzQ/exec';
function response(body,status){return new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json'}})}
async function sessionValid(token,secret){
 try{
  const parts=String(token||'').split('.');if(parts.length!==3||Number(parts[1])<=Date.now()/1000)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const sig=Uint8Array.from(atob(parts[2].replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  return await crypto.subtle.verify('HMAC',key,sig,new TextEncoder().encode(parts[0]+'.'+parts[1]));
 }catch{return false;}
}
export async function handleRelease(req,config){
 const url=new URL(req.url);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(url.pathname.startsWith('/api/proxy/')){
  url.pathname=url.pathname.replace('/api/proxy/','/functions/v1/');req=new Request(url,req);
 }
 const slug=/^\/functions\/v1\/([^/]+)/.exec(url.pathname)?.[1];
 if(blocked.has(slug))return response({error:'unknown_function'},404);
 let result;
 const proxy=Object.entries(config.upstreams||{}).find(([prefix])=>url.pathname.startsWith(prefix));
 if(proxy){
  const [prefix,upstream]=proxy;
  const target=upstream+'/'+url.pathname.slice(prefix.length)+url.search;
  result=await (config.fetcher||fetch)(new Request(new Request(target,req),{redirect:'error',signal:AbortSignal.timeout(90000)}));
 }else if(url.pathname==='/api/gas-report'){
  if(!await sessionValid(req.headers.get('x-bos-session'),config.vkSecret))return response({ok:false,error:'unauthorized'},401);
  if(!['GET','POST'].includes(req.method))return response({error:'method_not_allowed'},405);
  const upstream=new URL(gas);upstream.search=url.search;
  const headers=new Headers();if(req.headers.has('content-type'))headers.set('content-type',req.headers.get('content-type'));
  result=await (config.fetcher||fetch)(upstream,{method:req.method,headers,body:req.method==='POST'?await req.arrayBuffer():undefined,
   redirect:'follow',signal:AbortSignal.timeout(90000)});
 }else result=await handle(req,config);
 const headers=new Headers(result.headers);for(const [k,v] of Object.entries(cors))headers.set(k,v);
 return new Response(result.body,{status:result.status,headers});
}
if(import.meta.main&&typeof Deno!=='undefined'){
 const routes=JSON.parse(await Deno.readTextFile('/bos-main/routes.json'));
 const keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','VK_APP_SECRET','BOS_SYNC_KEY','HANDS_API_KEY','AVITO_CLIENT_ID','AVITO_CLIENT_SECRET'];
 const env=keys.map(k=>[k,Deno.env.get(k)||'']);
 const worker=async(slug,route)=>await EdgeRuntime.userWorkers.create({
  servicePath:'/bos-src/'+slug+'/'+route.entrypoint.split('/').slice(0,-1).join('/'),
  maybeEntrypoint:'file:///bos-src/'+slug+'/'+route.entrypoint,maybeEszip:await Deno.readFile('/bos-bundles/'+slug+'.eszip'),
  memoryLimitMb:150,workerTimeoutMs:90000,cpuTimeSoftLimitMs:10000,cpuTimeHardLimitMs:20000,
  noModuleCache:true,allowRemoteModules:false,envVars:[...env,['SUPABASE_FUNCTION_SLUG',slug]]});
 const upstreams={'/rest/v1/':Deno.env.get('BOS_REST_ORIGIN'),'/auth/v1/':Deno.env.get('BOS_AUTH_ORIGIN'),'/storage/v1/':Deno.env.get('BOS_STORAGE_ORIGIN')};
 if(Object.values(upstreams).some(v=>!/^http:\/\/bos-release-[a-z0-9_-]+-(?:rest|auth|storage):[0-9]+$/.test(v||'')))throw Error('invalid private upstream');
 Deno.serve(req=>handleRelease(req,{routes,secret:Deno.env.get('JWT_SECRET'),vkSecret:Deno.env.get('VK_APP_SECRET'),worker,upstreams})
  .catch(()=>response({error:'gateway_failed'},502)));
}
