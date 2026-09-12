import { createClient } from 'npm:@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type,apikey,authorization,x-bos-session',
  'Access-Control-Allow-Methods':'POST,OPTIONS'
};
const j=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,'Content-Type':'application/json'}});
function b64u(a:Uint8Array){let s='';for(const b of a)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function hmac(m:string,s:string){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(s),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(m))))}
async function sess(t:string,s:string){const p=String(t||'').split('.');if(p.length!==3||Number(p[1])<Date.now()/1000)return null;return await hmac(`${p[0]}.${p[1]}`,s)===p[2]?p[0]:null}
async function actor(db:any,r:Request){const uid=await sess(r.headers.get('x-bos-session')||'',Deno.env.get('VK_APP_SECRET')||'');if(!uid)return null;return (await db.from('business_staff').select('*').eq('external_id',uid).eq('is_active',true).maybeSingle()).data||null}
function canManage(actorRole:string,targetRole:string){if(targetRole==='owner')return false;if(actorRole==='owner')return['manager','dispatcher','master'].includes(targetRole);if(actorRole==='manager')return['dispatcher','master'].includes(targetRole);return false}
const publicStaff=(s:any)=>({id:s.id,external_id:s.external_id,vk_user_id:s.external_id,full_name:s.full_name,role:s.role,phone:s.phone||'',city:s.city||'',is_active:!!s.is_active,login:s.login||'',has_password:!!s.password_hash});

Deno.serve(async r=>{
  if(r.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const me=await actor(db,r);
    if(!me)return j({ok:false,error:'Доступ не подтверждён'},401);
    const role=String(me.role||'');
    if(!['owner','manager'].includes(role))return j({ok:false,error:'Недостаточно прав'},403);
    const b=await r.json().catch(()=>({})),action=String(b.action||'');

    if(action==='listStaff'){
      const q=await db.from('business_staff').select('id,external_id,full_name,role,phone,city,is_active,login,password_hash').order('full_name');
      if(q.error)throw q.error;
      return j({ok:true,staff:(q.data||[]).filter((x:any)=>canManage(role,String(x.role||''))).map(publicStaff)});
    }

    const targetId=String(b.id||'');
    if(!targetId)return j({ok:false,error:'Сотрудник не указан'},400);
    const tq=await db.from('business_staff').select('*').eq('id',targetId).maybeSingle();
    if(tq.error)throw tq.error;
    const target=tq.data;
    if(!target)return j({ok:false,error:'Сотрудник не найден'},404);
    if(!canManage(role,String(target.role||'')))return j({ok:false,error:'Недостаточно прав для этого сотрудника'},403);

    if(action==='setCredentials'){
      if(!target.is_active)return j({ok:false,error:'Сначала восстановите сотрудника'},400);
      const login=String(b.login||'').trim(),password=String(b.password||'');
      if(login.length<3)return j({ok:false,error:'Логин должен быть не короче 3 символов'},400);
      if(password.length<6)return j({ok:false,error:'Пароль должен быть не короче 6 символов'},400);
      const q=await db.rpc('bos_set_staff_credentials',{p_staff_id:target.id,p_login:login,p_password:password});
      if(q.error)throw q.error;
      const fresh=await db.from('business_staff').select('id,external_id,full_name,role,phone,city,is_active,login,password_hash').eq('id',target.id).single();
      if(fresh.error)throw fresh.error;
      return j({ok:true,user:publicStaff(fresh.data)});
    }

    if(action==='restoreEmployee'){
      if(target.is_active)return j({ok:true,user:publicStaff(target),already_active:true});
      const q=await db.from('business_staff').update({is_active:true,updated_at:new Date().toISOString()}).eq('id',target.id).select('id,external_id,full_name,role,phone,city,is_active,login,password_hash').single();
      if(q.error)throw q.error;
      return j({ok:true,user:publicStaff(q.data)});
    }

    return j({ok:false,error:'UNKNOWN_ACTION'},404);
  }catch(e){
    return j({ok:false,error:e instanceof Error?e.message:String(e)},500);
  }
});
