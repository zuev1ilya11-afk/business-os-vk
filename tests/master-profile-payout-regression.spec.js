const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master preview recalculates payout from current order amount instead of stale stored payout',async({page})=>{
  const {db,master}=await fullStack(page,'owner');
  const order=db.tables.orders.find(o=>String(o.id)==='11');
  order.status='Выполнена';
  order.completed_at=new Date().toISOString();
  order.amount=1000;
  order.master_payout=297.5;

  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();

  await page.evaluate(({masterVkId})=>{
    enterMasterPreview(masterVkId);
  },{masterVkId:master.external_id});

  await page.waitForFunction(()=>window.BOS_MASTER_MONEY_V130_API?.periodSnapshot);
  await page.locator('nav button[data-page="team"]').click();
  const payoutCard=page.locator('#masterMoneyV130').getByText('По заявкам',{exact:true}).locator('..');
  const salaryCard=page.locator('.salaryHero');
  await expect(payoutCard).toContainText('552,5');
  await expect(payoutCard).not.toContainText('297,5');
  await expect(salaryCard).toContainText('552,5');
  await expect(salaryCard).not.toContainText('297,5');
});
