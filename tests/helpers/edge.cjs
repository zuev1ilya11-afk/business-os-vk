const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { createHmac, webcrypto } = require('node:crypto');
const secret = 'audit-test-secret-not-production';
const token = (uid, exp = Math.floor(Date.now()/1000)+3600) => {
  const msg = `${uid}.${exp}`;
  return `${msg}.${createHmac('sha256',secret).update(msg).digest('base64url')}`;
};
function database(seed = {}) {
  const tables = structuredClone({business_staff:[],orders:[],staff_schedule:[],order_claims:[],master_memo_materials:[],...seed});
  const db = {tables, calls:[], rpc:async(name,p)=>{
    db.calls.push({rpc:name,p});
    if(name==='bos_verify_staff_credentials')return {data:tables.business_staff.find(x=>x.is_active&&x.login?.toLowerCase()===p.p_login.trim().toLowerCase()&&x.password_hash===p.p_password)?.id||null,error:null};
    if(name==='bos_consume_login_attempt')return {data:[{allowed:true,retry_after:0}],error:null};
    if(name==='bos_set_staff_credentials'){
      if(tables.business_staff.some(x=>x.id!==p.p_staff_id&&x.login?.toLowerCase()===p.p_login.trim().toLowerCase()))return {data:null,error:{code:'23505',message:'duplicate key business_staff_login_unique'}};
      Object.assign(tables.business_staff.find(x=>x.id===p.p_staff_id),{login:p.p_login,password_hash:p.p_password});return {data:null,error:null};
    }
    throw new Error(`Unexpected RPC ${name}`);
  },from(table){
    let filters=[], mode='select', payload, columns='*', single=false, from=0, to=999;
    const q={select(c='*'){columns=c;return q},eq(k,v){filters.push(x=>String(x[k])===String(v));return q},neq(k,v){filters.push(x=>String(x[k])!==String(v));return q},in(k,vs){filters.push(x=>vs.includes(x[k]));return q},order(){return q},limit(n){to=n-1;return q},range(a,b){from=a;to=b;return q},maybeSingle(){single=true;return q},single(){single=true;return q},insert(p){mode='insert';payload=p;return q},update(p){mode='update';payload=p;return q},upsert(p){mode='upsert';payload=p;return q},delete(){mode='delete';return q},then(resolve,reject){return Promise.resolve().then(()=>{
      db.calls.push({table,mode,payload:structuredClone(payload)});
      let rows=(tables[table]||[]).filter(x=>filters.every(f=>f(x)));
      if(mode==='insert'){
        if(table==='orders'&&tables.orders.some(x=>x.external_id===payload.external_id&&x.external_source===payload.external_source))return {data:null,error:{code:'23505',message:'duplicate key'}};
        rows=(Array.isArray(payload)?payload:[payload]).map(x=>({id:String((tables[table]||[]).length+1),...x}));tables[table].push(...rows);
      } else if(mode==='update')rows.forEach(x=>Object.assign(x,db.beforeUpdate?db.beforeUpdate(table,x,{...payload}):payload));
      else if(mode==='delete')tables[table]=tables[table].filter(x=>!rows.includes(x));
      else if(mode==='upsert'){rows=payload;for(const p of payload){const x=tables[table].find(x=>x.staff_id===p.staff_id&&x.work_date===p.work_date);if(x)Object.assign(x,p);else tables[table].push({...p})}}
      rows=rows.slice(from,to+1).map(x=>columns==='*'?{...x}:Object.fromEntries(columns.split(',').map(k=>[k,x[k]])));
      return {data:single?rows[0]||null:rows,error:null};
    }).then(resolve,reject)}};return q;
  }};return db;
}
function edge(slug,db,extra={}){
  let handler;
  const filename=path.join(__dirname,'../../supabase/functions',slug,'index.ts');
  const source=stripTypeScriptTypes(fs.readFileSync(filename,'utf8').replace(/^import .*?;\s*/,'') ,{mode:'transform'});
  const context={createClient:()=>db,Deno:{env:{get:k=>({VK_APP_SECRET:secret,BOS_SYNC_KEY:secret,SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-key'}[k])},serve:fn=>handler=fn},crypto:webcrypto,Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,btoa,atob,console,fetch:()=>{throw new Error('Unexpected external fetch')},...extra};
  vm.runInNewContext(source,context,{filename});
  return async(body,uid='100',session=token(uid))=>{const r=await handler(new Request('https://test.invalid',{method:'POST',headers:{'Content-Type':'application/json','X-BOS-Session':session},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()}};
}
const employee=(id,role='master',extra={})=>({id,external_id:id==='owner'?'100':`staff_${id}`,full_name:id,role,is_active:true,phone:'+79990000001',login:id,password_hash:'audit-password',...extra});
module.exports={edge,database,token,employee,secret};
