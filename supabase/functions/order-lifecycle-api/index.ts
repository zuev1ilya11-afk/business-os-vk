import { createClient } from 'npm:@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type,apikey,authorization,x-vk-launch-params,x-bos-session',
  'Access-Control-Allow-Methods':'POST,OPTIONS'
};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,'Content-Type':'application/json'}});
const round=(n:any)=>Math.round(Number(n||0)*100)/100;
// Keep the currently deployed report payout calculation unchanged in this lifecycle patch.
const payouts=(a:any)=>{const x=round(a);return{master_payout:round(x*.85*.35),manager_payout:round(x*.85*.94*.20),dispatcher_payout:round(x*.85*.94*.15)}};
const clean=(v:any)=>String(v??'').trim();
const money=(v:any)=>{const n=Number(String(v??'0').replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?Math.round(n*100)/100:0};
const masterPayout=(v:any)=>Math.round(money(v)*.85*.65*100)/100;
const externalId=(v:any)=>clean(v).replace(/^hands:/,'');
const localExternalId=(v:any)=>`hands:${externalId(v)}`;

function b64u(a:Uint8Array){let s='';for(const b of a)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function hmac(msg:string,secret:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(msg))))}
async function verifyLaunch(raw:string,secret:string){if(!raw)return null;const p=new URLSearchParams(raw.startsWith('?')?raw.slice(1):raw),sign=p.get('sign'),app=p.get('vk_app_id'),uid=p.get('vk_user_id');if(!sign||app!=='54758847'||!uid||!/^[1-9]\d*$/.test(uid))return null;const c=[...p.entries()].filter(([k])=>k.startsWith('vk_')).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&'),exp=await hmac(c,secret);if(exp.length!==sign.length)return null;let m=0;for(let i=0;i<exp.length;i++)m|=exp.charCodeAt(i)^sign.charCodeAt(i);return m===0?uid:null}
async function verifySession(token:string,secret:string){const p=String(token||'').split('.');if(!secret||p.length!==3||!/^[A-Za-z0-9_-]{1,128}$/.test(p[0])||!/^[0-9]+$/.test(p[1])||Number(p[1])<Math.floor(Date.now()/1000))return null;const exp=await hmac(`${p[0]}.${p[1]}`,secret);if(exp.length!==p[2].length)return null;let m=0;for(let i=0;i<exp.length;i++)m|=exp.charCodeAt(i)^p[2].charCodeAt(i);return m===0?p[0]:null}
async function currentActor(db:any,req:Request){const secret=Deno.env.get('VK_APP_SECRET')||'';let uid=await verifySession(req.headers.get('x-bos-session')||'',secret);if(!uid)uid=await verifyLaunch(req.headers.get('x-vk-launch-params')||'',secret);if(!uid)return null;const q=await db.from('business_staff').select('*').eq('external_id',uid).eq('is_active',true).maybeSingle();if(q.error)throw q.error;return q.data||null}
const ops=(r:string)=>['owner','manager','dispatcher'].includes(r);

async function reportActor(db:any,req:Request,body:any){let actor=await currentActor(db,req);if(!actor)return null;if(actor.role==='owner'&&body.acting_master_vk_id){const q=await db.from('business_staff').select('*').eq('external_id',String(body.acting_master_vk_id)).eq('role','master').eq('is_active',true).maybeSingle();if(q.error)throw q.error;return q.data||null}return actor.role==='master'?actor:null}

async function finalizeReport(db:any,req:Request,body:any){
  const actor=await reportActor(db,req,body);if(!actor)return json({ok:false,error:'Отчёт может загрузить только мастер'},403);
  const orderId=String(body.order_id||'');if(!orderId)return json({ok:false,error:'ORDER_ID_REQUIRED'},400);
  const q=await db.from('orders').select('*').eq('id',orderId).single();if(q.error)throw q.error;
  if(String(q.data.master_staff_id||'')!==String(actor.id))return json({ok:false,error:'Эта заявка назначена другому мастеру'},403);
  const token=String(body.upload_token||'');if(!token)return json({ok:false,error:'UPLOAD_TOKEN_REQUIRED'},400);
  const act=String(body.act_url||''),photos=Array.isArray(body.photo_urls)?body.photo_urls.filter(Boolean).slice(0,5):[];
  if(!act)return json({ok:false,error:'ACT_REQUIRED'},400);if(!photos.length)return json({ok:false,error:'PHOTO_REQUIRED'},400);
  for(const k of ['uncompleted_work_amount','extra_work_amount'])if(k in body&&(!Number.isFinite(Number(body[k]))||Number(body[k])<0))return json({ok:false,error:'Сумма должна быть конечным неотрицательным числом'},400);
  const original=Number(q.data.original_amount??q.data.amount??0),unfinished=Number(body.uncompleted_work_amount||0);if(unfinished>original)return json({ok:false,error:'Невыполненные работы не могут превышать сумму заказа'},400);
  const amount=round(original-unfinished),now=new Date().toISOString();
  const patch:any={status:'В работе',amount,extra_work_done:!!body.extra_work_done,extra_work_description:String(body.extra_work_description||''),extra_work_amount:round(body.extra_work_amount||0),uncompleted_work_done:!!body.uncompleted_work_done,uncompleted_work_description:String(body.uncompleted_work_description||''),uncompleted_work_amount:round(unfinished),report_type:'work',report_act_url:act,report_measurement_url:null,report_photo_urls:JSON.stringify(photos),report_uploaded_at:now,report_upload_token:token,report_review_status:'pending',report_reviewed_by:null,report_reviewed_at:null,report_review_comment:'',drive_archive_status:'pending',drive_archive_error:null,completed_at:null,sync_status:'pending_sheet',updated_at:now,...payouts(amount)};
  const r=await db.from('orders').update(patch).eq('id',orderId).select().single();if(r.error)throw r.error;
  return json({ok:true,order:r.data,drive_archive_status:'pending'});
}

async function archiveBeforeApproval(req:Request,order:any){
  if(String(order.drive_archive_status||'')==='archived'&&order.drive_archive_url)return order;
  const base=Deno.env.get('SUPABASE_URL')||'';if(!base)throw new Error('Server configuration missing');
  const headers:any={'Content-Type':'application/json'};for(const h of ['x-bos-session','x-vk-launch-params']){const v=req.headers.get(h);if(v)headers[h]=v}
  const r=await fetch(`${base}/functions/v1/drive-archive-api`,{method:'POST',headers,body:JSON.stringify({order_id:String(order.id)})});
  const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось сохранить отчёт на Google Диске');
  return d.order||order;
}
async function reviewReport(db:any,req:Request,body:any){
  const actor=await currentActor(db,req);if(!actor)return json({ok:false,error:'Доступ не подтверждён'},401);if(!ops(String(actor.role||'')))return json({ok:false,error:'Недостаточно прав'},403);
  const decision=String(body.decision||'');if(!['approved','rejected'].includes(decision))return json({ok:false,error:'Неверное решение'},400);
  const q=await db.from('orders').select('*').eq('id',body.id).single();if(q.error)throw q.error;if(!q.data.report_uploaded_at)return json({ok:false,error:'Отчёт ещё не загружен'},400);
  let order=q.data;if(decision==='approved')order=await archiveBeforeApproval(req,order);
  const now=new Date().toISOString(),patch:any={report_review_status:decision,report_reviewed_by:String(actor.full_name||actor.external_id),report_reviewed_at:now,report_review_comment:String(body.comment||''),status:decision==='approved'?'Выполнена':'В работе',completed_at:decision==='approved'?now:null,sync_status:'pending_sheet',updated_at:now};
  const u=await db.from('orders').update(patch).eq('id',body.id).select().single();if(u.error)throw u.error;
  return json({ok:true,order:u.data,archived:decision==='approved'});
}

function listFromResponse(d:any){if(Array.isArray(d))return d;for(const k of ['results','orders','items','data'])if(Array.isArray(d?.[k]))return d[k];return []}
function workText(o:any){const title=clean(o?.title),works=Array.isArray(o?.works)?o.works:[],names=works.map((w:any)=>clean(w?.name)).filter(Boolean);return title||names.join(', ')||'Заказ Hands'}
function phones(o:any){const x=Array.isArray(o?.client_phones)?o.client_phones:[];return clean(x[0]||o?.client_phone||o?.phone)}
function schedule(o:any){const raw=clean(o?.work_time||o?.scheduled_at||''),m=raw.match(/(\d{4}-\d{2}-\d{2})[T\s]+(\d{2}:\d{2})/);return m?{scheduled_date:m[1],scheduled_time:m[2]}:{scheduled_date:'',scheduled_time:''}}
function externalComment(o:any){const parts=[] as string[];if(clean(o?.comment))parts.push(clean(o.comment));if(clean(o?.directions))parts.push(`Как добраться: ${clean(o.directions)}`);if(clean(o?.shop_name))parts.push(`Магазин: ${clean(o.shop_name)}`);if(clean(o?.payment_status))parts.push(`Оплата: ${clean(o.payment_status)}`);const works=Array.isArray(o?.works)?o.works:[],details=works.map((w:any)=>[clean(w?.name),clean(w?.description)].filter(Boolean).join(' — ')).filter(Boolean);if(details.length)parts.push(`Состав работ: ${details.join('; ')}`);return parts.join('\n')}
async function hands(path:string){const key=Deno.env.get('HANDS_API_KEY')||'';if(!key)throw new Error('HANDS_API_KEY_NOT_CONFIGURED');const r=await fetch(`https://api.hands.ru/api/v1/specialist${path}`,{headers:{'X-Api-Key':key}});const text=await r.text();let data:any={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}}if(!r.ok)throw new Error(`HANDS_${r.status}: ${clean(data?.error||data?.detail||text||r.statusText)}`);return data}
async function importHandsOrder(db:any,o:any,staffByName:Map<string,any>){
  const id=externalId(o?.id);if(!id)return {ok:false,reason:'missing_id'};
  const prev=await db.from('orders').select('id,status,report_review_status').eq('external_source','hands').eq('external_id',localExternalId(id)).maybeSingle();if(prev.error)throw prev.error;
  const sched=schedule(o),specialist=clean(o?.specialist),staff=specialist?staffByName.get(specialist.toLocaleLowerCase('ru-RU')):null,amount=money(o?.price),remote=clean(o?.status).toUpperCase();
  const approved=String(prev.data?.report_review_status||'')==='approved';
  const status=['CANCELLED','CANCELED'].includes(remote)?'Отменена':approved?'Выполнена':'В работе';
  const base:any={external_source:'hands',external_id:localExternalId(id),source:'Hands',client:clean(o?.client_name||o?.client),phone:phones(o),address:clean(o?.address),work:workText(o),status,amount,original_amount:amount,master_payout:staff?.id?masterPayout(amount):0,scheduled_date:sched.scheduled_date,scheduled_time:sched.scheduled_time,master_name:specialist||staff?.full_name||'',source_updated_at:clean(o?.updated_at||o?.creation_time)||new Date().toISOString(),updated_at:new Date().toISOString(),sync_status:'synced'};
  if(staff?.id)base.master_staff_id=staff.id;
  if(prev.data){const q=await db.from('orders').update(base).eq('id',prev.data.id).select('id').single();if(q.error)throw q.error;return {ok:true,id:q.data.id,created:false}}
  const q=await db.from('orders').insert({...base,comment:externalComment(o),created_by_vk_id:'hands-api'}).select('id').single();if(q.error)throw q.error;return {ok:true,id:q.data.id,created:true};
}
async function syncHandsOrders(db:any,req:Request,body:any){
  const actor=await currentActor(db,req);if(!actor)return json({ok:false,error:'Доступ не подтверждён'},401);if(!ops(String(actor.role||'')))return json({ok:false,error:'Недостаточно прав'},403);
  const status=clean(body.status||'ACTIVE').toUpperCase();if(status&&!['ACTIVE','COMPLETE'].includes(status))return json({ok:false,error:'Неверный status'},400);
  const perPage=Math.min(500,Math.max(1,Number(body.per_page||500))),maxPages=Math.min(10,Math.max(1,Number(body.max_pages||4)));
  const staffQ=await db.from('business_staff').select('id,full_name,role').eq('is_active',true).eq('role','master');if(staffQ.error)throw staffQ.error;const staffByName=new Map((staffQ.data||[]).map((x:any)=>[clean(x.full_name).toLocaleLowerCase('ru-RU'),x]));
  let seen=0,created=0,updated=0,pages=0;
  for(let page=1;page<=maxPages;page++){
    const p=new URLSearchParams({page:String(page),per_page:String(perPage)});if(status)p.set('status',status);if(body.date_from)p.set('date_from',clean(body.date_from));if(body.date_to)p.set('date_to',clean(body.date_to));if(body.search)p.set('search',clean(body.search));
    const d=await hands(`/orders/?${p.toString()}`),rows=listFromResponse(d);pages++;if(!rows.length)break;for(const o of rows){const r=await importHandsOrder(db,o,staffByName);if(r.ok){seen++;r.created?created++:updated++}}if(rows.length<perPage)break;
  }
  return json({ok:true,seen,created,updated,pages,status});
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const body=await req.json().catch(()=>({}));const action=String(body.action||'health');
    if(action==='health')return json({ok:true,service:'order-lifecycle-api',version:'2026-09-23-v106'});
    const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;if(!url||!key)throw new Error('Server configuration missing');const db=createClient(url,key,{auth:{persistSession:false}});
    if(action==='finalizeMasterReport')return await finalizeReport(db,req,body);
    if(action==='reviewReport')return await reviewReport(db,req,body);
    if(action==='syncHandsOrders')return await syncHandsOrders(db,req,body);
    return json({ok:false,error:'UNKNOWN_ACTION'},404);
  }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
