const {test,expect,devices}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const PRIMARY='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e';
const BACKUP='https://api-v2.appdeploy.ai/app/business-os-api-gateway-ukp6ew';
const session='fixture.9999999999.signature';
test.use({...devices['Pixel 7']});
async function fixture(page,role='owner'){
 const calls=[],downloads=[],errors=[];let failing=false;
 page.on('pageerror',e=>errors.push(e.message));
 if(role)await page.addInitScript(token=>localStorage.setItem('bos_vk_session_v2',token),session);
 await page.route('http://bos.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1)||'index.html';
  const file=path.join(root,name);if(!fs.existsSync(file))return route.fulfill({status:404,body:'Missing'});
  const download={name,at:Date.now()};downloads.push(download);
  await new Promise(r=>setTimeout(r,100));download.completed=Date.now();
  return route.fulfill({path:file,contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'image/svg+xml'});
 });
 await page.route('https://**/*',async route=>{
  if(route.request().url().includes('vk-bridge'))return route.fulfill({contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'});
  let action='';try{action=route.request().postDataJSON()?.action}catch{}
  calls.push({action,session:route.request().headers()['x-bos-session']});
  if(failing)return route.abort('internetdisconnected');
  return route.fulfill({json:{ok:true,user:{id:'1',external_id:'owner',full_name:'Тест',role,city:'Москва'},orders:[],users:[],masters:[],masterSchedule:[],sources:[],settings:{}}});
 });
 return {calls,downloads,errors,fail:value=>{failing=value}};
}
for(const role of ['owner','dispatcher','master'])test(`production ${role}: one bootstrap, ordered parallel modules, reload`,async({page})=>{
 const f=await fixture(page,role);
 await page.goto('http://bos.test/',{waitUntil:'load'});
 await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>BOS_LOAD_ROLE_MODULES(state.user.role));
 await page.waitForTimeout(850); // Covers the removed legacy 700ms bootstrap timer.
 expect(f.calls.filter(c=>c.action==='bootstrap')).toEqual([{action:'bootstrap',session}]);
 expect(f.errors).toEqual([]);
 const list=f.downloads.filter(d=>/^(dispatcher-smart-assign-v119|dispatcher-free-slots-v120|master-home-orders-v124|master-orders-v125)\.js$/.test(d.name));
 expect(list.length).toBeGreaterThanOrEqual(2);
 expect(list.some((a,i)=>list.some((b,j)=>i!==j&&b.at>=a.at&&b.at<a.completed))).toBe(true);
 for(const name of ['master-call-workflow-v26.js','master-reschedule-call-v87.js','web-push-v211.js','master-order-actions-v179.js'])expect(f.downloads.filter(x=>x.name===name)).toHaveLength(1);
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();
 expect(f.errors).toEqual([]);
});
test('logged out production opens login without an anonymous bootstrap',async({page})=>{
 const f=await fixture(page,null);await page.goto('http://bos.test/');
 await expect(page.locator('#simplePassForm')).toBeVisible();
 await page.waitForTimeout(850);expect(f.calls.filter(x=>x.action==='bootstrap')).toEqual([]);
});
test('saved session survives failed network and resumes once online without entering credentials',async({page})=>{
 const f=await fixture(page);f.fail(true);await page.goto('http://bos.test/');
 await expect(page.locator('#simpleBootRetry')).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('bos_vk_session_v2'))).toBe(session);
 f.fail(false);const before=f.calls.filter(x=>x.action==='bootstrap').length;
 await page.evaluate(()=>{dispatchEvent(new Event('online'));dispatchEvent(new Event('online'))});
 await expect(page.locator('#authGate')).toBeHidden();
 expect(f.calls.filter(x=>x.action==='bootstrap')).toHaveLength(before+1);
});
test('stalled bootstrap body fails over inside the route deadline',async({page})=>{
 await page.route('**/transport-fixture',r=>r.fulfill({contentType:'text/html',body:'<html><body>Transport fixture</body></html>'}));
 await page.goto('/transport-fixture');
 await page.evaluate(({primary,backup})=>{
  window.bodyRoutes=[];
  window.fetch=(url,init)=>{
   bodyRoutes.push(url);
   if(url.startsWith(primary))return Promise.resolve(new Response(new ReadableStream({start(controller){init.signal.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true})}}),{headers:{'Content-Type':'application/json'}}));
   if(url.startsWith(backup))return Promise.resolve(new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}}));
   throw Error('unexpected route');
  };
  delete window.BOS_NETWORK_DIRECT_V86;
 },{primary:PRIMARY,backup:BACKUP});
 await page.addScriptTag({path:path.join(root,'network-direct-v86.js')});
 const result=await page.evaluate(async url=>{const start=performance.now();const r=await fetch(url+'/api/proxy/mini-app-api',{method:'POST',body:'{"action":"bootstrap"}'});return {data:await r.json(),elapsed:performance.now()-start,routes:bodyRoutes}},PRIMARY);
 expect(result.data).toEqual({ok:true});expect(result.elapsed).toBeLessThan(3500);expect(result.routes).toHaveLength(2);
 await page.evaluate(()=>dispatchEvent(new Event('online')));
 expect(await page.evaluate(()=>BOS_NETWORK_DIRECT_V86.preferredTarget().base)).toBe(PRIMARY);
});
test('installed PWA opens cached verified HTML while navigation network is stalled',async({browser})=>{
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');let stalled=false,networkNavigations=0;
 const html='<html><body><h1>Cached shell</h1><script>navigator.serviceWorker.register("./sw.js")</script></body></html>';
 const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8').replace(/const BUILD_ID='[^']*';/,"const BUILD_ID='fixture';");
 const manifest='self.BOS_BUILD='+JSON.stringify({id:'fixture',shell:hash(html),assets:{}})+';';
 const sockets=new Set();
 const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/'&&stalled){networkNavigations++;return}
  res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':'text/html');res.end(name==='/sw.js'?worker:name==='/build-version.js'?manifest:html);
 });
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const context=await browser.newContext({...devices['Pixel 7']});const page=await context.newPage();
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  stalled=true;await page.reload({timeout:2500});await expect(page.getByText('Cached shell')).toBeVisible();expect(networkNavigations).toBe(0);
  await context.setOffline(true);await page.reload();await expect(page.getByText('Cached shell')).toBeVisible();
 }finally{await context.close();for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r))}
});

test('slow response with body progress is not aborted or replayed',async({page})=>{
 await page.route('**/transport-progress',r=>r.fulfill({contentType:'text/html',body:'<html><body>Progress fixture</body></html>'}));await page.goto('/transport-progress');
 await page.evaluate(()=>{
  window.progressCalls=0;
  window.fetch=(url,init)=>{progressCalls++;return Promise.resolve(new Response(new ReadableStream({start(controller){
   const encoder=new TextEncoder();let closed=false;
   init.signal.addEventListener('abort',()=>{closed=true;controller.error(new DOMException('Aborted','AbortError'))},{once:true});
   for(const [at,text,last] of [[500,'{"ok":',false],[1500,'true',false],[2500,'}',true]])setTimeout(()=>{if(closed)return;controller.enqueue(encoder.encode(text));if(last)controller.close()},at);
  }}),{headers:{'Content-Type':'application/json'}}))};
 });
 await page.addScriptTag({path:path.join(root,'network-direct-v86.js')});
 expect(await page.evaluate(async url=>(await fetch(url+'/api/proxy/mini-app-api',{method:'POST',body:'{"action":"bootstrap"}'})).json(),PRIMARY)).toEqual({ok:true});
 expect(await page.evaluate(()=>progressCalls)).toBe(1);
});

test('fast session validation waits for the delayed role loader before unlock',async({page})=>{
 const f=await fixture(page,'owner');
 let release;const held=new Promise(r=>release=r);
 await page.route('http://bos.test/pwa-register.js*',async route=>{await held;return route.fallback()});
 await page.goto('http://bos.test/',{waitUntil:'commit'});
 await expect.poll(()=>f.calls.filter(x=>x.action==='bootstrap').length).toBe(1);
 await expect(page.locator('#authGate')).toBeVisible();
 release();await expect(page.locator('#authGate')).toBeHidden();
 expect(await page.evaluate(()=>typeof BOS_ROLE_MODULES_V190)).toBe('object');
 expect(f.downloads.some(x=>x.name==='dispatcher-horizontal-schedule-v190-fix.js')).toBe(true);
});

test('iPhone viewport in Chromium restores the master UI without script errors',async({browser})=>{
 const context=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});const page=await context.newPage();
 try{const f=await fixture(page,'master');await page.goto('http://bos.test/');await expect(page.locator('#authGate')).toBeHidden();await expect(page.locator('#app')).toBeVisible();expect(f.errors).toEqual([])}finally{await context.close()}
});
