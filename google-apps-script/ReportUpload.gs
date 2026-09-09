const REPORT_ARCHIVE_ROOT_ID='1ymO4m0maNw0ZZBKV1qskbzWmjfdQFd-O';

function doPost(e){
  try{
    const p=e&&e.parameter?e.parameter:{};
    if(String(p.action||'')!=='archiveReport') return reportText_({ok:false,error:'UNKNOWN_ACTION'});
    verifyArchiveRequest_(p);
    return reportText_(archiveReport_(p));
  }catch(err){
    return reportText_({ok:false,error:String(err&&err.message||err)});
  }
}

function archiveSigningKey_(){
  const syncKey=PropertiesService.getScriptProperties().getProperty('bos_sync_key')||'';
  if(!syncKey) throw new Error('bos_sync_key is not configured');
  const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,syncKey,Utilities.Charset.UTF_8);
  return digest.map(b=>('0'+((b<0?b+256:b)&255).toString(16)).slice(-2)).join('');
}

function verifyArchiveRequest_(p){
  const secret=archiveSigningKey_();
  const ts=Number(p.archive_ts||0);
  if(!Number.isFinite(ts)||Math.abs(Date.now()-ts)>5*60*1000) throw new Error('ARCHIVE_REQUEST_EXPIRED');
  const orderId=String(p.order_id||'').trim(),token=String(p.upload_token||'');
  if(!orderId) throw new Error('ORDER_ID_REQUIRED');
  const canonical=[String(ts),orderId,token].join('|');
  const bytes=Utilities.computeHmacSha256Signature(canonical,secret,Utilities.Charset.UTF_8);
  const expected=Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,'');
  if(!constantTimeEqual_(expected,String(p.archive_sign||''))) throw new Error('INVALID_ARCHIVE_SIGNATURE');
}

function archiveReport_(p){
  const orderId=String(p.order_id||'').trim();
  const reportType=String(p.report_type||'work');
  if(!['work','measurement'].includes(reportType)) throw new Error('BAD_REPORT_TYPE');
  if(!p.act_data) throw new Error('ACT_REQUIRED');
  if(reportType==='measurement'&&!p.measurement_data) throw new Error('MEASUREMENT_REQUIRED');
  let photos=[];try{photos=JSON.parse(String(p.photos_json||'[]'))}catch(_){photos=[]}
  if(!Array.isArray(photos)||!photos.length) throw new Error('PHOTO_REQUIRED');

  const folder=reportOrderFolder_(orderId);
  const act=saveNamedReportBlob_(folder,'Акт выполненных работ',p.act_name,p.act_mime,p.act_data);
  let measurement=null;
  if(reportType==='measurement') measurement=saveNamedReportBlob_(folder,'Лист замера',p.measurement_name,p.measurement_mime,p.measurement_data);
  const photoFiles=photos.slice(0,8).map((f,i)=>saveNamedReportBlob_(folder,'Фото выполненной работы '+(i+1),f.name,f.mime||'image/jpeg',f.data));
  return {ok:true,order_id:orderId,drive_folder_id:folder.getId(),drive_folder_url:folder.getUrl(),act_url:act.getUrl(),measurement_url:measurement?measurement.getUrl():'',photo_urls:photoFiles.map(f=>f.getUrl())};
}

function reportOrderFolder_(orderId){
  const root=DriveApp.getFolderById(REPORT_ARCHIVE_ROOT_ID);
  const safe=String(orderId).replace(/[^0-9A-Za-zА-Яа-яЁё_-]/g,'_');
  const name='Заявка '+safe;
  const it=root.getFoldersByName(name);
  return it.hasNext()?it.next():root.createFolder(name);
}

function saveNamedReportBlob_(folder,prefix,originalName,mime,data){
  const ext=fileExt_(String(originalName||''));
  const name=prefix+(ext?'.'+ext:'');
  const existing=folder.getFilesByName(name);while(existing.hasNext())existing.next().setTrashed(true);
  const raw=String(data||'').replace(/^data:[^;]+;base64,/, '');
  const bytes=Utilities.base64Decode(raw);
  return folder.createFile(Utilities.newBlob(bytes,String(mime||'application/octet-stream'),name));
}

function fileExt_(name){
  const m=String(name||'').match(/\.([A-Za-z0-9]{1,8})$/);return m?m[1].toLowerCase():'';
}
function constantTimeEqual_(a,b){a=String(a||'');b=String(b||'');if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
function reportText_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)}
