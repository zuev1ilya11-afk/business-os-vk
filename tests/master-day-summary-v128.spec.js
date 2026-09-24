const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('master v128 shows today totals with current payout formula and no legacy duplicate',async({page})=>{
  const {db}=await fullStack(page,'master');
  const today=localDate(),done=db.tables.orders.find(o=>String(o.id)==='11')||db.tables.orders[0];
  for(const o of db.tables.orders){o.status='В работе';o.report_review_status=null;o.completed_at=null;o.scheduled_date='2099-09-10';o.extra_work_amount=0}
  Object.assign(done,{
    status:'Выполнена',
    report_review_status:'approved',
    scheduled_date:today,
    completed_at:null,
    amount:1000,
    master_payout:297.5,
    extra_work_amount:100,
    client:'Анна Пичуева',
    work:'Установка карниза'
  });

  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_DAY_SUMMARY_V128===true);
  await page.evaluate(()=>{show('home');window.BOS_MASTER_DAY_SUMMARY_V128_API.refresh()});

  await expect(page.locator('#masterDailyV127')).toBeVisible();
  await expect(page.locator('.bosMasterTodayWorkflow:visible')).toHaveCount(0);

  const summary=page.locator('#masterDaySummaryV128');
  await expect(summary).toBeVisible();
  await expect(summary.getByRole('heading',{name:'Сегодня'})).toBeVisible();
  await expect(summary.locator('.masterV128Head')).toContainText('1 выполнено');
  await expect(summary.getByText('Выполнено',{exact:true}).locator('..')).toContainText('1');
  await expect(summary.getByText('По заявкам',{exact:true}).locator('..')).toContainText(/552[,.]5/);
  await expect(summary.getByText('Допработы',{exact:true}).locator('..')).toContainText(/100/);
  await expect(summary.getByText('Итого',{exact:true}).locator('..')).toContainText(/652[,.]5/);
  await expect(summary).not.toContainText('297,5');
  await expect(summary.locator('.masterV128Done')).toContainText('Анна Пичуева');

  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('master v128 summary is not rendered for dispatcher',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>show('home'));
  await expect(page.locator('#masterDaySummaryV128')).toHaveCount(0);
});


test('approved order refresh flows from working day to daily totals and cabinet without duplicate earnings',async({page})=>{
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders.find(o=>String(o.id)==='11');
  order.scheduled_date='2020-01-01';
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await expect(page.locator('#masterDaySummaryV128 .masterV128Empty')).toBeVisible();

  // Model the existing report approval response in the server fixture; refresh via real bootstrap.
  Object.assign(order,{status:'Выполнена',report_review_status:'approved',completed_at:null,
    report_reviewed_at:new Date().toISOString(),amount:1000,master_payout:552.5,
    extra_work_amount:100,uncompleted_work_amount:200});
  await page.evaluate(()=>window.BOS_REFRESH_NOW());
  const summary=page.locator('#masterDaySummaryV128');
  await expect(summary.locator('.masterV128Done')).toHaveCount(1);
  await expect(summary.getByText('Итого',{exact:true}).locator('..')).toContainText(/652[,.]5/);
  await expect(summary.getByText('Допработы',{exact:true}).locator('..')).toContainText('100');
  await expect(summary.getByText('Вычеты (уже учтены)',{exact:true}).locator('..')).toContainText('200');

  await page.locator('nav button[data-page="team"]').click();
  const panel=page.locator('#masterProfileSummaryV129');
  for(const label of ['ЗП сегодня','ЗП за неделю','ЗП за месяц','Общая зарплата']){
    await expect(panel.getByText(label,{exact:true}).locator('..')).toContainText(/652[,.]5/);
  }
  await expect(panel.getByText('Вычеты',{exact:true}).locator('..')).toContainText('200');
  await expect(page.locator('.masterCabinetV141Order')).toHaveCount(1);
  await expect(page.locator('.masterCabinetV141Order')).toContainText('Итого 652,5');
  await page.evaluate(()=>window.BOS_REFRESH_NOW());
  await expect(page.locator('.masterCabinetV141Order')).toHaveCount(1);
});
