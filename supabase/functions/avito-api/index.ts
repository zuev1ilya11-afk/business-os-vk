import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,apikey,authorization,x-vk-launch-params,x-bos-session','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,'Content-Type':'application/json'}});
function b64u(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function hmac(msg:string,secret:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(msg))))}
async function verifyLaunch(raw:string,secret:string){if(!raw)return null;const p=new URLSearchParams(raw.startsWith('?')?raw.slice(1):raw),sign=p.get('sign'),app=p.get('vk_app_id'),uid=p.get('vk_user_id');if(!sign||app!=='54758847'||!uid||!/^[1-9]\d*$/.test(uid))return null;const canonical=[...p.entries()].filter(([k])=>k.startsWith('vk_')).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');const expected=await hmac(canonical,secret);if(expected.length!==sign.length)return null;let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^sign.charCodeAt(i);return mismatch===0?uid:null}
async function verifySession(token:string,secret:string){const p=String(token||'').split('.');if(p.length!==3||!/^[A-Za-z0-9_-]{1,128}$/.test(p[0])||!/^[0-9]+$/.test(p[1]))return null;const exp=Number(p[1]);if(!Number.isFinite(exp)||exp<Math.floor(Date.now()/1000))return null;const expected=await hmac(`${p[0]}.${p[1]}`,secret);if(expected.length!==p[2].length)return null;let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^p[2].charCodeAt(i);return mismatch===0?p[0]:null}
async function authActor(db:any,req:Request){const secret=Deno.env.get('VK_APP_SECRET')||'';if(!secret)throw new Error('VK_APP_SECRET missing');let uid=await verifySession(req.headers.get('x-bos-session')||'',secret);if(!uid)uid=await verifyLaunch(req.headers.get('x-vk-launch-params')||'',secret);if(!uid)return null;const q=await db.from('business_staff').select('*').eq('external_id',uid).eq('is_active',true).maybeSingle();if(q.error)throw q.error;return q.data||null}

class AvitoError extends Error {
  constructor(public code:string, public status=502, public retryAfter=0) { super(code); }
}
const errors:Record<string,string>={
  NOT_CONFIGURED:'Владелец должен настроить ключи Авито на сервере.',
  NOT_CONNECTED:'Аккаунт Авито ещё не подключён.',
  AVITO_AUTH:'Доступ Авито истёк или ключи недействительны. Проверьте подключение.',
  AVITO_FORBIDDEN:'Авито не разрешает это действие. Проверьте доступ к Messenger API.',
  AVITO_RATE_LIMIT:'Слишком много запросов к Авито. Подождите перед повтором.',
  AVITO_TIMEOUT:'Авито не ответил вовремя. Обновите историю перед повторной отправкой.',
  AVITO_UNAVAILABLE:'Авито временно недоступен. Обновите историю перед повторной отправкой.',
  AVITO_REJECTED:'Авито не принял запрос. Проверьте данные и доступ к диалогу.',
};
function credentials(){
  const client_id=Deno.env.get('AVITO_CLIENT_ID')||'',client_secret=Deno.env.get('AVITO_CLIENT_SECRET')||'';
  if(!client_id||!client_secret)throw new AvitoError('NOT_CONFIGURED',503);
  return {client_id,client_secret};
}
async function request(path:string,init:RequestInit={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{
    const r=await fetch('https://api.avito.ru'+path,{...init,signal:controller.signal});
    if(!r.ok){
      const code=r.status===401?'AVITO_AUTH':r.status===403?'AVITO_FORBIDDEN':r.status===429?'AVITO_RATE_LIMIT':r.status>=500?'AVITO_UNAVAILABLE':'AVITO_REJECTED';
      const raw=r.headers.get('retry-after')||'',seconds=Number(raw)||Math.ceil((Date.parse(raw)-Date.now())/1000);
      throw new AvitoError(code,r.status===429?429:r.status===403?403:502,Math.min(3600,Math.max(30,seconds||30)));
    }
    if(r.status===204)return {};
    try{return await r.json()}catch{throw new AvitoError('AVITO_UNAVAILABLE')}
  }catch(e){
    if(e instanceof AvitoError)throw e;
    throw new AvitoError(controller.signal.aborted?'AVITO_TIMEOUT':'AVITO_UNAVAILABLE');
  }finally{clearTimeout(timer)}
}
// Client credentials grant renews by requesting another token; it has no refresh token.
// Cache is server-memory only. Cold starts obtain a new token.
let cached:{value:string;expires:number}|null=null,pending:Promise<string>|null=null;
async function token():Promise<string>{
  if(cached&&cached.expires>Date.now())return cached.value;
  if(pending)return pending;
  pending=(async()=>{
    const d=await request('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',...credentials()})});
    if(!d.access_token)throw new AvitoError('AVITO_AUTH');
    cached={value:String(d.access_token),expires:Date.now()+Math.max(0,(Number(d.expires_in)||0)-60)*1000};
    return cached.value;
  })();
  try{return await pending}finally{pending=null}
}
async function avito(path:string,body?:unknown){
  const run=async()=>request(path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${await token()}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{return await run()}catch(e){
    if(e instanceof AvitoError&&e.code==='AVITO_AUTH'){
      cached=null;
      // Never replay a message POST after an uncertain response.
      if(body===undefined)return await run();
    }
    throw e;
  }
}
const text=(v:any):string=>typeof v==='string'?v:typeof v?.text==='string'?v.text:'';
function timestamp(v:any){const n=Number(v);return Number.isFinite(n)&&n>0&&n<8.64e12?new Date(n>1e12?n:n*1000).toISOString():null}
function normalizeChat(c:any,uid:string){
  const other=(Array.isArray(c.users)?c.users:[]).find((u:any)=>String(u.id)!==uid)||{};
  const item=c.context?.value||{},last=c.last_message||{};
  return {id:String(c.id||''),client:String(other.name||'Клиент Авито'),client_id:String(other.id||''),
    phone:String(other.phone||''),item_id:String(item.id||''),item_title:String(item.title||''),
    item_url:String(item.url||''),city:typeof item.city==='string'?item.city:'',
    last_message:text(last.content),last_message_at:timestamp(last.created||c.updated),
    unread_count:Math.max(0,Number(c.unread_count??(last.is_read===false&&String(last.author_id)!==uid?1:0))||0)};
}
async function connection(db:any){
  const q=await db.from('avito_connections').select('id,avito_user_id,account_name,is_active,last_sync_at').eq('id',1).eq('is_active',true).maybeSingle();
  if(q.error)throw q.error;
  if(!q.data)throw new AvitoError('NOT_CONNECTED',409);
  return q.data;
}
const offset=(v:any)=>Math.max(0,Math.min(10000,Math.floor(Number(v)||0)));
async function chats(c:any,start=0){
  const d=await avito(`/messenger/v2/accounts/${encodeURIComponent(c.avito_user_id)}/chats?limit=100&offset=${start}&chat_types=u2i`);
  if(!Array.isArray(d.chats))throw new AvitoError('AVITO_UNAVAILABLE');
  return d.chats.map((x:any)=>normalizeChat(x,String(c.avito_user_id)));
}
async function sync(db:any,c:any,start=0){
  const rows=await chats(c,start);let updated=0;
  // Only update message metadata. Conversations are converted through createOrder.
  for(const ch of rows){
    const q=await db.from('orders').update({avito_unread_count:ch.unread_count,avito_last_message_at:ch.last_message_at}).eq('avito_chat_id',ch.id).select('id');
    if(q.error)throw q.error;
    updated+=(q.data||[]).length;
  }
  const now=new Date().toISOString(),q=await db.from('avito_connections').update({last_sync_at:now,last_error:null,updated_at:now}).eq('id',1);
  if(q.error)throw q.error;
  return {created:0,updated,chats:rows,last_sync_at:now,next_offset:rows.length===100?start+100:null};
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({ok:false,error:'Метод не поддерживается'},405);
  try{
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const actor=await authActor(db,req);
    if(!actor)return json({ok:false,error:'Войдите в Business OS повторно'},401);
    if(!['owner','manager','dispatcher'].includes(actor.role))return json({ok:false,error:'Недостаточно прав'},403);
    const b=await req.json().catch(()=>({})),action=String(b.action||'status');
    if(action==='status'){
      const q=await db.from('avito_connections').select('avito_user_id,account_name,is_active,connected_at,last_sync_at').eq('id',1).maybeSingle();
      if(q.error)throw q.error;
      return json({ok:true,connected:!!q.data?.is_active,configured:!!(Deno.env.get('AVITO_CLIENT_ID')&&Deno.env.get('AVITO_CLIENT_SECRET')),connection:q.data||null});
    }
    if(action==='connect'||action==='disconnect'){
      if(actor.role!=='owner')return json({ok:false,error:'Только владелец может менять подключение Авито'},403);
      cached=null;
      if(action==='disconnect'){
        const q=await db.from('avito_connections').update({is_active:false,client_id:'',client_secret:'',webhook_secret:crypto.randomUUID(),updated_at:new Date().toISOString()}).eq('id',1);
        if(q.error)throw q.error;
        return json({ok:true,connected:false});
      }
      const me=await avito('/core/v1/accounts/self'),id=String(me.id||'');
      if(!/^\d+$/.test(id))throw new AvitoError('AVITO_AUTH');
      // Validate Messenger permission before marking the account connected.
      await chats({avito_user_id:id});
      const now=new Date().toISOString();
      const q=await db.from('avito_connections').upsert({id:1,client_id:'',client_secret:'',avito_user_id:id,account_name:String(me.name||'Авито'),is_active:true,webhook_secret:crypto.randomUUID(),connected_at:now,last_error:null,updated_at:now},{onConflict:'id'});
      if(q.error)throw q.error;
      return json({ok:true,connected:true});
    }
    if(!['chats','messages','read','sendMessage','sync'].includes(action))return json({ok:false,error:'Неизвестное действие'},400);
    const c=await connection(db),account=encodeURIComponent(c.avito_user_id);
    if(action==='chats'){const rows=await chats(c,offset(b.offset));return json({ok:true,chats:rows,next_offset:rows.length===100?offset(b.offset)+100:null})}
    if(action==='sync')return json({ok:true,...await sync(db,c,offset(b.offset))});
    const chat=String(b.chat_id||'');
    if(!/^[\w:-]{1,200}$/.test(chat))return json({ok:false,error:'Некорректный ID диалога'},400);
    const path=`/messenger/v1/accounts/${account}/chats/${encodeURIComponent(chat)}`;
    if(action==='messages'){
      const d=await avito(`/messenger/v3/accounts/${account}/chats/${encodeURIComponent(chat)}/messages/?limit=50&offset=${offset(b.offset)}`);
      const rows=Array.isArray(d.messages)?d.messages:Array.isArray(d)?d:null;
      if(!rows)throw new AvitoError('AVITO_UNAVAILABLE');
      return json({ok:true,messages:rows.map((m:any)=>({id:String(m.id||''),text:text(m.content),type:String(m.type||'text'),created_at:timestamp(m.created),direction:String(m.author_id)===String(c.avito_user_id)?'out':'in'})),next_offset:rows.length===50?offset(b.offset)+50:null});
    }
    if(action==='sendMessage'){
      const value=String(b.text||'').trim();
      if(!value||value.length>1000)return json({ok:false,error:'Введите сообщение длиной от 1 до 1000 символов'},400);
      const result=await avito(path+'/messages',{type:'text',message:{text:value}});
      return json({ok:true,message_id:String(result.id||'')});
    }
    await avito(path+'/read',{});
    const q=await db.from('orders').update({avito_unread_count:0}).eq('avito_chat_id',chat);
    if(q.error)throw q.error;
    return json({ok:true});
  }catch(e){
    if(e instanceof AvitoError)return json({ok:false,code:e.code,error:errors[e.code]||errors.AVITO_UNAVAILABLE,retry_after:e.retryAfter},e.status);
    return json({ok:false,code:'INTERNAL_ERROR',error:'Не удалось выполнить действие Авито. Повторите позже.'},500);
  }
});
