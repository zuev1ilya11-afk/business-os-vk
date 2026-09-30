import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import policy from '../_shared/avito-price-catalog.json' with {type:'json'};
import {MODEL,HELLO,HANDOFF,CONFIRMED,incoming,hasHumanReply,extractionRequest,validateFacts,decision,canConfirm} from './core.ts';

class Failure extends Error{constructor(public code:string,public retryAfter=60){super(code)}}
const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
function equal(a:string,b:string){if(!a||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
async function rpc(db:any,action:string,data:any={}){
 const r=await db.rpc('bos_avito_assistant',{p_action:action,p_data:data});
 if(r.error)throw new Failure('DATABASE_ERROR');return r.data;
}
async function http(url:string,init:RequestInit,ms:number,kind:string){
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),ms);
 try{
  const r=await fetch(url,{...init,signal:ctl.signal});
  if(!r.ok)throw new Failure(kind+'_'+(r.status===401?'AUTH':r.status===403?'FORBIDDEN':r.status===429?'RATE_LIMIT':'UNAVAILABLE'),Math.min(3600,Math.max(60,Number(r.headers.get('retry-after'))||60)));
  const text=await r.text();if(text.length>1500000)throw new Failure(kind+'_INVALID_RESPONSE');
  return text?JSON.parse(text):{};
 }catch(e){if(e instanceof Failure)throw e;throw new Failure(kind+'_UNAVAILABLE')}finally{clearTimeout(timer)}
}
let cached:{token:string,expires:number}|null=null;
async function providerToken(){
 if(cached&&cached.expires>Date.now())return cached.token;
 const id=Deno.env.get('AVITO_CLIENT_ID'),secret=Deno.env.get('AVITO_CLIENT_SECRET');
 if(!id||!secret)throw new Failure('AVITO_NOT_CONFIGURED');
 const d=await http('https://api.avito.ru/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:id,client_secret:secret})},5000,'AVITO');
 if(!d.access_token)throw new Failure('AVITO_AUTH');
 cached={token:String(d.access_token),expires:Date.now()+Math.max(0,Number(d.expires_in||0)-60)*1000};return cached.token;
}
async function avito(path:string,body?:any){
 const get=body===undefined;
 const run=async()=>http('https://api.avito.ru'+path,{method:get?'GET':'POST',headers:{Authorization:'Bearer '+await providerToken(),'Content-Type':'application/json'},...(get?{}:{body:JSON.stringify(body)})},5000,'AVITO');
 try{return await run()}catch(e){if(e instanceof Failure&&e.code==='AVITO_AUTH'){cached=null;if(get)return await run()}throw e}
}
async function history(account:string,chat:string){
 const d=await avito('/messenger/v3/accounts/'+account+'/chats/'+encodeURIComponent(chat)+'/messages/?limit=50&offset=0');
 const rows=Array.isArray(d.messages)?d.messages:Array.isArray(d)?d:null;
 if(!rows)throw new Failure('AVITO_INVALID_RESPONSE');
 return rows.slice().reverse().sort((a:any,b:any)=>Number(a.created)-Number(b.created));
}
function fingerprint(rows:any[]){return rows.map(m=>String(m.id)+':'+JSON.stringify(m.content)+':'+String(m.type)).join('|')}
async function extract(messages:any[]){
 const key=Deno.env.get('OPENAI_API_KEY');if(!key)throw new Failure('AI_NOT_CONFIGURED');
 const req=extractionRequest(policy,messages,Deno.env.get('AVITO_AI_MODEL')||MODEL);
 const response=await http('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(req)},15000,'AI');
 if(response.status!=='completed')throw new Failure('AI_INCOMPLETE');
 const chunks=(response.output||[]).flatMap((o:any)=>o.content||[]);
 if(chunks.some((c:any)=>c.type==='refusal'))throw new Failure('AI_REFUSED');
 const texts=chunks.filter((c:any)=>c.type==='output_text').map((c:any)=>c.text);
 if(texts.length!==1)throw new Failure('AI_INVALID_RESULT');
 let parsed;try{parsed=JSON.parse(texts[0])}catch{throw new Failure('AI_INVALID_RESULT')}
 return validateFacts(parsed,messages,policy);
}
async function currentConnection(db:any){
 const q=await db.from('avito_connections').select('avito_user_id,is_active').eq('id',1).eq('is_active',true).maybeSingle();
 if(q.error)throw new Failure('DATABASE_ERROR');if(!q.data)throw new Failure('AVITO_NOT_CONNECTED');
 return String(q.data.avito_user_id);
}
async function processChat(db:any,claim:any,account:string,chat:any,policyHash:string){
 const id=String(chat.id||'');if(!/^[\w:-]{1,200}$/.test(id))return false;
 const args={lease:claim.lease,account,chat:id},snapshot=await rpc(db,'load',args);
 let state=snapshot.state||{status:'active'};
 if(['confirmed','handoff','paused'].includes(state.status))return false;
 const save=async(s:any)=>{state=s;await rpc(db,'save',{...args,state:s})};
 if(snapshot.uncertain){await save({...state,status:'handoff',reason:'UNCERTAIN_SEND'});return false}
 if(snapshot.sent_count>=20){await save({...state,status:'handoff',reason:'DIALOG_LIMIT'});return false}
 const existing=await db.from('orders').select('id').eq('external_source','avito').eq('external_id','avito_chat_'+id).maybeSingle();
 if(existing.error)throw new Failure('DATABASE_ERROR');
 if(existing.data){await save({...state,status:'paused',reason:'ORDER_EXISTS'});return false}
 const rows=await history(account,id),msgs=incoming(rows,account),last=msgs.at(-1);
 const started=Date.parse(claim.started_at)/1000;
 if(hasHumanReply(rows,account,snapshot.bot_ids||[],started)){
  await save({...state,status:'paused',reason:'HUMAN_REPLY'});return false;
 }
 const relevant=rows.filter((m:any)=>String(m.author_id)!==account&&Number(m.author_id)>0);
 const lastAny=relevant.at(-1);
 if(!lastAny||Number(lastAny.created)<started||String(lastAny.id)===state.last_input_id)return false;
 let next:any;
 if(rows.length>=50||msgs.reduce((n,m)=>n+m.text.length,0)>30000||lastAny.type!=='text'){
  next={status:'handoff',reply:HANDOFF,reason:'HISTORY_OR_ATTACHMENT_REVIEW'};
 }else{
  if(!last)return false;
  const handled=state.last_input_id?msgs.findIndex(m=>m.id===state.last_input_id):-1;
  const unseen=msgs.slice(handled+1);
  const lastOutgoing=rows.filter((m:any)=>String(m.author_id)===account).at(-1);
  if(state.policy_hash===policyHash&&canConfirm(state,unseen,String(lastOutgoing?.id||''))){
   next={status:'confirmed',reply:CONFIRMED};
  }else{
   if(!await rpc(db,'budget',{lease:claim.lease}))throw new Failure('DAILY_LIMIT',3600);
   try{next=decision(await extract(msgs),policy)}
   catch(e){
    const code=e instanceof Failure?e.code:e instanceof Error?e.message:'AI_INVALID_RESULT';
    if(['AI_INVALID_RESULT','AI_UNGROUNDED_RESULT','AI_REFUSED','AI_INCOMPLETE'].includes(code))next={status:'handoff',reply:HANDOFF,reason:'AI_REVIEW'};
    else throw e;
   }
  }
 }
 // Recheck after model latency: do not answer an obsolete input or talk over a dispatcher.
 const fresh=await history(account,id);
 if(fingerprint(fresh)!==fingerprint(rows)||hasHumanReply(fresh,account,snapshot.bot_ids||[],started))return false;
 if(await currentConnection(db)!==account)throw new Failure('ACCOUNT_CHANGED');
 const inputId=String(lastAny.id);
 if(next.status==='confirmed'){
  const item=chat.context?.value||{};
  const orderId=await rpc(db,'create_order',{...args,item_id:String(item.id||''),item_url:String(item.url||'')});
  state={...state,status:'confirmed',order_id:orderId,last_input_id:inputId};
 }else{
  state={status:next.status,reason:next.reason||null,fields:next.fields||null,
   summary:next.status==='awaiting_confirmation'?next.reply:null,summary_message_id:null,
   policy_hash:policyHash,last_input_id:inputId};
  await save(state);
 }
 const reply=(snapshot.sent_count===0?HELLO:'')+next.reply;
 if(reply.length>1000){await save({...state,status:'handoff',reason:'LONG_REPLY'});return false}
 const sendId=await rpc(db,'reserve_send',{...args,input_id:inputId,body:reply});
 if(!sendId){await save({...state,status:state.status==='confirmed'?'confirmed':'handoff',reason:'SEND_NOT_RESERVED'});return false}
 // After this durable reservation no automatic retry is allowed, including after a process crash.
 try{
  const sent=await avito('/messenger/v1/accounts/'+account+'/chats/'+encodeURIComponent(id)+'/messages',{type:'text',message:{text:reply}});
  if(!sent.id)throw new Failure('AVITO_UNCERTAIN_SEND');
  await rpc(db,'finish_send',{...args,id:sendId,message_id:String(sent.id)});
  if(state.status==='awaiting_confirmation')state.summary_message_id=String(sent.id);
  await save(state);
 }catch(e){
  await rpc(db,'finish_send',{...args,id:sendId,message_id:null}).catch(()=>{});
  await save({...state,status:state.status==='confirmed'?'confirmed':'handoff',reason:'UNCERTAIN_SEND'}).catch(()=>{});
  throw e;
 }
 return true;
}
async function worker(db:any){
 if(!Deno.env.get('OPENAI_API_KEY'))return {ok:false,error:'AI_NOT_CONFIGURED',enabled:false};
 const claim=await rpc(db,'claim');if(!claim)return {ok:true,processed:0};
 let offset=Number(claim.page_offset)||0,error:string|null=null,retry=0,processed=0;
 try{
  const account=await currentConnection(db),deadline=Date.now()+40000;
  const policyHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(policy))))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const pages=offset?[0,offset]:[0];
  for(const page of pages){
   const d=await avito('/messenger/v2/accounts/'+account+'/chats?limit=100&offset='+page+'&chat_types=u2i');
   if(!Array.isArray(d.chats))throw new Failure('AVITO_INVALID_RESPONSE');
   let completed=true;
   for(const ch of d.chats){
    if(Date.now()>deadline){completed=false;break}
    // First release covers new dialogs only. Existing conversations stay with their operators.
    if(Number(ch.created)*1000<Date.parse(claim.started_at)||!Number(ch.created))continue;
    if(await processChat(db,claim,account,ch,policyHash))processed++;
   }
   if(page===Number(claim.page_offset))offset=completed?(d.chats.length===100&&page<10000?page+100:0):page;
   if(!completed)break;
  }
  return {ok:true,processed};
 }catch(e){
  error=e instanceof Failure?e.code:'ASSISTANT_ERROR';retry=e instanceof Failure?e.retryAfter:60;
  return {ok:false,error,processed};
 }finally{await rpc(db,'release',{lease:claim.lease,offset,error,retry_after:retry})}
}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
 try{
  const key=String(req.headers.get('authorization')||'').replace(/^Bearer /,'');
  if(!/^[a-f0-9]{64}$/.test(key))return json({ok:false,error:'UNAUTHORIZED'},401);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const cfg=await rpc(db,'runtime');
  if(!cfg||!equal(key,cfg.worker_key))return json({ok:false,error:'UNAUTHORIZED'},401);
  const raw=await req.text();if(raw.length>1000)return json({ok:false,error:'INVALID_REQUEST'},400);
  const body=JSON.parse(raw);
  if(body.action==='probe'){
   const health={checked_at:new Date().toISOString(),ai_configured:!!Deno.env.get('OPENAI_API_KEY'),
    avito_configured:!!(Deno.env.get('AVITO_CLIENT_ID')&&Deno.env.get('AVITO_CLIENT_SECRET')),model:Deno.env.get('AVITO_AI_MODEL')||MODEL};
   await rpc(db,'health',{health});return json({ok:true,...health});
  }
  if(body.action!=='worker')return json({ok:false,error:'INVALID_ACTION'},400);
  return json(await worker(db));
 }catch(e){return json({ok:false,error:e instanceof Failure?e.code:'ASSISTANT_ERROR'},500)}
});
