const {test,expect}=require('@playwright/test');
const http=require('node:http'),fs=require('node:fs'),crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=','base64');
const jpg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDAooor6o8c/9k=','base64');
function pdf(){
 let out='%PDF-1.4\n',offsets=[0];
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>'];
 objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${o}\nendobj\n`});
 const start=Buffer.byteLength(out);out+='xref\n0 4\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
 return Buffer.from(out+`trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
test('installed PWA opens old/new signed JPG, PNG and PDF responses; denies missing signatures and never caches documents',async({browser})=>{
 const worker=fs.readFileSync('sw.js','utf8'),version=worker.match(/const BUILD_ID='([^']+)'/)[1],hits=[];
 const html='<html><body>APP SHELL<iframe title="PDF"></iframe><script>navigator.serviceWorker.register("/sw.js")</script></body></html>';
 const manifest='self.BOS_BUILD='+JSON.stringify({id:version,shell:hash(html),assets:{}})+';';
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
  if(url.pathname.startsWith('/storage/v1/')){
   hits.push(url.pathname);res.setHeader('Content-Type','application/json');
   if(url.searchParams.get('token')!=='valid'){res.writeHead(403);return res.end('{"error":"invalid signature"}')}
   const ext=url.pathname.split('.').pop(),bytes=ext==='pdf'?pdf():ext==='jpg'?jpg:png;
   res.setHeader('Content-Type',ext==='pdf'?'application/pdf':ext==='jpg'?'image/jpeg':'image/png');res.writeHead(200);return res.end(bytes);
  }
  const body=url.pathname==='/sw.js'?worker:url.pathname==='/build-version.js'?manifest:html;
  res.setHeader('Content-Type',url.pathname.endsWith('.js')?'application/javascript':'text/html');res.writeHead(200);res.end(body);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),origin=`http://127.0.0.1:${server.address().port}`;
 try{
  await page.goto(origin);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  for(const suffix of ['orders/11/before-migration/act.png','orders/12/after-migration/act.jpg']){
   const doc=await context.newPage(),url=origin+'/storage/v1/object/sign/bucket/'+suffix+'?token=valid';
   const response=await doc.goto(url);expect(response.status()).toBe(200);expect(response.fromServiceWorker()).toBe(false);
   expect(response.headers()['content-type']).toMatch(/^image\//);await expect.poll(()=>doc.locator('img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
   await doc.reload();await expect.poll(()=>doc.locator('img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);await doc.close();
  }
  const pdfURL=origin+'/storage/v1/object/sign/bucket/orders/12/new/act.pdf?token=valid';
  const responsePromise=page.waitForResponse(pdfURL);await page.locator('iframe').evaluate((frame,url)=>frame.src=url,pdfURL);
  const response=await responsePromise;expect(response.status()).toBe(200);expect(response.headers()['content-type']).toBe('application/pdf');expect(response.fromServiceWorker()).toBe(false);
  const denied=await context.newPage();const deniedResponse=await denied.goto(pdfURL.split('?')[0]);expect(deniedResponse.status()).toBe(403);await expect(denied.locator('body')).toContainText('invalid signature');await denied.close();
  expect(await page.evaluate(async()=>{const urls=[];for(const name of await caches.keys())for(const req of await (await caches.open(name)).keys())urls.push(req.url);return urls.some(url=>url.includes('/storage/v1/'))})).toBe(false);
  expect(hits.length).toBeGreaterThanOrEqual(6);
  await context.setOffline(true);await page.reload();await expect(page.locator('body')).toContainText('APP SHELL');
 }finally{await context.close();await new Promise(r=>server.close(r))}
});
