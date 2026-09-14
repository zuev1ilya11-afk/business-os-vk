const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master preview recalculates payout from current order amount instead of stale stored payout',async({page})=>{
  const {db,master}=await fullStack(page,'owner');
  const order=db.tables.orders.find(o=>String(o.id)==='11');
  order.status='Выполнена';
  order.amount=1000;
  order.master_payout=297.5;

  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();

  await page.evaluate(({masterVkId})=>{
    enterMasterPreview(masterVkId);
  },{masterVkId:master.external_id});

  const payoutCard=page.locator('.masterKpi').filter({hasText:'Моя выплата'});
  await expect(payoutCard).toContainText('552,5');
  await expect(payoutCard).not.toContainText('297,5');
});
