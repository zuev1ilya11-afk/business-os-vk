const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {edge,attachmentUrl}=require('./helpers/edge.cjs');
for(const action of ['approve','reject','archive'])test(`${action}: modal keeps the displayed report snapshot after background data changes`,async({page})=>{
 const {db,me}=await fullStack(page,'dispatcher'),o=db.tables.orders[0];
 Object.assign(o,{report_review_status:'pending',report_uploaded_at:'2026-01-01T10:00:00Z',report_upload_token:'r1',report_act_url:attachmentUrl(o.id,'r1'),report_photo_urls:JSON.stringify([attachmentUrl(o.id,'r1','photo.jpg')])});
 const slug=action==='archive'?'drive-archive-api':'order-lifecycle-api',api=edge(slug,db),calls=[];
 await page.route(new RegExp('/(?:api/proxy|functions/v1)/'+slug+'(?:\\?|$)'),async route=>{
  const b=route.request().postDataJSON();calls.push(b);const r=await api(b,me.external_id);
  await route.fulfill({status:r.status,contentType:'application/json',body:JSON.stringify(r.body)});
 });
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openReportReview('11'));
 await expect(page.locator('#reviewForm')).toBeVisible();
 // Same token can be reused after rejection: timestamp must also remain the displayed one.
 o.report_uploaded_at='2026-01-02T10:00:00Z';
 await page.evaluate(()=>state.orders.find(o=>o.id==='11').report_uploaded_at='2026-01-02T10:00:00Z');
 if(action==='reject')await page.locator('#reviewComment').fill('Добавьте фотографию');
 await page.locator(action==='archive'?'button[onclick^="retryDriveArchive"]':action==='approve'?'#approveReportBtn':'#rejectReportBtn').click();
 await expect(page.locator(action==='archive'?'#archiveMsg':'#reviewMsg')).toContainText('Обновите заявку');
 expect(calls).toHaveLength(1);expect(calls[0].expected_report_token).toBe('r1');expect(calls[0].expected_report_uploaded_at).toBe('2026-01-01T10:00:00Z');
 expect(o.report_review_status).toBe('pending');expect(o.completed_at).toBeUndefined();
 await expect(page.locator('#reviewForm')).toBeVisible();
});
