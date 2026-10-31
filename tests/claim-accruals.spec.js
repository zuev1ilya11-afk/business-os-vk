const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function prepare(page,role,known=true){
 await page.clock.install({time:new Date('2026-10-31T15:00:00Z')});await page.setViewportSize({width:390,height:844});
 const data=await fullStack(page,role),o=data.db.tables.orders[0];
 Object.assign(o,{order_number:'7395762',status:'Выполнена',report_review_status:'approved',completed_at:'2026-10-31T14:24:50Z',report_reviewed_at:'2026-10-31T14:24:50Z',is_claim:true,master_payout:3754.79,extra_work_amount:0});
 data.db.tables.order_financial_snapshots=known?[{order_id:o.id,financial_data:{...o,is_claim:undefined,completed_at:'2026-09-25T12:00:00Z',report_reviewed_at:'2026-09-25T12:00:00Z',scheduled_date:'2026-09-25'}}]:[];
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();return data;
}
test('master sees original claim earnings only in the original month, without repeated pay',async({page})=>{
 await prepare(page,'master');await page.evaluate(()=>show('team'));
 await page.getByRole('button',{name:'Подробнее →',exact:true}).click();
 const panel=page.locator('#masterMoneyV130');await expect(panel).toBeVisible();
 await panel.getByRole('button',{name:'Месяц',exact:true}).click();await expect(panel.locator('.salaryHero')).toContainText('0 ₽');await expect(panel.locator('.salaryOrder')).toHaveCount(0);
 await panel.locator('[data-money-action="previous"]').click();
 await expect(panel.locator('.salaryHero')).toContainText(/3[\s ]?754[,.]79/);await expect(panel.locator('.salaryOrder')).toHaveCount(1);
 await expect(panel).toContainText('7395762');
});
test('finance keeps claim earnings in the original period and warns about missing historical data',async({page})=>{
 const {db}=await prepare(page,'owner');await page.locator('nav [data-page="finance"]').click();
 await expect(page.locator('[data-fin-kpi="pay"] strong')).toHaveText('0 ₽');
 await page.locator('.finPeriodControl').evaluate(n=>n.open=true);await page.locator('[data-fin-period="custom"]').click();
 await page.locator('#finPeriodForm [name="from"]').fill('2026-09-01');await page.locator('#finPeriodForm [name="to"]').fill('2026-09-30');await page.locator('#finPeriodForm button').click();
 await expect(page.locator('[data-fin-kpi="pay"] strong')).toContainText(/3[\s ]?754[,.]79/);
 db.tables.order_financial_snapshots=[];await page.evaluate(()=>BOS_REFRESH_NOW());
 await expect(page.locator('#financePage')).toContainText('не восстановлено исходное начисление');
});
test('original master keeps salary history when a claim is assigned to someone else',async({page})=>{
 const {db}=await prepare(page,'master');db.tables.orders[0].master_staff_id='someone-else';
 await page.evaluate(()=>BOS_REFRESH_NOW());await page.evaluate(()=>show('team'));
 await page.getByRole('button',{name:'Подробнее →',exact:true}).click();
 const panel=page.locator('#masterMoneyV130');await panel.getByRole('button',{name:'Месяц',exact:true}).click();
 await expect(panel.locator('.salaryHero')).toContainText('0 ₽');
 await panel.locator('[data-money-action="previous"]').click();
 await expect(panel.locator('.salaryHero')).toContainText(/3[\s ]?754[,.]79/);await expect(panel.locator('.salaryOrder')).toHaveCount(1);
});
