import {createClient} from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-bos-session,x-vk-launch-params','Access-Control-Allow-Methods':'POST,OPTIONS'};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,'Content-Type':'application/json'}});
function b64u(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function hmac(msg:string,secret:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(msg))))}
async function sessionUid(token:string,secret:string){const p=String(token||'').split('.');if(p.length!==3||Number(p[1])<Math.floor(Date.now()/1000))return null;const e=await hmac(`${p[0]}.${p[1]}`,secret);return e===p[2]?p[0]:null}
Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response('ok',{headers:cors});try{const secret=Deno.env.get('VK_APP_SECRET')||'',uid=await sessionUid(req.headers.get('x-bos-session')||'',secret);if(!uid)return out({ok:false,error:'Доступ не подтверждён'},401);const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});const a=await db.from('business_staff').select('id,role').eq('external_id',uid).eq('is_active',true).maybeSingle();if(a.error)throw a.error;if(a.data?.role!=='owner')return out({ok:false,error:'Только владелец может менять данные сотрудника'},403);const b=await req.json(),id=String(b.id||'');if(!id)return out({ok:false,error:'Не указан сотрудник'},400);
const current=await db.from('business_staff').select('id,external_id,role').eq('id',id).maybeSingle();if(current.error)throw current.error;if(!current.data)return out({ok:false,error:'Сотрудник не найден'},404);
const patch:any={updated_at:new Date().toISOString()};
if('full_name'in b){const v=String(b.full_name||'').trim();if(!v)return out({ok:false,error:'Имя не может быть пустым'},400);patch.full_name=v}
if('phone'in b){const v=String(b.phone||'').trim();if(v){const dup=await db.from('business_staff').select('id').eq('phone',v).eq('is_active',true).neq('id',id).limit(1);if(dup.error)throw dup.error;if((dup.data||[]).length)return out({ok:false,error:'Этот телефон уже используется активным сотрудником'},409)}patch.phone=v||null}
if('district'in b)patch.district=String(b.district||'').trim()||null;
if('city'in b)patch.city=String(b.city||'Санкт-Петербург').trim()||'Санкт-Петербург';
if('specialization'in b)patch.specialization=String(b.specialization||'').trim()||null;
if('comment'in b)patch.comment=String(b.comment||'').trim()||null;
if('work_start'in b)patch.work_start=String(b.work_start||'').trim()||null;
if('work_end'in b)patch.work_end=String(b.work_end||'').trim()||null;
if('role'in b){const role=String(b.role||'');if(!['owner','manager','dispatcher','master'].includes(role))return out({ok:false,error:'Недопустимая роль'},400);if(String(current.data.id)===String(a.data.id)&&role!=='owner')return out({ok:false,error:'Нельзя снять роль владельца у текущего пользователя'},400);patch.role=role}
if('is_active'in b){const active=Boolean(b.is_active);if(String(current.data.id)===String(a.data.id)&&!active)return out({ok:false,error:'Нельзя отключить текущего владельца'},400);patch.is_active=active}
const r=await db.from('business_staff').update(patch).eq('id',id).select().single();if(r.error)throw r.error;return out({ok:true,user:{...r.data,vk_user_id:r.data.external_id,active:r.data.is_active}})}catch(e){return out({ok:false,error:e instanceof Error?e.message:String(e)},500)}});
