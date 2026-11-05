'use strict';
// Development-only composition. Never imported by server/start.cjs.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {setupStaging}=require('./setup.cjs');
const {createSqlAdapter}=require('./sql-adapter.cjs');
const {edge}=require('../../tests/helpers/edge.cjs');
const root=path.resolve(__dirname,'../..');
const signStaff=(uid,secret)=>{const msg=uid+'.'+(Math.floor(Date.now()/1000)+3600);return msg+'.'+crypto.createHmac('sha256',secret).update(msg).digest('base64url')};
async function createIntegratedStaging(options){
 const stage=await setupStaging(options);const {db,config,credentials}=stage;
 const {createPortal}=require('../server/api.cjs');const portal=await createPortal({db,config});
 const storageOrigin='https://stage.invalid';
 const staffDb=createSqlAdapter(db,{privateDir:options.privateDir,origin:storageOrigin,secret:credentials.secret});
 const env={VK_APP_SECRET:credentials.secret,BOS_SYNC_KEY:credentials.secret,SUPABASE_URL:storageOrigin,SUPABASE_SERVICE_ROLE_KEY:'isolated-not-an-external-key'};
 const edgeHandlers={};
 // External Google Drive is replaced by an explicit isolated disk archive transport.
 // Actual report-api and order-lifecycle-api code, receipt checks and SQL guards still run.
 async function archiveTransport(input,init={}){
  const u=new URL(input);if(u.origin!==storageOrigin||u.pathname!=='/functions/v1/drive-archive-api')throw Error('External delivery disabled in isolated staging');
  const token=new Headers(init.headers).get('x-bos-session')||'';
  const auth=await edgeHandlers['mini-app-api']({action:'bootstrap'},'',token);
  if(!auth.body.ok||!['owner','manager','dispatcher'].includes(auth.body.user.role))return Response.json({ok:false,error:'Forbidden'},{status:403});
  const body=JSON.parse(init.body),found=await db.query('SELECT * FROM orders WHERE id=$1',[body.order_id]),o=found.rows[0];
  if(!o||o.report_upload_token!==body.expected_report_token||new Date(o.report_uploaded_at).toISOString()!==new Date(body.expected_report_uploaded_at).toISOString())return Response.json({ok:false,error:'Report changed'},{status:409});
  const files=[o.report_act_url,...JSON.parse(o.report_photo_urls||'[]')];if(files.length<2)throw Error('Incomplete report');
  const dir=path.join(options.privateDir,'archives',String(o.id),String(o.report_upload_token));await fs.mkdir(dir,{recursive:true,mode:0o700});
  for(const [i,url]of files.entries()){const file=await staffDb.readStorage(new URL(url));if(!file)throw Error('Missing source report file');await fs.writeFile(path.join(dir,String(i)+'.bin'),file.bytes,{mode:0o600})}
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({order_id:String(o.id),report_token:o.report_upload_token,files:files.length,transport:'isolated-disk'}),{mode:0o600});
  const q=await staffDb.from('orders').update({drive_archive_status:'archived',drive_archive_url:options.origin+'/stage-archive-info',drive_archived_at:new Date().toISOString()}).eq('id',o.id).eq('report_upload_token',o.report_upload_token).select().single();
  if(q.error)throw Error(q.error.message);return Response.json({ok:true,order:q.data,transport:'isolated-disk'});
 }
 for(const slug of ['mini-app-api','password-session-api','profile-self-api','order-meta-api','claims-api','master-memo-api','master-workflow-api','order-lifecycle-api','report-api'])edgeHandlers[slug]=edge(slug,staffDb,{env,fetch:archiveTransport});
 const bootstrap=`(()=>{window.BOS_CLIENT_PORTAL_CONFIG={enabled:true,apiBase:'/client-api/'};window.vkBridge={send:async()=>({})};const native=window.fetch.bind(window);window.fetch=(input,init)=>{const raw=typeof input==='string'?input:input.url,url=new URL(raw,location.href);if(/functions\\/v1|api\\/proxy/.test(url.pathname)){const local='/stage-api/'+url.pathname.split('/').pop();return native(typeof input==='string'?local:new Request(new URL(local,location.origin),input),init)}if(url.origin!==location.origin)return Promise.reject(new Error('В тестовой среде внешние сервисы отключены'));return native(input,init)};if(navigator.serviceWorker)navigator.serviceWorker.register=async()=>{throw Error('Staff service worker disabled only in isolated staging')};const rewrite=()=>document.querySelectorAll('[href],[src]').forEach(el=>{for(const a of ['href','src']){const v=el.getAttribute(a);if(v&&v.startsWith('https://stage.invalid/storage/'))el.setAttribute(a,v.replace('https://stage.invalid',location.origin))}});new MutationObserver(rewrite).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['href','src']});})();`;
 async function handle(request){
  const url=new URL(request.url),p=decodeURIComponent(url.pathname);
  if(p.startsWith('/client-api/'))return portal.handle(request);
  if(p==='/')return new Response(null,{status:302,headers:{location:'/client/'}});
  if(p==='/stage-mobile')return new Response('<!doctype html><html lang="ru"><meta charset="utf-8"><title>Клиентский кабинет · ширина 390</title><style>body{margin:0;background:#e9eeeb;font:14px system-ui;display:grid;justify-content:center}p{margin:12px 0}iframe{border:1px solid #ccd5d0;width:390px;height:844px;background:#fff}</style><p>Проверка адаптивного интерфейса · 390 × 844</p><iframe title="Кабинет клиента шириной 390 пикселей" src="/client/"></iframe></html>',{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store'}});
  if(p==='/stage-bootstrap.js')return new Response(bootstrap,{headers:{'content-type':'application/javascript','cache-control':'no-store'}});
  if(p==='/stage-archive-info')return new Response('Изолированный файловый архив. Google Drive не подключён.',{headers:{'content-type':'text/plain;charset=utf-8','cache-control':'no-store'}});
  if(p.startsWith('/stage-api/')){
   if(request.method!=='POST')return Response.json({ok:false,error:'Method not allowed'},{status:405});
   if(request.headers.get('origin')!==options.origin)return Response.json({ok:false,error:'Origin mismatch'},{status:403});
   const slug=p.slice('/stage-api/'.length),h=edgeHandlers[slug];
   if(!h)return Response.json({ok:false,error:'Внешний сервис отключён в изолированной среде',code:'STAGING_DELIVERY_DISABLED'},{status:503});
   let text=await request.text();if(text.length>23*1024*1024)return Response.json({ok:false,error:'Too large'},{status:413});
   let body;try{body=JSON.parse(text)}catch{return Response.json({ok:false,error:'Bad JSON'},{status:400})}
   const out=await h(body,'',request.headers.get('x-bos-session')||'');
   if(out.binary)return new Response(out.body,{status:out.status,headers:out.headers});
   return Response.json(out.body,{status:out.status,headers:{'cache-control':'no-store'}});
  }
  if(p.startsWith('/storage/v1/object/sign/')){
   const file=await staffDb.readStorage(url);if(!file)return new Response('Not found',{status:404});
   return new Response(file.bytes,{headers:{'content-type':file.mime,'content-disposition':'inline','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
  }
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  let file,staff=false;
  if(p.startsWith('/client/')){const rel=p.slice('/client/'.length)||'index.html';if(!/^[a-zA-Z0-9_./-]+$/.test(rel)||rel.split('/').some(x=>x.startsWith('.')))return new Response('Not found',{status:404});file=path.join(root,'client-portal/public',rel)}
  else {
   let rel=p.startsWith('/staff/')?p.slice(7):p.slice(1);if(!rel)rel='index.html';
   // Explicit asset boundary; no docs, SQL, .env, runtime private dirs or source maps.
   if(!/^(?:[a-zA-Z0-9_-]+\.(?:js|css|svg|png|ico|html|webmanifest)|(?:assets|icons|vendor)\/[a-zA-Z0-9_./-]+\.(?:js|css|svg|png|ico))$/.test(rel)||rel.includes('..'))return new Response('Not found',{status:404});
   staff=rel==='index.html';file=path.join(root,rel);
  }
  try{let bytes=await fs.readFile(file);if(staff)bytes=Buffer.from(bytes.toString().replace(/<script[^>]+src="https:[^"]+"[^>]*><\/script>/g,'').replace('<head>','<head><script src="/stage-bootstrap.js"></script>'));
   const ext=path.extname(file),mime={'.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'}[ext]||'application/octet-stream';
   return new Response(request.method==='HEAD'?null:bytes,{headers:{'content-type':mime,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':staff?"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'self'":"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'self'"}});
  }catch(e){if(e.code==='ENOENT'||e.code==='EISDIR')return new Response('Not found',{status:404});throw e}
 }
 return {...stage,portal,staffDb,edgeHandlers,handle,signStaff:role=>signStaff('stage_'+role,credentials.secret)};
}
module.exports={createIntegratedStaging,signStaff};
