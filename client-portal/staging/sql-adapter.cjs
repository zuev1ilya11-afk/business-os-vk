// LOCAL ONLY: execute the existing Edge handlers against real PostgreSQL/PGlite.
// This adapter is not deployed in production. Unsupported operations fail explicitly.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const identifier=v=>{if(!/^[a-z_][a-z0-9_]*$/.test(v))throw Error('Invalid SQL identifier');return '"'+v+'"'};
const value=v=>v!==null&&typeof v==='object'&&!(v instanceof Date)?JSON.stringify(v):v;
const hash=(password,salt)=>crypto.scryptSync(password,salt,64).toString('hex');
const passwordHash=password=>{const salt=crypto.randomBytes(16).toString('hex');return `scrypt:${salt}:${hash(password,salt)}`};
function passwordMatches(password,stored){const [,salt,digest]=String(stored||'').split(':');if(!salt||!digest)return false;const got=Buffer.from(hash(password,salt),'hex'),want=Buffer.from(digest,'hex');return got.length===want.length&&crypto.timingSafeEqual(got,want)}
function createSqlAdapter(pg,{privateDir,origin,secret}){
 const allowed=new Set(['orders','business_staff','staff_schedule','order_claims','order_financial_snapshots','finance_expenses','master_memo_materials']);
 const run=fn=>pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE service_role');return fn(tx)});
 const db={from(table){
  if(!allowed.has(table))throw Error('Table outside isolated staff contract: '+table);
  let mode='select',selection='*',payload,filters=[],sort=[],offset=0,limit=1000,single=false,required=false,conflict=[];
  const q={select(s='*'){selection=s;return q},eq(k,v){filters.push([k,'=',v]);return q},neq(k,v){filters.push([k,'<>',v]);return q},is(k,v){filters.push([k,'is',v]);return q},gte(k,v){filters.push([k,'>=',v]);return q},lte(k,v){filters.push([k,'<=',v]);return q},gt(k,v){filters.push([k,'>',v]);return q},lt(k,v){filters.push([k,'<',v]);return q},in(k,v){filters.push([k,'in',v]);return q},order(k,o={}){sort.push([k,o.ascending===false?'DESC':'ASC']);return q},range(a,b){offset=Number(a);limit=Number(b)-offset+1;return q},limit(n){limit=Number(n);return q},single(){single=true;required=true;return q},maybeSingle(){single=true;return q},insert(p){mode='insert';payload=p;return q},update(p){mode='update';payload=p;return q},delete(){mode='delete';return q},upsert(p,o={}){mode='upsert';payload=p;conflict=String(o.onConflict||'id').split(',');return q},then(resolve,reject){return (async()=>{
   try{return await run(async tx=>{
    const args=[],bind=v=>{args.push(value(v));return '$'+args.length};
    const where=()=>filters.length?' WHERE '+filters.map(([k,op,v])=>op==='is'&&v===null?identifier(k)+' IS NULL':op==='in'?(v.length?identifier(k)+' IN ('+v.map(bind).join(',')+')':'false'):identifier(k)+' '+(op==='is'?'=':op)+' '+bind(v)).join(' AND '):'';
    let sql;const fields=selection==='*'?'*':selection.split(',').map(identifier).join(',');
    if(mode==='select'){
     if(!Number.isInteger(limit)||limit<0||limit>1000||!Number.isInteger(offset)||offset<0)throw Error('Invalid pagination');
     sql=`SELECT ${fields} FROM ${identifier(table)}`+where()+(sort.length?' ORDER BY '+sort.map(([k,d])=>identifier(k)+' '+d).join(','):'')+` LIMIT ${limit} OFFSET ${offset}`;
    }else if(mode==='insert'||mode==='upsert'){
     const rows=Array.isArray(payload)?payload:[payload],keys=[...new Set(rows.flatMap(Object.keys))];
     sql=`INSERT INTO ${identifier(table)} (${keys.map(identifier).join(',')}) VALUES `+rows.map(r=>'('+keys.map(k=>k in r?bind(r[k]):'DEFAULT').join(',')+')').join(',');
     if(mode==='upsert')sql+=' ON CONFLICT ('+conflict.map(identifier).join(',')+') DO UPDATE SET '+keys.filter(k=>!conflict.includes(k)).map(k=>identifier(k)+'=EXCLUDED.'+identifier(k)).join(',');
     sql+=' RETURNING '+fields;
    }else if(mode==='update'){sql=`UPDATE ${identifier(table)} SET `+Object.entries(payload).map(([k,v])=>identifier(k)+'='+bind(v)).join(',')+where()+' RETURNING '+fields}
    else sql=`DELETE FROM ${identifier(table)}`+where()+' RETURNING '+fields;
    const result=await tx.query(sql,args);const rows=JSON.parse(JSON.stringify(result.rows));
    if(single&&((required&&rows.length!==1)||rows.length>1))return {data:null,error:{code:'PGRST116',message:'Expected one row'}};
    return {data:single?rows[0]||null:rows,error:null};
   })}catch(e){return {data:null,error:{code:e.code||'STAGE_SQL_ERROR',message:e.message}}}
  })().then(resolve,reject)}};return q;
 },async rpc(name,p={}){
  try{
   if(name==='bos_verify_staff_credentials'){
    const {rows}=await pg.query('SELECT id,password_hash FROM business_staff WHERE lower(login)=lower($1) AND is_active=true',[p.p_login.trim()]);
    return {data:rows[0]&&passwordMatches(p.p_password,rows[0].password_hash)?rows[0].id:null,error:null};
   }
   if(name==='bos_consume_login_attempt')return await pg.transaction(async tx=>{
    await tx.query('INSERT INTO stage_login_attempts(key_hash) VALUES($1) ON CONFLICT DO NOTHING',[p.p_key_hash]);
    const r=await tx.query('UPDATE stage_login_attempts SET attempts=CASE WHEN window_start < now()-$2::int*interval \'1 second\' THEN 1 ELSE attempts+1 END,window_start=CASE WHEN window_start < now()-$2::int*interval \'1 second\' THEN now() ELSE window_start END WHERE key_hash=$1 RETURNING attempts',[p.p_key_hash,p.p_window_seconds]);
    return {data:[{allowed:r.rows[0].attempts<=p.p_limit,retry_after:p.p_window_seconds}],error:null};
   });
   const approved=new Set(['bos_contact_action','bos_manual_complete_order','bos_import_lemana_order','bos_hands_report_status']);
   if(!approved.has(name))return {data:null,error:{code:'STAGING_UNSUPPORTED_RPC',message:'RPC not enabled in isolated environment'}};
   const exists=await pg.query('SELECT 1 FROM pg_proc WHERE proname=$1',[name]);
   if(!exists.rows.length)return {data:null,error:{code:'PGRST202',message:'RPC absent from isolated schema'}};
   const args=Object.values(p).map(value),named=Object.keys(p).map((k,i)=>identifier(k)+'=> $'+(i+1)).join(',');
   const r=await run(tx=>tx.query('SELECT '+identifier(name)+'('+named+') AS result',args));return {data:r.rows[0]?.result,error:null};
  }catch(e){return {data:null,error:{code:e.code,message:e.message}}}
 }};
 const storageRoot=path.join(privateDir,'staff-files');
 const safePath=p=>{if(!/^orders\/[1-9][0-9]*\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(p)||p.includes('..'))throw Error('Invalid storage path');return path.join(storageRoot,p)};
 const signature=(p,exp)=>crypto.createHmac('sha256',secret).update(p+'\n'+exp).digest('base64url');
 db.storage={from(bucket){if(bucket!=='business-os-vk-files')throw Error('Unknown isolated bucket');return {
  async upload(p,bytes,options={}){try{const file=safePath(p);if(bytes.length>16*1024*1024)throw Error('File too large');await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});await fs.writeFile(file+'.meta',JSON.stringify({mime:options.contentType||'application/octet-stream'}),{mode:0o600});return {data:{path:p},error:null}}catch(e){return {data:null,error:{message:e.message}}}},
  async createSignedUrl(p,ttl){safePath(p);const exp=Math.floor(Date.now()/1000)+Math.min(Number(ttl)||600,3600);return {data:{signedUrl:origin+'/storage/v1/object/sign/'+bucket+'/'+p+'?expires='+exp+'&token='+signature(p,exp)},error:null}}
 }}};
 db.readStorage=async url=>{const prefix='/storage/v1/object/sign/business-os-vk-files/';if(!url.pathname.startsWith(prefix))return null;const p=decodeURIComponent(url.pathname.slice(prefix.length)),exp=Number(url.searchParams.get('expires')),token=url.searchParams.get('token')||'';const expected=signature(p,exp);if(exp<=Date.now()/1000||token.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(token),Buffer.from(expected)))return null;const file=safePath(p),meta=JSON.parse(await fs.readFile(file+'.meta','utf8'));return {bytes:await fs.readFile(file),mime:meta.mime}};
 return db;
}
module.exports={createSqlAdapter,passwordHash,passwordMatches};
