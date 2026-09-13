import { createClient } from 'npm:@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type,apikey,authorization,x-bos-session',
  'Access-Control-Allow-Methods':'POST,OPTIONS'
};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,'Content-Type':'application/json'}});
function b64u(a:Uint8Array){let s='';for(const b of a)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function hmac(m:string,s:string){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(s),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(m))))}
async function sessionUid(t:string,s:string){const p=String(t||'').split('.');if(p.length!==3)return null;const exp=Number(p[1]);if(!Number.isFinite(exp)||exp<Math.floor(Date.now()/1000))return null;return await hmac(`${p[0]}.${p[1]}`,s)===p[2]?p[0]:null}
async function sha256hex(s:string){const d=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));return Array.from(d,b=>b.toString(16).padStart(2,'0')).join('')}
function canManage(actorRole:string,targetRole:string){if(targetRole==='owner')return false;if(actorRole==='owner')return['manager','dispatcher','master'].includes(targetRole);if(actorRole==='manager')return['dispatcher','master'].includes(targetRole);return false}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
  try{
    const secret=Deno.env.get('VK_APP_SECRET')||'';
    const uid=await sessionUid(req.headers.get('x-bos-session')||'',secret);
    if(!uid)return json({ok:false,error:'Доступ не подтверждён'},401);
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const actor=(await db.from('business_staff').select('id,external_id,role,is_active').eq('external_id',uid).eq('is_active',true).maybeSingle()).data;
    if(!actor||!['owner','manager'].includes(String(actor.role||'')))return json({ok:false,error:'Недостаточно прав'},403);

    const body=await req.json().catch(()=>({}));
    const staffId=String(body.staff_id||body.id||'').trim();
    if(!staffId)return json({ok:false,error:'Сотрудник не указан'},400);
    const tq=await db.from('business_staff').select('id,external_id,full_name,role,is_active').eq('id',staffId).maybeSingle();
    if(tq.error)throw tq.error;
    const target=tq.data;
    if(!target)return json({ok:false,error:'Сотрудник не найден'},404);
    if(!target.is_active)return json({ok:false,error:'Сотрудник отключён'},400);
    if(!canManage(String(actor.role||''),String(target.role||'')))return json({ok:false,error:'Недостаточно прав для этого сотрудника'},403);
    if(/^[1-9]\d*$/.test(String(target.external_id||'')))return json({ok:false,error:'VK уже привязан к сотруднику'},409);

    const bytes=crypto.getRandomValues(new Uint8Array(32));
    const token=b64u(bytes);
    const tokenHash=await sha256hex(token);
    const expiresAt=new Date(Date.now()+60*60*1000).toISOString();

    const revoke=await db.from('staff_invites').update({revoked_at:new Date().toISOString()}).eq('staff_id',target.id).is('consumed_at',null).is('revoked_at',null);
    if(revoke.error)throw revoke.error;
    const ins=await db.from('staff_invites').insert({staff_id:target.id,issued_by_staff_id:actor.id,token_hash:tokenHash,expires_at:expiresAt}).select('id,expires_at').single();
    if(ins.error)throw ins.error;

    return json({ok:true,invite_id:ins.data.id,token,expires_at:ins.data.expires_at,staff:{id:target.id,full_name:target.full_name,role:target.role}});
  }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
