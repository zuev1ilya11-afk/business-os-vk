import { createClient } from 'npm:@supabase/supabase-js@2';
import "../../../order-payroll.js";
const orderPayroll=(globalThis as any).BOS_ORDER_PAYROLL;

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type,x-bos-session,x-vk-launch-params',
  'Access-Control-Allow-Methods':'POST,OPTIONS'
};
const json=(x:any,s=200)=>new Response(JSON.stringify(x,(key,value)=>['password_hash','password'].includes(key)?undefined:value),{status:s,headers:{...cors,'Content-Type':'application/json'}});
function b64u(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function hmac(msg:string,secret:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(msg))))}
async function verifySession(token:string,secret:string){const p=String(token||'').split('.');if(p.length!==3||!/^[A-Za-z0-9_-]{1,128}$/.test(p[0])||!/^[0-9]+$/.test(p[1]))return null;if(Number(p[1])<Math.floor(Date.now()/1000))return null;const expected=await hmac(`${p[0]}.${p[1]}`,secret);if(expected.length!==p[2].length)return null;let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^p[2].charCodeAt(i);return mismatch===0?p[0]:null}
// Legacy launch fallback shares the issuer's 24-hour freshness window. BOS sessions remain independent.
async function verifyLaunch(raw:string,secret:string){if(!raw)return null;const p=new URLSearchParams(raw.startsWith('?')?raw.slice(1):raw),sign=p.get('sign'),app=p.get('vk_app_id'),uid=p.get('vk_user_id');if(!sign||app!=='54758847'||!uid||!/^[1-9]\d*$/.test(uid))return null;const ts=p.get('vk_ts')||'';if(!/^\d{1,12}$/.test(ts)||Number(ts)<=0||Math.abs(Math.floor(Date.now()/1000)-Number(ts))>86400)return null;const canonical=[...p.entries()].filter(([k])=>k.startsWith('vk_')).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');const expected=await hmac(canonical,secret);if(expected.length!==sign.length)return null;let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^sign.charCodeAt(i);return mismatch===0?uid:null}
function normPhone(v:any){let d=String(v||'').replace(/\D/g,'');if(d.length===11&&d[0]==='8')d='7'+d.slice(1);if(d.length===10)d='7'+d;return d}
function out(s:any){return{...s,vk_user_id:s.external_id}}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
  try{
    const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,secret=Deno.env.get('VK_APP_SECRET')||'';
    if(!url||!key||!secret)throw new Error('Server configuration missing');
    const db=createClient(url,key,{auth:{persistSession:false}});
    const body=await req.json().catch(()=>({}));
    let uid=await verifySession(req.headers.get('x-bos-session')||'',secret);
    if(!uid)uid=await verifyLaunch(req.headers.get('x-vk-launch-params')||'',secret);
    if(!uid)return json({ok:false,error:'Доступ не подтверждён'},401);
    const aq=await db.from('business_staff').select('*').eq('external_id',uid).eq('is_active',true).maybeSingle();
    if(aq.error)throw aq.error;
    const actor=aq.data;
    if(!actor)return json({ok:false,error:'Сотрудник не найден'},403);

    if(String(body.action||'')==='presence'){
      const now=new Date().toISOString();
      const touch=await db.from('business_staff').update({last_seen_at:now}).eq('id',actor.id).select('id,last_seen_at').single();
      if(touch.error)throw touch.error;
      if(['owner','manager','dispatcher'].includes(String(actor.role||''))){
        const q=await db.from('business_staff').select('id,external_id,full_name,role,last_seen_at').eq('role','master').eq('is_active',true).order('full_name');
        if(q.error)throw q.error;
        return json({ok:true,last_seen_at:now,masters:(q.data||[]).map(out)});
      }
      return json({ok:true,last_seen_at:now,masters:[]});
    }

    let target=actor;
    if(actor.role==='owner'&&body.acting_master_vk_id){
      const tq=await db.from('business_staff').select('*').eq('external_id',String(body.acting_master_vk_id)).eq('role','master').eq('is_active',true).maybeSingle();
      if(tq.error)throw tq.error;
      if(!tq.data)return json({ok:false,error:'Мастер не найден'},404);
      target=tq.data;
    }else if(actor.role!=='master')return json({ok:false,error:'Редактировать этот профиль может только мастер'},403);

    const phone=String(body.phone||'').trim(),district=String(body.district||'').trim();
    if(normPhone(phone).length!==11)return json({ok:false,error:'Введите корректный номер телефона'},400);
    if(district.length>120)return json({ok:false,error:'Название района слишком длинное'},400);
    const all=await db.from('business_staff').select('id,phone').eq('is_active',true);
    if(all.error)throw all.error;
    const dup=(all.data||[]).find((x:any)=>String(x.id)!==String(target.id)&&normPhone(x.phone)===normPhone(phone));
    if(dup)return json({ok:false,error:'Этот номер уже используется другим сотрудником'},409);
    // Old installed clients encode stage changes in the district field. Handle only
    // that marker here so the old SQL read/update bridge cannot overwrite a newer row.
    if(district.startsWith('@@BOS_WF1@@|')){
      const m=district.match(/^@@BOS_WF1@@\|(\d+)\|(departed|started)$/);
      if(!m)return json({ok:false,error:'Неверный этап работы'},400);
      const [,id,stage]=m;
      const q=await db.from('orders').select('*').eq('id',id).maybeSingle();if(q.error)throw q.error;
      const cur=q.data;
      if(!cur||String(cur.master_staff_id||'')!==String(target.id))return json({ok:false,error:'Можно менять только свою заявку'},403);
      const closed=(o:any)=>['Выполнена','Отменена'].includes(o.status);
      const rank=(o:any)=>o.master_started_at||o.master_workflow_stage==='started'||o.report_uploaded_at||['pending','rejected','approved'].includes(o.report_review_status)?2:o.master_departed_at||o.master_arrived_at||['departed','arrived'].includes(o.master_workflow_stage)?1:0;
      const next=stage==='started'?2:1;
      if(closed(cur))return json({ok:false,error:'Заявка закрыта'},409);
      const receipt=(o:any)=>json({ok:true,user:out(target),order:orderPayroll.masterView(o),idempotent:true});
      if(rank(cur)>=next)return receipt(cur);
      if(rank(cur)!==next-1)return json({ok:false,error:'Этапы нужно отмечать по порядку'},409);
      const now=new Date().toISOString(),time=stage==='started'?'master_started_at':'master_departed_at';
      let write=db.from('orders').update({master_workflow_stage:stage,[time]:cur[time]||now,updated_at:now,sync_status:'pending_sheet'}).eq('id',cur.id);
      for(const k of ['updated_at','status','master_staff_id','master_workflow_stage','master_departed_at','master_arrived_at','master_started_at','report_uploaded_at','report_review_status'])write=cur[k]==null?write.is(k,null):write.eq(k,cur[k]);
      const saved=await write.select('*').maybeSingle();if(saved.error)throw saved.error;
      if(saved.data)return json({ok:true,user:out(target),order:orderPayroll.masterView(saved.data)});
      const fresh=await db.from('orders').select('*').eq('id',id).maybeSingle();if(fresh.error)throw fresh.error;
      if(fresh.data&&String(fresh.data.master_staff_id||'')===String(target.id)&&!closed(fresh.data)&&rank(fresh.data)>=next)return receipt(fresh.data);
      return json({ok:false,error:'Заявка уже изменена. Обновите заявку.'},409);
    }
    const r=await db.from('business_staff').update({phone,district,updated_at:new Date().toISOString()}).eq('id',target.id).select().single();
    if(r.error)throw r.error;
    return json({ok:true,user:out(r.data)});
  }catch(e){
    return json({ok:false,error:e instanceof Error?e.message:String(e)},500);
  }
});
