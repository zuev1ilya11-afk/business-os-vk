import {createHash, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const STORAGE='http://127.0.0.1:5000';
const ORIGINS=new Set([STORAGE,'http://127.0.0.1:3000','http://127.0.0.1:9999']);
let phase='preflight';

export async function requestLocal(url,options={},fetcher=fetch){
  const parsed=new URL(url);
  if(!ORIGINS.has(parsed.origin)||parsed.username||parsed.password)throw new Error('non-local request');
  return fetcher(parsed.href,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
}
export function safeSignedURL(path,bucket){
  const result=new URL(path,STORAGE);
  if(result.origin!==STORAGE||result.username||result.password||
     result.pathname!==`/object/sign/${bucket}/probe.txt`||!result.searchParams.get('token'))
    throw new Error('unexpected signed URL');
  return result;
}
export function verifyBytes(body,type,row){
  if(body.length!==row.size||createHash('sha256').update(body).digest('hex')!==row.sha256||
    String(type||'').split(';')[0].trim().toLowerCase()!==row.mimetype.split(';')[0].trim().toLowerCase())
    throw new Error('object bytes or MIME differ');
}
function requireStatus(response,allowed=[200]){
  if(!allowed.includes(response.status)){const error=new Error('unexpected HTTP status');error.http=response.status;throw error;}
}
function privateDenied(response){
  if(![400,401,403,404].includes(response.status))throw new Error('anonymous object access not denied');
}
const objectPath=(bucket,name)=>encodeURIComponent(bucket)+'/'+name.split('/').map(encodeURIComponent).join('/');

export async function ready(fetcher=fetch){
  for(const path of ['http://127.0.0.1:3000/','http://127.0.0.1:9999/health',STORAGE+'/status'])
    requireStatus(await requestLocal(path,{},fetcher));
  return true;
}
export async function runProbe(config,fetcher=fetch){
  const headers=token=>({'Authorization':'Bearer '+token,'apikey':token});
  const service=headers(config.service_key),anon=headers(config.anon_key);
  const req=(url,options={})=>requestLocal(url,options,fetcher);
  phase='rest_service_read';
  const rest=await req('http://127.0.0.1:3000/orders?select=id&limit=1',{
    headers:{...service,Prefer:'count=exact'}});
  requireStatus(rest,[200,206]);
  if(Number((rest.headers.get('content-range')||'').split('/')[1])!==config.expected_orders)
    throw new Error('REST count differs');
  const orders=await rest.json();
  if(!Array.isArray(orders)||orders.length!==1)throw new Error('REST read failed');
  phase='rest_anon_denial';
  const denied=await req('http://127.0.0.1:3000/orders?select=id&limit=1',{headers:anon});
  if(denied.status===200){
    const rows=await denied.json();
    if(!Array.isArray(rows)||rows.length)throw new Error('anonymous order access not denied');
  }else requireStatus(denied,[401,403]);
  phase='auth_admin_read';
  requireStatus(await req('http://127.0.0.1:9999/health'));
  const auth=await req('http://127.0.0.1:9999/admin/users?per_page=1000',{headers:service});
  requireStatus(auth);
  const users=await auth.json();
  if(!Array.isArray(users.users)||users.users.length!==config.expected_auth_users)throw new Error('Auth user count differs');
  requireStatus(await req('http://127.0.0.1:9999/admin/users',{headers:anon}),[401,403]);
  phase='storage_read_snapshot';
  requireStatus(await req(STORAGE+'/status'));
  let bytes=0;
  for(const row of config.objects){
    const response=await req(STORAGE+'/object/authenticated/'+objectPath(config.bucket,row.name),{headers:service});
    requireStatus(response);
    const body=Buffer.from(await response.arrayBuffer());
    verifyBytes(body,response.headers.get('content-type'),row);
    bytes+=body.length;
  }
  phase='storage_anon_denial';
  privateDenied(await req(STORAGE+'/object/authenticated/'+objectPath(config.bucket,config.objects[0].name),{headers:anon}));
  privateDenied(await req(STORAGE+'/object/public/'+objectPath(config.bucket,config.objects[0].name)));
  const bucket='bos-trial-'+randomUUID().replaceAll('-','');
  const probeBody=Buffer.from('Business OS isolated Storage trial '+randomUUID());
  const probeRow={size:probeBody.length,sha256:createHash('sha256').update(probeBody).digest('hex'),mimetype:'text/plain'};
  phase='storage_create_probe_bucket';
  requireStatus(await req(STORAGE+'/bucket',{method:'POST',headers:{...service,'Content-Type':'application/json'},
    body:JSON.stringify({id:bucket,name:bucket,public:false})}),[200,201]);
  try{
    phase='storage_upload_probe';
    requireStatus(await req(STORAGE+`/object/${bucket}/probe.txt`,{method:'POST',
      headers:{...service,'Content-Type':'text/plain'},body:probeBody}),[200,201]);
    phase='storage_read_probe';
    const response=await req(STORAGE+`/object/authenticated/${bucket}/probe.txt`,{headers:service});
    requireStatus(response);verifyBytes(Buffer.from(await response.arrayBuffer()),response.headers.get('content-type'),probeRow);
    privateDenied(await req(STORAGE+`/object/authenticated/${bucket}/probe.txt`,{headers:anon}));
    phase='storage_signed_probe';
    const signed=await req(STORAGE+`/object/sign/${bucket}/probe.txt`,{method:'POST',
      headers:{...service,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60})});
    requireStatus(signed);
    const signedURL=safeSignedURL((await signed.json()).signedURL,bucket);
    const download=await req(signedURL.href);requireStatus(download);
    verifyBytes(Buffer.from(await download.arrayBuffer()),download.headers.get('content-type'),probeRow);
  }finally{
    const objects=await req(STORAGE+`/object/${bucket}`,{method:'DELETE',
      headers:{...service,'Content-Type':'application/json'},body:JSON.stringify({prefixes:['probe.txt']})});
    requireStatus(objects);
    requireStatus(await req(STORAGE+`/bucket/${bucket}`,{method:'DELETE',headers:service}));
  }
  phase='complete';
  return {rest_read:true,rest_anon_denied:true,auth_admin_read:true,auth_anon_denied:true,
    storage_objects:config.objects.length,storage_bytes:bytes,storage_private_denied:true,
    storage_write_cycle:true,storage_signed_read:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv[2]==='--ready')await ready();
    else console.log(JSON.stringify(await runProbe(JSON.parse(readFileSync(process.argv[2],'utf8')))));
  }catch(error){
    console.log(JSON.stringify({ok:false,phase,http:Number.isInteger(error.http)?error.http:null}));
    process.exitCode=1;
  }
}
