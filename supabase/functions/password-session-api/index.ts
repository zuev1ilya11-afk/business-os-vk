import { createClient } from 'npm:@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type,apikey,authorization,x-bos-session',
  'Access-Control-Allow-Methods':'POST,OPTIONS'
};
const out=(x:any,s=200,extra:Record<string,string>={})=>new Response(JSON.stringify(x),{status:s,headers:{...cors,'Content-Type':'application/json',...extra}});
const SESSION_TTL_SECONDS=60*60*24*365;

function b64u(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function hmac(msg:string,secret:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(msg))))}
async function sha256hex(value:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function validSubject(v:string){return /^[A-Za-z0-9_-]{1,128}$/.test(v)}
async function makeSession(uid:string,secret:string){if(!validSubject(uid))throw new Error('Invalid staff external id');const exp=Math.floor(Date.now()/1000)+SESSION_TTL_SECONDS,msg=`${uid}.${exp}`,sig=await hmac(msg,secret);return`${msg}.${sig}`}
async function verifySession(token:string,secret:string){const p=String(token||'').split('.');if(p.length!==3||!validSubject(p[0])||!/^[0-9]+$/.test(p[1]))return null;const exp=Number(p[1]);if(!Number.isFinite(exp)||exp<Math.floor(Date.now()/1000))return null;const expected=await hmac(`${p[0]}.${p[1]}`,secret);if(expected.length!==p[2].length)return null;let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^p[2].charCodeAt(i);return mismatch===0?p[0]:null}
function clientIp(req:Request){const direct=String(req.headers.get('cf-connecting-ip')||req.headers.get('x-real-ip')||'').trim();if(direct&&direct.length<=128)return direct;const fwd=String(req.headers.get('x-forwarded-for')||'').split(',')[0].trim();return fwd&&fwd.length<=128?fwd:''}
async function consume(db:any,keyHash:string,limit:number,windowSeconds:number){const r=await db.rpc('bos_consume_login_attempt',{p_key_hash:keyHash,p_limit:limit,p_window_seconds:windowSeconds});if(r.error)throw r.error;const d=Array.isArray(r.data)?r.data[0]:r.data;return {allowed:d?.allowed!==false,retry_after:Math.max(0,Number(d?.retry_after||0))}}
async function checkLoginRate(db:any,req:Request,login:string){const ip=clientIp(req),normalized=login.trim().toLowerCase(),windowSeconds=15*60;if(ip){const byIp=await consume(db,await sha256hex(`ip\n${ip}`),30,windowSeconds);if(!byIp.allowed)return byIp}return await consume(db,await sha256hex(`pair\n${ip||'unknown'}\n${normalized}`),8,windowSeconds)}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return out({ok:false,error:'METHOD_NOT_ALLOWED'},405);
  try{
    const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,secret=Deno.env.get('VK_APP_SECRET')||'';
    if(!url||!key||!secret)throw new Error('Server configuration missing');
    const db=createClient(url,key,{auth:{persistSession:false}});
    const raw=await req.text();
    if(raw.length>8192)return out({ok:false,error:'Запрос слишком большой'},413);
    let body:any={};try{body=raw?JSON.parse(raw):{}}catch{return out({ok:false,error:'Некорректный запрос'},400)}
    const action=String(body.action||'');

    if(action==='login'){
      const login=String(body.login||'').trim(),password=String(body.password||'');
      if(!login||!password)return out({ok:false,error:'Введите логин и пароль'},400);
      const rate=await checkLoginRate(db,req,login);
      if(!rate.allowed)return out({ok:false,error:'Слишком много попыток входа. Повторите позже.'},429,{'Retry-After':String(rate.retry_after||60)});
      const vr=await db.rpc('bos_verify_staff_credentials',{p_login:login,p_password:password});
      if(vr.error)throw vr.error;
      const id=vr.data;
      if(!id)return out({ok:false,error:'Неверный логин или пароль'},401);
      const q=await db.from('business_staff').select('*').eq('id',id).eq('is_active',true).single();
      if(q.error)throw q.error;
      const uid=String(q.data.external_id||'');
      if(!validSubject(uid))return out({ok:false,error:'Некорректный идентификатор сотрудника. Обратитесь к владельцу.'},409);
      return out({ok:true,session_token:await makeSession(uid,secret),user:{id:q.data.id,full_name:q.data.full_name,role:q.data.role,phone:q.data.phone,city:q.data.city}})
    }

    if(action==='refresh'){
      const uid=await verifySession(req.headers.get('x-bos-session')||'',secret);
      if(!uid)return out({ok:false,error:'Сессия истекла. Войдите снова.'},401);
      const q=await db.from('business_staff').select('id,external_id,full_name,role,phone,city').eq('external_id',uid).eq('is_active',true).single();
      if(q.error)throw q.error;
      return out({ok:true,session_token:await makeSession(uid,secret),user:q.data})
    }

    if(action==='setCredentials'){
      const uid=await verifySession(req.headers.get('x-bos-session')||'',secret);
      if(!uid)return out({ok:false,error:'Сессия истекла. Войдите снова.'},401);
      const q=await db.from('business_staff').select('id').eq('external_id',uid).eq('is_active',true).single();
      if(q.error)throw q.error;
      const login=String(body.login||'').trim(),password=String(body.password||'');
      if(login.length<3)return out({ok:false,error:'Логин должен быть не короче 3 символов'},400);
      if(login.length>64)return out({ok:false,error:'Логин слишком длинный'},400);
      if(password.length<10)return out({ok:false,error:'Пароль должен быть не короче 10 символов'},400);
      if(password.length>128)return out({ok:false,error:'Пароль слишком длинный'},400);
      const r=await db.rpc('bos_set_staff_credentials',{p_staff_id:q.data.id,p_login:login,p_password:password});
      if(r.error){const msg=String(r.error.message||'');if(msg.toLowerCase().includes('duplicate')||msg.includes('business_staff_login_unique'))return out({ok:false,error:'Такой логин уже занят'},409);throw r.error}
      return out({ok:true})
    }

    return out({ok:false,error:'UNKNOWN_ACTION'},404)
  }catch(e){
    console.error('password-session-api',e instanceof Error?e.name:'Error');
    return out({ok:false,error:'Временная ошибка сервиса. Повторите позже.'},500)
  }
});