// Trial-only loopback gateway and per-function JWT policy. No remote imports.
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function decode(part) {
  if(!/^[A-Za-z0-9_-]+$/.test(part))throw Error('invalid encoding');
  return Uint8Array.from(atob(part.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
}
export async function authorize(req,route,secret) {
  if(req.method==='OPTIONS'||route.verify_jwt===false)return true;
  if(route.verify_jwt!==true||!secret)return false;
  try {
    const auth=req.headers.get('authorization')||'';
    if(!auth.startsWith('Bearer ')||auth.length>16384)return false;
    const parts=auth.slice(7).split('.');if(parts.length!==3)return false;
    const header=JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const payload=JSON.parse(new TextDecoder().decode(decode(parts[1])));
    if(header.alg!=='HS256'||header.crit||!payload||typeof payload!=='object')return false;
    const now=Date.now()/1000;
    if(payload.exp!==undefined&&(!Number.isFinite(payload.exp)||payload.exp<=now))return false;
    if(payload.nbf!==undefined&&(!Number.isFinite(payload.nbf)||payload.nbf>now))return false;
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    return await crypto.subtle.verify('HMAC',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  }catch{return false;}
}

export async function handle(req,{routes,secret,worker,fetcher=fetch}) {
  const url=new URL(req.url);
  if(url.pathname==='/__bos_ready'&&req.method==='GET')return json({ready:true});
  for(const [prefix,origin] of [['/rest/v1/','http://127.0.0.1:3000/'],
                              ['/auth/v1/','http://127.0.0.1:9999/'],
                              ['/storage/v1/','http://127.0.0.1:5000/']]) {
    if(url.pathname.startsWith(prefix)) {
      const target=origin+url.pathname.slice(prefix.length)+url.search;
      const forwarded=new Request(target,req);
      return await fetcher(new Request(forwarded,{redirect:'error',signal:AbortSignal.timeout(15000)}));
    }
  }
  const match=/^\/functions\/v1\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})(?:\/.*)?$/.exec(url.pathname);
  const slug=match?.[1];
  if(!slug||!Object.hasOwn(routes,slug))return json({error:'unknown_function'},404);
  if(!await authorize(req,routes[slug],secret))return json({error:'invalid_jwt'},401);
  try{return await (await worker(slug,routes[slug])).fetch(req);}
  catch{return json({error:'worker_failed',function:slug},500);}
}

if(import.meta.main&&typeof Deno!=='undefined') {
  const routes=JSON.parse(await Deno.readTextFile('/bos-main/routes.json'));
  const secret=Deno.env.get('JWT_SECRET');
  const keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY',
              'VK_APP_SECRET','BOS_SYNC_KEY','HANDS_API_KEY','AVITO_CLIENT_ID','AVITO_CLIENT_SECRET'];
  const env=keys.map(k=>[k,Deno.env.get(k)||'']);
  const worker=async(slug,route)=>await EdgeRuntime.userWorkers.create({
    servicePath:'/bos-src/'+slug+'/'+route.entrypoint.split('/').slice(0,-1).join('/'),
    maybeEntrypoint:'file:///bos-src/'+slug+'/'+route.entrypoint,
    maybeEszip:await Deno.readFile('/bos-bundles/'+slug+'.eszip'),
    memoryLimitMb:150,workerTimeoutMs:60000,cpuTimeSoftLimitMs:10000,cpuTimeHardLimitMs:20000,
    noModuleCache:true,allowRemoteModules:false,envVars:[...env,['SUPABASE_FUNCTION_SLUG',slug]],
  });
  Deno.serve(req=>handle(req,{routes,secret,worker}).catch(()=>json({error:'gateway_failed'},502)));
}
