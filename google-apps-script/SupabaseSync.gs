const BOS_SYNC_SPREADSHEET_ID='1lt3WoH6pRJkwsC5XbJi90wvbA9nYu9XqNIhJcKS6w_w';
const BOS_SYNC_API_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/business-os-api';
const BOS_SYNC_KEY_PROP='SUPABASE_SYNC_KEY';

function setupBusinessOsSync(){
  const ui=SpreadsheetApp.getUi();
  const r=ui.prompt('Business OS Sync','Вставьте ключ синхронизации Supabase',ui.ButtonSet.OK_CANCEL);
  if(r.getSelectedButton()!==ui.Button.OK)return;
  const key=String(r.getResponseText()||'').trim();
  if(!key)throw new Error('Ключ не указан');
  PropertiesService.getScriptProperties().setProperty(BOS_SYNC_KEY_PROP,key);
  ScriptApp.getProjectTriggers().forEach(t=>{if(['syncOrderOnEdit','pullSupabaseUpdatesToSheet'].includes(t.getHandlerFunction()))ScriptApp.deleteTrigger(t)});
  ScriptApp.newTrigger('syncOrderOnEdit').forSpreadsheet(BOS_SYNC_SPREADSHEET_ID).onEdit().create();
  ScriptApp.newTrigger('pullSupabaseUpdatesToSheet').timeBased().everyMinutes(5).create();
  ui.alert('Готово','Синхронизация включена: новые заявки отправляются в Supabase, изменения из приложения возвращаются каждые 5 минут.',ui.ButtonSet.OK);
}

function syncOrderOnEdit(e){
  try{
    if(!e||!e.range)return;
    const sh=e.range.getSheet();
    if(sh.getName()!=='Orders'||e.range.getRow()<2)return;
    pushSheetOrderRow_(e.range.getRow());
  }catch(err){console.error(err)}
}

function pushSheetOrderRow_(rowNum){
  const ss=SpreadsheetApp.openById(BOS_SYNC_SPREADSHEET_ID),sh=ss.getSheetByName('Orders');
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  const vals=sh.getRange(rowNum,1,1,headers.length).getValues()[0];
  const o=Object.fromEntries(headers.map((h,i)=>[h,vals[i]]));
  if(!String(o.client||'').trim()||!String(o.address||'').trim()||!String(o.work||'').trim())return;
  let externalId=String(o.request_id||o.id||'').trim();
  if(!externalId){externalId='sheet_'+Utilities.getUuid();writeByHeader_(sh,headers,rowNum,'request_id',externalId)}
  const payload={action:'syncSheetOrder',order:{external_id:externalId,sheet_row:rowNum,client:String(o.client||''),phone:String(o.phone||''),address:String(o.address||''),work:String(o.work||''),scheduled_date:dateValue_(o.scheduled_date),scheduled_time:timeValue_(o.scheduled_time),amount:Number(o.amount||0),source:String(o.source||'Google Sheets'),city:String(o.city||'Москва'),comment:String(o.comment||''),source_updated_at:new Date().toISOString()}};
  const res=callBosSync_(payload);
  if(!res.ok)throw new Error(res.error||'SYNC_FAILED');
  if(res.order){writeByHeader_(sh,headers,rowNum,'supabase_id',res.order.id);writeByHeader_(sh,headers,rowNum,'sync_status',res.locked?'locked':'synced');writeByHeader_(sh,headers,rowNum,'last_synced_at',new Date())}
}

function pullSupabaseUpdatesToSheet(){
  const res=callBosSync_({action:'listPendingSheetUpdates'});if(!res.ok)throw new Error(res.error||'PULL_FAILED');
  const orders=res.orders||[];if(!orders.length)return;
  const ss=SpreadsheetApp.openById(BOS_SYNC_SPREADSHEET_ID),sh=ss.getSheetByName('Orders');
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String),data=sh.getDataRange().getValues();
  const reqIdx=headers.indexOf('request_id'),idIdx=headers.indexOf('id'),synced=[];
  orders.forEach(o=>{
    let row=-1;
    for(let i=1;i<data.length;i++){if((reqIdx>=0&&String(data[i][reqIdx])===String(o.external_id))||(idIdx>=0&&String(data[i][idIdx])===String(o.external_id))){row=i+1;break}}
    if(row<2)return;
    const patch={status:o.status,amount:o.amount,original_amount:o.original_amount,master_payout:o.master_payout,manager_payout:o.manager_payout,dispatcher_payout:o.dispatcher_payout,extra_work_done:o.extra_work_done,extra_work_description:o.extra_work_description,extra_work_amount:o.extra_work_amount,uncompleted_work_done:o.uncompleted_work_done,uncompleted_work_description:o.uncompleted_work_description,uncompleted_work_amount:o.uncompleted_work_amount,scheduled_date:o.scheduled_date,scheduled_time:o.scheduled_time,report_type:o.report_type,supabase_id:o.id,sync_status:'synced',last_synced_at:new Date()};
    Object.entries(patch).forEach(([k,v])=>writeByHeader_(sh,headers,row,k,v));synced.push(o.id);
  });
  if(synced.length)callBosSync_({action:'markSheetSynced',ids:synced});
}

function callBosSync_(payload){
  const key=PropertiesService.getScriptProperties().getProperty(BOS_SYNC_KEY_PROP);if(!key)throw new Error('Не настроен SUPABASE_SYNC_KEY. Запустите setupBusinessOsSync().');
  const r=UrlFetchApp.fetch(BOS_SYNC_API_URL,{method:'post',contentType:'application/json',headers:{'X-Sync-Key':key},payload:JSON.stringify(payload),muteHttpExceptions:true});
  let out={};try{out=JSON.parse(r.getContentText())}catch(_){throw new Error('Некорректный ответ Supabase')}
  if(r.getResponseCode()>=400)throw new Error(out.error||('HTTP '+r.getResponseCode()));return out;
}
function writeByHeader_(sh,h,row,name,value){const c=h.indexOf(name);if(c>=0)sh.getRange(row,c+1).setValue(value)}
function dateValue_(v){if(!v)return null;if(v instanceof Date)return Utilities.formatDate(v,Session.getScriptTimeZone()||'Etc/GMT','yyyy-MM-dd');return String(v).slice(0,10)}
function timeValue_(v){if(!v)return null;if(v instanceof Date)return Utilities.formatDate(v,Session.getScriptTimeZone()||'Etc/GMT','HH:mm:ss');if(typeof v==='number'){const total=Math.round(v*24*60),h=Math.floor(total/60)%24,m=total%60;return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':00'}return String(v).slice(0,8)}
