const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {fullStack}=require('./helpers/full-stack.cjs');
const {attachmentUrl}=require('./helpers/edge.cjs');
const origin='https://homemaster.qd.je';
for(const role of ['owner','manager'])test(`${role}: current HTTPS origin, double click, response loss, reload and report links`,async({page})=>{
 const {db}=await fullStack(page,role),o=db.tables.orders[0];
 Object.assign(o,{report_review_status:'pending',report_upload_token:'r1',report_uploaded_at:'2026-10-30T08:00:00Z',report_act_url:attachmentUrl('11','r1').replace('https://test.invalid','https://139.100.237.167:8443'),report_photo_urls:JSON.stringify([attachmentUrl('11','r1','photo.jpg').replace('https://test.invalid','https://139.100.237.167:8443')])});
 await page.route(origin+'/**',async r=>{
  const u=new URL(r.request().url());if(u.pathname.startsWith('/functions/'))return r.fallback();
  if(u.pathname.startsWith('/storage/'))return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lYkAAAAASUVORK5CYII=','base64')});
  const file=path.resolve('.','.'+(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(process.cwd()+path.sep)||!fs.existsSync(file))return r.fulfill({status:404,body:''});
  const type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html';
  return r.fulfill({contentType:type,body:fs.readFileSync(file)});
 });
 let reviews=0;const {edge}=require('./helpers/edge.cjs');const api=edge('order-lifecycle-api',db);
 await page.route(origin+'/functions/v1/order-lifecycle-api',async r=>{
  reviews++;const request=r.request();await api(request.postDataJSON(),'ignored',request.headers()['x-bos-session']);
  // The DB committed, but the mobile connection lost the response.
  await r.abort('failed');
 });
 await page.goto(origin);await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openReportReview('11'));
 await expect(page.locator('a').filter({hasText:'Открыть акт'})).toHaveAttribute('href',/^https:\/\/homemaster\.qd\.je\/storage\//);
 await page.locator('.reportPhotoThumb').click();
 await expect(page.locator('#reportPhotoViewer a')).toHaveAttribute('href',/^https:\/\/homemaster\.qd\.je\/storage\//);
 await page.evaluate(()=>BOS_CLOSE_REPORT_PHOTO());
 await page.evaluate(()=>{document.getElementById('approveReportBtn').click();document.getElementById('approveReportBtn').click()});
 await expect(page.locator('#reportReviewNotice')).toContainText('Отчёт принят');
 expect(reviews).toBe(1);expect(o.report_review_status).toBe('approved');
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();
 expect(await page.evaluate(()=>state.orders.find(o=>o.id==='11').report_review_status)).toBe('approved');
 await page.evaluate(()=>openReportReview('11'));await expect(page.locator('#approveReportBtn')).toBeDisabled();
});
