const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('report review shows what extra work the master entered',async({page})=>{
  const {db}=await fullStack(page,'owner');
  Object.assign(db.tables.orders[0],{
    report_uploaded_at:new Date().toISOString(),
    report_review_status:'pending',
    extra_work_done:true,
    extra_work_amount:2000,
    extra_work_description:'Демонтаж старого карниза\nУстановка дополнительных креплений'
  });

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>typeof window.openReportReview)).toBe('function');
  await page.evaluate(()=>window.openReportReview('11'));

  await expect(page.getByRole('heading',{name:/Проверка отчёта 11/})).toBeVisible();
  await expect(page.getByText('Что указал мастер:')).toBeVisible();
  await expect(page.getByText(/Демонтаж старого карниза/)).toBeVisible();
  await expect(page.getByText(/Установка дополнительных креплений/)).toBeVisible();
  await expect(page.locator('.reportExtraWorkDetails')).toContainText(/2\s?000/);
});
