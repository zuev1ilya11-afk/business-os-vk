import { createClient } from 'npm:@supabase/supabase-js@2';
const GAS='https://script.google.com/macros/s/AKfycbx6l6V_jjZdbWQGljODcR4Uf4wvMc8hA24Dulzdmi-Ek76QH1mQS0tm3Q_ErI1sWEumzQ/exec';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-vk-launch-params,x-bos-session','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,'Content-Type':'application/json'}});
function b64u(a:Uint8Array){let s='';for(const b of a)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function sha256hex(msg:string){const d=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(msg)));return [...d].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function hmac(msg:string,secret:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(msg))))}
async function verifyLaunch(raw:string,secret:string){if(!raw)return null;const p=new URLSearchParams(raw.startsWith('?')?raw.slice(1):raw),sign=p.get('sign'),app=p.get('vk_app_id'),uid=p.get('vk_user_id');if(!sign||app!=='54758847'||!uid||!/^[1-9]\d*$/.test(uid))return null;const c=[...p.entries()].filter(([k])=>k.startsWith('vk_')).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&'),exp=await hmac(c,secret);if(exp.length!==sign.length)return null;let m=0;for(let i=0;i<exp.length;i++)m|=exp.charCodeAt(i)^sign.charCodeAt(i);return m===0?uid:null}
async function verifySession(token:string,secret:string){const p=String(token||'').split('.');if(!secret||p.length!==3||!/^[A-Za-z0-9_-]{1,128}$/.test(p[0])||!/^[0-9]+$/.test(p[1])||Number(p[1])<Math.floor(Date.now()/1000))return null;const exp=await hmac(`${p[0]}.${p[1]}`,secret);if(exp.length!==p[2].length)return null;let m=0;for(let i=0;i<exp.length;i++)m|=exp.charCodeAt(i)^p[2].charCodeAt(i);return m===0?p[0]:null}
function toB64(buf:ArrayBuffer){const a=new Uint8Array(buf);let s='';const step=0x8000;for(let i=0;i<a.length;i+=step)s+=String.fromCharCode(...a.subarray(i,i+step));return btoa(s)}

// Only signed objects for this exact order/report may cross the attachment boundary.
function validAttachmentUrl(raw:any,orderId:any,token:any){
  try{
    if(typeof raw!=='string'||raw.length>8192)return false;
    const u=new URL(raw),base=new URL(Deno.env.get('SUPABASE_URL')||'');
    const reportToken=String(token||'').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-120);
    const prefix=`/storage/v1/object/sign/business-os-vk-files/orders/${orderId}/${reportToken}/`;
    const path=decodeURIComponent(u.pathname),file=path.slice(prefix.length);
    return !!reportToken&&u.protocol==='https:'&&u.origin===base.origin&&!u.username&&!u.password&&!u.hash&&!!u.searchParams.get('token')&&path.startsWith(prefix)&&!!file&&!file.includes('/')&&!['.','..'].includes(file);
  }catch{return false}
}

class AttachmentError extends Error{constructor(message:string,public status:number){super(message)}}
async function fetchFile(url:string,name:string,order:any,budget:{bytes:number}){
  if(!validAttachmentUrl(url,order.id,order.report_upload_token))throw new AttachmentError('INVALID_ATTACHMENT_URL',400);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  const maxFile=10*1024*1024,maxReport=25*1024*1024;
  try{
    const r=await fetch(url,{redirect:'error',signal:controller.signal});
    if(!r.ok||r.redirected)throw new AttachmentError(`Не удалось прочитать ${name}`,502);
    const advertised=Number(r.headers.get('content-length')||0);
    if(advertised>maxFile||advertised+budget.bytes>maxReport)throw new AttachmentError('REPORT_FILE_TOO_LARGE',413);
    const reader=r.body?.getReader();if(!reader)throw new AttachmentError('EMPTY_REPORT_FILE',400);
    const chunks:Uint8Array[]=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>maxFile||budget.bytes+size>maxReport)throw new AttachmentError('REPORT_FILE_TOO_LARGE',413);
      chunks.push(value);
    }}finally{await reader.cancel().catch(()=>{})}
    if(!size)throw new AttachmentError('EMPTY_REPORT_FILE',400);
    const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength}
    budget.bytes+=size;
    return{name,mime:r.headers.get('content-type')||'application/octet-stream',data:toB64(bytes.buffer)};
  }catch(e){if(controller.signal.aborted)throw new AttachmentError('REPORT_FILE_TIMEOUT',504);throw e}
  finally{controller.abort();clearTimeout(timer)}
}
function archiveWrite(db:any,o:any,patch:any){
  let q=db.from('orders').update(patch).eq('id',o.id);
  for(const k of ['updated_at','status','report_review_status','report_upload_token'])q=o[k]==null?q.is(k,null):q.eq(k,o[k]);
  return q.select().maybeSingle();
}
const sameReport=(a:any,b:any)=>b&&['updated_at','status','report_review_status','report_upload_token'].every(k=>(a[k]??null)===(b[k]??null));

function displayOrderNo(o:any){const x=String(o?.external_id||'').trim();const hands=x.startsWith('hands:')?x.slice(6).trim():'';return hands||String(o?.id||'').trim()}
Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response('ok',{headers:cors});try{if(req.method!=='POST')return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);const body=await req.json().catch(()=>({}));const orderId=String(body.order_id||'');if(!orderId)return json({ok:false,error:'ORDER_ID_REQUIRED'},400);const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,vkSecret=Deno.env.get('VK_APP_SECRET')||'',syncKey=Deno.env.get('BOS_SYNC_KEY')||'';if(!url||!key||!vkSecret||!syncKey)throw new Error('Server configuration missing');const archiveSecret=await sha256hex(syncKey);const db=createClient(url,key,{auth:{persistSession:false}});let uid=await verifySession(req.headers.get('x-bos-session')||'',vkSecret);if(!uid)uid=await verifyLaunch(req.headers.get('x-vk-launch-params')||'',vkSecret);if(!uid)return json({ok:false,error:'Доступ не подтверждён'},401);const aq=await db.from('business_staff').select('*').eq('external_id',uid).eq('is_active',true).maybeSingle();if(aq.error)throw aq.error;if(!aq.data||!['owner','manager','dispatcher'].includes(String(aq.data.role)))return json({ok:false,error:'Недостаточно прав'},403);const q=await db.from('orders').select('*').eq('id',orderId).single();if(q.error)throw q.error;const o=q.data,orderNo=displayOrderNo(o);if(!o.report_uploaded_at||!o.report_act_url)return json({ok:false,error:'Отчёт ещё не загружен'},400);if(!body.expected_report_token||!body.expected_report_uploaded_at||String(o.report_upload_token||'')!==String(body.expected_report_token)||String(o.report_uploaded_at||'')!==String(body.expected_report_uploaded_at))return json({ok:false,error:'REPORT_CHANGED',message:'Отчёт изменён. Обновите заявку.'},409);if(o.status==='Отменена'||o.report_review_status==='rejected')return json({ok:false,error:'REPORT_CHANGED'},409);if(o.drive_archive_status==='archived'&&o.drive_archive_url)return json({ok:true,order:o,drive_order_no:orderNo,drive_folder_url:o.drive_archive_url});const budget={bytes:0};const act=await fetchFile(o.report_act_url,'act.pdf',o,budget);let measurement:any=null;if(o.report_type==='measurement'){if(!o.report_measurement_url)return json({ok:false,error:'Нет листа замера'},400);measurement=await fetchFile(o.report_measurement_url,'measurement.pdf',o,budget)}let urls:any[]=[];try{urls=JSON.parse(o.report_photo_urls||'[]')}catch{}if(!Array.isArray(urls)||!urls.length)return json({ok:false,error:'Нет фотографий'},400);const photos=[];for(const [i,u] of urls.slice(0,8).entries())photos.push(await fetchFile(String(u),`photo_${i+1}.jpg`,o,budget));const fresh=await db.from('orders').select('*').eq('id',orderId).maybeSingle();if(fresh.error)throw fresh.error;if(!sameReport(o,fresh.data))return json({ok:false,error:'REPORT_CHANGED'},409);const ts=Date.now(),token=String(o.report_upload_token||''),sign=await hmac(`${ts}|${orderId}|${token}`,archiveSecret),orderNoSign=await hmac(`${ts}|${orderId}|${token}|${orderNo}`,archiveSecret);const p=new URLSearchParams({action:'archiveReport',archive_ts:String(ts),archive_sign:sign,order_id:orderId,order_no:orderNo,order_no_sign:orderNoSign,upload_token:token,report_type:String(o.report_type||'work'),act_name:act.name,act_mime:act.mime,act_data:act.data,measurement_name:measurement?.name||'',measurement_mime:measurement?.mime||'',measurement_data:measurement?.data||'',photos_json:JSON.stringify(photos)});const ar=await fetch(GAS,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:p.toString(),redirect:'follow'});const text=await ar.text();let d:any={};try{d=JSON.parse(text)}catch{throw new Error('Drive bridge returned invalid response')}if(!ar.ok||!d.ok)throw new Error(d.error||'Не удалось сохранить отчёт на Google Диске');const now=new Date().toISOString();const up=await archiveWrite(db,o,{drive_archive_status:'archived',drive_archive_error:null,drive_archive_folder_id:d.drive_folder_id||null,drive_archive_url:d.drive_folder_url||null,drive_archived_at:now,updated_at:now});if(up.error)throw up.error;if(!up.data)return json({ok:false,error:'REPORT_CHANGED'},409);return json({ok:true,order:up.data,drive_order_no:d.order_no||orderNo,drive_folder_url:d.drive_folder_url||''})}catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},e instanceof AttachmentError?e.status:500)}});
