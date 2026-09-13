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
const safeUser=(s:any)=>({id:s.id,external_id:s.external_id,vk_user_id:s.external_id,full_name:s.full_name,role:s.role,phone:s.phone||'',city:s.city||'',is_active:!!s.is_active});

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
  try{
    const secret=Deno.env.get('VK_APP_SECRET')||'';
    const uid=await sessionUid(req.headers.get('x-bos-session')||'',secret);
    if(!uid||!/^[1-9]\d*$/.test(uid))return json({ok:false,error:'Сессия VK не подтверждена'},401);
    const body=await req.json().catch(()=>({}));
    const token=String(body.token||body.code||'').trim();
    if(token.length<20||token.length>256)return json({ok:false,error:'Некорректный код приглашения'},400);

    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const existing=await db.from('business_staff').select('*').eq('external_id',uid).maybeSingle();
    if(existing.error)throw existing.error;
    if(existing.data)return json({ok:true,already_linked:true,user:safeUser(existing.data)});

    const tokenHash=await sha256hex(token);
    const q=await db.rpc('accept_staff_invite',{p_token_hash:tokenHash,p_vk_user_id:uid});
    if(q.error){
      const msg=String(q.error.message||'');
      if(msg.includes('INVITE_NOT_FOUND')||msg.includes('INVALID_INVITE'))return json({ok:false,error:'Приглашение не найдено'},404);
      if(msg.includes('INVITE_EXPIRED'))return json({ok:false,error:'Срок действия приглашения истёк'},410);
      if(msg.includes('INVITE_USED')||msg.includes('INVITE_REVOKED'))return json({ok:false,error:'Приглашение уже недействительно'},409);
      if(msg.includes('VK_ALREADY_LINKED')||msg.includes('STAFF_ALREADY_LINKED'))return json({ok:false,error:'Аккаунт или сотрудник уже привязан'},409);
      if(msg.includes('STAFF_INACTIVE'))return json({ok:false,error:'Сотрудник отключён'},403);
      throw q.error;
    }
    const user=Array.isArray(q.data)?q.data[0]:q.data;
    return json({ok:true,linked:true,user:safeUser(user)});
  }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
