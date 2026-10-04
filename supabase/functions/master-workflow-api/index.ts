import { createClient } from 'npm:@supabase/supabase-js@2';
import "../../../order-payroll.js";
const orderPayroll=(globalThis as any).BOS_ORDER_PAYROLL;

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
const safeOrder=(o:any)=>orderPayroll.masterView(o);
const activeStages=['assigned','departed','started'];
const stamp:any={departed:'master_departed_at',arrived:'master_arrived_at',started:'master_started_at'};
const validDate=(v:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(`${v}T00:00:00Z`);return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v};
const validTime=(v:string)=>{if(!/^\d{2}:\d{2}$/.test(v))return false;const [h,m]=v.split(':').map(Number);return h>=0&&h<24&&m>=0&&m<60};
const timeSlot=(v:string)=>{const [h,m]=v.split(':').map(Number);return `${v}–${String((h+1)%24).padStart(2,'0')}:${String(m).padStart(2,'0')}`};
const hasSchedule=(o:any)=>!!String(o?.scheduled_date||'').slice(0,10)&&!!String(o?.scheduled_time||o?.time_slot||'').slice(0,5);
const normalizedStage=(o:any)=>{const s=String(o?.master_workflow_stage||'assigned');return s==='arrived'?'departed':activeStages.includes(s)?s:'assigned'};
const contactResults=['no_answer','thinking','waiting_delivery','call_later','agreed','other'];
const successfulContact=new Set(['thinking','waiting_delivery','call_later','agreed','other']);
const contactHistory=(o:any)=>Array.isArray(o?.master_contact_history)?o.master_contact_history.filter((x:any)=>x&&typeof x==='object').slice(-50):[];
function normalizePhone(v:any){
  const digits=String(v||'').replace(/\D/g,'');
  if(digits.length===10)return '+7'+digits;
  if(digits.length===11&&(digits[0]==='7'||digits[0]==='8'))return '+7'+digits.slice(1);
  return digits.length>=10&&digits.length<=15?('+'+digits):'';
}
function orderPhones(o:any){
  const raw=String(o?.phone||o?.client_phone||'').trim();if(!raw)return[];
  const hits=raw.match(/(?:\+?7|8)?[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g)||[raw];
  return [...new Set(hits.map(normalizePhone).filter(Boolean))];
}
const validAttemptId=(v:any)=>/^[A-Za-z0-9_-]{8,96}$/.test(String(v||''));
const sameContactResult=(event:any,result:string,comment:string,callbackAt:string|null)=>String(event?.result||'')===result&&String(event?.comment||'')===comment&&String(event?.callback_at||'')===String(callbackAt||'');

// Every mutation compares the authorized snapshot at the instant of the UPDATE.
function workflowWrite(db:any,order:any,patch:any){
  let q=db.from('orders').update(patch).eq('id',order.id);
  for(const k of ['updated_at','status','master_staff_id','master_workflow_stage','master_departed_at','master_arrived_at','master_started_at','master_called_at','master_called_by_staff_id','master_called_by_name','master_agreed_at','report_uploaded_at','report_review_status','scheduled_date','scheduled_time','time_slot'])q=order[k]==null?q.is(k,null):q.eq(k,order[k]);
  return q.select('*').maybeSingle();
}
const contactConfirmed=(o:any)=>!!o.master_called_at&&!!o.master_called_by_staff_id&&!!String(o.master_called_by_name||'').trim();
const stageRank=(o:any)=>o.report_uploaded_at||['pending','rejected','approved'].includes(o.report_review_status)?3:o.master_started_at||normalizedStage(o)==='started'?2:o.master_departed_at||o.master_arrived_at||normalizedStage(o)==='departed'?1:0;
const stageConfirmed=(o:any,stage:string)=>stage==='departed'?stageRank(o)>=1:stage==='started'?stageRank(o)>=2:!!o.master_arrived_at||o.master_workflow_stage==='arrived';

Deno.serve(async r=>{
  if(r.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const b=await r.json().catch(()=>({}));
    const action=String(b.action||'health');
    if(action==='health')return j({ok:true,version:'2026-10-04-contact-journal'});
    const me=await actor(db,r);
    if(!me)return j({ok:false,error:'Доступ не подтверждён'},401);
    if(String(me.role||'')!=='master')return j({ok:false,error:'Действие доступно только мастеру'},403);

    const q=await db.from('orders').select('*').eq('id',b.id).maybeSingle();
    if(q.error)throw q.error;
    const cur=q.data;
    if(!cur)return j({ok:false,error:'Заявка не найдена'},404);
    if(String(cur.master_staff_id||'')!==String(me.id||''))return j({ok:false,error:'Можно менять только свою заявку'},403);
    if(['Выполнена','Отменена'].includes(String(cur.status||'')))return j({ok:false,error:'Завершённую или отменённую заявку менять нельзя'},409);

    async function save(patch:any,confirmed:(o:any)=>boolean){
      const u=await workflowWrite(db,cur,patch);if(u.error)throw u.error;
      if(u.data)return j({ok:true,order:safeOrder(u.data)});
      const fresh=await db.from('orders').select('*').eq('id',cur.id).maybeSingle();if(fresh.error)throw fresh.error;
      if(!fresh.data||String(fresh.data.master_staff_id||'')!==String(me.id))return j({ok:false,error:'Заявка больше не назначена вам. Обновите список.'},403);
      if(!['Выполнена','Отменена'].includes(fresh.data.status)&&confirmed(fresh.data))return j({ok:true,order:safeOrder(fresh.data),idempotent:true});
      return j({ok:false,error:'Заявка уже изменена. Проверьте актуальный этап.',order:safeOrder(fresh.data)},409);
    }

    if(action==='recordContactAttempt'){
      const attemptId=String(b.attempt_id||'');
      const phone=normalizePhone(b.phone);
      if(!validAttemptId(attemptId))return j({ok:false,error:'Некорректный ID попытки звонка'},400);
      if(!phone||!orderPhones(cur).includes(phone))return j({ok:false,error:'Номер не относится к этой заявке'},400);
      const oldHistory=contactHistory(cur),existing=oldHistory.find((x:any)=>String(x.id||'')===attemptId);
      if(existing)return j({ok:true,order:safeOrder(cur),contact_event:existing,idempotent:true});
      const now=new Date().toISOString();
      const event={id:attemptId,at:now,phone,result:'pending',comment:'',callback_at:null,by_staff_id:me.id,by_name:String(me.full_name||'').trim()||'Мастер'};
      const next=[...oldHistory,event].slice(-50);
      return await save({master_contact_history:next,master_contact_status:'pending',master_contact_comment:null,master_contact_phone:phone,master_contact_updated_at:now,master_contact_callback_at:null,updated_at:now,sync_status:'pending_sheet'},o=>contactHistory(o).some((x:any)=>String(x.id||'')===attemptId));
    }

    if(action==='recordContactResult'){
      const attemptId=String(b.attempt_id||''),result=String(b.result||''),phone=normalizePhone(b.phone);
      let comment=String(b.comment||'').trim();if(comment.length>500)comment=comment.slice(0,500);
      if(!validAttemptId(attemptId)||!contactResults.includes(result))return j({ok:false,error:'Некорректный итог звонка'},400);
      if(result==='other'&&!comment)return j({ok:false,error:'Для варианта «Другое» добавьте комментарий'},400);
      if(!phone||!orderPhones(cur).includes(phone))return j({ok:false,error:'Номер не относится к этой заявке'},400);
      let callbackAt:string|null=null;
      if(result==='call_later'&&b.callback_at){const d=new Date(String(b.callback_at));if(Number.isNaN(d.getTime()))return j({ok:false,error:'Некорректное время повторного звонка'},400);callbackAt=d.toISOString();}
      const now=new Date().toISOString(),history=contactHistory(cur);let index=history.findIndex((x:any)=>String(x.id||'')===attemptId);
      if(index<0){history.push({id:attemptId,at:now,phone,result:'pending',comment:'',callback_at:null,by_staff_id:me.id,by_name:String(me.full_name||'').trim()||'Мастер'});index=history.length-1;}
      const event=history[index];
      if(String(event.by_staff_id||'')&&String(event.by_staff_id)!==String(me.id))return j({ok:false,error:'Эта попытка звонка принадлежит другому мастеру'},403);
      if(sameContactResult(event,result,comment,callbackAt))return j({ok:true,order:safeOrder(cur),contact_event:event,idempotent:true});
      history[index]={...event,phone,result,comment,callback_at:callbackAt,result_at:now,by_staff_id:me.id,by_name:String(me.full_name||'').trim()||'Мастер'};
      const patch:any={master_contact_history:history.slice(-50),master_contact_status:result,master_contact_comment:comment||null,master_contact_phone:phone,master_contact_updated_at:now,master_contact_callback_at:callbackAt,updated_at:now,sync_status:'pending_sheet'};
      if(successfulContact.has(result)&&!contactConfirmed(cur)){patch.master_called_at=now;patch.master_called_by_staff_id=me.id;patch.master_called_by_name=String(me.full_name||'').trim()||'Мастер';}
      return await save(patch,o=>contactHistory(o).some((x:any)=>String(x.id||'')===attemptId&&String(x.result||'')===result));
    }

    if(action==='markCalled'){
      if(contactConfirmed(cur))return j({ok:true,order:safeOrder(cur),idempotent:true});
      const now=new Date().toISOString();
      // Cached clients used this action implicitly when saving an agreement.
      // Keep their legacy call mark, but only the explicit new action is proof.
      if(b.contact_confirmed!==true){
        if(cur.master_called_at)return j({ok:true,order:safeOrder(cur),idempotent:true});
        return await save({master_called_at:now,updated_at:now,sync_status:'pending_sheet'},o=>!!o.master_called_at);
      }
      return await save({master_called_at:now,master_called_by_staff_id:me.id,master_called_by_name:String(me.full_name||'').trim()||'Мастер',updated_at:now,sync_status:'pending_sheet'},contactConfirmed);
    }

    if(action==='confirmAgreement'){
      if(!cur.master_called_at)return j({ok:false,error:'Сначала отметьте звонок клиенту'},409);
      if(!hasSchedule(cur))return j({ok:false,error:'В заявке не указаны дата и время'},409);
      if(cur.master_agreed_at)return j({ok:true,order:safeOrder(cur),idempotent:true});
      const now=new Date().toISOString();
      return await save({master_agreed_at:now,updated_at:now,sync_status:'pending_sheet'},o=>!!o.master_agreed_at);
    }

    if(action==='setAgreementSchedule'){
      if(!cur.master_called_at)return j({ok:false,error:'Сначала отметьте звонок клиенту'},409);
      if(stageRank(cur)>=2||cur.report_act_url)return j({ok:false,error:'После начала работы дату и время договорённости менять нельзя'},409);
      const date=String(b.scheduled_date||'').slice(0,10),time=String(b.scheduled_time||'').slice(0,5);
      if(!validDate(date)||!validTime(time))return j({ok:false,error:'Укажите корректные дату и время'},400);
      const today=new Date().toISOString().slice(0,10);
      if(date<today)return j({ok:false,error:'Нельзя договориться на прошедшую дату'},400);
      const currentDate=String(cur.scheduled_date||'').slice(0,10),currentTime=String(cur.scheduled_time||cur.time_slot||'').slice(0,5);
      if(cur.master_agreed_at&&currentDate===date&&currentTime===time)return j({ok:true,order:safeOrder(cur),idempotent:true});
      const now=new Date().toISOString();
      const patch:any={scheduled_date:date,scheduled_time:time,time_slot:timeSlot(time),master_agreed_at:now,updated_at:now,sync_status:'pending_sheet'};
      return await save(patch,o=>!!o.master_agreed_at&&String(o.scheduled_date||'').slice(0,10)===date&&String(o.scheduled_time||o.time_slot||'').slice(0,5)===time);
    }

    if(action!=='setStage')return j({ok:false,error:'UNKNOWN_ACTION'},404);
    const stage=String(b.stage||'');
    if(!['departed','arrived','started'].includes(stage))return j({ok:false,error:'Неверный этап работы'},400);
    if(stageConfirmed(cur,stage))return j({ok:true,order:safeOrder(cur),idempotent:true});
    const rank=stageRank(cur);
    const allowed=(stage==='departed'&&rank===0)||((stage==='started'||stage==='arrived')&&rank===1);
    if(!allowed)return j({ok:false,error:'Сначала подтвердите выезд. Этапы нужно отмечать по порядку'},409);
    const now=new Date().toISOString(),patch:any={master_workflow_stage:stage,updated_at:now,sync_status:'pending_sheet'};
    patch[stamp[stage]]=cur[stamp[stage]]||now;
    return await save(patch,o=>stageConfirmed(o,stage));
  }catch(e){
    return j({ok:false,error:e instanceof Error?e.message:String(e)},500);
  }
});
