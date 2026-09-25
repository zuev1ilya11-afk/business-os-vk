const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('owner employee card recalculates master payout from current completed amount',async({page})=>{
  const {db,master}=await fullStack(page,'owner');
  const order=db.tables.orders.find(o=>String(o.id)==='11');
  order.status='Выполнена';
  order.amount=1000;
  order.master_payout=297.5;

  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=team]').click();
  await page.getByRole('button',{name:/Тестовый мастер/}).click();

  const payoutCard=page.getByText('Выплата',{exact:true}).locator('..');
  await expect(payoutCard).toContainText('552,5');
  await expect(payoutCard).not.toContainText('297,5');
});
