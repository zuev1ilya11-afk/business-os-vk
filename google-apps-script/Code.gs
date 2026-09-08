const SPREADSHEET_ID = '1lt3WoH6pRJkwsC5XbJi90wvbA9nYu9XqNIhJcKS6w_w';
const VK_APP_ID = '54758847';

function doGet(e) {
  const callback = safeCallback_(e.parameter.callback || 'callback');
  try {
    const action = e.parameter.action || 'bootstrap';
    const launchParams = e.parameter.launch_params || '';
    const vk = verifyVk_(launchParams);
    if (!vk) return jsonp_(callback, { ok:false, error:'INVALID_VK_SIGNATURE' });

    const user = ensureUser_(vk.userId, e.parameter.full_name || ('VK ' + vk.userId));
    if (!user || !user.is_active) return jsonp_(callback, { ok:false, error:'ACCESS_DENIED' });

    let result;
    if (action === 'bootstrap') result = bootstrap_(user);
    else if (action === 'createOrder') result = createOrder_(user, parsePayload_(e.parameter.payload));
    else if (action === 'updateOrder') result = updateOrder_(user, parsePayload_(e.parameter.payload));
    else if (action === 'setUserRole') result = setUserRole_(user, parsePayload_(e.parameter.payload));
    else result = { ok:false, error:'UNKNOWN_ACTION' };

    return jsonp_(callback, result);
  } catch (err) {
    return jsonp_(callback, { ok:false, error:String(err && err.message || err) });
  }
}

function verifyVk_(raw) {
  const secret = PropertiesService.getScriptProperties().getProperty('VK_APP_SECRET');
  if (!secret) throw new Error('VK_APP_SECRET is not configured');
  const p = parseQuery_(raw);
  if (!p || !/^[A-Za-z0-9_-]{43}$/.test(p.sign || '') || p.vk_app_id !== VK_APP_ID || !p.vk_user_id) return null;
  const keys = Object.keys(p).filter(k => k.indexOf('vk_') === 0).sort();
  // Serialize decoded vk_* parameters like URLSearchParams (form encoding).
  // sign and application query parameters are never part of the HMAC input.
  const canonical = keys.map(k => formEncode_(k) + '=' + formEncode_(p[k])).join('&');
  const sig = Utilities.computeHmacSha256Signature(canonical, secret, Utilities.Charset.UTF_8);
  const computed = Utilities.base64EncodeWebSafe(sig).replace(/=+$/,'');
  if (computed !== p.sign) return null;
  return { userId:String(p.vk_user_id), appId:p.vk_app_id };
}

function formEncode_(value) {
  // Apps Script has no browser URLSearchParams. Spaces become '+', literal
  // plus becomes '%2B', and only ASCII alphanumerics, '*', '-', '.', '_' stay raw.
  return encodeURIComponent(value)
    .replace(/[!'()~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
}

function parseQuery_(raw) {
  raw = String(raw || '').replace(/^\?/,'');
  const out = Object.create(null);
  if (!raw) return out;
  // e.parameter already removed the outer request encoding. Decode each
  // inner key/value exactly once, never decode the entire launch_params string.
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
  return values.slice(1).filter(r=>r.some(v=>v!==''&&v!==null)).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}

function ensureUser_(vkId, fullName) {
  const s=sheet_('Users');
  const values=s.getDataRange().getValues();
  const headers=values[0].map(String);
  const idx=headers.indexOf('vk_user_id');
  for(let i=1;i<values.length;i++) if(String(values[i][idx])===String(vkId)) return rowObject_(headers,values[i]);

  const hasAny=values.slice(1).some(r=>r.some(v=>v!==''&&v!==null));
  if (hasAny) return null;
  const row={vk_user_id:String(vkId),full_name:fullName,role:'owner',city:'Москва',is_active:true,phone:'',comment:'Первый пользователь — владелец'};
  appendObject_(s,headers,row);
  return row;
}

function bootstrap_(user) {
  const allOrders=rows_('Orders');
  const masters=rows_('Masters').filter(x=>truthy_(x.is_active));
  const sources=rows_('Sources').filter(x=>truthy_(x.is_active));
  const users=rows_('Users').filter(x=>truthy_(x.is_active));
  const settings=Object.fromEntries(rows_('Settings').map(x=>[String(x.key),x.value]));
  let orders=allOrders;
  if (user.role==='master') orders=allOrders.filter(o=>String(o.master_vk_id)===String(user.vk_user_id));
  else if (user.role!=='owner') orders=allOrders.filter(o=>String(o.city||'')===String(user.city||''));
  return {ok:true,user,orders,masters,sources,users,settings};
}

function createOrder_(user,p) {
  if (!['owner','manager','dispatcher'].includes(String(user.role))) return {ok:false,error:'FORBIDDEN'};
  const s=sheet_('Orders'), headers=s.getRange(1,1,1,s.getLastColumn()).getValues()[0].map(String);
  const id=nextOrderId_();
  const row={id,created_at:new Date(),status:p.master_vk_id?'Назначена':'Новая',client:p.client||'',phone:p.phone||'',address:p.address||'',work:p.work||'',scheduled_date:p.scheduled_date||'',scheduled_time:p.scheduled_time||'',master_vk_id:p.master_vk_id||'',master_name:p.master_name||'',amount:Number(p.amount||0),source:p.source||'VK',city:p.city||user.city||'Москва',comment:p.comment||'',created_by_vk_id:user.vk_user_id};
  appendObject_(s,headers,row);
  return {ok:true,order:row};
}

function updateOrder_(user,p) {
  const s=sheet_('Orders'), data=s.getDataRange().getValues(), headers=data[0].map(String), idIdx=headers.indexOf('id');
  const rowIdx=data.findIndex((r,i)=>i>0&&String(r[idIdx])===String(p.id));
  if (rowIdx<1) return {ok:false,error:'ORDER_NOT_FOUND'};
  const current=rowObject_(headers,data[rowIdx]);
  if (user.role==='master') {
    if (String(current.master_vk_id)!==String(user.vk_user_id) || !['В работе','Выполнена'].includes(String(p.status))) return {ok:false,error:'FORBIDDEN'};
    current.status=p.status;
  } else if (['owner','manager','dispatcher'].includes(String(user.role))) {
    ['status','client','phone','address','work','scheduled_date','scheduled_time','master_vk_id','master_name','amount','source','city','comment'].forEach(k=>{if(Object.prototype.hasOwnProperty.call(p,k))current[k]=p[k]});
  } else return {ok:false,error:'FORBIDDEN'};
  s.getRange(rowIdx+1,1,1,headers.length).setValues([headers.map(h=>current[h]??'')]);
  return {ok:true,order:current};
}

function setUserRole_(user,p){
  if(String(user.role)!=='owner') return {ok:false,error:'FORBIDDEN'};
  const allowed=['owner','manager','dispatcher','master'];
  if(!allowed.includes(String(p.role))) return {ok:false,error:'BAD_ROLE'};
  const s=sheet_('Users'),data=s.getDataRange().getValues(),headers=data[0].map(String),idIdx=headers.indexOf('vk_user_id');
  const rowIdx=data.findIndex((r,i)=>i>0&&String(r[idIdx])===String(p.vk_user_id));
  if(rowIdx<1) return {ok:false,error:'USER_NOT_FOUND'};
  const obj=rowObject_(headers,data[rowIdx]); obj.role=p.role;
  s.getRange(rowIdx+1,1,1,headers.length).setValues([headers.map(h=>obj[h]??'')]);
  return {ok:true,user:obj};
}

function nextOrderId_(){ const ids=rows_('Orders').map(x=>Number(String(x.id).replace(/\D/g,''))).filter(Number.isFinite); return 'З-'+String((ids.length?Math.max.apply(null,ids):1000)+1); }
function appendObject_(sheet,headers,obj){ sheet.appendRow(headers.map(h=>obj[h]??'')); }
function rowObject_(headers,row){ return Object.fromEntries(headers.map((h,i)=>[h,row[i]])); }
function truthy_(v){ return v===true || String(v).toLowerCase()==='true' || String(v)==='1'; }
function parsePayload_(raw){ try{return JSON.parse(decodeURIComponent(raw||'%7B%7D'))}catch(e){return {}} }
function safeCallback_(v){ return /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(v)?v:'callback'; }
function jsonp_(callback,obj){ return ContentService.createTextOutput(callback+'('+JSON.stringify(obj)+');').setMimeType(ContentService.MimeType.JAVASCRIPT); }
