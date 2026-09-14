import { createClient } from 'npm:@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type,apikey,authorization,x-vk-launch-params,x-bos-session',
  'Access-Control-Allow-Methods':'GET,POST,OPTIONS'
};
const round=(n:any)=>Math.round(Number(n||0)*100)/100;
const payouts=(a:any,has=true)=>{
  const x=round(a);
  return{
    master_payout:has?round(x*.85*.65):0,
    manager_payout:round(x*.85*.94*.20),
    dispatcher_payout:round(x*.85*.94*.15)
  }
};
const j=(x:any,s=200)=>new Response(JSON.stringify(x,(key,value)=>['password_hash','password'].includes(key)?undefined:value),{status:s,headers:{...cors,'Content-Type':'application/json'}});

function b64u(a:Uint8Array){let s='';for(const b of a)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function hmac(m:string,s:string){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(s),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(m))))}
async function sess(t:string,s:string){const p=String(t||'').split('.');if(!s||p.length!==3||!/^[A-Za-z0-9_-]{1,128}$/.test(p[0])||!/^\d{1,12}$/.test(p[1])||Number(p[1])<=Date.now()/1000)return null;return await hmac(`${p[0]}.${p[1]}`,s)===p[2]?p[0]:null}
function norm(v:any){let d=String(v||'').replace(/\D/g,'');if(d.length===11&&d[0]==='8')d='7'+d.slice(1);if(d.length===10)d='7'+d;return d}
const out=(s:any)=>{const x={...(s||{})};delete x.password_hash;return {...x,vk_user_id:x.external_id}};
const masterOrder=(o:any)=>{const x={...o,master_payout:payouts(o?.amount,!!o?.master_staff_id).master_payout};for(const k of ['amount','original_amount','manager_payout','dispatcher_payout'])delete x[k];return x};
const safeRequestId=(v:any)=>{const s=String(v||'').trim();return /^[A-Za-z0-9_-]{8,128}$/.test(s)?s:''};
// PostgREST caps an unpaginated response at 1000 rows. Keep totals complete.
async function allRows(query:any){
  const data:any[]=[];
  for(let offset=0;;offset+=1000){
    const page=await query.range(offset,offset+999);
    if(page.error)return page;
    data.push(...(page.data||[]));
    if((page.data||[]).length<1000)return {data,error:null};
  }
}

async function sessionUid(r:Request){return await sess(r.headers.get('x-bos-session')||'',Deno.env.get('VK_APP_SECRET')||'')}
async function actor(db:any,r:Request){const uid=await sessionUid(r);if(!uid)return null;return (await db.from('business_staff').select('*').eq('external_id',uid).eq('is_active',true).maybeSingle()).data||null}
async function staff(db:any,v:any){if(!v)return null;let q=await db.from('business_staff').select('*').eq('external_id',String(v)).maybeSingle();if(q.data)return q.data;q=await db.from('business_staff').select('*').eq('id',String(v)).maybeSingle();return q.data||null}
const ops=(r:string)=>['owner','manager','dispatcher'].includes(r);
function canManage(a:string,t:string){if(t==='owner')return false;if(a==='owner')return['manager','dispatcher','master'].includes(t);if(a==='manager')return['dispatcher','master'].includes(t);if(a==='dispatcher')return t==='master';return false}

Deno.serve(async r=>{
  if(r.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const b=await r.json().catch(()=>({}));
    const a=String(b.action||'health');
    if(a==='health')return j({ok:true,version:'2026-09-12-team-critical-v13'});

    if(a==='registerByPhone')return j({ok:false,error:'Регистрация по телефону отключена. Используйте код приглашения владельца.'},410);

    const me=await actor(db,r);
    if(!me)return j({ok:false,error:'Доступ не подтверждён'},401);
    const role=String(me.role||'');

    if(a==='bootstrap'){
      let oq=db.from('orders').select('*').order('created_at',{ascending:false}).order('id',{ascending:false});
      if(role==='master')oq=oq.eq('master_staff_id',me.id);
      const [or,st,sr,cl]=await Promise.all([
        allRows(oq),
        allRows(db.from('business_staff').select('*').eq('is_active',true).order('full_name').order('id')),
        allRows(db.from('staff_schedule').select('*').order('staff_id').order('work_date')),
        allRows(db.from('order_claims').select('*').order('opened_at',{ascending:false}).order('id'))
      ]);
      for(const q of [or,st,sr,cl])if(q.error)throw q.error;
      const all=st.data||[],vis=role==='master'?all.filter((x:any)=>x.id===me.id):all,map=new Map(all.map((x:any)=>[String(x.id),x]));
      let orders=(or.data||[]).map((o:any)=>({...o,id:String(o.id),master_vk_id:map.get(String(o.master_staff_id))?.external_id||'',master_name:o.master_name||map.get(String(o.master_staff_id))?.full_name||''}));
      if(role==='master')orders=orders.map(masterOrder);
      return j({ok:true,user:out(me),orders,users:vis.map(out),masters:(role==='master'?vis:all.filter((x:any)=>x.role==='master')).map(out),masterSchedule:(sr.data||[]).filter((x:any)=>role!=='master'||x.staff_id===me.id),claims:(cl.data||[]).filter((x:any)=>role!=='master'||x.master_staff_id===me.id),sources:[{source:'VK'},{source:'Google Sheets'},{source:'Авито'}],settings:{permissions:{can_manage_orders:ops(role),can_manage_schedule:ops(role),can_manage_staff:['owner','manager'].includes(role),can_review_reports:ops(role),can_view_finance:['owner','manager'].includes(role)}}});
    }

    if(a==='createOrder'||a==='updateOrder'){
      if(!ops(role))return j({ok:false,error:'Недостаточно прав'},403);
      let cur:any=null;
      if(a==='updateOrder'){
        const q=await db.from('orders').select('*').eq('id',b.id).single();
        if(q.error)throw q.error;
        cur=q.data;
      }
      for(const k of a==='createOrder'?['client','address','work']:[])if(!String(b[k]||'').trim())return j({ok:false,error:'Заполните обязательные поля'},400);

      const requestId=a==='createOrder'?safeRequestId(b.request_id):'';
      const createExternalId=requestId?`app_${me.id}_${requestId}`:'';
      if(createExternalId){
        const prior=await db.from('orders').select('*').eq('external_id',createExternalId).maybeSingle();
        if(prior.error)throw prior.error;
        if(prior.data)return j({ok:true,order:prior.data,idempotent:true});
      }

      let ms:any=undefined;
      if(a==='createOrder'||Object.prototype.hasOwnProperty.call(b,'master_vk_id')||Object.prototype.hasOwnProperty.call(b,'master_id'))ms=await staff(db,b.master_vk_id||b.master_id);
      if((b.master_vk_id||b.master_id)&&(!ms||ms.role!=='master'||!ms.is_active))return j({ok:false,error:'Выберите активного мастера'},400);
      for(const k of ['original_amount','amount','extra_work_amount','uncompleted_work_amount'])if(k in b&&(!Number.isFinite(Number(b[k]))||Number(b[k])<0))return j({ok:false,error:'Сумма должна быть конечным неотрицательным числом'},400);
      const original=round(b.original_amount??b.amount??cur?.original_amount??cur?.amount??0),unfinished=round(b.uncompleted_work_amount??cur?.uncompleted_work_amount??0),amount=round(original-unfinished),now=new Date().toISOString();
      if(amount<0)return j({ok:false,error:'Невыполненные работы не могут превышать сумму заказа'},400);
      const p:any={updated_at:now,sync_status:'pending_sheet'};
      for(const k of ['status','client','phone','address','work','scheduled_date','scheduled_time','time_slot','source','city','comment','extra_work_done','extra_work_description','extra_work_amount','uncompleted_work_done','uncompleted_work_description','uncompleted_work_amount','wall_over_3m','wall_material','possible_extra_work'])if(a==='createOrder'||Object.prototype.hasOwnProperty.call(b,k))p[k]=b[k]??'';
      for(const k of ['scheduled_date','scheduled_time'])if(k in p&&!p[k])p[k]=null;
      for(const k of ['extra_work_done','uncompleted_work_done','wall_over_3m','possible_extra_work'])if(k in p)p[k]=p[k]===true||p[k]==='true'||p[k]==='on';
      for(const k of ['extra_work_amount','uncompleted_work_amount'])if(k in p)p[k]=round(p[k]);
      p.original_amount=original;
      p.amount=amount;
      if(ms!==undefined){p.master_staff_id=ms?.id||null;p.master_name=ms?.full_name||''}
      // A comment/status edit must not overwrite an explicitly adjusted payout.
      if(!cur||amount!==Number(cur.amount)||original!==Number(cur.original_amount??cur.amount))Object.assign(p,payouts(amount,ms===undefined?!!cur?.master_staff_id:!!ms));
      else if(ms!==undefined&&ms?.id!==cur.master_staff_id)p.master_payout=payouts(amount,!!ms).master_payout;
      if(a==='createOrder'){
        Object.assign(p,{status:b.status||'В работе',client:String(b.client).trim(),address:String(b.address).trim(),work:String(b.work).trim(),source:b.source||'VK',city:b.city||'Санкт-Петербург',external_source:'mini_app',external_id:createExternalId||('app_'+crypto.randomUUID()),created_by_vk_id:me.external_id,source_updated_at:now});
        const q=await db.from('orders').insert(p).select().single();
        if(q.error?.code==='23505'&&createExternalId){
          const prior=await db.from('orders').select('*').eq('external_source','mini_app').eq('external_id',createExternalId).maybeSingle();
          if(prior.data)return j({ok:true,order:prior.data,idempotent:true});
        }
        if(q.error)throw q.error;
        return j({ok:true,order:q.data});
      }
      if(p.status==='Выполнена'){
        p.completed_at=now;
        if(!cur.report_uploaded_at)p.report_review_status='not_submitted';
      }
      const q=await db.from('orders').update(p).eq('id',b.id).select().single();
      if(q.error)throw q.error;
      return j({ok:true,order:q.data});
    }

    if(a==='reviewReport'){
      if(!ops(role))return j({ok:false,error:'Недостаточно прав'},403);
      const decision=String(b.decision||'');
      if(!['approved','rejected'].includes(decision))return j({ok:false,error:'Неверное решение'},400);
      const q=await db.from('orders').select('*').eq('id',b.id).single();
      if(q.error)throw q.error;
      if(!q.data.report_uploaded_at)return j({ok:false,error:'Отчёт ещё не загружен'},400);
      const now=new Date().toISOString(),u=await db.from('orders').update({report_review_status:decision,report_reviewed_by:String(me.full_name||me.external_id),report_reviewed_at:now,report_review_comment:String(b.comment||''),status:decision==='rejected'?'В работе':'Выполнена',completed_at:decision==='rejected'?null:now,sync_status:'pending_sheet',updated_at:now}).eq('id',b.id).select().single();
      if(u.error)throw u.error;
      return j({ok:true,order:u.data});
    }

    if(a==='addEmployee'){
      if(role!=='owner')return j({ok:false,error:'Только владелец может добавлять сотрудников'},403);
      const rr=['manager','dispatcher','master'].includes(String(b.role))?String(b.role):'master',phone=String(b.phone||'').trim();
      if(norm(phone).length!==11)return j({ok:false,error:'Укажите корректный номер телефона сотрудника'},400);
      const q=await db.from('business_staff').insert({external_id:'staff_'+Date.now()+'_'+crypto.randomUUID().slice(0,8),full_name:String(b.full_name||'Сотрудник').trim(),role:rr,phone,city:String(b.city||'Санкт-Петербург'),specialization:String(b.specialization||''),is_active:true,work_start:b.work_start||null,work_end:b.work_end||null,comment:String(b.comment||'')}).select().single();
      if(q.error)throw q.error;
      return j({ok:true,user:out(q.data),master:rr==='master'?out(q.data):null,registration_by_phone:true});
    }

    if(a==='updateEmployee'){
      const target=await staff(db,b.vk_user_id||b.external_id||b.id);
      if(!target)return j({ok:false,error:'Сотрудник не найден'},404);
      if(!canManage(role,String(target.role||'')))return j({ok:false,error:'Недостаточно прав для управления этим сотрудником'},403);
      const p:any={updated_at:new Date().toISOString()};
      for(const k of ['full_name','phone','city','comment','specialization','work_start','work_end'])if(Object.prototype.hasOwnProperty.call(b,k))p[k]=b[k];
      if(Object.prototype.hasOwnProperty.call(b,'is_active'))p.is_active=!!b.is_active;
      if(Object.prototype.hasOwnProperty.call(b,'role')){
        const nr=String(b.role);
        if(!['manager','dispatcher','master'].includes(nr))return j({ok:false,error:'Недопустимая роль'},400);
        if(!canManage(role,nr))return j({ok:false,error:'Недостаточно прав для назначения этой роли'},403);
        p.role=nr;
      }
      const q=await db.from('business_staff').update(p).eq('id',target.id).select().single();
      if(q.error)throw q.error;
      return j({ok:true,user:out(q.data)});
    }

    if(a==='saveMasterSchedule'){
      if(!ops(role)&&role!=='master')return j({ok:false,error:'Недостаточно прав'},403);
      let m=role==='master'?me:await staff(db,b.master_id||b.master_vk_id);
      if(!m||m.role!=='master')return j({ok:false,error:'Мастер не найден'},404);
      if(role==='master'&&String(b.master_id||b.master_vk_id||me.id)!==String(me.id)&&String(b.master_id||b.master_vk_id||me.external_id)!==String(me.external_id))return j({ok:false,error:'Можно изменять только свой график'},403);
      const days=Array.isArray(b.days)?b.days:[];
      if(days.length!==7)return j({ok:false,error:'Нужны 7 дней недели'},400);
      const rows=days.map((d:any,i:number)=>({staff_id:m.id,week_start:b.week_start,work_date:d.date,weekday:i+1,is_working:!!d.is_working,work_start:d.is_working?(d.work_start||b.work_start||'09:00'):null,work_end:d.is_working?(d.work_end||b.work_end||'18:00'):null,updated_at:new Date().toISOString()}));
      const q=await db.from('staff_schedule').upsert(rows,{onConflict:'staff_id,work_date'}).select();
      if(q.error)throw q.error;
      return j({ok:true,schedule:q.data||[]});
    }

    return j({ok:false,error:'UNKNOWN_ACTION'},404);
  }catch(e){
    return j({ok:false,error:e instanceof Error?e.message:String(e)},500);
  }
});