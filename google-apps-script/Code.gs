const SPREADSHEET_ID = '1lt3WoH6pRJkwsC5XbJi90wvbA9nYu9XqNIhJcKS6w_w';
const VK_APP_ID = '54758847';
const OWNER_VK_ID = '1105117085';

function doGet(e) {
  const callback = safeCallback_(e.parameter.callback || 'callback');
  let lock;
  try {
    const action = e.parameter.action || 'bootstrap';
    if (action === 'health') return jsonp_(callback, {ok:true,version:'2026-09-08-mobile-2'});
    const launchParams = e.parameter.launch_params || '';
    const vk = verifyVk_(launchParams);
    if (!vk) return jsonp_(callback, { ok:false, error:'INVALID_VK_SIGNATURE' });
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return jsonp_(callback, {ok:false,error:'BUSY'});

    const user = ensureUser_(vk.userId, e.parameter.full_name || ('VK ' + vk.userId));
    if (!user || !truthy_(user.is_active)) return jsonp_(callback, { ok:false, error:'ACCESS_DENIED' });

    let result;
    if (action === 'bootstrap') result = bootstrap_(user);
    else if (action === 'createOrder') result = createOrder_(user, parsePayload_(e.parameter.payload));
    else if (action === 'updateOrder') result = updateOrder_(user, parsePayload_(e.parameter.payload));
    else if (action === 'setUserRole') result = setUserRole_(user, parsePayload_(e.parameter.payload));
    else if (action === 'upsertUser') result = upsertUser_(user, parsePayload_(e.parameter.payload));
    else result = { ok:false, error:'UNKNOWN_ACTION' };

    return jsonp_(callback, result);
  } catch (err) {
    return jsonp_(callback, { ok:false, error:String(err && err.message || err) });
  } finally {
    if (lock && lock.hasLock()) {
      try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
    }
  }
}

function verifyVk_(raw) {
  const secret = PropertiesService.getScriptProperties().getProperty('VK_APP_SECRET');
  if (!secret) throw new Error('VK_APP_SECRET is not configured');
  const p = parseQuery_(raw);
  if (!p || !p.sign || p.vk_app_id !== VK_APP_ID || !p.vk_user_id) return null;
  const keys = Object.keys(p).filter(k => k.indexOf('vk_') === 0).sort();
  if (!keys.length) return null;
  const canonical = keys.map(k => formEncode_(k) + '=' + formEncode_(p[k])).join('&');
  const sig = Utilities.computeHmacSha256Signature(canonical, secret, Utilities.Charset.UTF_8);
  const computed = Utilities.base64EncodeWebSafe(sig).replace(/=+$/,'');
  if (computed !== String(p.sign)) return null;
  return { userId:String(p.vk_user_id), appId:p.vk_app_id };
}

function formEncode_(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
}

function parseQuery_(raw) {
  raw = String(raw || '').replace(/^\?/,'');
  const out = Object.create(null);
  if (!raw) return out;
  try {
    for (const part of raw.split('&')) {
      if (!part) continue;
      const i = part.indexOf('=');
      const k = decodeURIComponent((i < 0 ? part : part.slice(0,i)).replace(/\+/g,' '));
      if (k !== 'sign' && k.indexOf('vk_') !== 0) continue;
      if (Object.prototype.hasOwnProperty.call(out, k)) return null;
      const v = decodeURIComponent((i < 0 ? '' : part.slice(i+1)).replace(/\+/g,' '));
      out[k] = v;
    }
  } catch (err) {
    return null;
  }
  return out;
}

function ss_(){ return SpreadsheetApp.openById(SPREADSHEET_ID); }
function sheet_(name){ const s=ss_().getSheetByName(name); if(!s) throw new Error('Sheet not found: '+name); return s; }
function rows_(name){
  const s=sheet_(name), values=s.getDataRange().getValues();
  if (!values.length) return [];
  const headers=values[0].map(String);
  return values.slice(1).filter(r=>r.some(v=>v!==''&&v!==null)).map(r=>rowObject_(headers,r));
}

function ensureUser_(vkId, fullName) {
  const s=sheet_('Users');
  const values=s.getDataRange().getValues();
  const headers=values[0].map(String);
  const idx=headers.indexOf('vk_user_id');
  for(let i=1;i<values.length;i++) if(String(values[i][idx])===String(vkId)) return rowObject_(headers,values[i]);

  const hasAny=values.slice(1).some(r=>r.some(v=>v!==''&&v!==null));
  if (hasAny) return null;
  const ownerId=PropertiesService.getScriptProperties().getProperty('OWNER_VK_ID') || OWNER_VK_ID;
  if (!ownerId) throw new Error('OWNER_NOT_CONFIGURED');
  if (String(vkId)!==String(ownerId)) return null;
  const row={vk_user_id:String(vkId),full_name:fullName,role:'owner',city:'Москва',is_active:true,phone:'',comment:'Первый пользователь — владелец'};
  appendObject_(s,headers,row);
  return row;
}

function bootstrap_(user) {
  const allOrders=rows_('Orders');
  const masters=rows_('Masters').filter(x=>truthy_(x.is_active) && (user.role==='owner' || String(x.city||'')===String(user.city||'')));
  const sources=rows_('Sources').filter(x=>truthy_(x.is_active));
  const users=rows_('Users').filter(x=>truthy_(x.is_active) && (user.role==='owner' || (user.role!=='master' && String(x.city||'')===String(user.city||'')) || String(x.vk_user_id)===String(user.vk_user_id)));
  const settings=Object.fromEntries(rows_('Settings').map(x=>[String(x.key),x.value]));
  let orders=allOrders;
  if (user.role==='master') orders=allOrders.filter(o=>String(o.master_vk_id)===String(user.vk_user_id));
  else if (user.role!=='owner') orders=allOrders.filter(o=>String(o.city||'')===String(user.city||''));
  return {ok:true,user,orders,masters,sources,users,settings};
}

function createOrder_(user,p) {
  if (!['owner','manager','dispatcher'].includes(String(user.role))) return {ok:false,error:'FORBIDDEN'};
  const s=sheet_('Orders');
  let headers=s.getRange(1,1,1,s.getLastColumn()).getValues()[0].map(String);
  if (p.request_id && !/^[A-Za-z0-9_-]{8,100}$/.test(p.request_id)) throw new Error('BAD_PAYLOAD');
  if (p.request_id) {
    const existing=rows_('Orders').find(o=>String(o.created_by_vk_id)===String(user.vk_user_id) && o.request_id===p.request_id);
    if (existing) return {ok:true,order:existing};
  }
  const id=nextOrderId_();
  const row={id,created_at:new Date(),status:p.master_vk_id?'Назначена':'Новая',client:p.client||'',phone:p.phone||'',address:p.address||'',work:p.work||'',scheduled_date:p.scheduled_date||'',scheduled_time:p.scheduled_time||'',master_vk_id:p.master_vk_id||'',master_name:p.master_name||'',amount:Number(p.amount||0),source:p.source||'VK',city:p.city||user.city||'Москва',comment:p.comment||'',created_by_vk_id:user.vk_user_id};
  validateOrder_(user,row);
  if (p.request_id) {
    if (!headers.includes('request_id')) { s.getRange(1,headers.length+1).setValue('request_id'); headers.push('request_id'); }
    row.request_id=p.request_id;
  }
  appendObject_(s,headers,row);
  return {ok:true,order:row};
}

function updateOrder_(user,p) {
  const s=sheet_('Orders'), data=s.getDataRange().getValues(), headers=data[0].map(String), idIdx=headers.indexOf('id');
  const rowIdx=data.findIndex((r,i)=>i>0&&String(r[idIdx])===String(p.id));
  if (rowIdx<1) return {ok:false,error:'ORDER_NOT_FOUND'};
  const current=rowObject_(headers,data[rowIdx]);
  if (user.role!=='owner' && user.role!=='master' && String(current.city||'')!==String(user.city||'')) return {ok:false,error:'FORBIDDEN'};
  if (user.role==='master') {
    if (String(current.master_vk_id)!==String(user.vk_user_id) || !['В работе','Выполнена'].includes(String(p.status))) return {ok:false,error:'FORBIDDEN'};
    if (!['Назначена','В работе'].includes(current.status) && current.status!==p.status) return {ok:false,error:'BAD_STATUS'};
    current.status=p.status;
  } else if (['owner','manager','dispatcher'].includes(String(user.role))) {
    ['status','client','phone','address','work','scheduled_date','scheduled_time','master_vk_id','master_name','amount','source','city','comment'].forEach(k=>{if(Object.prototype.hasOwnProperty.call(p,k))current[k]=p[k]});
  } else return {ok:false,error:'FORBIDDEN'};
  if (user.role!=='master') {
    if (Object.prototype.hasOwnProperty.call(p,'master_vk_id') && !Object.prototype.hasOwnProperty.call(p,'status') && ['Новая','Назначена'].includes(current.status)) current.status=current.master_vk_id?'Назначена':'Новая';
    validateOrder_(user,current);
  }
  s.getRange(rowIdx+1,1,1,headers.length).setValues([headers.map(h=>cellValue_(current[h]))]);
  return {ok:true,order:current};
}

function setUserRole_(user,p){
  if(String(user.role)!=='owner') return {ok:false,error:'FORBIDDEN'};
  const allowed=['owner','manager','dispatcher','master'];
  if(!allowed.includes(String(p.role))) return {ok:false,error:'BAD_ROLE'};
  const s=sheet_('Users'),data=s.getDataRange().getValues(),headers=data[0].map(String),idIdx=headers.indexOf('vk_user_id');
  const rowIdx=data.findIndex((r,i)=>i>0&&String(r[idIdx])===String(p.vk_user_id));
  if(rowIdx<1) return {ok:false,error:'USER_NOT_FOUND'};
  const obj=rowObject_(headers,data[rowIdx]);
  if (obj.role==='owner' && p.role!=='owner' && rows_('Users').filter(u=>u.role==='owner'&&truthy_(u.is_active)).length<=1) return {ok:false,error:'LAST_OWNER'};
  obj.role=p.role;
  s.getRange(rowIdx+1,1,1,headers.length).setValues([headers.map(h=>cellValue_(obj[h]))]);
  syncMaster_(obj);
  return {ok:true,user:obj};
}

function upsertUser_(user,p){
  if(String(user.role)!=='owner') return {ok:false,error:'FORBIDDEN'};
  const vkId=String(p.vk_user_id||'').trim();
  const fullName=String(p.full_name||'').trim();
  const role=String(p.role||'master');
  const city=String(p.city||user.city||'Москва').trim();
  if(!/^\d{2,20}$/.test(vkId) || !fullName) return {ok:false,error:'BAD_USER'};
  if(!['owner','manager','dispatcher','master'].includes(role)) return {ok:false,error:'BAD_ROLE'};
  const s=sheet_('Users'), data=s.getDataRange().getValues(), headers=data[0].map(String), idIdx=headers.indexOf('vk_user_id');
  let rowIdx=data.findIndex((r,i)=>i>0&&String(r[idIdx])===vkId);
  let obj={vk_user_id:vkId,full_name:fullName,role,city,is_active:p.is_active===false?false:true,phone:String(p.phone||''),comment:String(p.comment||'')};
  if(rowIdx>0){
    const old=rowObject_(headers,data[rowIdx]);
    obj=Object.assign(old,obj);
    s.getRange(rowIdx+1,1,1,headers.length).setValues([headers.map(h=>cellValue_(obj[h]))]);
  } else appendObject_(s,headers,obj);
  syncMaster_(obj);
  return {ok:true,user:obj};
}

function syncMaster_(u){
  const s=sheet_('Masters'),data=s.getDataRange().getValues(),headers=data[0].map(String),idIdx=headers.indexOf('vk_user_id');
  const rowIdx=data.findIndex((r,i)=>i>0&&String(r[idIdx])===String(u.vk_user_id));
  if(String(u.role)==='master' && truthy_(u.is_active)){
    const m={vk_user_id:String(u.vk_user_id),full_name:u.full_name||'',phone:u.phone||'',city:u.city||'Москва',specialization:'',is_active:true,work_start:'09:00',work_end:'18:00'};
    if(rowIdx>0){
      const old=rowObject_(headers,data[rowIdx]);
      const merged=Object.assign(old,m);
      s.getRange(rowIdx+1,1,1,headers.length).setValues([headers.map(h=>cellValue_(merged[h]))]);
    } else appendObject_(s,headers,m);
  } else if(rowIdx>0){
    const old=rowObject_(headers,data[rowIdx]); old.is_active=false;
    s.getRange(rowIdx+1,1,1,headers.length).setValues([headers.map(h=>cellValue_(old[h]))]);
  }
}

function nextOrderId_(){ const ids=rows_('Orders').map(x=>Number(String(x.id).replace(/\D/g,''))).filter(Number.isFinite); return 'З-'+String((ids.length?Math.max.apply(null,ids):1000)+1); }
function cellValue_(v){ return typeof v==='string' && /^[=+@-]/.test(v)?"'"+v:(v??''); }
function appendObject_(sheet,headers,obj){ sheet.appendRow(headers.map(h=>cellValue_(obj[h]))); }
function rowObject_(headers,row){ return Object.fromEntries(headers.map((h,i)=>{
  let v=row[i];
  if (v instanceof Date) v=h==='scheduled_date'?Utilities.formatDate(v,ss_().getSpreadsheetTimeZone(),'yyyy-MM-dd'):h==='scheduled_time'?Utilities.formatDate(v,ss_().getSpreadsheetTimeZone(),'HH:mm'):v.toISOString();
  return [h,v];
})); }
function validateOrder_(user,row){
  for (const k of ['client','address','work']) { row[k]=String(row[k]||'').trim(); if(!row[k]) throw new Error('REQUIRED_FIELDS'); }
  for (const k of ['client','phone','address','work','comment','source','city']) if(String(row[k]||'').length>1000) throw new Error('TEXT_TOO_LONG');
  row.amount=Number(row.amount||0);
  if(!Number.isFinite(row.amount)||row.amount<0) throw new Error('BAD_AMOUNT');
  if(user.role!=='owner' && String(row.city||'')!==String(user.city||'')) throw new Error('FORBIDDEN');
  if(!['Новая','Назначена','В работе','Выполнена','Отменена'].includes(row.status)) throw new Error('BAD_STATUS');
  if(row.scheduled_date && (!/^\d{4}-\d{2}-\d{2}$/.test(row.scheduled_date)||!Number.isFinite(Date.parse(row.scheduled_date))||new Date(row.scheduled_date).toISOString().slice(0,10)!==row.scheduled_date)) throw new Error('BAD_DATE');
  if(row.scheduled_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.scheduled_time)) throw new Error('BAD_DATE');
  if(row.master_vk_id){
    const master=rows_('Masters').find(m=>String(m.vk_user_id)===String(row.master_vk_id)&&truthy_(m.is_active));
    if(!master || (user.role!=='owner' && String(master.city||'')!==String(user.city||''))) throw new Error('MASTER_NOT_FOUND');
    row.master_name=master.full_name;
  } else { row.master_name=''; if(row.status==='Назначена') throw new Error('MASTER_REQUIRED'); }
}
function truthy_(v){ return v===true || String(v).toLowerCase()==='true' || String(v)==='1'; }
function parsePayload_(raw){
  let p;
  try { p=JSON.parse(raw||'{}'); } catch(e) { try { p=JSON.parse(decodeURIComponent(raw||'%7B%7D')); } catch(err) { throw new Error('BAD_PAYLOAD'); } }
  if(!p||typeof p!=='object'||Array.isArray(p)) throw new Error('BAD_PAYLOAD');
  return p;
}
function safeCallback_(v){ return /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(v)?v:'callback'; }
function jsonp_(callback,obj){ return ContentService.createTextOutput(callback+'('+JSON.stringify(obj)+');').setMimeType(ContentService.MimeType.JAVASCRIPT); }
