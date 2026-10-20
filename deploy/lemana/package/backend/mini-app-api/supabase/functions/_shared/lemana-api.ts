// Signed previews are stateless, actor-bound, short-lived, and never stored or logged.
export async function lemanaApi(db:any,body:any,me:any,sign:(s:string)=>Promise<string>){
 const L=(globalThis as any).BOS_LEMANA_IMPORT,X=(globalThis as any).BOS_XLSX,P=(globalThis as any).BOS_ORDER_PAYROLL;
 const encode=(s:string)=>{let binary='';for(const b of new TextEncoder().encode(s))binary+=String.fromCharCode(b);return btoa(binary).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')};
 const decode=(s:string)=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)));
 const readAll=async(table:string,columns='*')=>{const rows:any[]=[];for(let at=0;;at+=1000){const q=await db.from(table).select(columns).order('id').range(at,at+999);if(q.error)throw Error('Не удалось проверить существующие заявки');rows.push(...q.data);if(q.data.length<1000)return rows}};
 if(!['owner','manager','dispatcher'].includes(me.role))return {status:403,body:{ok:false,error:'Недостаточно прав для импорта'}};
 try{
  if(body.action==='previewLemanaImport'){
   if(typeof body.file_name!=='string'||!/^.+\.xlsx$/i.test(body.file_name))throw Error('Выберите файл XLSX');
   const raw=body.file_base64;if(typeof raw!=='string'||raw.length>Math.ceil(X.MAX_FILE/3)*4||!raw.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(raw))throw Error('Недопустимый размер или формат файла (до 5 МБ)');
   const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0)),parsed=X.read(bytes);
   const [orders,staff]=await Promise.all([readAll('orders','id,source,external_source,external_id,order_number'),readAll('business_staff','id,full_name,role,is_active,city')]);
   const preview=L.preview(parsed,orders,staff,body.timezone,body.overrides||{});
   const snapshot=JSON.stringify({v:1,actor:String(me.id),exp:Date.now()+20*60*1000,rows:preview.rows.filter((r:any)=>r.kind==='new').map((r:any)=>({row:r.row,order:r.order}))});
   if(new TextEncoder().encode(snapshot).length>3*1024*1024-100)throw Error('Слишком много данных для одного импорта. Разделите отчёт на меньшие файлы');
   const payload=encode(snapshot);
   return {status:200,body:{ok:true,preview,preview_token:payload+'.'+await sign('lemana-preview-v1:'+payload)}};
  }
  const token=body.preview_token;if(typeof token!=='string'||token.length>4*1024*1024)throw Error('Недействительный предпросмотр. Проверьте файл заново');
  const [payload,signature,...rest]=token.split('.');if(rest.length||!payload||!signature||signature!==await sign('lemana-preview-v1:'+payload))throw Error('Недействительная подпись предпросмотра');
  const preview=JSON.parse(decode(payload));if(preview.v!==1||preview.actor!==String(me.id)||preview.exp<Date.now())throw Error('Предпросмотр устарел. Проверьте файл заново');
  const selected=body.selected;if(!Array.isArray(selected)||!selected.length||selected.length>1000||new Set(selected).size!==selected.length||selected.some(x=>!Number.isInteger(x)||!preview.rows.some((r:any)=>r.row===x)))throw Error('Выберите новые заявки из предпросмотра');
  const staff=await readAll('business_staff','id,external_id');
  const result:any={ok:true,created:0,skipped:0,errors:0,rows:[],orders:[]};
  for(const row of preview.rows.filter((r:any)=>selected.includes(r.row))){
   const o=row.order;
   // Rate is calculated here by the same library as reports; SQL never copies the formula.
   const order={...o,...P.calculate(o.amount,o,!!o.master_staff_id&&o.status!=='Отменена'),city:o.city||me.city||'',created_by_vk_id:me.external_id};
   const q=await db.rpc('bos_import_lemana_order',{p_actor:me.id,p_order:order});
   if(q.error){result.errors++;result.rows.push({row:row.row,number:o.order_number,kind:'error',reason:'Не удалось сохранить строку. Проверьте данные и повторите предпросмотр'});continue}
   if(q.data?.kind==='created'){result.created++;result.orders.push({...q.data.order,id:String(q.data.order.id),master_vk_id:staff.find((m:any)=>String(m.id)===String(q.data.order.master_staff_id))?.external_id||''});result.rows.push({row:row.row,number:o.order_number,kind:'created',reason:''})}
   else {result.skipped++;result.rows.push({row:row.row,number:o.order_number,kind:'skipped',reason:q.data?.reason||'Уже существует или требует повторной проверки'})}
  }
  return {status:200,body:result};
 }catch(error){return {status:400,body:{ok:false,error:(error as Error).message||'Не удалось проверить файл'}}}
}
