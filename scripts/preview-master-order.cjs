// Serves the real application with its existing fixture-backed Edge handlers.
// Localhost only, synthetic data, no production credentials, no external calls.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {fullStack}=require('../tests/helpers/full-stack.cjs');

async function createPreviewServer(){
 let session,apiRoute;
 const {db,me}=await fullStack({
  addInitScript:async(_fn,arg)=>{session=arg},
  route:async(pattern,handler)=>{if(pattern instanceof RegExp)apiRoute=handler}
 },'master');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const at=new Date().toISOString();
 Object.assign(db.tables.orders[0],{
  order_number:'TEST-1022',client:'Тестовый клиент',phone:'+70000000001',address:'Тестовая улица, дом 12',apartment:'8',floor:'3',city:'Санкт-Петербург',
  received_date:today,scheduled_date:today,scheduled_time:'14:00',master_agreed_at:at,master_called_at:at,master_called_by_staff_id:me.id,master_called_by_name:me.full_name,
  master_contact_status:'agreed',master_contact_history:[{result:'agreed',phone:'+70000000001',at,comment:'Позвонить у подъезда.'}],
  work:'3 шторы 6 направляющих\nМонтаж шторы × 2 шт.\nПодрезка × 1,5 м',
  work_items:[{name:'Монтаж шторы',quantity:2,unit:'шт.'},{name:'Подрезка',quantity:1.5,unit:'м'}]
 });
 db.tables.orders=db.tables.orders.filter(o=>o.id==='11');
 const bootstrap=`(()=>{
  localStorage.setItem('bos_vk_session_v2',${JSON.stringify(session)});
  window.vkBridge={send:async()=>({})};
  const nativeFetch=window.fetch.bind(window);
  window.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(/functions\\/v1|api\\/proxy/.test(url.pathname))return nativeFetch('/preview-api/'+url.pathname.split('/').pop(),init);if(url.origin!==location.origin)return Promise.reject(Error('External network disabled in preview'));return nativeFetch(input,init)};
  if(navigator.serviceWorker)navigator.serviceWorker.register=async()=>{throw Error('Service worker disabled in local preview')};
  document.addEventListener('click',e=>{const link=e.target.closest?.('a[href]');if(link&&new URL(link.href,location.href).origin!==location.origin)e.preventDefault()},true);
  let attempts=0;const timer=setInterval(()=>{if(++attempts>300){clearInterval(timer);return}if(window.BOS_MASTER_ORDER_ACTIONS_V179&&typeof state!=='undefined'&&state.orders?.length){clearInterval(timer);openOrder('11')}},100);
 })();`;
 const root=path.resolve(__dirname,'..');
 const publicAssets=new Set(fs.readdirSync(root).filter(n=>/\.(js|css|png|svg|ico|webp|woff2?)$/.test(n)&&n!=='sw.js'&&fs.lstatSync(path.join(root,n)).isFile()));
 publicAssets.add('index.html');
 const server=http.createServer(async(req,res)=>{
  try{
   const expectedHost='127.0.0.1:'+server.address().port;
   if(req.headers.host!==expectedHost||(req.headers.origin&&req.headers.origin!=='http://'+expectedHost)){
    res.statusCode=403;return res.end('Local preview only');
   }
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   res.setHeader('Cache-Control','no-store');
   res.setHeader('X-Content-Type-Options','nosniff');
   res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'none'; manifest-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none';");
   if(pathname==='/preview-bootstrap.js'){res.setHeader('Content-Type','application/javascript');return res.end(bootstrap)}
   if(pathname.startsWith('/preview-api/')){
    let body='';for await(const chunk of req){body+=chunk;if(body.length>2000000)throw Error('Preview request too large')}
    return await apiRoute({
     request:()=>({method:()=>req.method,url:()=>new URL(req.url,'http://localhost').href,postDataJSON:()=>JSON.parse(body||'{}'),headers:()=>req.headers}),
     fulfill:async({status=200,headers={},contentType,body=''})=>{res.writeHead(status,{...headers,...(contentType?{'Content-Type':contentType}:{})});res.end(body)}
    });
   }
   const relative=pathname==='/'?'index.html':pathname.slice(1),file=path.resolve(root,relative);
   if(!publicAssets.has(relative)||path.dirname(file)!==root||!fs.existsSync(file)||!fs.lstatSync(file).isFile()){res.statusCode=404;return res.end('Not found')}
   let bytes=fs.readFileSync(file);
   if(relative==='index.html')bytes=Buffer.from(bytes.toString().replace(/<script[^>]+src="https:[^"]+"[^>]*><\/script>/g,'').replace('<head>','<head><script src="/preview-bootstrap.js"></script>').replace('</body>','<aside id="staging-banner" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:4px;background:#facc15;color:#111;font:10px/14px sans-serif;text-align:center;pointer-events:none">ТЕСТОВАЯ СРЕДА — НЕ РАБОЧИЕ ДАННЫЕ · локальный макет</aside></body>'));
   res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);
  }catch(error){res.statusCode=500;res.end(error.message)}
 });
 return {server,db};
}
if(require.main===module)createPreviewServer().then(({server})=>server.listen(Number(process.env.BOS_MASTER_PREVIEW_PORT||4176),'127.0.0.1',()=>console.log('Synthetic master order preview: http://127.0.0.1:'+server.address().port))).catch(error=>{console.error(error);process.exitCode=1});
module.exports={createPreviewServer};
