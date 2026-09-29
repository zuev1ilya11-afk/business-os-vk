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
 await expect(modal.locator('a[href="https://example.test/photo.jpg"]')).toHaveCount(1);
 await expect(modal.locator('a[href^="javascript:"],a[href^="data:"],a[href^="file:"]')).toHaveCount(0);
});

test('master document view refuses unsafe schemes and retains valid links',async({page})=>{
 await fullStack(page,'master');
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 const result=await page.evaluate(()=>{
  const html=reportLinksHtml({report_act_url:'https://example.test/act.pdf',report_type:'measurement',report_measurement_url:'javascript:alert(1)',report_photo_urls:JSON.stringify(['data:text/html,bad','https://example.test/photo.jpg'])});
  const root=document.createElement('div');root.innerHTML=html;
  return {links:[...root.querySelectorAll('a')].map(a=>a.href),invalid:reportLinksHtml({report_act_url:'javascript:alert(1)'})};
 });
 expect(result.links).toEqual(['https://example.test/act.pdf','https://example.test/photo.jpg']);expect(result.invalid).toBe('');
});
