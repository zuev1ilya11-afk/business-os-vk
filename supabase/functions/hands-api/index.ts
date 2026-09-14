import { createClient } from 'npm:@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type,apikey,authorization,x-bos-session',
  'Access-Control-Allow-Methods':'POST,OPTIONS'
};
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
const API_BASE='https://api.hands.ru/api/v1/specialist';

function b64u(a:Uint8Array){let s='';for(const b of a)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function hmac(m:string,s:string){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(s),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(m))))}
async function sessionUid(r:Request){const t=r.headers.get('x-bos-session')||'',p=t.split('.'),s=Deno.env.get('VK_APP_SECRET')||'';if(!s||p.length!==3||Number(p[1])<Date.now()/1000)return null;return await hmac(`${p[0]}.${p[1]}`,s)===p[2]?p[0]:null}
async function actor(db:any,r:Request){const uid=await sessionUid(r);if(!uid)return null;return (await db.from('business_staff').select('*').eq('external_id',uid).eq('is_active',true).maybeSingle()).data||null}
const ops=(r:string)=>['owner','manager','dispatcher'].includes(r);
const clean=(v:any)=>String(v??'').trim();
const money=(v:any)=>{const n=Number(String(v??'0').replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?Math.round(n*100)/100:0};
const masterPayout=(v:any)=>Math.round(money(v)*.85*.65*100)/100;
const externalId=(v:any)=>clean(v).replace(/^hands:/,'');
const localExternalId=(v:any)=>`hands:${externalId(v)}`;

function listFromResponse(d:any){
  if(Array.isArray(d))return d;
  for(const k of ['results','orders','items','data'])if(Array.isArray(d?.[k]))return d[k];
  return [];
}
function workText(o:any){
  const title=clean(o?.title);
  const works=Array.isArray(o?.works)?o.works:[];
  const names=works.map((w:any)=>clean(w?.name)).filter(Boolean);
  return title||names.join(', ')||'Заказ Hands';
}
function phones(o:any){const x=Array.isArray(o?.client_phones)?o.client_phones:[];return clean(x[0]||o?.client_phone||o?.phone)}
function schedule(o:any){
  const raw=clean(o?.work_time||o?.scheduled_at||'');
  const m=raw.match(/(\d{4}-\d{2}-\d{2})[T\s]+(\d{2}:\d{2})/);
  return m?{scheduled_date:m[1],scheduled_time:m[2]}:{scheduled_date:'',scheduled_time:''};
}
function localStatus(o:any){const s=clean(o?.status).toUpperCase();return s==='COMPLETE'||s==='COMPLETED'?'Выполнена':s==='CANCELLED'||s==='CANCELED'?'Отменена':'В работе'}
function externalComment(o:any){
  const parts=[] as string[];
  if(clean(o?.comment))parts.push(clean(o.comment));
  if(clean(o?.directions))parts.push(`Как добраться: ${clean(o.directions)}`);
  if(clean(o?.shop_name))parts.push(`Магазин: ${clean(o.shop_name)}`);
  if(clean(o?.payment_status))parts.push(`Оплата: ${clean(o.payment_status)}`);
  const works=Array.isArray(o?.works)?o.works:[];
  const details=works.map((w:any)=>[clean(w?.name),clean(w?.description)].filter(Boolean).join(' — ')).filter(Boolean);
  if(details.length)parts.push(`Состав работ: ${details.join('; ')}`);
  return parts.join('\n');
}
async function hands(path:string,init:RequestInit={}){
  const key=Deno.env.get('HANDS_API_KEY')||'';
  if(!key)throw new Error('HANDS_API_KEY_NOT_CONFIGURED');
  const headers=new Headers(init.headers||{});headers.set('X-Api-Key',key);
  if(init.body&&!headers.has('Content-Type')&&!(init.body instanceof FormData))headers.set('Content-Type','application/json');
  const r=await fetch(`${API_BASE}${path}`,{...init,headers});
  const text=await r.text();let data:any={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!r.ok)throw new Error(`HANDS_${r.status}: ${clean(data?.error||data?.detail||text||r.statusText)}`);
  return data;
}
async function importOrder(db:any,o:any,staffByName:Map<string,any>){
  const id=externalId(o?.id);if(!id)return {ok:false,reason:'missing_id'};
  const sched=schedule(o),specialist=clean(o?.specialist),staff=specialist?staffByName.get(specialist.toLocaleLowerCase('ru-RU')):null;
  const amount=money(o?.price);
  const base:any={
    external_source:'hands',external_id:localExternalId(id),source:'Hands',client:clean(o?.client_name||o?.client),phone:phones(o),address:clean(o?.address),work:workText(o),status:localStatus(o),amount,original_amount:amount,master_payout:staff?.id?masterPayout(amount):0,scheduled_date:sched.scheduled_date,scheduled_time:sched.scheduled_time,master_name:specialist||staff?.full_name||'',source_updated_at:clean(o?.updated_at||o?.creation_time)||new Date().toISOString(),updated_at:new Date().toISOString(),sync_status:'synced'
  };
  if(staff?.id)base.master_staff_id=staff.id;
  const prev=await db.from('orders').select('id').eq('external_source','hands').eq('external_id',localExternalId(id)).maybeSingle();
  if(prev.error)throw prev.error;
  if(prev.data){const q=await db.from('orders').update(base).eq('id',prev.data.id).select('id').single();if(q.error)throw q.error;return {ok:true,id:q.data.id,created:false}}
  const ins={...base,comment:externalComment(o),external_source:'hands',created_by_vk_id:'hands-api'};
  const q=await db.from('orders').insert(ins).select('id').single();if(q.error)throw q.error;return {ok:true,id:q.data.id,created:true};
}
async function syncOrders(db:any,b:any){
  const status=clean(b.status||'ACTIVE').toUpperCase();
  if(status&&!['ACTIVE','COMPLETE'].includes(status))throw new Error('Неверный status');
  const perPage=Math.min(500,Math.max(1,Number(b.per_page||500))),maxPages=Math.min(10,Math.max(1,Number(b.max_pages||4)));
  const staffQ=await db.from('business_staff').select('id,full_name,role').eq('is_active',true).eq('role','master');if(staffQ.error)throw staffQ.error;
  const staffByName=new Map((staffQ.data||[]).map((x:any)=>[clean(x.full_name).toLocaleLowerCase('ru-RU'),x]));
  let seen=0,created=0,updated=0,pages=0;
  for(let page=1;page<=maxPages;page++){
    const q=new URLSearchParams({page:String(page),per_page:String(perPage)});if(status)q.set('status',status);if(b.date_from)q.set('date_from',clean(b.date_from));if(b.date_to)q.set('date_to',clean(b.date_to));if(b.search)q.set('search',clean(b.search));
    const d=await hands(`/orders/?${q.toString()}`);const rows=listFromResponse(d);pages++;if(!rows.length)break;
    for(const o of rows){const r=await importOrder(db,o,staffByName);if(r.ok){seen++;r.created?created++:updated++}}
    if(rows.length<perPage)break;
  }
  return {seen,created,updated,pages,status};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
  try{
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const me=await actor(db,req);if(!me)return json({ok:false,error:'Доступ не подтверждён'},401);
    const role=String(me.role||''),b=await req.json().catch(()=>({})),action=clean(b.action||'health');
    if(action==='health')return json({ok:true,service:'hands-api',configured:!!Deno.env.get('HANDS_API_KEY'),base_url:API_BASE});
    if(!ops(role))return json({ok:false,error:'Недостаточно прав'},403);
    if(action==='syncOrders'){const result=await syncOrders(db,b);return json({ok:true,...result})}
    if(action==='assignSpecialist'){
      const id=externalId(b.order_id);if(!id)return json({ok:false,error:'Не указан order_id'},400);
      const specialist=clean(b.specialist);if(!specialist)return json({ok:false,error:'Не указан специалист'},400);
      const body:any={specialist};if(clean(b.specialist_login))body.specialist_login=clean(b.specialist_login);
      const data=await hands(`/orders/${encodeURIComponent(id)}/specialist/`,{method:'POST',body:JSON.stringify(body)});return json({ok:true,result:data});
    }
    if(action==='sendReport'){
      const id=externalId(b.order_id);if(!id)return json({ok:false,error:'Не указан order_id'},400);
      const kind=clean(b.kind).toUpperCase(),outcome=clean(b.outcome).toUpperCase();if(!['AGREED','COMPLETED'].includes(kind)||!outcome)return json({ok:false,error:'Неверный отчёт'},400);
      const body:any={kind,outcome};for(const k of ['time','comment','reason','time_change_reason'])if(clean(b[k]))body[k]=clean(b[k]);
      const data=await hands(`/orders/${encodeURIComponent(id)}/report/`,{method:'POST',body:JSON.stringify(body)});return json({ok:true,result:data});
    }
    if(action==='uploadFile'){
      const id=externalId(b.order_id),name=clean(b.file_name),mime=clean(b.mime_type||'application/octet-stream'),base64=clean(b.base64);if(!id||!name||!base64)return json({ok:false,error:'Не хватает данных файла'},400);
      const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));if(bytes.byteLength>10*1024*1024)return json({ok:false,error:'Файл больше 10 МБ'},400);
      const form=new FormData();form.append('file',new Blob([bytes],{type:mime}),name);form.append('relation',clean(b.relation||'SPECIALIST_PHOTO'));
      const data=await hands(`/orders/${encodeURIComponent(id)}/files/`,{method:'POST',body:form});return json({ok:true,result:data});
    }
    return json({ok:false,error:'UNKNOWN_ACTION'},404);
  }catch(e){const msg=e instanceof Error?e.message:String(e);const status=msg==='HANDS_API_KEY_NOT_CONFIGURED'?503:500;return json({ok:false,error:msg},status)}
});