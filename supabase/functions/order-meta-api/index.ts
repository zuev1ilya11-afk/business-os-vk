import { createClient } from 'npm:@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type,x-bos-session',
  'Access-Control-Allow-Methods':'POST,OPTIONS'
};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,'Content-Type':'application/json'}});

function b64u(a:Uint8Array){let s='';for(const b of a)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function hmac(msg:string,secret:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(msg))))}
async function verifySession(token:string,secret:string){const p=String(token||'').split('.');if(p.length!==3||!/^[A-Za-z0-9_-]{1,128}$/.test(p[0])||!/^[0-9]+$/.test(p[1]))return null;if(Number(p[1])<Math.floor(Date.now()/1000))return null;const exp=await hmac(`${p[0]}.${p[1]}`,secret);if(exp.length!==p[2].length)return null;let m=0;for(let i=0;i<exp.length;i++)m|=exp.charCodeAt(i)^p[2].charCodeAt(i);return m===0?p[0]:null}
function validDate(v:any){const s=String(v||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(`${s}T00:00:00Z`);return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s}
function validTime(v:any){return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||''))}
function timeSlot(v:string){const [h,m]=v.split(':').map(Number),end=(h+1)%24;return `${v}–${String(end).padStart(2,'0')}:${String(m).padStart(2,'0')}`}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const body=await req.json();
    const action=String(body.action||'');
    if(!['setOrderType','resolveReschedule'].includes(action))return json({ok:false,error:'UNKNOWN_ACTION'},404);

    const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,secret=Deno.env.get('VK_APP_SECRET')||'';
    const db=createClient(url,key,{auth:{persistSession:false}});
    const uid=await verifySession(req.headers.get('x-bos-session')||'',secret);
    if(!uid)return json({ok:false,error:'Доступ не подтверждён'},401);
    const aq=await db.from('business_staff').select('*').eq('external_id',uid).eq('is_active',true).maybeSingle();
    if(aq.error)throw aq.error;
    if(!aq.data||!['owner','manager','dispatcher'].includes(String(aq.data.role)))return json({ok:false,error:'Недостаточно прав'},403);

    const id=String(body.id||'').trim();
    if(!id)return json({ok:false,error:'Заявка не указана'},400);

    if(action==='setOrderType'){
      const type=['work','measurement'].includes(String(body.order_type))?String(body.order_type):'work';
      const r=await db.from('orders').update({order_type:type,updated_at:new Date().toISOString()}).eq('id',id).select().single();
      if(r.error)throw r.error;
      return json({ok:true,order:r.data});
    }

    const scheduledDate=String(body.scheduled_date||'').trim(),scheduledTime=String(body.scheduled_time||'').trim().slice(0,5);
    if(!validDate(scheduledDate))return json({ok:false,error:'Укажите корректную дату переноса'},400);
    if(!validTime(scheduledTime))return json({ok:false,error:'Укажите корректное время переноса'},400);

    const current=await db.from('orders').select('id,status').eq('id',id).maybeSingle();
    if(current.error)throw current.error;
    if(!current.data)return json({ok:false,error:'Заявка не найдена'},404);
    if(['Выполнена','Отменена'].includes(String(current.data.status||'')))return json({ok:false,error:'Нельзя переносить завершённую или отменённую заявку'},409);

    const now=new Date().toISOString();
    const r=await db.from('orders').update({
      scheduled_date:scheduledDate,
      scheduled_time:scheduledTime,
      time_slot:timeSlot(scheduledTime),
      reschedule_requested:false,
      reschedule_reason:null,
      reschedule_requested_at:null,
      reschedule_requested_by:null,
      sync_status:'pending_sheet',
      updated_at:now
    }).eq('id',id).select().single();
    if(r.error)throw r.error;
    return json({ok:true,order:r.data});
  }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
