// Loopback-only integration Preview. Synthetic accounts + disk-backed PostgreSQL
// WASM. No production credentials, upstreams, orders, files or external calls.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {PGlite}=require('@electric-sql/pglite');const {edge,employee,token}=require('../../tests/helpers/edge.cjs'),{postgresAdapter}=require('../../tests/helpers/help-postgres.cjs');
const root=path.resolve(__dirname,'../..'),port=Number(process.env.BOS_HELP_PREVIEW_PORT||4188),dir=process.env.BOS_HELP_PREVIEW_DATA||path.join(os.tmpdir(),'bos-help-preview');
const allowed=new Set(['master-help-entry.js','master-help.js','master-help-data.js','master-help-store.js','master-help-editor.js','master-help.css']);
(async()=>{
 const pg=new PGlite(dir);
 for(const role of ['anon','authenticated','service_role'])if(!(await pg.query('select rolname from pg_roles where rolname=$1',[role])).rows.length)await pg.exec('create role '+role+(role==='service_role'?' bypassrls':''));
 await pg.exec('create table if not exists business_staff(id text primary key,external_id text,role text,is_active boolean);');
 for(const role of ['owner','manager','master']){const user=employee(role,role);await pg.query('insert into business_staff values($1,$2,$3,true) on conflict(id) do nothing',[user.id,user.external_id,user.role])}
 await pg.exec(fs.readFileSync(path.join(root,'deploy/help-editor/schema.sql'),'utf8'));await pg.exec(fs.readFileSync(path.join(root,'deploy/help-editor/seed.sql'),'utf8'));
 const api=edge('master-memo-api',postgresAdapter(pg));
 const server=http.createServer(async(req,res)=>{
  const send=(status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type==='application/json'?JSON.stringify(data):data)};
  try{
   if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host))return send(403,{ok:false});
   if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return send(403,{ok:false});
   const url=new URL(req.url,'http://127.0.0.1:'+port),name=url.pathname.slice(1);
   if(req.method==='POST'){
    if(!String(req.headers['content-type']).startsWith('application/json'))return send(415,{ok:false});
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>200000)return send(413,{ok:false})}const body=JSON.parse(raw);
    if(url.pathname==='/preview/session'){
     if(!['owner','manager','master'].includes(body.role))return send(400,{ok:false});const user=employee(body.role,body.role);return send(200,{user:{id:user.id,role:user.role},token:token(user.external_id)});
    }
    if(url.pathname==='/functions/v1/master-memo-api'){if(!['help_list','help_save'].includes(body.action))return send(404,{ok:false,error:'В тестовом стенде доступны только подсказки'});const result=await api(body,'ignored',req.headers['x-bos-session']||'');return send(result.status,result.body)}
    return send(404,{ok:false});
   }
   if(url.pathname==='/')return send(200,fs.readFileSync(path.join(root,'tests/fixtures/help-preview.html')),'text/html; charset=utf-8');
   if(allowed.has(name))return send(200,fs.readFileSync(path.join(root,name)),name.endsWith('.css')?'text/css':'application/javascript');
   if(/^master-help-images\/[a-z0-9-]+\.png$/.test(name))return send(200,fs.readFileSync(path.join(root,name)),'image/png');
   return send(404,{ok:false});
  }catch(error){send(500,{ok:false,error:error.message})}
 });
 server.listen(port,'127.0.0.1',()=>console.log('Help integration Preview: http://127.0.0.1:'+port+' (synthetic accounts, persistent local PostgreSQL)'));
 const close=()=>server.close(async()=>{await pg.close();process.exit(0)});process.on('SIGTERM',close);process.on('SIGINT',close);
})().catch(error=>{console.error(error);process.exit(1)});
