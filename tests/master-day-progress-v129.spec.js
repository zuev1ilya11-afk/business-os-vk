const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('master v129 shows daily progress and remaining workload',async({page})=>{
  const {db}=await fullStack(page,'master');
  const today=localDate();
  const first=db.tables.orders.find(o=>String(o.id)==='11')||db.tables.orders[0];
  const second=db.tables.orders.find(o=>String(o.id)==='12')||db.tables.orders[1];

  for(const o of db.tables.orders){o.scheduled_date='2099-09-10';o.status='В работе';o.report_review_status=null;o.completed_at=null}
  Object.assign(first,{scheduled_date:today,scheduled_time:'10:00',status:'Выполнена',report_review_status:'approved'});
  Object.assign(second,{scheduled_date:today,scheduled_time:'15:30',status:'В работе',report_review_status:null});

  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_DAY_PROGRESS_V129===true);
  await page.evaluate(()=>{show('home');window.BOS_MASTER_DAY_PROGRESS_V129_API.refresh()});

  const progress=page.locator('#masterDayProgressV129');
  await expect(progress).toBeVisible();
  await expect(progress.getByRole('heading',{name:'1 из 2 выполнено'})).toBeVisible();
  await expect(progress).toContainText('50%');
  await expect(progress).toContainText('Осталось: 1');
  await expect(progress).toContainText('Ближайшая в 15:30');
  await expect(progress.locator('.masterV129Bar span')).toHaveAttribute('style',/width:50%/);
  await expect(page.locator('body')).not.toHaveCSS('overflow-x','scroll');
});

test('master v129 does not render for dispatcher',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_DAY_PROGRESS_V129===true);
  await page.evaluate(()=>show('home'));
  await expect(page.locator('#masterDayProgressV129')).toHaveCount(0);
});
