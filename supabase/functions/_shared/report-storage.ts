// SUPABASE_URL is the trusted internal gateway. Public/legacy origins are an explicit allowlist.
export function reportObjectPath(raw:any,orderId:any,token:any):string|null{
  try{
    if(typeof raw!=='string'||raw.length>8192)return null;
    const base=Deno.env.get('SUPABASE_URL')||'';
    const allowed=[base,Deno.env.get('BOS_PUBLIC_URL')||'',...(Deno.env.get('BOS_LEGACY_STORAGE_ORIGINS')||'').split(',')].filter(Boolean).map(x=>new URL(x.trim()).origin);
    const u=new URL(raw),reportToken=String(token||'').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-120);
    const prefix=`/storage/v1/object/sign/business-os-vk-files/orders/${orderId}/${reportToken}/`;
    const path=decodeURIComponent(u.pathname),file=path.slice(prefix.length);
    if(!reportToken||!['https:','http:'].includes(u.protocol)||!allowed.includes(u.origin)||u.username||u.password||u.hash||!u.searchParams.get('token')||!path.startsWith(prefix)||!file||/[\\/\x00-\x1f]/.test(file)||['.','..'].includes(file))return null;
    return path.slice('/storage/v1/object/sign/business-os-vk-files/'.length);
  }catch{return null}
}
export function validAttachmentUrl(raw:any,orderId:any,token:any){return reportObjectPath(raw,orderId,token)!==null}
export function publicReportUrl(raw:string){
  const publicBase=Deno.env.get('BOS_PUBLIC_URL');if(!publicBase)return raw;
  const base=new URL(publicBase),u=new URL(raw);
  if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('INVALID_PUBLIC_STORAGE_ORIGIN');
  if(!u.pathname.startsWith('/storage/v1/'))throw new Error('INVALID_STORAGE_PATH');
  return base.origin+u.pathname+u.search;
}
export function internalReportRequest(raw:string,order:any){
  const path=reportObjectPath(raw,order.id,order.report_upload_token);
  if(!path)throw new Error('INVALID_ATTACHMENT_URL');
  const base=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  return {url:base+'/storage/v1/object/authenticated/business-os-vk-files/'+path.split('/').map(encodeURIComponent).join('/'),headers:{Authorization:`Bearer ${key}`,apikey:key}};
}
