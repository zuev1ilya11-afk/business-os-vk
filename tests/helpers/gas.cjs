const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const SECRET='synthetic-local-test-secret';
function fixture(){
 const data={
  Users:[['vk_user_id','full_name','role','city','is_active','phone','comment'],['101','Тестовый владелец','owner','Москва',true],['102','Тестовый мастер','master','Москва',true],['103','Диспетчер','dispatcher','Москва',true],['104','Другой город','dispatcher','Казань',true]],
  Orders:[['id','created_at','status','client','phone','address','work','scheduled_date','scheduled_time','master_vk_id','master_name','amount','source','city','comment','created_by_vk_id']],
  Masters:[['vk_user_id','full_name','phone','city','specialization','is_active','work_start','work_end'],['102','Тестовый мастер','','Москва','',true,'09:00','18:00']],
  Sources:[['source','is_active'],['VK',true],['Телефон',true]], Settings:[['key','value'],['default_city','Москва']]
 };
 const props={VK_APP_SECRET:SECRET,OWNER_VK_ID:'101'};
 let locked=false;
 const decode=v=>typeof v==='string'&&v.startsWith("'")?v.slice(1):v;
 const sheet=name=>({
  getDataRange:()=>({getValues:()=>data[name].map(r=>[...r])}),
  getLastColumn:()=>data[name][0].length,
  getRange:(row,col,n=1,m=1)=>({
   getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>data[name][row+i-1]?.[col+j-1]??'')),
   setValues:values=>values.forEach((r,i)=>r.forEach((v,j)=>{data[name][row+i-1]??=[];data[name][row+i-1][col+j-1]=decode(v)})),
   setValue:v=>{data[name][row-1][col-1]=v}
  }),appendRow:r=>data[name].push(r.map(decode))
 });
 const context=vm.createContext({Date,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},
  LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true},hasLock:()=>locked,releaseLock:()=>locked=false})},
  SpreadsheetApp:{openById:()=>({getSheetByName:n=>data[n]?sheet(n):null,getSpreadsheetTimeZone:()=>'UTC'}),flush(){}},
  Utilities:{Charset:{UTF_8:'UTF-8'},computeHmacSha256Signature:(s,key)=>[...crypto.createHmac('sha256',key).update(s).digest()],base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url'),formatDate:(d,tz,fmt)=>fmt==='yyyy-MM-dd'?d.toISOString().slice(0,10):d.toISOString().slice(11,16)},
  ContentService:{MimeType:{JAVASCRIPT:'javascript'},createTextOutput:text=>({text,setMimeType(){return this}})}
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../google-apps-script/Code.gs'),'utf8'),context);
 function launch(id='101'){const p=new URLSearchParams({vk_app_id:'54758847',vk_user_id:id,vk_platform:'mobile_android',vk_language:'ru'});p.sort();p.set('sign',crypto.createHmac('sha256',SECRET).update(p.toString()).digest('base64url'));return p.toString()}
 function request(action,payload={},id='101'){const result=context.doGet({parameter:{callback:'testcb',action,payload:JSON.stringify(payload),launch_params:launch(id)}}).text;return JSON.parse(result.slice(7,-2))}
 return {data,props,context,launch,request};
}
module.exports={fixture};
