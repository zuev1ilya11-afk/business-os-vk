const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

function prepareReports(db){
  const orders=db.tables.orders;
  orders.forEach(o=>{o.report_uploaded_at=null;o.report_review_status=null;o.extra_work_amount=0;o.uncompleted_work_amount=0});
  const [oldReport,recentReport,extraReport]=orders.slice(0,3);
  Object.assign(oldReport,{report_uploaded_at:'2026-09-22T06:00:00Z',report_review_status:'pending',master_name:'Мастер Старый',address:'Старый адрес',amount:10000});
  Object.assign(recentReport,{report_uploaded_at:'2026-09-24T10:00:00Z',report_review_status:'pending',master_name:'Мастер Новый',address:'Новый адрес',amount:8000});
  Object.assign(extraReport,{report_uploaded_at:'2026-09-23T09:00:00Z',report_review_status:'pending',master_name:'Мастер Доп',address:'Адрес допработ',amount:12000,extra_work_amount:1500});
  return{oldReport,recentReport,extraReport};
}

test('dispatcher sees full pending report queue with age and useful filters',async({page})=>{
  const {db}=await fullStack(page,'dispatcher');
  const {oldReport,recentReport,extraReport}=prepareReports(db);
  await page.addInitScript(()=>{window.__BOS_REPORT_QUEUE_NOW='2026-09-24T12:00:00Z'});
  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>!!window.BOS_REPORT_REVIEW_QUEUE_V129);

  const homeQueue=page.locator('.reportQueue');
  await expect(homeQueue).toBeVisible();
  await expect(homeQueue.locator('.rrq129Open')).toHaveText('Все отчёты');
  await homeQueue.locator('.rrq129Open').click();

  await expect(page.getByRole('heading',{name:'Очередь проверки'})).toBeVisible();
  await expect(page.locator('.rrq129Card')).toHaveCount(3);
  await expect(page.locator('.rrq129Card').first()).toHaveAttribute('data-report-order-id',String(oldReport.id));
  await expect(page.locator(`.rrq129Card[data-report-order-id="${oldReport.id}"] .rrq129Top strong`)).toContainText('2 д');

  await page.getByRole('button',{name:/Ждут >24 ч/}).click();
  await expect(page.locator('.rrq129Card')).toHaveCount(2);
  await expect(page.locator(`.rrq129Card[data-report-order-id="${recentReport.id}"]`)).toHaveCount(0);

  await page.getByRole('button',{name:/С допработами/}).click();
  await expect(page.locator('.rrq129Card')).toHaveCount(1);
  await expect(page.locator('.rrq129Card').first()).toHaveAttribute('data-report-order-id',String(extraReport.id));
  await expect(page.locator('.rrq129Card').first()).toContainText('Допработы');

  await page.getByRole('button',{name:/Все/}).click();
  await page.locator(`.rrq129Card[data-report-order-id="${oldReport.id}"]`).click();
  await expect(page.locator('#modalRoot')).toContainText(`Проверка отчёта ${oldReport.id}`);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('master cannot open management report queue',async({page})=>{
  const {db}=await fullStack(page,'master');
  prepareReports(db);
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>!!window.BOS_REPORT_REVIEW_QUEUE_V129);
  await expect(page.locator('.rrq129Open')).toHaveCount(0);
  const opened=await page.evaluate(()=>window.showReportQueueV129());
  expect(opened).toBe(false);
  await expect(page.getByRole('heading',{name:'Очередь проверки'})).toHaveCount(0);
});
