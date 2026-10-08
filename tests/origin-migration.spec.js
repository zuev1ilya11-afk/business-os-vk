const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),http=require('node:http'),crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');

test('an installed old PWA preserves an open draft then redirects reload with VK query and fragment',async({browser})=>{
 let version='A',origin,target;
 const runtime=fs.readFileSync('app-build-runtime.js','utf8');
 const worker=fs.readFileSync('sw.js','utf8');
 const targetServer=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>New application login</h1>')});
 await new Promise(resolve=>targetServer.listen(0,'127.0.0.1',resolve));
 target=`http://127.0.0.1:${targetServer.address().port}/`;
 const server=http.createServer((req,res)=>{
  const path=new URL(req.url,origin).pathname.replace('/business-os-vk/','/');
  const html=`<html><body><input id="draft"><script src="build-version.js"></script><script src="app-build-runtime.js"></script><script>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(BOS_WATCH_UPDATE)</script></body></html>`;
  const manifest='self.BOS_BUILD='+JSON.stringify({id:version,shell:hash(html),assets:{'app-build-runtime.js':hash(runtime)}})+';';
  let code=worker.replace(/const BUILD_ID='[^']*';/,`const BUILD_ID='${version}';`);
  if(version==='B')code=code.replace('https://zuev1ilya11-afk.github.io',origin).replace('https://139.100.237.167/',target);
  const files={'/':html,'/index.html':html,'/sw.js':code,'/build-version.js':manifest,'/app-build-runtime.js':runtime};
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type',path.endsWith('.js')?'application/javascript':'text/html');
  res.writeHead(files[path]===undefined?404:200);res.end(files[path]??'Missing');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 origin=`http://127.0.0.1:${server.address().port}`;
 const context=await browser.newContext(),page=await context.newPage();
 const suffix='?vk_user_id=123&sign=abc%2Fdef%2Bghi&bos_push_order=115#orders';
 try{
  await page.goto(origin+'/business-os-vk/'+suffix);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.locator('#draft').fill('Сохранённый в открытой форме черновик');
  version='B';
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update()});
  await expect(page.locator('#bosBuildUpdate')).toBeVisible();
  await expect(page.locator('#draft')).toHaveValue('Сохранённый в открытой форме черновик');
  expect(await page.evaluate(()=>caches.has('business-os-build-A'))).toBe(true);
  await page.getByRole('button',{name:'Обновить',exact:true}).click();
  await expect(page).toHaveURL(target+suffix);
  await expect(page.getByRole('heading',{name:'New application login'})).toBeVisible();
 }finally{
  await context.close();
  await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>targetServer.close(resolve))]);
 }
});
