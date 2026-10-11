const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

for(const role of ['owner','manager','dispatcher'])test(`${role}: review shows original intake in Moscow without changing the order`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const {db}=await fullStack(page,role);
 Object.assign(db.tables.orders[0],{external_source:'hands',external_id:'hands:7344896',created_at:'2026-10-06T11:35:00Z',updated_at:'2026-10-09T10:00:00Z',report_uploaded_at:'2026-10-09T09:00:00Z',report_review_status:'pending'});
 const before=structuredClone(db.tables.orders);
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openReportReview('11'));
 const header=page.locator('.reportReviewReceived');
 await expect(header).toHaveText('Поступила: 06.10.2026 в 14:35');
 await expect(page.locator('#modalRoot')).toContainText('Заявка №7344896');
 await expect(header).toBeVisible();
 expect(await header.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 await page.evaluate(()=>{Object.assign(state.orders[0],{updated_at:'2026-10-10T13:00:00Z',report_uploaded_at:'2026-10-10T12:00:00Z',scheduled_date:'2026-10-12'});openReportReview('11')});
 await expect(header).toHaveText('Поступила: 06.10.2026 в 14:35');
 expect(db.tables.orders).toEqual(before);
 expect(db.calls.filter(c=>c.table==='orders'&&c.mode!=='select')).toEqual([]);
});

test('review uses created_at for Avito and reports absent or invalid intake explicitly',async({page})=>{
 await fullStack(page,'owner');await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>{Object.assign(state.orders[1],{created_at:'2026-09-30T22:05:00+00:00',source_updated_at:'2026-10-09T11:00:00Z'});openReportReview('12')});
 await expect(page.locator('.reportReviewReceived')).toHaveText('Поступила: 01.10.2026 в 01:05');
 for(const created_at of [null,'','not-a-date']){
  await page.evaluate(value=>{state.orders[1].created_at=value;openReportReview('12')},created_at);
  await expect(page.locator('.reportReviewReceived')).toHaveText('Дата поступления не указана');
 }
});
