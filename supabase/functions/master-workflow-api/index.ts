import { createClient } from 'npm:@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type,apikey,authorization,x-vk-launch-params,x-bos-session',
  'Access-Control-Allow-Methods':'GET,POST,OPTIONS'
};
const j=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,'Content-Type':'application/json'}});
function b64u(a:Uint8Array){let s='';for(const b of a)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function hmac(m:string,s:string){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(s),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(m))))}
async function sess(t:string,s:string){const p=String(t||'').split('.');if(!s||p.length!==3||!/^[A-Za-z0-9_-]{1,128}$/.test(p[0])||!/^\d{1,12}$/.test(p[1])||Number(p[1])<=Date.now()/1000)return null;return await hmac(`${p[0]}.${p[1]}`,s)===p[2]?p[0]:null}
async function actor(db:any,r:Request){const uid=await sess(r.headers.get('x-bos-session')||'',Deno.env.get('VK_APP_SECRET')||'');if(!uid)return null;return (await db.from('business_staff').select('*').eq('external_id',uid).eq('is_active',true).maybeSingle()).data||null}
const safeOrder=(o:any)=>{const x={...(o||{})};for(const k of ['amount','original_amount','manager_payout','dispatcher_payout'])delete x[k];return x};
const activeStages=['assigned','departed','started'];
const stamp:any={departed:'master_departed_at',arrived:'master_arrived_at',started:'master_started_at'};
const validDate=(v:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(`${v}T00:00:00Z`);return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v};
const validTime=(v:string)=>{if(!/^\d{2}:\d{2}$/.test(v))return false;const [h,m]=v.split(':').map(Number);return h>=0&&h<24&&m>=0&&m<60};
const timeSlot=(v:string)=>{const [h,m]=v.split(':').map(Number);return `${v}–${String((h+1)%24).padStart(2,'0')}:${String(m).padStart(2,'0')}`};

Deno.serve(async r=>{
  if(r.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const b=await r.json().catch(()=>({}));
    const action=String(b.action||'health');
    if(action==='health')return j({ok:true,version:'2026-09-23-master-agreement-v109'});
    const me=await actor(db,r);
    if(!me)return j({ok:false,error:'Доступ не подтверждён'},401);
    if(String(me.role||'')!=='master')return j({ok:false,error:'Действие доступно только мастеру'},403);

    const q=await db.from('orders').select('*').eq('id',b.id).maybeSingle();
    if(q.error)throw q.error;
    const cur=q.data;
    if(!cur)return j({ok:false,error:'Заявка не найдена'},404);
    if(String(cur.master_staff_id||'')!==String(me.id||''))return j({ok:false,error:'Можно менять только свою заявку'},403);
    if(['Выполнена','Отменена'].includes(String(cur.status||'')))return j({ok:false,error:'Завершённую или отменённую заявку менять нельзя'},409);

    if(action==='setAgreementSchedule'){
      const existingDate=String(cur.scheduled_date||'').slice(0,10);
      const existingTime=String(cur.scheduled_time||cur.time_slot||'').slice(0,5);
      if(existingDate||existingTime)return j({ok:false,error:'Дата или время уже назначены. Для переноса используйте запрос на перенос.'},409);
      const date=String(b.scheduled_date||'').slice(0,10),time=String(b.scheduled_time||'').slice(0,5);
      if(!validDate(date)||!validTime(time))return j({ok:false,error:'Укажите корректные дату и время'},400);
      const today=new Date().toISOString().slice(0,10);
      if(date<today)return j({ok:false,error:'Нельзя договориться на прошедшую дату'},400);
      const patch:any={scheduled_date:date,scheduled_time:time,time_slot:timeSlot(time),updated_at:new Date().toISOString(),sync_status:'pending_sheet'};
      const u=await db.from('orders').update(patch).eq('id',cur.id).select('*').single();
      if(u.error)throw u.error;
      return j({ok:true,order:safeOrder(u.data)});
    }

    if(action!=='setStage')return j({ok:false,error:'UNKNOWN_ACTION'},404);
    const stage=String(b.stage||'');
    if(!['departed','arrived','started'].includes(stage))return j({ok:false,error:'Неверный этап работы'},400);
    const raw=String(cur.master_workflow_stage||'assigned');
    const current=raw==='arrived'?'departed':activeStages.includes(raw)?raw:'assigned';
    if(stage===raw)return j({ok:true,order:safeOrder(cur),idempotent:true});
    const allowed=(stage==='departed'&&current==='assigned')||(stage==='arrived'&&current==='departed')||(stage==='started'&&current==='departed');
    if(!allowed)return j({ok:false,error:'Этапы нужно отмечать по порядку'},409);
    const now=new Date().toISOString(),patch:any={master_workflow_stage:stage,updated_at:now,sync_status:'pending_sheet'};
    patch[stamp[stage]]=now;
    const u=await db.from('orders').update(patch).eq('id',cur.id).select('*').single();
    if(u.error)throw u.error;
    return j({ok:true,order:safeOrder(u.data)});
  }catch(e){
    return j({ok:false,error:e instanceof Error?e.message:String(e)},500);
  }
});
