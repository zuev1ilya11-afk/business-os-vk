const REPORT_HEADERS=['report_type','report_act_url','report_measurement_url','report_photo_urls','report_uploaded_at','report_upload_token'];

function doPost(e){
  try{
    if(!e||!e.parameter||e.parameter.action!=='uploadMasterReport') return reportText_({ok:false,error:'UNKNOWN_ACTION'});
    ensureOrderHeaders_();
    ensureReportHeaders_();
    const result=uploadMasterReport_(e.parameter);
    SpreadsheetApp.flush();
    return reportText_(result);
  }catch(err){
    return reportText_({ok:false,error:String(err&&err.message||err)});
  }
}

function ensureReportHeaders_(){
  const s=sheet_('Orders');
  let h=s.getRange(1,1,1,Math.max(1,s.getLastColumn())).getValues()[0].map(String);
  REPORT_HEADERS.forEach(name=>{if(!h.includes(name)){s.getRange(1,h.length+1).setValue(name);h.push(name)}});
}

function uploadMasterReport_(p){
  const orderId=String(p.order_id||'').trim();
  if(!orderId) throw new Error('Не указана заявка');
  const reportType=String(p.report_type||'work');
  if(!['work','measurement'].includes(reportType)) throw new Error('Некорректный тип отчёта');
  if(!p.act_data) throw new Error('Приложите акт выполненных работ');
  if(reportType==='measurement'&&!p.measurement_data) throw new Error('Для замера приложите лист замера');
  let photos=[];
  try{photos=JSON.parse(String(p.photos_json||'[]'))}catch(_){photos=[]}
  if(!Array.isArray(photos)||!photos.length) throw new Error('Приложите хотя бы одно фото объекта/работы');

  const s=sheet_('Orders'),data=s.getDataRange().getValues(),h=data[0].map(String),idIndex=h.indexOf('id');
  const rowIndex=data.findIndex((r,i)=>i>0&&String(r[idIndex])===orderId);
  if(rowIndex<1) throw new Error('Заявка не найдена');
  const o=backfillAmounts_(rowObject_(h,data[rowIndex]));
  const folder=reportOrderFolder_(orderId);

  const act=saveReportBlob_(folder,p.act_name||'Акт',p.act_mime||'application/octet-stream',p.act_data);
  let measurement=null;
  if(reportType==='measurement') measurement=saveReportBlob_(folder,p.measurement_name||'Лист замера',p.measurement_mime||'application/octet-stream',p.measurement_data);
  const photoUrls=photos.slice(0,8).map((f,i)=>saveReportBlob_(folder,f.name||('Фото-'+(i+1)),f.mime||'image/jpeg',f.data).getUrl());

  o.status='Выполнена';
  o.report_type=reportType;
  o.report_act_url=act.getUrl();
  o.report_measurement_url=measurement?measurement.getUrl():'';
  o.report_photo_urls=JSON.stringify(photoUrls);
  o.report_uploaded_at=new Date();
  o.report_upload_token=String(p.upload_token||'');

  o.extra_work_done=truthy_(p.extra_work_done);
  o.extra_work_description=String(p.extra_work_description||'');
  o.extra_work_amount=Number(p.extra_work_amount||0);
  o.uncompleted_work_done=truthy_(p.uncompleted_work_done);
  o.uncompleted_work_description=String(p.uncompleted_work_description||'');
  o.uncompleted_work_amount=Number(p.uncompleted_work_amount||0);

  normalizeCompletion_(o);
  normalizeExtraWork_(o);
  applyPayouts_(o);
  s.getRange(rowIndex+1,1,1,h.length).setValues([h.map(k=>cellValue_(o[k]))]);
  return {ok:true,order_id:orderId,report_upload_token:o.report_upload_token};
}

function reportOrderFolder_(orderId){
  const rootName='Business OS Reports';
  const rootIt=DriveApp.getFoldersByName(rootName);
  const root=rootIt.hasNext()?rootIt.next():DriveApp.createFolder(rootName);
  const safe=String(orderId).replace(/[^0-9A-Za-zА-Яа-яЁё_-]/g,'_');
  const it=root.getFoldersByName(safe);
  return it.hasNext()?it.next():root.createFolder(safe);
}

function saveReportBlob_(folder,name,mime,data){
  const raw=String(data||'').replace(/^data:[^;]+;base64,/, '');
  const bytes=Utilities.base64Decode(raw);
  const clean=String(name||'file').replace(/[\\/:*?"<>|]/g,'_').slice(0,120);
  return folder.createFile(Utilities.newBlob(bytes,String(mime||'application/octet-stream'),clean));
}

function reportText_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)}
