import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

// Machine-only worker. Browser actions use the existing signed-session lifecycle API.
const BASE='https://api.hands.ru/api/v1/specialist';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const clean=(v:unknown)=>String(v??'').trim();
const same=(a:string,b:string)=>{if(a.length!==64||b.length!==64)return false;let diff=0;for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0};
class DeliveryError extends Error{constructor(message:string,readonly retry=false,readonly uncertain=false){super(message)}}
async function rpc(db:any,name:string,params:Record<string,unknown>={}){const r=await db.rpc(name,params);if(r.error)throw new Error('QUEUE_UNAVAILABLE');return r.data}
const TYPES:Record<string,string>={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif','image/heic':'heic','image/heif':'heif','image/tiff':'tiff','image/bmp':'bmp'};
type Step={kind:'file',path:string,relation:string,label:string}|{kind:'report',body:Record<string,string>};

function objectPath(raw:unknown,o:any){
  try{
    if(typeof raw!=='string'||raw.length>8192)throw 0;
    const u=new URL(raw),base=new URL(Deno.env.get('SUPABASE_URL')||'');
    const token=clean(o.report_upload_token).replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-120);
    const prefix=`/storage/v1/object/sign/business-os-vk-files/orders/${o.id}/${token}/`;
    const path=decodeURIComponent(u.pathname),file=path.slice(prefix.length);
    if(!token||u.protocol!=='https:'||u.origin!==base.origin||u.username||u.password||u.hash||!u.searchParams.get('token')||!path.startsWith(prefix)||!file||/[\\/\x00-\x1f]/.test(file)||['.','..'].includes(file))throw 0;
    return path.slice('/storage/v1/object/sign/business-os-vk-files/'.length);
  }catch{throw new DeliveryError('Некорректное вложение принятого отчёта. Проверьте файлы заявки.')}
}
function steps(o:any):Step[]{
  const result:Step[]=[];
  if(!['work','measurement'].includes(o.report_type))throw new DeliveryError('Неизвестный тип принятого отчёта.');
  const document=o.report_type==='measurement'?o.report_measurement_url:o.report_act_url;
  if(!document)throw new DeliveryError('В принятом отчёте отсутствует документ.');
  result.push({kind:'file',path:objectPath(document,o),relation:'SPECIALIST_REPORT',label:o.report_type==='measurement'?'measurement':'act'});
  if(o.report_type==='work'&&o.report_measurement_url)result.push({kind:'file',path:objectPath(o.report_measurement_url,o),relation:'SPECIALIST_REPORT',label:'measurement'});
  let photos:any;
  try{photos=typeof o.report_photo_urls==='string'?JSON.parse(o.report_photo_urls):o.report_photo_urls||[]}catch{throw new DeliveryError('Не удалось прочитать список фотографий отчёта.')}
  if(!Array.isArray(photos)||photos.length>5||(o.report_type==='work'&&!photos.length))throw new DeliveryError('Проверьте фотографии принятого отчёта.');
  for(const [i,url] of [...new Set(photos)].entries())result.push({kind:'file',path:objectPath(url,o),relation:'SPECIALIST_PHOTO',label:`photo_${i+1}`});
  const lines=[`Отчёт принят в Business OS. Заявка №${o.id}.`,o.report_type==='measurement'?'Замер выполнен.':'Работы завершены.',clean(o.work)];
  if(o.extra_work_done||Number(o.extra_work_amount)>0)lines.push(`Дополнительные работы: ${clean(o.extra_work_description)||'указаны в акте'}. Сумма: ${Number(o.extra_work_amount)||0} руб.`);
  if(o.uncompleted_work_done||Number(o.uncompleted_work_amount)>0)lines.push(`Не выполнено: ${clean(o.uncompleted_work_description)||'указано в акте'}. Сумма исключённых работ: ${Number(o.uncompleted_work_amount)||0} руб.`);
  if(clean(o.report_review_comment))lines.push(`Комментарий при приёме: ${clean(o.report_review_comment)}`);
  const comment=lines.filter(Boolean).join('\n');
  if(comment.length>10000)throw new DeliveryError('Комментарий отчёта слишком длинный для автоматической передачи.');
  result.push({kind:'report',body:{kind:'COMPLETED',outcome:'SUCCESS',comment}});
  return result;
}
async function download(path:string):Promise<{bytes:Uint8Array,mime:string,ext:string}>{
  const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    // Re-authorize the exact stored object; an expired signed URL is not a reason to lose the receipt.
    const url=`${base}/storage/v1/object/authenticated/business-os-vk-files/${path.split('/').map(encodeURIComponent).join('/')}`;
    const r=await fetch(url,{headers:{Authorization:`Bearer ${key}`,apikey:key},redirect:'error',signal:controller.signal});
    if(!r.ok)throw new DeliveryError(`Не удалось получить файл отчёта (HTTP ${r.status}).`,r.status===429||r.status>=500);
    const mime=(r.headers.get('content-type')||'').split(';')[0].toLowerCase(),ext=TYPES[mime];
    if(!ext)throw new DeliveryError('Формат вложения не поддерживается для передачи в Hands.');
    const max=10*1024*1024;
    if(Number(r.headers.get('content-length')||0)>max)throw new DeliveryError('Вложение больше 10 МБ.');
    const reader=r.body?.getReader();if(!reader)throw new DeliveryError('Вложение пустое.');
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new DeliveryError('Вложение больше 10 МБ.')}chunks.push(value)}
    if(!size)throw new DeliveryError('Вложение пустое.');
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
    return {bytes,mime,ext};
  }catch(e){if(e instanceof DeliveryError)throw e;throw new DeliveryError('Хранилище временно недоступно. Повторим получение файла.',true)}
  finally{controller.abort();clearTimeout(timer)}
}
async function post(path:string,body:FormData|Record<string,string>){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    const headers:Record<string,string>={'X-Api-Key':Deno.env.get('HANDS_API_KEY')!};
    if(!(body instanceof FormData))headers['Content-Type']='application/json';
    const r=await fetch(`${BASE}${path}`,{method:'POST',headers,body:body instanceof FormData?body:JSON.stringify(body),redirect:'error',signal:controller.signal});
    // Never expose a provider response body: it can contain customer information or credentials.
    await r.body?.cancel();
    if(r.ok)return;
    if(r.status===429)throw new DeliveryError('Hands ограничил частоту запросов. Отправка повторится автоматически.',true);
    if(r.status>=500)throw new DeliveryError(`Hands не подтвердил отправку (HTTP ${r.status}). Проверьте этот шаг в Hands.`,false,true);
    throw new DeliveryError(`Hands отклонил отправку (HTTP ${r.status}). Проверьте доступ и данные отчёта.`);
  }catch(e){if(e instanceof DeliveryError)throw e;throw new DeliveryError('Hands не подтвердил отправку. Проверьте этот шаг в Hands перед повтором.',false,true)}
  finally{controller.abort();clearTimeout(timer)}
}
async function deliver(db:any,d:any){
  const started=Date.now(),params=()=>({p_id:d.id,p_lease:d.lease,p_step:d.step});
  let plan:Step[];
  try{plan=steps(d.snapshot)}catch(e){await rpc(db,'bos_hands_report_step',{...params(),p_action:'attention',p_error:e instanceof DeliveryError?e.message:'Некорректный отчёт.'});return}
  const external=clean(d.snapshot.external_id).replace(/^hands:/,'');
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(external)){await rpc(db,'bos_hands_report_step',{...params(),p_action:'attention',p_error:'Некорректный номер заказа Hands.'});return}
  const tag=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(d.report_token)))].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,16);
  while(d.step<plan.length){
    if(Date.now()-started>30000){await rpc(db,'bos_hands_report_step',{...params(),p_action:'yield'});return}
    const step=plan[d.step];let body:FormData|Record<string,string>,label='Отчёт о выполнении';
    try{
      if(step.kind==='file'){
        const file=await download(step.path);body=new FormData();body.append('relation',step.relation);
        label=`bos_${d.order_id}_${tag}_${step.label}.${file.ext}`;
        body.append('file',new Blob([file.bytes as BlobPart],{type:file.mime}),label);
      }else body=step.body;
    }catch(e){
      const error=e instanceof DeliveryError?e:new DeliveryError('Не удалось подготовить файл отчёта.',true);
      await rpc(db,'bos_hands_report_step',{...params(),p_action:error.retry?'retry':'attention',p_error:error.message});return;
    }
    if(!await rpc(db,'bos_hands_report_step',{...params(),p_action:'begin',p_label:label,p_final:step.kind==='report'}))return;
    try{await post(`/orders/${encodeURIComponent(external)}/${step.kind==='file'?'files':'report'}/`,body)}
    catch(e){
      const error=e instanceof DeliveryError?e:new DeliveryError('Отправка не подтверждена.',false,true);
      await rpc(db,'bos_hands_report_step',{...params(),p_action:error.retry?'retry':'attention',p_error:error.message,p_uncertain:error.uncertain});return;
    }
    // Failed persistence here deliberately leaves the intent in-flight. Recovery cannot duplicate the POST.
    if(!await rpc(db,'bos_hands_report_step',{...params(),p_action:step.kind==='report'?'sent':'advance'}))return;
    d.step++;
  }
}
async function probe(db:any){
  const q=await db.from('orders').select('external_id').eq('external_source','hands').limit(1).maybeSingle();
  if(q.error||!q.data)throw new Error('NO_LINKED_ORDER');
  const id=clean(q.data.external_id).replace(/^hands:/,'');if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new Error('INVALID_LINK');
  const result:Record<string,unknown>={};
  const connection=new AbortController(),connectionTimer=setTimeout(()=>connection.abort(),8000);
  try{
    const r=await fetch(`${BASE}/orders/?status=ACTIVE&per_page=1&page=1`,{headers:{'X-Api-Key':Deno.env.get('HANDS_API_KEY')!},redirect:'error',signal:connection.signal});
    result.connection={status:r.status};await r.body?.cancel();
  }finally{connection.abort();clearTimeout(connectionTimer)}
  for(const endpoint of ['report','files']){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),12000);
    try{
      const r=await fetch(`${BASE}/orders/${encodeURIComponent(id)}/${endpoint}/`,{method:'OPTIONS',headers:{'X-Api-Key':Deno.env.get('HANDS_API_KEY')!},redirect:'error',signal:c.signal});
      const data=await r.json().catch(()=>({}));const fields=data.actions?.POST||data.fields||{};
      result[endpoint]={status:r.status,allow:r.headers.get('allow'),keys:Object.keys(data),fields:Object.fromEntries(Object.entries(fields).map(([name,value])=>{
        const v=value as any;return [name,{type:v.type,required:v.required,max_length:v.max_length,choices:Array.isArray(v.choices)?v.choices.map((x:any)=>({value:x.value,display_name:x.display_name})):undefined}];
      }))};
    }finally{c.abort();clearTimeout(t)}
  }
  return result;
}
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
  try{
    const supplied=req.headers.get('x-bos-hands-worker')||'';
    if(!/^[a-f0-9]{64}$/.test(supplied))return json({ok:false,error:'UNAUTHORIZED'},401);
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const runtime=await rpc(db,'bos_hands_report_runtime');
    if(!runtime||!same(supplied,clean(runtime.workerKey)))return json({ok:false,error:'UNAUTHORIZED'},401);
    const body=await req.json().catch(()=>({}));
    if(!Deno.env.get('HANDS_API_KEY'))return json({ok:false,error:'HANDS_NOT_CONFIGURED'},503);
    if(body.action==='probe')return json({ok:true,contract:await probe(db)});
    if(body.action!=='worker')return json({ok:false,error:'UNKNOWN_ACTION'},400);
    if(!runtime.enabled)return json({ok:true,disabled:true});
    const d=await rpc(db,'bos_hands_report_claim');if(!d||d.attention)return json({ok:true,processed:0});
    await deliver(db,d);return json({ok:true,processed:1});
  }catch{return json({ok:false,error:'WORKER_TEMPORARILY_UNAVAILABLE'},503)}
});
