const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('review modal keeps valid document links and omits executable URL schemes',async({page})=>{
 await fullStack(page,'dispatcher');
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>{
  Object.assign(state.orders[0],{report_uploaded_at:'2026-01-01',report_review_status:'pending',report_act_url:'javascript:alert(1)',report_measurement_url:'data:text/html,unsafe',report_photo_urls:JSON.stringify(['https://example.test/photo.jpg','javascript:alert(2)']),drive_archive_url:'javascript:alert(3)'});
  openReportReview(state.orders[0].id);
 });
 const modal=page.locator('#modalRoot');
 await expect(modal.getByRole('heading',{name:/Проверка отчёта/})).toBeVisible();
 await expect(modal.locator('.reportPhotoThumb img[src="https://example.test/photo.jpg"]')).toHaveCount(1);
 await modal.locator('.reportPhotoThumb').click();
 await expect(page.locator('#reportPhotoViewer')).toBeVisible();
 await expect(page.locator('#reportPhotoViewer img')).toHaveAttribute('src','https://example.test/photo.jpg');
 await page.locator('#reportPhotoViewer .reportPhotoViewerPanel button').click();
 await expect(page.locator('#reportPhotoViewer')).toHaveCount(0);
 await expect(modal.locator('a[href^="javascript:"],a[href^="data:"],a[href^="file:"]')).toHaveCount(0);
});

test('master document view refuses unsafe schemes and retains valid links',async({page})=>{
 await fullStack(page,'master');
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 const result=await page.evaluate(()=>{
  const html=reportLinksHtml({report_act_url:'https://example.test/act.pdf',report_type:'measurement',report_measurement_url:'javascript:alert(1)',report_photo_urls:JSON.stringify(['data:text/html,bad','https://example.test/photo.jpg'])});
  const root=document.createElement('div');root.innerHTML=html;
  return {links:[...root.querySelectorAll('a')].map(a=>a.href),photos:[...root.querySelectorAll('.reportPhotoThumb img')].map(img=>img.src),invalid:reportLinksHtml({report_act_url:'javascript:alert(1)'})};
 });
 expect(result.links).toEqual(['https://example.test/act.pdf']);expect(result.photos).toEqual(['https://example.test/photo.jpg']);expect(result.invalid).toBe('');
});

test('master mobile order card displays saved report photos and closes the viewer',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const f=await fullStack(page,'master');
 const photos=['https://example.test/photo1.jpg','https://example.test/photo2.jpg'];
 Object.assign(f.db.tables.orders[0],{report_uploaded_at:'2026-01-01',report_review_status:'pending',report_act_url:'https://example.test/act.pdf',report_photo_urls:JSON.stringify([...photos,'javascript:alert(1)','data:text/html,bad','file:///report.jpg'])});
 await page.route('https://example.test/*.jpg',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="blue"/></svg>'}));
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openOrder('11'));
 const modal=page.locator('#modalRoot');
 await expect(modal.locator('.reportPhotoThumb')).toHaveCount(2);
 for(const url of photos){
  const thumb=modal.locator(`.reportPhotoThumb img[src="${url}"]`);
  await expect(thumb).toBeVisible();
  await expect.poll(()=>thumb.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
 }
 await modal.locator('.reportPhotoThumb').nth(1).click();
 const viewer=page.locator('#reportPhotoViewer');
 await expect(viewer).toBeVisible();
 await expect(viewer.locator('img')).toHaveAttribute('src',photos[1]);
 await expect(viewer.getByRole('link',{name:'Открыть оригинал'})).toHaveAttribute('href',photos[1]);
 await viewer.getByRole('button',{name:'Закрыть',exact:true}).click();
 await expect(viewer).toHaveCount(0);
 await expect(modal.locator('.reportPhotoThumb')).toHaveCount(2);
 await expect(modal.locator('a[href^="javascript:"],a[href^="data:"],a[href^="file:"],img[src^="javascript:"],img[src^="data:"],img[src^="file:"]')).toHaveCount(0);
 expect(f.db.calls.filter(c=>c.table==='orders'&&c.mode==='update')).toEqual([]);
});
