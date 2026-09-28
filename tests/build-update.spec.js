const {test,expect}=require('@playwright/test');
const http=require('node:http'),fs=require('node:fs'),crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
test('new build waits for consent, reloads once, and stays usable offline',async({browser})=>{
 let version='A',broken=false;
 const runtime=fs.readFileSync('app-build-runtime.js','utf8');
 const worker=fs.readFileSync('sw.js','utf8');
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const fixture=`window.fixtureBuild='${version}';`;
  const manifest='self.BOS_BUILD='+JSON.stringify({id:version,assets:{'fixture.js':hash(fixture),'app-build-runtime.js':hash(runtime)}})+';';
  const html=`<html><head><meta name="bos-build-id" content="${version}"></head><body><input id="draft"><script src="build-version.js?build=${version}"></script><script src="app-build-runtime.js?build=${version}"></script><script src="fixture.js?build=${version}"></script><script>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(BOS_WATCH_UPDATE)</script></body></html>`;
  const files={'/':html,'/index.html':html,'/sw.js':worker.replace(/const BUILD_ID='[^']*';/,`const BUILD_ID='${version}';`),'/build-version.js':manifest,'/fixture.js':broken?'invalid deployment':fixture,'/app-build-runtime.js':runtime};
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',url.pathname.endsWith('.js')?'application/javascript; charset=utf-8':'text/html; charset=utf-8');
  res.writeHead(files[url.pathname]===undefined?404:200);res.end(files[url.pathname]??'Missing');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const context=await browser.newContext();const page=await context.newPage();let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++});
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.locator('#draft').fill('Несохранённые изменения');
  version='B';await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()});
  await expect(page.locator('#bosBuildUpdate')).toBeVisible();
  await expect(page.locator('#draft')).toHaveValue('Несохранённые изменения');
  expect(await page.evaluate(()=>fixtureBuild)).toBe('A');expect(navigations).toBe(1);
  await page.getByRole('button',{name:'Обновить',exact:true}).click();
  await page.waitForFunction(()=>window.fixtureBuild==='B');
  expect(navigations).toBe(2);await expect(page.locator('#bosBuildUpdate')).toHaveCount(0);
  await context.setOffline(true);await page.reload();
  expect(await page.evaluate(()=>fixtureBuild)).toBe('B');
  await context.setOffline(false);
  // A partial deployment must fail installation, preserving the working build.
  version='C';broken=true;
  const state=await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();const w=r.installing;if(!w)return 'no update';return new Promise(resolve=>w.addEventListener('statechange',()=>{if(['redundant','installed'].includes(w.state))resolve(w.state)}))});
  expect(state).toBe('redundant');await expect(page.locator('#bosBuildUpdate')).toHaveCount(0);
  await page.reload();
  expect(await page.evaluate(()=>fixtureBuild)).toBe('B');
 }finally{await context.close();await new Promise(r=>server.close(r))}
});
