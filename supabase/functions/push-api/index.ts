import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';

const VERSION='web-push-v211-control-v2';
// Match password-session-api login/refresh issuance, with one minute of clock skew.
const MAX_SESSION_TTL_SECONDS=60*60*24*365+60;
const encoder=new TextEncoder();
const origins=new Set(['https://zuev1ilya11-afk.github.io','https://business-os-public-xo8i66.v2.appdeploy.ai','https://business-os-api-gateway.netlify.app']);
const roles=new Set(['owner','manager','dispatcher','master']);
function headers(req:Request){
  const origin=req.headers.get('origin')||'';
  return {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin',
    'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://zuev1ilya11-afk.github.io',
    'Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'content-type,x-bos-session,authorization,apikey'};
}
function json(req:Request,data:any,status=200){return new Response(JSON.stringify(data),{status,headers:headers(req)})}
function b64u(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
function equal(a:string,b:string){if(!a||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
async function sha(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),x=>x.toString(16).padStart(2,'0')).join('')}
async function subject(token:string,secret:string){
  const p=String(token||'').split('.'),now=Math.floor(Date.now()/1000);
  if(!secret||p.length!==3||!/^[A-Za-z0-9_-]{1,128}$/.test(p[0])||!/^\d{1,12}$/.test(p[1])||
    Number(p[1])<=now||Number(p[1])>now+MAX_SESSION_TTL_SECONDS||!/^[A-Za-z0-9_-]{43}$/.test(p[2]))return null;
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=b64u(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(p[0]+'.'+p[1]))));
  return equal(signature,p[2])?p[0]:null;
}
function validEndpoint(value:any){
  if(typeof value!=='string'||value.length>2048)return false;
  try{
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return false;
    if(u.hostname==='fcm.googleapis.com')return /^\/(?:fcm\/send|wp)\/[A-Za-z0-9_:\-]+$/.test(u.pathname)&&!u.search;
    if(u.hostname==='updates.push.services.mozilla.com')return /^\/wpush\/v[12]\/[A-Za-z0-9_-]+$/.test(u.pathname)&&!u.search;
    if(u.hostname==='web.push.apple.com')return /^\/[A-Za-z0-9_\-]+$/.test(u.pathname)&&!u.search;
    return false;
  }catch{return false}
}
function validKey(value:any,length:number,first?:number){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value)||value.length>100)return false;
  try{const data=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return data.length===length&&(first===undefined||data.charCodeAt(0)===first)}catch{return false}
}
function validSubscription(s:any){return s&&validEndpoint(s.endpoint)&&validKey(s.keys?.p256dh,65,4)&&validKey(s.keys?.auth,16)}
const validRevoke=(x:any)=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x);
async function rpc(db:any,name:string,args={}){const r=await db.rpc(name,args);if(r.error)throw new Error('PUSH_DATABASE_ERROR');return r.data}
async function config(db:any){
  let c=await rpc(db,'bos_push_runtime');
  if(!c)throw new Error('PUSH_NOT_CONFIGURED');
  if(!c.publicKey||!c.privateKey){
    const keys=webpush.generateVAPIDKeys();
    c=await rpc(db,'bos_push_set_vapid',{p_public:keys.publicKey,p_private:keys.privateKey});
  }
  return c;
}
function payload(row:any){
  // No client name, address, phone number, report contents or financial data on the lock screen.
  const titles:any={assigned:'Вам назначена заявка',unassigned:'Назначение изменилось',rescheduled:'Изменено время заявки',
    cancelled:'Заявка отменена',report_rejected:'Отчёт возвращён на доработку',new_order:'Новая заявка',
    report_pending:'Отчёт ожидает проверки',control_due:'Наступил срок поручения по заявке',test:'Уведомления Business OS подключены'};
  const order=/^\d{1,20}$/.test(String(row.order_id||''))?String(row.order_id):null;
  return {v:1,event_id:row.event_id,binding_id:row.binding_id,order_id:order,
    title:titles[row.event_type]||'Business OS',body:order?`Заявка №${order}. Откройте приложение.`:'Откройте приложение.',
    expires_at:row.expires_at};
}
async function sendOne(db:any,cfg:any,claim:any){
  const args={p_id:claim.id,p_lease:claim.lease_token};
  let status=0,retry=false;
  try{
    const row=await rpc(db,'bos_push_delivery',args);
    if(row&&validSubscription({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}})){
      const ttl=Math.min(900,Math.floor((Date.parse(row.expires_at)-Date.now())/1000));
      if(ttl>0){
        const request=webpush.generateRequestDetails({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},JSON.stringify(payload(row)),{
          vapidDetails:{subject:'https://zuev1ilya11-afk.github.io/business-os-vk/',publicKey:cfg.publicKey,privateKey:cfg.privateKey},
          TTL:ttl,urgency:'high',contentEncoding:'aes128gcm',topic:String(row.event_id).replace(/-/g,'').slice(0,32)
        });
        // Provider allowlist plus redirect:error prevents turning stored endpoints into an SSRF proxy.
        const endpoint=request.endpoint;
        if(typeof endpoint!=='string'||endpoint!==row.endpoint||!request.body)throw new Error('INVALID_PUSH_ENDPOINT');
        const encrypted=new Uint8Array(request.body.byteLength);
        encrypted.set(request.body);
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
        try{
          const response=await fetch(endpoint,{method:'POST',headers:request.headers,body:encrypted.buffer,
            redirect:'error',signal:controller.signal});
          status=response.status;retry=status===408||status===429||status>=500;
          await response.body?.cancel();
        }catch{retry=true}finally{clearTimeout(timer)}
      }
    }
  }catch{retry=true}
  await rpc(db,'bos_push_finish',{...args,p_status:status,p_retry:retry});
  return status>=200&&status<300;
}
async function worker(db:any,cfg:any){
  if(!cfg.enabled)return {ok:true,enabled:false,accepted:0};
  const claims=await rpc(db,'bos_push_claim');let accepted=0;
  // Bounded batch and concurrency fit the Edge runtime and leave lease recovery to cron.
  const pending=[...(claims||[])];
  await Promise.all(Array.from({length:4},async()=>{while(pending.length){const claim=pending.shift();if(await sendOne(db,cfg,claim))accepted++}}));
  return {ok:true,enabled:true,processed:claims.length,accepted};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
  if(req.method!=='POST')return json(req,{ok:false,error:'METHOD_NOT_ALLOWED'},405);
  try{
    if(Number(req.headers.get('content-length')||0)>8192)return json(req,{ok:false,error:'REQUEST_TOO_LARGE'},413);
    const reader=req.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
    if(reader){while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
      if(size>8192){await reader.cancel();return json(req,{ok:false,error:'REQUEST_TOO_LARGE'},413)}chunks.push(part.value)}}
    const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength}
    const raw=new TextDecoder().decode(bytes);
    let body:any;try{body=JSON.parse(raw)}catch{return json(req,{ok:false,error:'INVALID_JSON'},400)}
    if(!body||typeof body!=='object'||Array.isArray(body))return json(req,{ok:false,error:'INVALID_JSON'},400);
    const action=String(body.action||'');
    if(action==='health')return json(req,{ok:true,service:'push-api',version:VERSION});
    const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!url||!key)throw new Error('CONFIGURATION');
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    if(action==='worker'){
      const token=String(req.headers.get('authorization')||'').replace(/^Bearer /,'');
      if(!/^[a-f0-9]{64}$/.test(token))return json(req,{ok:false,error:'UNAUTHORIZED'},401);
      const cfg=await rpc(db,'bos_push_runtime');
      if(!cfg||!equal(token,cfg.workerKey||''))return json(req,{ok:false,error:'UNAUTHORIZED'},401);
      return json(req,await worker(db,await config(db)));
    }
    if(action==='revoke'){
      if(!validEndpoint(body.endpoint)||!validRevoke(body.revoke_token))return json(req,{ok:false,error:'INVALID_DEVICE'},400);
      await rpc(db,'bos_push_revoke',{p_endpoint:body.endpoint,p_revoke_hash:await sha(body.revoke_token)});
      return json(req,{ok:true});
    }
    if(!['status','subscribe','test','controlList','controlSave','controlClear'].includes(action))return json(req,{ok:false,error:'UNKNOWN_ACTION'},404);
    const uid=await subject(req.headers.get('x-bos-session')||'',Deno.env.get('VK_APP_SECRET')||'');
    if(!uid)return json(req,{ok:false,error:'Войдите в приложение заново.'},401);
    const actorQuery=await db.from('business_staff').select('id,external_id,role,is_active').eq('external_id',uid).eq('is_active',true).maybeSingle();
    if(actorQuery.error)throw new Error('ACTOR_READ_FAILED');
    const actor=actorQuery.data;
    if(!actor||!roles.has(actor.role))return json(req,{ok:false,error:'Доступ сотрудника отключён.'},403);
    if(['controlList','controlSave','controlClear'].includes(action)){
      if(action!=='controlList'&&actor.role==='master')return json(req,{ok:false,error:'Назначения меняет диспетчер или руководитель.'},403);
      const result=await rpc(db,'bos_control_action',{p_actor:actor.id,p_action:action,p_input:body});
      return json(req,result,result?.ok?200:([400,403,404,409].includes(result?.status)?result.status:500));
    }
    const cfg=await config(db);
    if(!cfg.enabled)return json(req,{ok:false,error:'Уведомления ещё не включены на сервере.'},503);
    if(action==='status'){
      let device=null;
      if(validEndpoint(body.endpoint)){
        const q=await db.from('bos_push_subscriptions').select('id,binding_id,active,expires_at').eq('staff_id',actor.id).eq('external_id',uid).eq('endpoint',body.endpoint).maybeSingle();
        if(q.error)throw new Error('DEVICE_READ_FAILED');device=q.data;
      }
      const connected=!!device?.active&&Date.parse(device.expires_at)>Date.now();
      return json(req,{ok:true,public_key:cfg.publicKey,account:uid,connected,
        device:connected&&device?{id:device.id,binding_id:device.binding_id,expires_at:device.expires_at}:null});
    }
    if(!validRevoke(body.revoke_token))return json(req,{ok:false,error:'INVALID_DEVICE_TOKEN'},400);
    const revokeHash=await sha(body.revoke_token);
    if(action==='subscribe'){
      if(!validSubscription(body.subscription))return json(req,{ok:false,error:'Этот браузер не поддерживается. Используйте Chrome, Firefox или установленное приложение на iPhone.'},400);
      const s=body.subscription;
      const r=await rpc(db,'bos_push_subscribe',{p_staff:actor.id,p_external:uid,p_endpoint:s.endpoint,
        p_p256dh:s.keys.p256dh,p_auth:s.keys.auth,p_revoke_hash:revokeHash});
      if(r?.conflict)return json(req,{ok:false,error:'Переподключите уведомления на этом устройстве.',reset_required:true},409);
      if(r?.limit)return json(req,{ok:false,error:'Достигнут лимит: 8 устройств на сотрудника.'},409);
      return json(req,{ok:true,account:uid,device:r});
    }
    if(!validEndpoint(body.endpoint))return json(req,{ok:false,error:'INVALID_DEVICE'},400);
    const result=await rpc(db,'bos_push_test',{p_staff:actor.id,p_endpoint:body.endpoint,p_revoke_hash:revokeHash});
    if(result?.limited)return json(req,{ok:false,error:'Повторный тест доступен через минуту.'},429);
    if(result?.missing)return json(req,{ok:false,error:'Сначала подключите уведомления на этом телефоне.'},409);
    return json(req,{ok:true,queued:true});
  }catch{
    // Never return provider responses, endpoints, database details or signing material.
    return json(req,{ok:false,error:'Не удалось обработать уведомления. Повторите попытку.'},500);
  }
});
